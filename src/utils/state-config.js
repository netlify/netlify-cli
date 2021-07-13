const fs = require('fs')
const path = require('path')
const process = require('process')

const dotProp = require('dot-prop')
const findUp = require('find-up')
const makeDir = require('make-dir')
const writeFileAtomic = require('write-file-atomic')

const { getPathInProject } = require('../lib/settings')

const STATE_PATH = getPathInProject(['state.json'])
const permissionError = "You don't have access to this file."

class StateConfig {
  constructor(cwd) {
    this.path = StateConfig.findStatePath(cwd)
  }

  // Finds location of `.netlify/state.json`
  static findStatePath(cwd) {
    const statePath = findUp.sync([STATE_PATH], { cwd })

    if (!statePath) {
      return path.join(cwd, STATE_PATH)
    }

    return statePath
  }

  get all() {
    try {
      return JSON.parse(fs.readFileSync(this.path, 'utf8'))
    } catch (error) {
      // Don't create if it doesn't exist
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return {}
      }

      // Improve the message of permission errors
      if (error.code === 'EACCES') {
        error.message = `${error.message}\n${permissionError}\n`
      }

      // Empty the file if it encounters invalid JSON
      if (error.name === 'SyntaxError') {
        writeFileAtomic.sync(this.path, '')
        return {}
      }

      throw error
    }
  }

  set all(val) {
    try {
      // Make sure the folder exists as it could have been deleted in the meantime
      makeDir.sync(path.dirname(this.path))
      writeFileAtomic.sync(this.path, JSON.stringify(val, null, '\t'))
    } catch (error) {
      // Improve the message of permission errors
      if (error.code === 'EACCES') {
        error.message = `${error.message}\n${permissionError}\n`
      }

      throw error
    }
  }

  get size() {
    return Object.keys(this.all || {}).length
  }

  get(key) {
    if (key === 'siteId' && process.env.NETLIFY_SITE_ID) {
      // TODO figure out cleaner way of grabbing ENV vars
      return process.env.NETLIFY_SITE_ID
    }
    return dotProp.get(this.all, key)
  }

  set(...args) {
    const [key, val] = args
    const config = this.all

    if (args.length === 1) {
      Object.entries(key).forEach(([keyPart, value]) => {
        dotProp.set(config, keyPart, value)
      })
    } else {
      dotProp.set(config, key, val)
    }

    this.all = config
  }

  has(key) {
    return dotProp.has(this.all, key)
  }

  delete(key) {
    const config = this.all
    dotProp.delete(config, key)
    this.all = config
  }

  clear() {
    this.all = {}
  }
}

module.exports = StateConfig
