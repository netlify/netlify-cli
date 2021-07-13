const { dirname } = require('path')
const process = require('process')
const util = require('util')

const findUp = require('find-up')
const gitRepoInfo = require('git-repo-info')
const gitconfiglocal = require('gitconfiglocal')
const isEmpty = require('lodash/isEmpty')
const parseGitRemote = require('parse-github-url')

const { log } = require('./command-helpers')

const getRepoData = async function ({ remoteName }) {
  try {
    const cwd = process.cwd()
    const [gitConfig, gitDirectory] = await Promise.all([
      util.promisify(gitconfiglocal)(cwd),
      findUp('.git', { cwd, type: 'directory' }),
    ])
    const baseGitPath = dirname(gitDirectory)

    if (cwd !== baseGitPath) {
      log(`Git directory located in ${baseGitPath}`)
    }

    if (isEmpty(gitConfig) || isEmpty(gitConfig.remote)) {
      throw new Error('No Git remote found')
    }

    if (!remoteName) {
      const remotes = Object.keys(gitConfig.remote)
      remoteName = remotes.find((remote) => remote === 'origin') || remotes[0]
    }

    if (!Object.prototype.hasOwnProperty.call(gitConfig.remote, remoteName) || isEmpty(gitConfig.remote[remoteName])) {
      throw new Error(
        `The specified remote "${remoteName}" is not defined in Git repo. Please use --gitRemoteName flag to specify a remote.`,
      )
    }

    const { url } = gitConfig.remote[remoteName]
    const { name, owner, host, repo } = parseGitRemote(url)
    const { branch } = gitRepoInfo()
    return {
      name,
      owner,
      repo,
      url,
      branch,
      provider: PROVIDERS[host] || host,
      httpsUrl: `https://${host}/${repo}`,
    }
  } catch (error) {
    return {
      error: error.message,
    }
  }
}

const PROVIDERS = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
}

module.exports = { getRepoData }
