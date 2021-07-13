const process = require('process')

const open = require('better-opn')
const chalk = require('chalk')
const isDockerContainer = require('is-docker')

const { log } = require('./command-helpers')

const unableToOpenBrowserMessage = function ({ url, message }) {
  log('---------------------------')
  log(chalk.redBright(`Error: Unable to open browser automatically: ${message}`))
  log(chalk.cyan('Please open your browser and open the URL below:'))
  log(chalk.bold(url))
  log('---------------------------')
}

const openBrowser = async function ({ url, silentBrowserNoneError }) {
  if (isDockerContainer()) {
    unableToOpenBrowserMessage({ url, message: 'Running inside a docker container' })
    return
  }
  if (process.env.BROWSER === 'none') {
    if (!silentBrowserNoneError) {
      unableToOpenBrowserMessage({ url, message: "BROWSER environment variable is set to 'none'" })
    }
    return
  }

  try {
    await open(url)
  } catch (error) {
    unableToOpenBrowserMessage({ url, message: error.message })
  }
}

module.exports = openBrowser
