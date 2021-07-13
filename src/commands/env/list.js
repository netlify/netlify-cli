const fromEntries = require('@ungap/from-entries')
const AsciiTable = require('ascii-table')
const isEmpty = require('lodash/isEmpty')

const Command = require('../../utils/command')
const { log, logJson } = require('../../utils/command-helpers')

class EnvListCommand extends Command {
  async run() {
    const { flags } = this.parse(EnvListCommand)
    const { api, site, cachedConfig } = this.netlify
    const siteId = site.id

    if (!siteId) {
      log('No site id found, please run inside a site folder or `netlify link`')
      return false
    }

    const siteData = await api.getSite({ siteId })
    const environment = fromEntries(
      Object.entries(cachedConfig.env)
        // Omitting general variables to reduce noise.
        .filter(([, variable]) => variable.sources[0] !== 'general')
        .map(([key, variable]) => [key, variable.value]),
    )

    // Return json response for piping commands
    if (flags.json) {
      logJson(environment)
      return false
    }

    if (isEmpty(environment)) {
      log(`No environment variables set for site ${siteData.name}`)
      return false
    }

    // List environment variables using a table
    log(`site: ${siteData.name}`)
    const table = new AsciiTable(`Environment variables`)

    table.setHeading('Key', 'Value')
    table.addRowMatrix(Object.entries(environment))
    log(table.toString())
  }
}

EnvListCommand.description = `Lists resolved environment variables for site (includes netlify.toml)`

module.exports = EnvListCommand
