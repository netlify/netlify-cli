const go = require('./go')
const js = require('./js')

/**
 * @callback BuildFunction
 * @param {object} func
 * @returns {Promise<{srcFiles: string[], buildPath?: string>}
 */

/**
 * @callback GetBuildFunction
 * @param  {{ config: object, context: object, errorExit: function, func: object, functionsDirectory: string, projectRoot: string }} params
 * @returns {Promise<BuildFunction>}
 */

/**
 * @callback InvokeFunction
 * @param  {{ context: object, event: object, func: object, timeout: number }} params
 * @returns {Promise<{ body: object, statusCode: number }>}
 */

/**
 * @callback OnDirectoryScanFunction
 * @param  {{ directory: string }} params
 * @returns {Promise<undefined>}
 */

/**
 * @typedef {object} Runtime
 * @property {GetBuildFunction} getBuildFunction
 * @property {InvokeFunction} invokeFunction
 * @property {OnDirectoryScanFunction} [onDirectoryScan]
 * @property {string} name
 */

const runtimes = [js, go].reduce((res, runtime) => ({ ...res, [runtime.name]: runtime }), {})

module.exports = runtimes
