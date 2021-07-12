const fs = require('fs')
const { promisify } = require('util')

const del = require('del')
const makeDir = require('make-dir')
const pathType = require('path-type')

const statAsync = promisify(fs.stat)
const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)
const rmFileAsync = promisify(fs.unlink)
const copyFileAsync = promisify(fs.copyFile)
const accessAsync = promisify(fs.access)
const mkdtempAsync = promisify(fs.mkdtemp)
const appendFileAsync = promisify(fs.appendFile)
const renameAsync = promisify(fs.rename)

const readFileAsyncCatchError = async (filepath) => {
  try {
    return { content: await readFileAsync(filepath) }
  } catch (error) {
    return { error }
  }
}

const fileExistsAsync = async (filePath) => {
  try {
    await accessAsync(filePath, fs.F_OK)
    return true
  } catch (_) {
    return false
  }
}

const isFileAsync = (filePath) => pathType.isFile(filePath)

const mkdirRecursiveSync = (path) => makeDir.sync(path)
const mkdirRecursiveAsync = (path) => makeDir(path)

const rmdirRecursiveAsync = (path) => del(path, { force: true })

const renameAsyncNoError = async (oldPath, newPath) => {
  try {
    await renameAsync(oldPath, newPath)
    return true
  } catch (_) {
    return false
  }
}

module.exports = {
  statAsync,
  readFileAsync,
  readFileAsyncCatchError,
  writeFileAsync,
  rmFileAsync,
  copyFileAsync,
  fileExistsAsync,
  isFileAsync,
  mkdirRecursiveSync,
  mkdirRecursiveAsync,
  rmdirRecursiveAsync,
  mkdtempAsync,
  appendFileAsync,
  renameAsyncNoError,
}
