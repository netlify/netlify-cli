const fs = require('fs')

const { zipFunctions } = require('@netlify/zip-it-and-ship-it')
const { flags: flagsLib } = require('@oclif/command')

const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const { getFunctionsDir } = require('../../utils/functions')
const { NETLIFYDEVLOG, NETLIFYDEVERR } = require('../../utils/logo')

class FunctionsBuildCommand extends Command {
  run() {
    const { flags } = this.parse(FunctionsBuildCommand)

    const { config } = this.netlify

    const src = flags.src || config.build.functionsSource
    const dst = getFunctionsDir({ flags, config })

    if (src === dst) {
      log(`${NETLIFYDEVERR} Source and destination for function build can't be the same`)
      this.exit(1)
    }

    if (!src || !dst) {
      if (!src)
        log(
          `${NETLIFYDEVERR} Error: You must specify a source folder with a --src flag or a functionsSource field in your config`,
        )
      if (!dst)
        log(
          `${NETLIFYDEVERR} Error: You must specify a destination functions folder with a --functions flag or a functions field in your config`,
        )
      this.exit(1)
    }

    fs.mkdirSync(dst, { recursive: true })

    log(`${NETLIFYDEVLOG} Building functions`)
    zipFunctions(src, dst, { skipGo: true })
    log(`${NETLIFYDEVLOG} Functions built to `, dst)
  }
}

FunctionsBuildCommand.description = `Build functions locally
`
FunctionsBuildCommand.aliases = ['function:build']
FunctionsBuildCommand.flags = {
  functions: flagsLib.string({
    char: 'f',
    description: 'Specify a functions directory to build to',
  }),
  src: flagsLib.string({
    char: 's',
    description: 'Specify the source directory for the functions',
  }),
  ...FunctionsBuildCommand.flags,
}

module.exports = FunctionsBuildCommand
