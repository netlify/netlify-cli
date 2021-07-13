const Command = require('../utils/command')
const { log } = require('../utils/command-helpers')
const { track } = require('../utils/telemetry')

class UnlinkCommand extends Command {
  async run() {
    const { site, state } = this.netlify
    const siteId = site.id

    if (!siteId) {
      log(`Folder is not linked to a Netlify site. Run 'netlify link' to link it`)
      return this.exit()
    }

    let siteData = {}
    try {
      siteData = await this.netlify.api.getSite({ siteId })
    } catch (error) {
      // ignore errors if we can't get the site
    }

    state.delete('siteId')

    await track('sites_unlinked', {
      siteId: siteData.id || siteId,
    })

    if (site) {
      log(`Unlinked ${site.configPath} from ${siteData ? siteData.name : siteId}`)
    } else {
      log('Unlinked site')
    }
  }
}

UnlinkCommand.description = `Unlink a local folder from a Netlify site`

module.exports = UnlinkCommand
