const { flags: flagsLib } = require('@oclif/command')
const execa = require('execa')
const Listr = require('listr')

const Command = require('../../utils/command')
const { installPlatform } = require('../../utils/lm/install')
const { checkHelperVersion } = require('../../utils/lm/requirements')
const { printBanner } = require('../../utils/lm/ui')

const installHelperIfMissing = async function ({ force }) {
  let installHelper = false
  try {
    const version = await checkHelperVersion()
    if (!version) {
      installHelper = true
    }
  } catch (error) {
    installHelper = true
  }

  if (installHelper) {
    return installPlatform({ force })
  }

  return false
}

const provisionService = async function (siteId, api) {
  const addonName = 'large-media'

  if (!siteId) {
    throw new Error('No site id found, please run inside a site folder or `netlify link`')
  }
  try {
    await api.createServiceInstance({
      siteId,
      addon: addonName,
      body: {},
    })
  } catch (error) {
    // error is JSONHTTPError
    throw new Error(error.json.error)
  }
}

const configureLFSURL = async function (siteId, api) {
  const siteInfo = await api.getSite({ siteId })
  const url = `https://${siteInfo.id_domain}/.netlify/large-media`

  return execa('git', ['config', '-f', '.lfsconfig', 'lfs.url', url])
}

class LmSetupCommand extends Command {
  async run() {
    await this.authenticate()

    const { flags } = this.parse(LmSetupCommand)
    const { api, site } = this.netlify

    let helperInstalled = false
    if (!flags['skip-install']) {
      try {
        helperInstalled = await installHelperIfMissing({ force: flags['force-install'] })
      } catch (error_) {
        this.error(error_)
      }
    }

    const tasks = new Listr([
      {
        title: 'Provisioning Netlify Large Media',
        async task() {
          await provisionService(site.id, api)
        },
      },
      {
        title: 'Configuring Git LFS for this site',
        async task() {
          await configureLFSURL(site.id, api)
        },
      },
    ])
    await tasks.run().catch(() => {})

    if (helperInstalled) {
      printBanner(this, flags['force-install'])
    }
  }
}

LmSetupCommand.flags = {
  'skip-install': flagsLib.boolean({
    char: 's',
    description: 'Skip the credentials helper installation check',
  }),
  'force-install': flagsLib.boolean({
    char: 'f',
    description: 'Force the credentials helper installation',
  }),
  ...LmSetupCommand.flags,
}

LmSetupCommand.description = `Configures your site to use Netlify Large Media.
It runs the install command if you have not installed the dependencies yet.`

module.exports = LmSetupCommand
