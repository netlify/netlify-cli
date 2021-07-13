const execa = require('execa')

const Command = require('../../utils/command')
const { injectEnvVariables } = require('../../utils/dev')

class ExecCommand extends Command {
  async init() {
    this.commandContext = 'dev'
    await super.init()
  }

  async run() {
    const { warn, netlify } = this
    const { cachedConfig, site } = netlify
    await injectEnvVariables({ env: cachedConfig.env, site, warn })

    execa(this.argv[0], this.argv.slice(1), {
      stdio: 'inherit',
    })
  }
}

ExecCommand.description = `Exec command
Runs a command within the netlify dev environment, e.g. with env variables from any installed addons
`

ExecCommand.examples = ['$ netlify dev:exec npm run bootstrap']

ExecCommand.strict = false
ExecCommand.parse = false

module.exports = ExecCommand
