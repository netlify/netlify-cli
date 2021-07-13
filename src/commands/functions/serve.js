const { join } = require('path')

const { flags: flagsLib } = require('@oclif/command')

const { startFunctionsServer } = require('../../lib/functions/server')
const Command = require('../../utils/command')
const { getSiteInformation, acquirePort, injectEnvVariables } = require('../../utils/dev')
const { getFunctionsDir } = require('../../utils/functions')

const DEFAULT_PORT = 9999

class FunctionsServeCommand extends Command {
  async run() {
    const { flags } = this.parse(FunctionsServeCommand)

    const { error: errorExit, warn, netlify } = this
    const { api, site, config, siteInfo } = netlify

    const functionsDir = getFunctionsDir({ flags, config }, join('netlify', 'functions'))

    await injectEnvVariables({ env: this.netlify.cachedConfig.env, site, warn })

    const { siteUrl, capabilities, timeouts } = await getSiteInformation({
      flags,
      api,
      site,
      warn,
      error: errorExit,
      siteInfo,
    })

    const functionsPort = await acquirePort({
      configuredPort: flags.port || (config.dev && config.dev.functionsPort),
      defaultPort: DEFAULT_PORT,
      errorMessage: 'Could not acquire configured functions port',
    })

    await startFunctionsServer({
      config,
      settings: { functions: functionsDir, functionsPort },
      site,
      warn,
      errorExit,
      siteUrl,
      capabilities,
      timeouts,
      prefix: '/.netlify/functions/',
    })
  }
}

FunctionsServeCommand.description = `(Beta) Serve functions locally

Helpful for debugging functions.
`
FunctionsServeCommand.aliases = ['function:serve']
FunctionsServeCommand.flags = {
  functions: flagsLib.string({
    char: 'f',
    description: 'Specify a functions directory to serve',
  }),
  port: flagsLib.integer({
    char: 'p',
    description: 'Specify a port for the functions server',
  }),
  offline: flagsLib.boolean({
    char: 'o',
    description: 'disables any features that require network access',
  }),
  ...FunctionsServeCommand.flags,
}

module.exports = FunctionsServeCommand
