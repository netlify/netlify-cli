const oclif = require('@oclif/command')
const AsciiTable = require('ascii-table')
const chalk = require('chalk')
const { methods } = require('netlify')

const { isEmptyCommand } = require('../utils/check-command-inputs')
const Command = require('../utils/command')
const { log, logJson } = require('../utils/command-helpers')

class APICommand extends Command {
  async run() {
    const { api } = this.netlify
    const { args, flags } = this.parse(APICommand)

    const { apiMethod } = args

    if (isEmptyCommand(flags, args) || flags.list) {
      const table = new AsciiTable(`Netlify API Methods`)
      table.setHeading('API Method', 'Docs Link')
      methods.forEach((method) => {
        const { operationId } = method
        table.addRow(operationId, `https://open-api.netlify.com/#operation/${operationId}`)
      })
      log(table.toString())
      log()
      log('Above is a list of available API methods')
      log(`To run a method use "${chalk.cyanBright('netlify api methodName')}"`)
      this.exit()
    }

    if (!apiMethod) {
      this.error(`You must provide an API method. Run "netlify api --list" to see available methods`)
    }

    if (!api[apiMethod] || typeof api[apiMethod] !== 'function') {
      this.error(`"${apiMethod}"" is not a valid api method. Run "netlify api --list" to see available methods`)
    }

    let payload
    if (flags.data) {
      payload = typeof flags.data === 'string' ? JSON.parse(flags.data) : flags.data
    } else {
      payload = {}
    }
    try {
      const apiResponse = await api[apiMethod](payload)
      logJson(apiResponse)
    } catch (error) {
      this.error(error)
    }
  }
}

APICommand.description = `Run any Netlify API method

For more information on available methods checkout https://open-api.netlify.com/ or run "netlify api --list"
`

APICommand.args = [
  {
    name: 'apiMethod',
    description: 'Open API method to run',
  },
]

APICommand.examples = ['netlify api --list', 'netlify api getSite --data \'{ "site_id": "123456"}\'']

APICommand.flags = {
  data: oclif.flags.string({
    char: 'd',
    description: 'Data to use',
  }),
  list: oclif.flags.boolean({
    description: 'List out available API methods',
  }),
  ...APICommand.flags,
}

APICommand.strict = false

module.exports = APICommand
