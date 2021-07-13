const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const openBrowser = require('../../utils/open-browser')

class OpenAdminCommand extends Command {
  async run() {
    const { api, site } = this.netlify
    await this.authenticate()

    const siteId = site.id

    if (!siteId) {
      this.warn(`No Site ID found in current directory.
Run \`netlify link\` to connect to this folder to a site`)
      return false
    }

    let siteData
    let url
    try {
      siteData = await api.getSite({ siteId })
      url = siteData.ssl_url || siteData.url
      log(`Opening "${siteData.name}" site url:`)
      log(`> ${url}`)
    } catch (error) {
      // unauthorized
      if (error.status === 401) {
        this.warn(`Log in with a different account or re-link to a site you have permission for`)
        this.error(`Not authorized to view the currently linked site (${siteId})`)
      }
      this.error(error)
    }

    await openBrowser({ url })
    this.exit()
  }
}

OpenAdminCommand.description = `Opens current site url in browser`

OpenAdminCommand.examples = ['netlify open:site']

module.exports = OpenAdminCommand
