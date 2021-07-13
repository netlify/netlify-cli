const fs = require('fs')

const { flags: flagsLib } = require('@oclif/command')
const AsciiTable = require('ascii-table')
const dotenv = require('dotenv')
const isEmpty = require('lodash/isEmpty')

const Command = require('../../utils/command')
const { log, logJson } = require('../../utils/command-helpers')

class EnvImportCommand extends Command {
  async run() {
    const { args, flags } = this.parse(EnvImportCommand)
    const { api, site } = this.netlify
    const siteId = site.id

    if (!siteId) {
      log('No site id found, please run inside a site folder or `netlify link`')
      return false
    }

    const siteData = await api.getSite({ siteId })

    // Get current environment variables set in the UI
    const {
      build_settings: { env = {} },
    } = siteData

    // Import environment variables from specified .env file
    const { fileName } = args
    let importedEnv = {}
    try {
      const envFileContents = fs.readFileSync(fileName)
      importedEnv = dotenv.parse(envFileContents)
    } catch (error) {
      log(error.message)
      this.exit(1)
    }

    if (isEmpty(importedEnv)) {
      log(`No environment variables found in file ${fileName} to import`)
      return false
    }

    // Apply environment variable updates
    const siteResult = await api.updateSite({
      siteId,
      body: {
        build_settings: {
          // Only set imported variables if --replaceExisting or otherwise merge
          // imported ones with the current environment variables.
          env: flags.replaceExisting ? importedEnv : { ...env, ...importedEnv },
        },
      },
    })

    // Return new environment variables of site if using json flag
    if (flags.json) {
      logJson(siteResult.build_settings.env)
      return false
    }

    // List newly imported environment variables in a table
    log(`site: ${siteData.name}`)
    const table = new AsciiTable(`Imported environment variables`)

    table.setHeading('Key', 'Value')
    table.addRowMatrix(Object.entries(importedEnv))
    log(table.toString())
  }
}

EnvImportCommand.description = `Import and set environment variables from .env file`
EnvImportCommand.flags = {
  replaceExisting: flagsLib.boolean({
    char: 'r',
    description: 'Replace all existing variables instead of merging them with the current ones',
    default: false,
  }),
  ...EnvImportCommand.flags,
}
EnvImportCommand.args = [
  {
    name: 'fileName',
    required: true,
    description: '.env file to import',
  },
]

module.exports = EnvImportCommand
