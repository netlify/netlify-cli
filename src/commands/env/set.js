const Command = require('../../utils/command')
const { log, logJson } = require('../../utils/command-helpers')

class EnvSetCommand extends Command {
  async run() {
    const { args, flags } = this.parse(EnvSetCommand)
    const { api, site } = this.netlify
    const siteId = site.id

    if (!siteId) {
      log('No site id found, please run inside a site folder or `netlify link`')
      return false
    }

    const siteData = await api.getSite({ siteId })

    // Get current environment variables set in the UI
    const {
      build_settings: { env = {} },
    } = siteData

    // Merge new enviroment variable with currently set variables
    const { name, value } = args
    const newEnv = {
      ...env,
      [name]: value,
    }

    // Apply environment variable updates
    const siteResult = await api.updateSite({
      siteId,
      body: {
        build_settings: {
          env: newEnv,
        },
      },
    })

    // Return new environment variables of site if using json flag
    if (flags.json) {
      logJson(siteResult.build_settings.env)
      return false
    }

    log(`Set environment variable ${name}=${value} for site ${siteData.name}`)
  }
}

EnvSetCommand.description = `Set value of environment variable`
EnvSetCommand.args = [
  {
    name: 'name',
    required: true,
    description: 'Environment variable name',
  },
  {
    name: 'value',
    required: false,
    default: '',
    description: 'Value to set to',
  },
]

module.exports = EnvSetCommand
