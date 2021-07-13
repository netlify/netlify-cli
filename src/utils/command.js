const process = require('process')
const { URL } = require('url')

const resolveConfig = require('@netlify/config')
const { flags: flagsLib } = require('@oclif/command')
const oclifParser = require('@oclif/parser')
const merge = require('lodash/merge')
const argv = require('minimist')(process.argv.slice(2))
const API = require('netlify')
const omit = require('omit.js').default

const { getAgent } = require('../lib/http-agent')

const chalkInstance = require('./chalk')
const { pollForToken, log, getToken } = require('./command-helpers')
const getGlobalConfig = require('./get-global-config')
const openBrowser = require('./open-browser')
const StateConfig = require('./state-config')
const { track, identify } = require('./telemetry')
const { TrackedCommand } = require('./telemetry/tracked-command')

const { NETLIFY_API_URL } = process.env

// Netlify CLI client id. Lives in bot@netlify.com
// Todo setup client for multiple environments
const CLIENT_ID = 'd6f37de6614df7ae58664cfca524744d73807a377f5ee71f1a254f78412e3750'

class BaseCommand extends TrackedCommand {
  // Initialize context
  async init() {
    await super.init()

    const cwd = argv.cwd || process.cwd()
    // Grab netlify API token
    const authViaFlag = getAuthArg(argv)
    const { normalizeConfig } = BaseCommand

    const [token] = await getToken(authViaFlag)

    // Get site id & build state
    const state = new StateConfig(cwd)

    const apiUrlOpts = {}

    if (NETLIFY_API_URL) {
      const apiUrl = new URL(NETLIFY_API_URL)
      apiUrlOpts.scheme = apiUrl.protocol.slice(0, -1)
      apiUrlOpts.host = apiUrl.host
      apiUrlOpts.pathPrefix = NETLIFY_API_URL === `${apiUrl.protocol}//${apiUrl.host}` ? '/api/v1' : apiUrl.pathname
    }

    const cachedConfig = await this.getConfig({ cwd, state, token, ...apiUrlOpts })
    const { configPath, config, buildDir, repositoryRoot, siteInfo } = cachedConfig
    const normalizedConfig = normalizeConfig(config)

    const { flags } = this.parse(BaseCommand)
    const agent = await getAgent({
      log,
      exit: this.exit,
      httpProxy: flags.httpProxy,
      certificateFile: flags.httpProxyCertificateFilename,
    })
    const apiOpts = { ...apiUrlOpts, agent }
    const globalConfig = await getGlobalConfig()

    this.netlify = {
      // api methods
      api: new API(token || '', apiOpts),
      repositoryRoot,
      // current site context
      site: {
        root: buildDir,
        configPath,
        get id() {
          return state.get('siteId')
        },
        set id(id) {
          state.set('siteId', id)
        },
      },
      // Site information retrieved using the API
      siteInfo,
      // Configuration from netlify.[toml/yml]
      config: normalizedConfig,
      // Used to avoid calling @netlify/config again
      cachedConfig,
      // global cli config
      globalConfig,
      // state of current site dir
      state,
    }
  }

  // Find and resolve the Netlify configuration
  async getConfig({ cwd, host, offline = argv.offline, pathPrefix, scheme, state, token }) {
    try {
      return await resolveConfig({
        config: argv.config,
        cwd,
        context: argv.context || this.commandContext,
        debug: argv.debug,
        siteId: argv.siteId || (typeof argv.site === 'string' && argv.site) || state.get('siteId'),
        token,
        mode: 'cli',
        host,
        pathPrefix,
        scheme,
        offline,
      })
    } catch (error) {
      const isUserError = error.type === 'userError'

      // If we're failing due to an error thrown by us, it might be because the token we're using is invalid.
      // To account for that, we try to retrieve the config again, this time without a token, to avoid making
      // any API calls.
      //
      // @todo Replace this with a mechanism for calling `resolveConfig` with more granularity (i.e. having
      // the option to say that we don't need API data.)
      if (isUserError && !offline && token) {
        return this.getConfig({ cwd, offline: true, state, token })
      }

      const message = isUserError ? error.message : error.stack
      console.error(message)
      this.exit(1)
    }
  }

  // When `build.publish` is not set by the user, the CLI behavior differs in
  // several ways. It detects it by checking if `build.publish` is `undefined`.
  // However, `@netlify/config` adds a default value to `build.publish`.
  // This removes it.
  static normalizeConfig(config) {
    return config.build.publishOrigin === 'default'
      ? { ...config, build: omit(config.build, ['publish', 'publishOrigin']) }
      : config
  }

  async isLoggedIn() {
    try {
      await this.netlify.api.getCurrentUser()
      return true
    } catch (_) {
      return false
    }
  }

  /* Modified flag parser to support global --auth, --json, & --silent flags */
  parse(opts, args = this.argv) {
    /* Set flags object for commands without flags */
    if (!opts.flags) {
      opts.flags = {}
    }
    /* enrich parse with global flags */
    const globalFlags = {}
    if (!opts.flags.silent) {
      globalFlags.silent = {
        parse: (value) => value,
        description: 'Silence CLI output',
        allowNo: false,
        type: 'boolean',
      }
    }
    if (!opts.flags.json) {
      globalFlags.json = {
        parse: (value) => value,
        description: 'Output return values as JSON',
        allowNo: false,
        type: 'boolean',
      }
    }
    if (!opts.flags.auth) {
      globalFlags.auth = {
        parse: (value) => value,
        description: 'Netlify auth token',
        input: [],
        multiple: false,
        type: 'option',
      }
    }

    // enrich with flags here
    opts.flags = { ...opts.flags, ...globalFlags }

    return oclifParser.parse(args, {
      context: this,
      ...opts,
    })
  }

  static get chalk() {
    // If --json flag disable chalk colors
    return chalkInstance(argv.json)
  }

  async authenticate(tokenFromFlag) {
    const [token] = await getToken(tokenFromFlag)
    if (token) {
      return token
    }
    return this.expensivelyAuthenticate()
  }

  async expensivelyAuthenticate() {
    const webUI = process.env.NETLIFY_WEB_UI || 'https://app.netlify.com'
    log(`Logging into your Netlify account...`)

    // Create ticket for auth
    const ticket = await this.netlify.api.createTicket({
      clientId: CLIENT_ID,
    })

    // Open browser for authentication
    const authLink = `${webUI}/authorize?response_type=ticket&ticket=${ticket.id}`

    log(`Opening ${authLink}`)
    await openBrowser({ url: authLink, log })

    const accessToken = await pollForToken({
      api: this.netlify.api,
      ticket,
      exitWithError: this.error,
      chalk: this.chalk,
    })

    const { id: userId, full_name: name, email } = await this.netlify.api.getCurrentUser()

    const userData = merge(this.netlify.globalConfig.get(`users.${userId}`), {
      id: userId,
      name,
      email,
      auth: {
        token: accessToken,
        github: {
          user: undefined,
          token: undefined,
        },
      },
    })
    // Set current userId
    this.netlify.globalConfig.set('userId', userId)
    // Set user data
    this.netlify.globalConfig.set(`users.${userId}`, userData)

    await identify({
      name,
      email,
      userId,
    })
    await track('user_login', {
      email,
    })

    // Log success
    log()
    log(`${this.chalk.greenBright('You are now logged into your Netlify account!')}`)
    log()
    log(`Run ${this.chalk.cyanBright('netlify status')} for account details`)
    log()
    log(`To see all available commands run: ${this.chalk.cyanBright('netlify help')}`)
    log()
    return accessToken
  }
}

const getAuthArg = function (cliArgs) {
  // If deploy command. Support shorthand 'a' flag
  if (cliArgs && cliArgs._ && cliArgs._[0] === 'deploy') {
    return cliArgs.auth || cliArgs.a
  }
  return cliArgs.auth
}

BaseCommand.strict = false
BaseCommand.flags = {
  debug: flagsLib.boolean({
    description: 'Print debugging information',
  }),
  httpProxy: flagsLib.string({
    description: 'Proxy server address to route requests through.',
    default: process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
  }),
  httpProxyCertificateFilename: flagsLib.string({
    description: 'Certificate file to use when connecting using a proxy server',
    default: process.env.NETLIFY_PROXY_CERTIFICATE_FILENAME,
  }),
}

BaseCommand.getToken = getToken
module.exports = BaseCommand
