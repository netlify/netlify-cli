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
    try {
      siteData = await api.getSite({ siteId })
      log(`Opening "${siteData.name}" site admin UI:`)
      log(`> ${siteData.admin_url}`)
    } catch (error) {
      // unauthorized
      if (error.status === 401) {
        this.warn(`Log in with a different account or re-link to a site you have permission for`)
        this.error(`Not authorized to view the currently linked site (${siteId})`)
      }
      // site not found
      if (error.status === 404) {
        log()
        log('Please double check this ID and verify you are logged in with the correct account')
        log()
        log('To fix this, run `netlify unlink` then `netlify link` to reconnect to the correct site ID')
        log()
        this.error(`Site "${siteId}" not found in account`)
      }
      this.error(error)
    }

    await openBrowser({ url: siteData.admin_url })
    this.exit()
  }
}

OpenAdminCommand.description = `Opens current site admin UI in Netlify`

OpenAdminCommand.examples = ['netlify open:admin']

module.exports = OpenAdminCommand
