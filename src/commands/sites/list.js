const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')
const { cli } = require('cli-ux')

const { listSites } = require('../../lib/api')
const Command = require('../../utils/command')
const { log, logJson } = require('../../utils/command-helpers')

class SitesListCommand extends Command {
  async run() {
    const { flags } = this.parse(SitesListCommand)

    const { api } = this.netlify
    if (!flags.json) {
      cli.action.start('Loading your sites')
    }
    await this.authenticate()

    const sites = await listSites({ api, options: { filter: 'all' } })
    if (!flags.json) {
      cli.action.stop()
    }

    if (sites && sites.length !== 0) {
      const logSites = sites.map((site) => {
        const siteInfo = {
          id: site.id,
          name: site.name,
          ssl_url: site.ssl_url,
          account_name: site.account_name,
        }

        if (site.build_settings && site.build_settings.repo_url) {
          siteInfo.repo_url = site.build_settings.repo_url
        }

        return siteInfo
      })

      // Json response for piping commands
      if (flags.json) {
        const redactedSites = sites.map((site) => {
          if (site && site.build_settings) {
            delete site.build_settings.env
          }
          return site
        })
        logJson(redactedSites)
        return false
      }

      log(`
────────────────────────────┐
   Current Netlify Sites    │
────────────────────────────┘

Count: ${logSites.length}
`)

      logSites.forEach((logSite) => {
        log(`${chalk.greenBright(logSite.name)} - ${logSite.id}`)
        log(`  ${chalk.whiteBright.bold('url:')}  ${chalk.yellowBright(logSite.ssl_url)}`)
        if (logSite.repo_url) {
          log(`  ${chalk.whiteBright.bold('repo:')} ${chalk.white(logSite.repo_url)}`)
        }
        if (logSite.account_name) {
          log(`  ${chalk.whiteBright.bold('account:')} ${chalk.white(logSite.account_name)}`)
        }
        log(`─────────────────────────────────────────────────`)
      })
    }
  }
}

SitesListCommand.description = `List all sites you have access to`

SitesListCommand.flags = {
  json: flagsLib.boolean({
    description: 'Output site data as JSON',
  }),
  ...SitesListCommand.flags,
}

module.exports = SitesListCommand
