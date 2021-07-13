const path = require('path')
const process = require('process')

const execa = require('execa')
const { fetchVersion, fetchLatest, updateAvailable, newerVersion } = require('gh-release-fetch')
const isExe = require('isexe')

const { log } = require('../utils/command-helpers')
const { NETLIFYDEVWARN } = require('../utils/logo')

const isWindows = () => process.platform === 'win32'

const getRepository = ({ packageName }) => `netlify/${packageName}`

const getExecName = ({ execName }) => (isWindows() ? `${execName}.exe` : execName)

const getOptions = () => {
  // this is used in out CI tests to avoid hitting GitHub API limit
  // when calling gh-release-fetch
  if (process.env.NETLIFY_TEST_GITHUB_TOKEN) {
    return {
      headers: { Authorization: `token ${process.env.NETLIFY_TEST_GITHUB_TOKEN}` },
    }
  }
}

const isVersionOutdated = async ({ packageName, currentVersion, latestVersion }) => {
  if (latestVersion) {
    return newerVersion(latestVersion, currentVersion)
  }
  const options = getOptions()
  const outdated = await updateAvailable(getRepository({ packageName }), currentVersion, options)
  return outdated
}

const shouldFetchLatestVersion = async ({ binPath, packageName, execName, execArgs, pattern, latestVersion }) => {
  const execPath = path.join(binPath, getExecName({ execName }))

  const exists = await isExe(execPath, { ignoreErrors: true })
  if (!exists) {
    return true
  }

  const { stdout } = await execa(execPath, execArgs)

  if (!stdout) {
    return false
  }

  const match = stdout.match(new RegExp(pattern))
  if (!match) {
    return false
  }

  try {
    const [, currentVersion] = match
    const outdated = await isVersionOutdated({
      packageName,
      currentVersion,
      latestVersion,
    })
    return outdated
  } catch (error) {
    if (exists) {
      log(NETLIFYDEVWARN, `failed checking for new version of '${packageName}'. Using existing version`)
      return false
    }
    throw error
  }
}

const fetchLatestVersion = async ({ packageName, execName, destination, extension, latestVersion }) => {
  const win = isWindows()
  const platform = win ? 'windows' : process.platform
  const release = {
    repository: getRepository({ packageName }),
    package: `${execName}-${platform}-amd64.${extension}`,
    destination,
    extract: true,
  }

  const options = getOptions()
  await (latestVersion ? fetchVersion({ ...release, version: latestVersion }, options) : fetchLatest(release, options))
}

module.exports = { getExecName, shouldFetchLatestVersion, fetchLatestVersion }
