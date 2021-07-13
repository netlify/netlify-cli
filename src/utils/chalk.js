const chalk = require('chalk')
const { Chalk } = require('chalk')

/**
 * Chalk instance for CLI
 * @param  {boolean} noColors - disable chalk colors
 * @return {object} - default or custom chalk instance
 */
const safeChalk = function (noColors) {
  if (noColors) {
    const colorlessChalk = new Chalk({ level: 0 })
    return colorlessChalk
  }
  return chalk
}

module.exports = safeChalk
