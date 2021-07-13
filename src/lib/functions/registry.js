const chalk = require('chalk')

const { NETLIFYDEVLOG, NETLIFYDEVERR } = require('../../utils/logo')
const { mkdirRecursiveAsync } = require('../fs')
const { getLogMessage } = require('../log')

const { NetlifyFunction } = require('./netlify-function')
const runtimes = require('./runtimes')
const { watchDebounced } = require('./watcher')

class FunctionsRegistry {
  constructor({ capabilities, config, errorExit, functionsDirectory, log, projectRoot, timeouts, warn }) {
    this.capabilities = capabilities
    this.config = config
    this.errorExit = errorExit
    this.functionsDirectory = functionsDirectory
    this.logger = {
      log,
      warn,
    }
    this.projectRoot = projectRoot
    this.timeouts = timeouts

    // An object to be shared among all functions in the registry. It can be
    // used to cache the results of the build function — e.g. it's used in
    // the `memoizedBuild` method in the JavaScript runtime.
    this.buildCache = {}

    // File watchers for parent directories where functions live — i.e. the
    // ones supplied to `scan()`. This is a Map because in the future we
    // might have several function directories.
    this.directoryWatchers = new Map()

    // The functions held by the registry. Maps function names to instances of
    // `NetlifyFunction`.
    this.functions = new Map()

    // File watchers for function files. Maps function names to objects built
    // by the `watchDebounced` utility.
    this.functionWatchers = new Map()

    // Performance optimization: load '@netlify/zip-it-and-ship-it' on demand.
    // eslint-disable-next-line node/global-require
    const { listFunctions } = require('@netlify/zip-it-and-ship-it')

    this.listFunctions = listFunctions
  }

  async buildFunctionAndWatchFiles(func, { verbose } = {}) {
    if (verbose) {
      this.logger.log(`${NETLIFYDEVLOG} ${chalk.magenta('Reloading')} function ${chalk.yellow(func.name)}...`)
    }

    const { error, srcFilesDiff } = await func.build({ cache: this.buildCache })

    if (error) {
      this.logger.log(
        `${NETLIFYDEVERR} ${chalk.red('Failed')} reloading function ${chalk.yellow(func.name)} with error:\n${
          error.message
        }`,
      )
    } else if (verbose) {
      this.logger.log(`${NETLIFYDEVLOG} ${chalk.green('Reloaded')} function ${chalk.yellow(func.name)}`)
    }

    // If the build hasn't resulted in any files being added or removed, there
    // is nothing else we need to do.
    if (!srcFilesDiff) {
      return
    }

    const watcher = this.functionWatchers.get(func.name)

    // If there is already a watcher for this function, we need to unwatch any
    // files that have been removed and watch any files that have been added.
    if (watcher) {
      srcFilesDiff.deleted.forEach((path) => {
        watcher.unwatch(path)
      })

      srcFilesDiff.added.forEach((path) => {
        watcher.add(path)
      })

      return
    }

    // If there is no watcher for this function but the build produced files,
    // we create a new watcher and watch them.
    if (srcFilesDiff.added.size !== 0) {
      const newWatcher = await watchDebounced([...srcFilesDiff.added], {
        onChange: () => {
          this.buildFunctionAndWatchFiles(func, { verbose: true })
        },
      })

      this.functionWatchers.set(func.name, newWatcher)
    }
  }

  get(name) {
    return this.functions.get(name)
  }

  async registerFunction(name, func) {
    if (func.isBackground && !this.capabilities.backgroundFunctions) {
      this.logger.warn(getLogMessage('functions.backgroundNotSupported'))
    }

    this.functions.set(name, func)
    await this.buildFunctionAndWatchFiles(func)

    this.logger.log(`${NETLIFYDEVLOG} ${chalk.green('Loaded')} function ${chalk.yellow(name)}.`)
  }

  async scan(directory) {
    await mkdirRecursiveAsync(directory)

    // We give runtimes the opportunity to react to a directory scan and run
    // additional logic before the directory is read. So if they implement a
    // `onDirectoryScan` hook, we run it.
    await Promise.all(
      Object.values(runtimes).map((runtime) => {
        if (typeof runtime.onDirectoryScan !== 'function') {
          return null
        }

        return runtime.onDirectoryScan({ directory })
      }),
    )

    const functions = await this.listFunctions(directory)

    // Before registering any functions, we look for any functions that were on
    // the previous list but are missing from the new one. We unregister them.
    const deletedFunctions = [...this.functions.values()].filter((oldFunc) => {
      const isFound = functions.some(
        (newFunc) => newFunc.name === oldFunc.name && newFunc.runtime === oldFunc.runtime.name,
      )

      return !isFound
    })

    await Promise.all(deletedFunctions.map((func) => this.unregisterFunction(func.name)))
    await Promise.all(
      functions.map(async ({ mainFile, name, runtime: runtimeName }) => {
        const runtime = runtimes[runtimeName]

        // If there is no matching runtime, it means this function is not yet
        // supported in Netlify Dev.
        if (runtime === undefined) {
          return
        }

        // If this function has already been registered, we skip it.
        if (this.functions.has(name)) {
          return
        }

        const func = new NetlifyFunction({
          config: this.config,
          errorExit: this.errorExit,
          functionsDirectory: this.functionsDirectory,
          mainFile,
          name,
          projectRoot: this.projectRoot,
          runtime,
          timeoutBackground: this.timeouts.backgroundFunctions,
          timeoutSynchronous: this.timeouts.syncFunctions,
        })

        return await this.registerFunction(name, func)
      }),
    )

    await this.setupDirectoryWatcher(directory)
  }

  // This watcher looks at files being added or removed from a functions
  // directory. It doesn't care about files being changed, because those
  // will be handled by each functions' watcher.
  async setupDirectoryWatcher(directory) {
    if (this.directoryWatchers.has(directory)) {
      return
    }

    const watcher = await watchDebounced(directory, {
      depth: 1,
      onAdd: () => {
        this.scan(directory)
      },
      onUnlink: () => {
        this.scan(directory)
      },
    })

    this.directoryWatchers.set(directory, watcher)
  }

  async unregisterFunction(name) {
    this.functions.delete(name)

    this.logger.log(`${NETLIFYDEVLOG} ${chalk.magenta('Removed')} function ${chalk.yellow(name)}.`)

    const watcher = this.functionWatchers.get(name)

    if (watcher) {
      await watcher.close()
    }
  }
}

module.exports = { FunctionsRegistry }
