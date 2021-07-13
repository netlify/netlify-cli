const path = require('path')
const process = require('process')
const { promisify } = require('util')

const { flags: flagsLib } = require('@oclif/command')
const boxen = require('boxen')
const chalk = require('chalk')
const execa = require('execa')
const StaticServer = require('static-server')
const stripAnsiCc = require('strip-ansi-control-characters')
const waitPort = require('wait-port')

const { startFunctionsServer } = require('../../lib/functions/server')
const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const { detectServerSettings } = require('../../utils/detect-server-settings')
const { getSiteInformation, injectEnvVariables } = require('../../utils/dev')
const { startLiveTunnel } = require('../../utils/live-tunnel')
const { NETLIFYDEV, NETLIFYDEVLOG, NETLIFYDEVWARN, NETLIFYDEVERR } = require('../../utils/logo')
const openBrowser = require('../../utils/open-browser')
const { startProxy } = require('../../utils/proxy')
const { startForwardProxy } = require('../../utils/traffic-mesh')

const startStaticServer = async ({ settings }) => {
  const server = new StaticServer({
    rootPath: settings.dist,
    name: 'netlify-dev',
    port: settings.frameworkPort,
    templates: {
      notFound: path.join(settings.dist, '404.html'),
    },
  })

  await promisify(server.start.bind(server))()
  log(`\n${NETLIFYDEVLOG} Static server listening to`, settings.frameworkPort)
}

const isNonExistingCommandError = ({ command, error }) => {
  // `ENOENT` is only returned for non Windows systems
  // See https://github.com/sindresorhus/execa/pull/447
  if (error.code === 'ENOENT') {
    return true
  }

  // if the command is a package manager we let it report the error
  if (['yarn', 'npm'].includes(command)) {
    return false
  }

  // this only works on English versions of Windows
  return (
    typeof error.message === 'string' && error.message.includes('is not recognized as an internal or external command')
  )
}

const startFrameworkServer = async function ({ settings, exit }) {
  if (settings.useStaticServer) {
    return await startStaticServer({ settings })
  }

  log(`${NETLIFYDEVLOG} Starting Netlify Dev with ${settings.framework || 'custom config'}`)

  // we use reject=false to avoid rejecting synchronously when the command doesn't exist
  const frameworkProcess = execa.command(settings.command, { preferLocal: true, reject: false })
  frameworkProcess.stdout.pipe(stripAnsiCc.stream()).pipe(process.stdout)
  frameworkProcess.stderr.pipe(stripAnsiCc.stream()).pipe(process.stderr)
  process.stdin.pipe(frameworkProcess.stdin)

  // we can't try->await->catch since we don't want to block on the framework server which
  // is a long running process
  // eslint-disable-next-line promise/catch-or-return,promise/prefer-await-to-then
  frameworkProcess.then(async () => {
    const result = await frameworkProcess
    const [commandWithoutArgs] = settings.command.split(' ')
    // eslint-disable-next-line promise/always-return
    if (result.failed && isNonExistingCommandError({ command: commandWithoutArgs, error: result })) {
      log(
        NETLIFYDEVERR,
        `Failed launching framework server. Please verify ${chalk.magenta(`'${commandWithoutArgs}'`)} exists`,
      )
    } else {
      const errorMessage = result.failed
        ? `${NETLIFYDEVERR} ${result.shortMessage}`
        : `${NETLIFYDEVWARN} "${settings.command}" exited with code ${result.exitCode}`

      log(`${errorMessage}. Shutting down Netlify Dev server`)
    }
    process.exit(1)
  })
  ;['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP', 'exit'].forEach((signal) => {
    process.on(signal, () => {
      frameworkProcess.kill('SIGTERM', { forceKillAfterTimeout: 500 })
      process.exit()
    })
  })

  try {
    const open = await waitPort({
      port: settings.frameworkPort,
      output: 'silent',
      timeout: FRAMEWORK_PORT_TIMEOUT,
      ...(settings.pollingStrategies.includes('HTTP') && { protocol: 'http' }),
    })

    if (!open) {
      throw new Error(`Timed out waiting for port '${settings.frameworkPort}' to be open`)
    }
  } catch (error) {
    log(NETLIFYDEVERR, `Netlify Dev could not connect to localhost:${settings.frameworkPort}.`)
    log(NETLIFYDEVERR, `Please make sure your framework server is running on port ${settings.frameworkPort}`)
    exit(1)
  }
}

// 10 minutes
const FRAMEWORK_PORT_TIMEOUT = 6e5

const startProxyServer = async ({ flags, settings, site, exit, addonsUrls }) => {
  let url
  if (flags.edgeHandlers || flags.trafficMesh) {
    url = await startForwardProxy({
      port: settings.port,
      frameworkPort: settings.frameworkPort,
      functionsPort: settings.functionsPort,
      publishDir: settings.dist,
      debug: flags.debug,
      locationDb: flags.locationDb,
      jwtRolesPath: settings.jwtRolePath,
      jwtSecret: settings.jwtSecret,
    })
    if (!url) {
      log(NETLIFYDEVERR, `Unable to start forward proxy on port '${settings.port}'`)
      exit(1)
    }
  } else {
    url = await startProxy(settings, addonsUrls, site.configPath, site.root)
    if (!url) {
      log(NETLIFYDEVERR, `Unable to start proxy server on port '${settings.port}'`)
      exit(1)
    }
  }
  return url
}

const handleLiveTunnel = async ({ flags, site, api, settings }) => {
  if (flags.live) {
    const sessionUrl = await startLiveTunnel({
      siteId: site.id,
      netlifyApiToken: api.accessToken,
      localPort: settings.port,
    })
    process.env.BASE_URL = sessionUrl
    return sessionUrl
  }
}

const printBanner = ({ url }) => {
  const banner = chalk.bold(`${NETLIFYDEVLOG} Server now ready on ${url}`)

  log(
    boxen(banner, {
      padding: 1,
      margin: 1,
      align: 'center',
      borderColor: '#00c7b7',
    }),
  )
}

class DevCommand extends Command {
  async init() {
    this.commandContext = 'dev'
    await super.init()
  }

  async run() {
    log(`${NETLIFYDEV}`)
    const { error: errorExit, warn, exit } = this
    const { flags } = this.parse(DevCommand)
    const { api, site, config, siteInfo } = this.netlify
    config.dev = { ...config.dev }
    config.build = { ...config.build }
    const devConfig = {
      framework: '#auto',
      ...(config.functionsDirectory && { functions: config.functionsDirectory }),
      ...(config.build.publish && { publish: config.build.publish }),
      ...config.dev,
      ...flags,
    }

    if (flags.trafficMesh) {
      warn(
        '--trafficMesh and -t are deprecated and will be removed in the near future. Please use --edgeHandlers or -e instead.',
      )
    }

    await injectEnvVariables({ env: this.netlify.cachedConfig.env, site, warn })
    const { addonsUrls, siteUrl, capabilities, timeouts } = await getSiteInformation({
      flags,
      api,
      site,
      warn,
      error: errorExit,
      siteInfo,
    })

    let settings = {}
    try {
      settings = await detectServerSettings(devConfig, flags, site.root)
    } catch (error) {
      log(NETLIFYDEVERR, error.message)
      exit(1)
    }

    this.setAnalyticsPayload({ projectType: settings.framework || 'custom', live: flags.live })

    await startFunctionsServer({
      config,
      settings,
      site,
      warn,
      errorExit,
      siteUrl,
      capabilities,
      timeouts,
    })
    await startFrameworkServer({ settings, exit })

    let url = await startProxyServer({ flags, settings, site, exit, addonsUrls })

    const liveTunnelUrl = await handleLiveTunnel({ flags, site, api, settings })
    url = liveTunnelUrl || url

    if (devConfig.autoLaunch !== false) {
      await openBrowser({ url, silentBrowserNoneError: true })
    }

    process.env.URL = url
    process.env.DEPLOY_URL = url

    printBanner({ url })
  }
}

DevCommand.description = `Local dev server
The dev command will run a local dev server with Netlify's proxy and redirect rules
`

DevCommand.examples = [
  '$ netlify dev',
  '$ netlify dev -d public',
  '$ netlify dev -c "hugo server -w" --targetPort 1313',
]

DevCommand.strict = false

DevCommand.flags = {
  command: flagsLib.string({
    char: 'c',
    description: 'command to run',
  }),
  port: flagsLib.integer({
    char: 'p',
    description: 'port of netlify dev',
  }),
  targetPort: flagsLib.integer({
    description: 'port of target app server',
  }),
  framework: flagsLib.string({
    description: 'framework to use. Defaults to #auto which automatically detects a framework',
  }),
  staticServerPort: flagsLib.integer({
    description: 'port of the static app server used when no framework is detected',
    hidden: true,
  }),
  dir: flagsLib.string({
    char: 'd',
    description: 'dir with static files',
  }),
  functions: flagsLib.string({
    char: 'f',
    description: 'specify a functions folder to serve',
  }),
  offline: flagsLib.boolean({
    char: 'o',
    description: 'disables any features that require network access',
  }),
  live: flagsLib.boolean({
    char: 'l',
    description: 'start a public live session',
    default: false,
  }),
  edgeHandlers: flagsLib.boolean({
    char: 'e',
    hidden: true,
    description: 'activates the Edge Handlers runtime',
  }),
  trafficMesh: flagsLib.boolean({
    char: 't',
    hidden: true,
    description: '(DEPRECATED: use --edgeHandlers or -e instead) uses Traffic Mesh for proxying requests',
  }),
  locationDb: flagsLib.string({
    description: 'specify the path to a local GeoIP location database in MMDB format',
    char: 'g',
    hidden: true,
  }),
  ...DevCommand.flags,
}

module.exports = DevCommand
