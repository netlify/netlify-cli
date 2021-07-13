const { flags } = require('@oclif/command')

const Command = require('../../utils/command')
const { runProcess } = require('../../utils/traffic-mesh')

class TraceCommand extends Command {
  async init() {
    this.commandContext = 'dev'
    await super.init()
  }

  async run() {
    this.parse(TraceCommand)

    const args = ['trace'].concat(this.argv)
    const { subprocess } = runProcess({ args })
    await subprocess
  }
}

TraceCommand.description = `Trace command
Simulates Netlify's Edge routing logic to match specific requests.
This command is designed to mimic cURL's command line, so the flags are more familiar.
`

TraceCommand.examples = [
  '$ netlify dev:trace http://localhost/routing-path',
  '$ netlify dev:trace -w dist-directory http://localhost/routing-path',
  '$ netlify dev:trace -X POST http://localhost/routing-path',
  '$ netlify dev:trace -H "Accept-Language es" http://localhost/routing-path',
  '$ netlify dev:trace --cookie nf_jwt=token http://localhost/routing-path',
]
TraceCommand.strict = false
TraceCommand.args = [
  {
    name: 'url',
    required: true,
    description: 'Sets the request URL',
  },
]
TraceCommand.flags = {
  request: flags.string({
    char: 'X',
    description: 'Specifies a custom request method [default: GET]',
  }),
  cookie: flags.string({
    char: 'b',
    description: 'Request cookie, this flag can be used multiple times. Example: "nf_jwt=token"',
  }),
  header: flags.string({
    char: 'H',
    description: 'Request header, this flag can be used multiple times. Example: "Host: netlify.test"',
  }),
  watch: flags.string({
    char: 'w',
    description: 'Path to the publish directory',
  }),
  debug: TraceCommand.flags.debug,
}

module.exports = TraceCommand
