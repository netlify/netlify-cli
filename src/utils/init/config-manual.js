const inquirer = require('inquirer')

const { log } = require('../command-helpers')

const { getBuildSettings, saveNetlifyToml, createDeployKey, setupSite } = require('./utils')

const addDeployKey = async ({ exit, deployKey }) => {
  log('\nGive this Netlify SSH public key access to your repository:\n')
  log(`\n${deployKey.public_key}\n\n`)

  const { sshKeyAdded } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'sshKeyAdded',
      message: 'Continue?',
      default: true,
    },
  ])

  if (!sshKeyAdded) {
    exit()
  }
}

const getRepoPath = async ({ repoData }) => {
  const { repoPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repoPath',
      message: 'The SSH URL of the remote git repo:',
      default: repoData.url,
      validate: (url) => SSH_URL_REGEXP.test(url) || 'The URL provided does not use the SSH protocol',
    },
  ])

  return repoPath
}

const addDeployHook = async ({ deployHook }) => {
  log('\nConfigure the following webhook for your repository:\n')
  log(`\n${deployHook}\n\n`)
  const { deployHookAdded } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deployHookAdded',
      message: 'Continue?',
      default: true,
    },
  ])

  return deployHookAdded
}

module.exports = async function configManual({ context, siteId, repoData }) {
  const { warn, error: failAndExit, exit, netlify } = context
  const {
    api,
    config,
    repositoryRoot,
    site: { root: siteRoot },
    cachedConfig: { env, configPath },
  } = netlify

  const { baseDir, buildCmd, buildDir, functionsDir, pluginsToInstall } = await getBuildSettings({
    repositoryRoot,
    siteRoot,
    config,
    env,
    warn,
  })
  await saveNetlifyToml({ repositoryRoot, config, configPath, baseDir, buildCmd, buildDir, functionsDir, warn })

  const deployKey = await createDeployKey({ api, failAndExit })
  await addDeployKey({ exit, deployKey })

  const repoPath = await getRepoPath({ repoData })
  const repo = {
    provider: 'manual',
    repo_path: repoPath,
    repo_branch: repoData.branch,
    allowed_branches: [repoData.branch],
    deploy_key_id: deployKey.id,
    base: baseDir,
    dir: buildDir,
    functions_dir: functionsDir,
    ...(buildCmd && { cmd: buildCmd }),
  }

  const updatedSite = await setupSite({
    api,
    failAndExit,
    siteId,
    repo,
    configPlugins: config.plugins,
    pluginsToInstall,
  })
  const deployHookAdded = await addDeployHook({ deployHook: updatedSite.deploy_hook })
  if (!deployHookAdded) {
    exit()
  }
}

const SSH_URL_REGEXP = /(ssh:\/\/|[a-zA-Z]*@|[a-zA-Z.].*:(?!\/\/))/
