const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')
const inquirer = require('inquirer')

const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const { parseRawFlags } = require('../../utils/parse-raw-flags')

class SitesDeleteCommand extends Command {
  async run() {
    const { args, flags, raw } = this.parse(SitesDeleteCommand)

    this.setAnalyticsPayload({ force: flags.force })

    const { api, site } = this.netlify
    const { siteId } = args
    const cwdSiteId = site.id

    // 1. Prompt user for verification
    await this.authenticate(flags.auth)

    let siteData
    try {
      siteData = await api.getSite({ siteId })
    } catch (error) {
      if (error.status === 404) {
        this.error(`No site with id ${siteId} found. Please verify the siteId & try again.`)
      }
    }

    if (!siteData) {
      this.error(`Unable to process site`)
    }

    const rawFlags = parseRawFlags(raw)
    const noForce = !rawFlags.force && !rawFlags.f

    /* Verify the user wants to delete the site */
    if (noForce) {
      log(`${chalk.redBright('Warning')}: You are about to permanently delete "${chalk.bold(siteData.name)}"`)
      log(`         Verify this siteID "${siteId}" supplied is correct and proceed.`)
      log('         To skip this prompt, pass a --force flag to the delete command')
      log()
      log(`${chalk.bold('Be careful here. There is no undo!')}`)
      log()
      const { wantsToDelete } = await inquirer.prompt({
        type: 'confirm',
        name: 'wantsToDelete',
        message: `WARNING: Are you sure you want to delete the "${siteData.name}" site?`,
        default: false,
      })
      log()
      if (!wantsToDelete) {
        this.exit()
      }
    }

    /* Validation logic if siteId passed in does not match current site ID */
    if (noForce && cwdSiteId && cwdSiteId !== siteId) {
      log(`${chalk.redBright('Warning')}: The siteId supplied does not match the current working directory siteId`)
      log()
      log(`Supplied:       "${siteId}"`)
      log(`Current Site:   "${cwdSiteId}"`)
      log()
      log(`Verify this siteID "${siteId}" supplied is correct and proceed.`)
      log('To skip this prompt, pass a --force flag to the delete command')
      const { wantsToDelete } = await inquirer.prompt({
        type: 'confirm',
        name: 'wantsToDelete',
        message: `Verify & Proceed with deletion of site "${siteId}"?`,
        default: false,
      })
      if (!wantsToDelete) {
        this.exit()
      }
    }

    log(`Deleting site "${siteId}"...`)

    try {
      await api.deleteSite({ site_id: siteId })
    } catch (error) {
      if (error.status === 404) {
        this.error(`No site with id ${siteId} found. Please verify the siteId & try again.`)
      } else {
        this.error(`Delete Site error: ${error.status}: ${error.message}`)
      }
    }
    log(`Site "${siteId}" successfully deleted!`)
  }
}

SitesDeleteCommand.description = `Delete a site

This command will permanently delete the site on Netlify. Use with caution.
`

SitesDeleteCommand.args = [
  {
    name: 'siteId',
    required: true,
    description: 'Site ID to delete.',
  },
]

SitesDeleteCommand.flags = {
  force: flagsLib.boolean({
    char: 'f',
    description: 'delete without prompting (useful for CI)',
  }),
  ...SitesDeleteCommand.flags,
}

SitesDeleteCommand.examples = ['netlify sites:delete 1234-3262-1211']

module.exports = SitesDeleteCommand
