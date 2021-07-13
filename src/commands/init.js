const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')
const dotProp = require('dot-prop')
const inquirer = require('inquirer')
const isEmpty = require('lodash/isEmpty')

const Command = require('../utils/command')
const { log } = require('../utils/command-helpers')
const { getRepoData } = require('../utils/get-repo-data')
const ensureNetlifyIgnore = require('../utils/gitignore')
const { configureRepo } = require('../utils/init/config')
const { track } = require('../utils/telemetry')

const LinkCommand = require('./link')
const SitesCreateCommand = require('./sites/create')

const persistState = ({ state, siteInfo }) => {
  // Save to .netlify/state.json file
  state.set('siteId', siteInfo.id)
}

const getRepoUrl = ({ siteInfo }) => dotProp.get(siteInfo, 'build_settings.repo_url')

const logExistingAndExit = ({ exit, siteInfo }) => {
  log()
  log(`This site has been initialized`)
  log()
  log(`Site Name:  ${chalk.cyan(siteInfo.name)}`)
  log(`Site Url:   ${chalk.cyan(siteInfo.ssl_url || siteInfo.url)}`)
  log(`Site Repo:  ${chalk.cyan(getRepoUrl({ siteInfo }))}`)
  log(`Site Id:    ${chalk.cyan(siteInfo.id)}`)
  log(`Admin URL:  ${chalk.cyan(siteInfo.admin_url)}`)
  log()
  log(`To disconnect this directory and create a new site (or link to another siteId)`)
  log(`1. Run ${chalk.cyanBright.bold('netlify unlink')}`)
  log(`2. Then run ${chalk.cyanBright.bold('netlify init')} again`)
  exit()
}

const createNewSiteAndExit = async ({ exit, state }) => {
  const siteInfo = await SitesCreateCommand.run([])

  log(`"${siteInfo.name}" site was created`)
  log()
  log(`To deploy to this site. Run your site build and then ${chalk.cyanBright.bold('netlify deploy')}`)

  persistState({ state, siteInfo })

  exit()
}

const logGitSetupInstructionsAndExit = ({ exit }) => {
  log()
  log(`${chalk.bold('To initialize a new git repo follow the steps below.')}

1. Initialize a new repo:

   ${chalk.cyanBright.bold('git init')}

2. Commit your files

   ${chalk.cyanBright.bold('git add .')}

3. Commit your files

   ${chalk.cyanBright.bold("git commit -m 'initial commit'")}

4. Create a new repo in GitHub ${chalk.cyanBright.bold('https://github.com/new')}

5. Link the remote repo with this local directory

   ${chalk.cyanBright.bold('git remote add origin git@github.com:YourGithubName/your-repo-slug.git')}

6. Push up your files

   ${chalk.cyanBright.bold('git push -u origin main')}

7. Initialize your Netlify Site

   ${chalk.cyanBright.bold('netlify init')}
`)
  exit()
}

const handleNoGitRemoteAndExit = async ({ exit, error, state }) => {
  log()
  log(`${chalk.yellow('No git remote was found, would you like to set one up?')}`)
  log(`
It is recommended that you initialize a site that has a remote repository in GitHub.

This will allow for Netlify Continuous deployment to build branch & PR previews.

For more details on Netlify CI checkout the docs: http://bit.ly/2N0Jhy5
`)
  if (error === "Couldn't find origin url") {
    log(`Unable to find a remote origin URL. Please add a git remote.

git remote add origin https://github.com/YourUserName/RepoName.git
`)
  }

  const NEW_SITE_NO_GIT = 'Yes, create and deploy site manually'
  const NO_ABORT = 'No, I will connect this directory with GitHub first'

  const { noGitRemoteChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'noGitRemoteChoice',
      message: 'Do you want to create a Netlify site without a git repository?',
      choices: [NEW_SITE_NO_GIT, NO_ABORT],
    },
  ])

  if (noGitRemoteChoice === NEW_SITE_NO_GIT) {
    await createNewSiteAndExit({ exit, state })
  } else if (noGitRemoteChoice === NO_ABORT) {
    logGitSetupInstructionsAndExit({ exit })
  }
}

const createOrLinkSiteToRepo = async () => {
  const NEW_SITE = '+  Create & configure a new site'
  const EXISTING_SITE = '⇄  Connect this directory to an existing Netlify site'

  const initializeOpts = [EXISTING_SITE, NEW_SITE]

  const { initChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'initChoice',
      message: 'What would you like to do?',
      choices: initializeOpts,
    },
  ])

  // create site or search for one
  if (initChoice === NEW_SITE) {
    await track('sites_initStarted', {
      type: 'new site',
    })
    // run site:create command
    return await SitesCreateCommand.run([])
  }
  if (initChoice === EXISTING_SITE) {
    // run link command
    return await LinkCommand.run([], false)
  }
}

const logExistingRepoSetupAndExit = ({ exit, siteName, repoUrl }) => {
  log()
  log(chalk.underline.bold(`Success`))
  log(`This site "${siteName}" is configured to automatically deploy via ${repoUrl}`)
  // TODO add support for changing github repo in site:config command
  exit()
}

class InitCommand extends Command {
  async run() {
    const { flags } = this.parse(InitCommand)

    this.setAnalyticsPayload({ manual: flags.manual, force: flags.force })

    const { exit, netlify } = this
    const { repositoryRoot, state } = netlify
    let { siteInfo } = this.netlify

    // Check logged in status
    await this.authenticate()

    // Add .netlify to .gitignore file
    await ensureNetlifyIgnore(repositoryRoot)

    const repoUrl = getRepoUrl({ siteInfo })
    if (repoUrl && !flags.force) {
      logExistingAndExit({ exit, siteInfo })
    }

    // Look for local repo
    const repoData = await getRepoData({ remoteName: flags.gitRemoteName })
    if (repoData.error) {
      await handleNoGitRemoteAndExit({ exit, error: repoData.error, state })
    }

    if (isEmpty(siteInfo)) {
      siteInfo = await createOrLinkSiteToRepo()
    }

    // Check for existing CI setup
    const remoteBuildRepo = getRepoUrl({ siteInfo })
    if (remoteBuildRepo && !flags.force) {
      logExistingRepoSetupAndExit({ exit, siteName: siteInfo.name, repoUrl: remoteBuildRepo })
    }

    persistState({ state, siteInfo })

    await configureRepo({ context: this, siteId: siteInfo.id, repoData, manual: flags.manual })

    return siteInfo
  }
}

InitCommand.description = `Configure continuous deployment for a new or existing site`

InitCommand.flags = {
  manual: flagsLib.boolean({
    char: 'm',
    description: 'Manually configure a git remote for CI',
  }),
  force: flagsLib.boolean({
    description: 'Reinitialize CI hooks if the linked site is already configured to use CI',
  }),
  gitRemoteName: flagsLib.string({
    description: 'Name of Git remote to use. e.g. "origin"',
  }),
  ...InitCommand.flags,
}

module.exports = InitCommand
