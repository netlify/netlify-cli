const path = require('path')
const process = require('process')

const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')

const { listSites } = require('../lib/api')
const Command = require('../utils/command')
const { log } = require('../utils/command-helpers')
const ensureNetlifyIgnore = require('../utils/gitignore')
const linkPrompt = require('../utils/link/link-by-prompt')
const { track } = require('../utils/telemetry')

class LinkCommand extends Command {
  async run() {
    await this.authenticate()

    const { flags } = this.parse(LinkCommand)
    const {
      api,
      repositoryRoot,
      site: { id: siteId },
      state,
    } = this.netlify

    let siteData
    try {
      siteData = await api.getSite({ siteId })
    } catch (error) {
      // silent api error
    }

    // Add .netlify to .gitignore file
    await ensureNetlifyIgnore(repositoryRoot)

    // Site id is incorrect
    if (siteId && !siteData) {
      console.log(`"${siteId}" was not found in your Netlify account.`)
      console.log(`Please double check your siteID and which account you are logged into via \`netlify status\`.`)
      return this.exit()
    }

    // If already linked to site. exit and prompt for unlink
    if (siteData) {
      log(`Site already linked to "${siteData.name}"`)
      log(`Admin url: ${siteData.admin_url}`)
      log()
      log(`To unlink this site, run: ${chalk.cyanBright('netlify unlink')}`)
      return this.exit()
    }

    if (flags.id) {
      try {
        siteData = await api.getSite({ site_id: flags.id })
      } catch (error) {
        if (error.status === 404) {
          this.error(new Error(`Site id ${flags.id} not found`))
        } else {
          this.error(error)
        }
      }

      // Save site ID
      state.set('siteId', siteData.id)
      log(`Linked to ${siteData.name} in ${state.path}`)

      await track('sites_linked', {
        siteId: siteData.id,
        linkType: 'manual',
        kind: 'byId',
      })

      return this.exit()
    }

    if (flags.name) {
      let results
      try {
        results = await listSites({
          api,
          options: {
            name: flags.name,
            filter: 'all',
          },
        })
      } catch (error) {
        if (error.status === 404) {
          this.error(new Error(`${flags.name} not found`))
        } else {
          this.error(error)
        }
      }

      if (results.length === 0) {
        this.error(new Error(`No sites found named ${flags.name}`))
      }
      const [firstSiteData] = results
      state.set('siteId', firstSiteData.id)

      log(`Linked to ${firstSiteData.name} in ${path.relative(path.join(process.cwd(), '..'), state.path)}`)

      await track('sites_linked', {
        siteId: (firstSiteData && firstSiteData.id) || siteId,
        linkType: 'manual',
        kind: 'byName',
      })

      return this.exit()
    }

    siteData = await linkPrompt(this, flags)
    return siteData
  }
}

LinkCommand.description = `Link a local repo or project folder to an existing site on Netlify`

LinkCommand.examples = ['netlify link', 'netlify link --id 123-123-123-123', 'netlify link --name my-site-name']

LinkCommand.flags = {
  id: flagsLib.string({
    description: 'ID of site to link to',
  }),
  name: flagsLib.string({
    description: 'Name of site to link to',
  }),
  gitRemoteName: flagsLib.string({
    description: 'Name of Git remote to use. e.g. "origin"',
  }),
  ...LinkCommand.flags,
}

module.exports = LinkCommand
