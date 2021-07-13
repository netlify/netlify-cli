const { prepareAddonCommand, ADDON_VALIDATION } = require('../../utils/addons/prepare')
const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const openBrowser = require('../../utils/open-browser')

class AddonsAuthCommand extends Command {
  async run() {
    const { args } = this.parse(AddonsAuthCommand)

    const addonName = args.name
    const { addon } = await prepareAddonCommand({
      context: this,
      addonName,
      validation: ADDON_VALIDATION.EXISTS,
    })

    if (!addon.auth_url) {
      console.log(`No Admin URL found for the "${addonName} add-on"`)
      return false
    }

    log()
    log(`Opening ${addonName} add-on admin URL:`)
    log()
    log(addon.auth_url)
    log()
    await openBrowser({ url: addon.auth_url, log })
    this.exit()
  }
}
AddonsAuthCommand.aliases = ['addon:auth']
AddonsAuthCommand.args = [
  {
    name: 'name',
    required: true,
    description: 'Add-on slug',
  },
]

AddonsAuthCommand.description = `Login to add-on provider`

module.exports = AddonsAuthCommand
