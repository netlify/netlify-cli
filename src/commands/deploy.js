const path = require('path')
const process = require('process')

const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')
const { get } = require('dot-prop')
const inquirer = require('inquirer')
const isObject = require('lodash/isObject')
const prettyjson = require('prettyjson')

const { cancelDeploy } = require('../lib/api')
const { getBuildOptions, runBuild } = require('../lib/build')
const { statAsync } = require('../lib/fs')
const { normalizeFunctionsConfig } = require('../lib/functions/config')
const { getLogMessage } = require('../lib/log')
const { startSpinner, stopSpinner } = require('../lib/spinner')
const Command = require('../utils/command')
const { log, logJson, getToken } = require('../utils/command-helpers')
const { deploySite } = require('../utils/deploy/deploy-site')
const { deployEdgeHandlers } = require('../utils/edge-handlers')
const { NETLIFYDEV, NETLIFYDEVLOG, NETLIFYDEVERR } = require('../utils/logo')
const openBrowser = require('../utils/open-browser')

const LinkCommand = require('./link')
const SitesCreateCommand = require('./sites/create')

const DEFAULT_DEPLOY_TIMEOUT = 1.2e6

const triggerDeploy = async ({ api, siteId, siteData, error }) => {
  try {
    const siteBuild = await api.createSiteBuild({ siteId })
    log(
      `${NETLIFYDEV} A new deployment was triggered successfully. Visit https://app.netlify.com/sites/${siteData.name}/deploys/${siteBuild.deploy_id} to see the logs.`,
    )
  } catch (error_) {
    if (error_.status === 404) {
      error('Site not found. Please rerun "netlify link" and make sure that your site has CI configured.')
    } else {
      error(error_.message)
    }
  }
}

const getDeployFolder = async ({ flags, config, site, siteData }) => {
  let deployFolder
  if (flags.dir) {
    deployFolder = path.resolve(process.cwd(), flags.dir)
  } else if (get(config, 'build.publish')) {
    deployFolder = path.resolve(site.root, get(config, 'build.publish'))
  } else if (get(siteData, 'build_settings.dir')) {
    deployFolder = path.resolve(site.root, get(siteData, 'build_settings.dir'))
  }

  if (!deployFolder) {
    log('Please provide a publish directory (e.g. "public" or "dist" or "."):')
    log(process.cwd())
    const { promptPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'promptPath',
        message: 'Publish directory',
        default: '.',
        filter: (input) => path.resolve(process.cwd(), input),
      },
    ])
    deployFolder = promptPath
  }

  return deployFolder
}

const validateDeployFolder = async ({ deployFolder, error }) => {
  let stat
  try {
    stat = await statAsync(deployFolder)
  } catch (error_) {
    if (error_.code === 'ENOENT') {
      return error(`No such directory ${deployFolder}! Did you forget to run a build?`)
    }

    // Improve the message of permission errors
    if (error_.code === 'EACCES') {
      return error('Permission error when trying to access deploy folder')
    }
    throw error_
  }

  if (!stat.isDirectory()) {
    return error('Deploy target must be a path to a directory')
  }
  return stat
}

const getFunctionsFolder = ({ flags, config, site, siteData }) => {
  let functionsFolder
  // Support "functions" and "Functions"
  const funcConfig = config.functionsDirectory
  if (flags.functions) {
    functionsFolder = path.resolve(process.cwd(), flags.functions)
  } else if (funcConfig) {
    functionsFolder = path.resolve(site.root, funcConfig)
  } else if (get(siteData, 'build_settings.functions_dir')) {
    functionsFolder = path.resolve(site.root, get(siteData, 'build_settings.functions_dir'))
  }
  return functionsFolder
}

const validateFunctionsFolder = async ({ functionsFolder, error }) => {
  let stat
  if (functionsFolder) {
    // we used to hard error if functions folder is specified but doesn't exist
    // but this was too strict for onboarding. we can just log a warning.
    try {
      stat = await statAsync(functionsFolder)
    } catch (error_) {
      if (error_.code === 'ENOENT') {
        log(
          `Functions folder "${functionsFolder}" specified but it doesn't exist! Will proceed without deploying functions`,
        )
      }
      // Improve the message of permission errors
      if (error_.code === 'EACCES') {
        error('Permission error when trying to access functions folder')
      }
    }
  }

  if (stat && !stat.isDirectory()) {
    error('Functions folder must be a path to a directory')
  }

  return stat
}

const validateFolders = async ({ deployFolder, functionsFolder, error }) => {
  const deployFolderStat = await validateDeployFolder({ deployFolder, error })
  const functionsFolderStat = await validateFunctionsFolder({ functionsFolder, error })
  return { deployFolderStat, functionsFolderStat }
}

const getDeployFilesFilter = ({ site, deployFolder }) => {
  // site.root === deployFolder can happen when users run `netlify deploy --dir .`
  // in that specific case we don't want to publish the repo node_modules
  // when site.root !== deployFolder the behaviour matches our buildbot
  const skipNodeModules = site.root === deployFolder

  return (filename) => {
    if (filename == null) {
      return false
    }
    if (filename === deployFolder) {
      return true
    }

    const basename = path.basename(filename)
    const skipFile =
      (skipNodeModules && basename === 'node_modules') ||
      (basename.startsWith('.') && basename !== '.well-known') ||
      basename.startsWith('__MACOSX') ||
      basename.includes('/.')

    return !skipFile
  }
}

const SEC_TO_MILLISEC = 1e3
// 100 bytes
const SYNC_FILE_LIMIT = 1e2

const prepareProductionDeploy = async ({ siteData, api, exit }) => {
  if (isObject(siteData.published_deploy) && siteData.published_deploy.locked) {
    log(`\n${NETLIFYDEVERR} Deployments are "locked" for production context of this site\n`)
    const { unlockChoice } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'unlockChoice',
        message: 'Would you like to "unlock" deployments for production context to proceed?',
        default: false,
      },
    ])
    if (!unlockChoice) exit(0)
    await api.unlockDeploy({ deploy_id: siteData.published_deploy.id })
    log(`\n${NETLIFYDEVLOG} "Auto publishing" has been enabled for production context\n`)
  }
  log('Deploying to main site URL...')
}

const hasErrorMessage = (actual, expected) => {
  if (typeof actual === 'string') {
    return actual.includes(expected)
  }
  return false
}

const getJsonErrorMessage = (error) => get(error, 'json.message', '')

const reportDeployError = ({ error, warn, failAndExit }) => {
  switch (true) {
    case error.name === 'JSONHTTPError': {
      const message = getJsonErrorMessage(error)
      if (hasErrorMessage(message, 'Background Functions not allowed by team plan')) {
        return failAndExit(`\n${getLogMessage('functions.backgroundNotSupported')}`)
      }
      warn(`JSONHTTPError: ${message} ${error.status}`)
      warn(`\n${JSON.stringify(error, null, '  ')}\n`)
      failAndExit(error)
      return
    }
    case error.name === 'TextHTTPError': {
      warn(`TextHTTPError: ${error.status}`)
      warn(`\n${error}\n`)
      failAndExit(error)
      return
    }
    case hasErrorMessage(error.message, 'Invalid filename'): {
      warn(error.message)
      failAndExit(error)
      return
    }
    default: {
      warn(`\n${JSON.stringify(error, null, '  ')}\n`)
      failAndExit(error)
    }
  }
}

const runDeploy = async ({
  flags,
  deployToProduction,
  site,
  siteData,
  api,
  siteId,
  deployFolder,
  configPath,
  functionsConfig,
  functionsFolder,
  alias,
  warn,
  error,
  exit,
}) => {
  let results
  let deployId
  try {
    if (deployToProduction) {
      await prepareProductionDeploy({ siteData, api, exit })
    } else {
      log('Deploying to draft URL...')
    }

    const draft = !deployToProduction && !alias
    const title = flags.message
    results = await api.createSiteDeploy({ siteId, title, body: { draft, branch: alias } })
    deployId = results.id

    const silent = flags.json || flags.silent
    await deployEdgeHandlers({
      site,
      deployId,
      api,
      silent,
      error,
      warn,
    })
    results = await deploySite(api, siteId, deployFolder, {
      configPath,
      fnDir: functionsFolder,
      functionsConfig,
      statusCb: silent ? () => {} : deployProgressCb(),
      deployTimeout: flags.timeout * SEC_TO_MILLISEC || DEFAULT_DEPLOY_TIMEOUT,
      syncFileLimit: SYNC_FILE_LIMIT,
      // pass an existing deployId to update
      deployId,
      filter: getDeployFilesFilter({ site, deployFolder }),
      warn,
      rootDir: site.root,
    })
  } catch (error_) {
    if (deployId) {
      await cancelDeploy({ api, deployId, warn })
    }
    reportDeployError({ error: error_, warn, failAndExit: error })
  }

  const siteUrl = results.deploy.ssl_url || results.deploy.url
  const deployUrl = get(results, 'deploy.deploy_ssl_url') || get(results, 'deploy.deploy_url')
  const logsUrl = `${get(results, 'deploy.admin_url')}/deploys/${get(results, 'deploy.id')}`

  return {
    siteId: results.deploy.site_id,
    siteName: results.deploy.name,
    deployId: results.deployId,
    siteUrl,
    deployUrl,
    logsUrl,
  }
}

const handleBuild = async ({ context, flags }) => {
  if (!flags.build) {
    return
  }
  const [token] = await context.getToken()
  const options = await getBuildOptions({
    context,
    token,
    flags,
  })
  const { exitCode, newConfig } = await runBuild(options)
  if (exitCode !== 0) {
    context.exit(exitCode)
  }
  return newConfig
}

const printResults = ({ flags, results, deployToProduction, exit }) => {
  const msgData = {
    Logs: `${results.logsUrl}`,
    'Unique Deploy URL': results.deployUrl,
  }

  if (deployToProduction) {
    msgData['Website URL'] = results.siteUrl
  } else {
    delete msgData['Unique Deploy URL']
    msgData['Website Draft URL'] = results.deployUrl
  }

  // Spacer
  log()

  // Json response for piping commands
  if (flags.json) {
    const jsonData = {
      name: results.name,
      site_id: results.site_id,
      site_name: results.siteName,
      deploy_id: results.deployId,
      deploy_url: results.deployUrl,
      logs: results.logsUrl,
    }
    if (deployToProduction) {
      jsonData.url = results.siteUrl
    }

    logJson(jsonData)
    exit(0)
  } else {
    log(prettyjson.render(msgData))

    if (!deployToProduction) {
      log()
      log('If everything looks good on your draft URL, deploy it to your main site URL with the --prod flag.')
      log(`${chalk.cyanBright.bold('netlify deploy --prod')}`)
      log()
    }
  }
}

class DeployCommand extends Command {
  async run() {
    const { flags } = this.parse(DeployCommand)
    const { warn, error, exit } = this
    const { api, site } = this.netlify
    const alias = flags.alias || flags.branch

    // for build context
    this.getToken = getToken

    this.setAnalyticsPayload({ open: flags.open, prod: flags.prod, json: flags.json, alias: Boolean(alias) })

    if (flags.branch) {
      warn('--branch flag has been renamed to --alias and will be removed in future versions')
    }

    await this.authenticate(flags.auth)

    let siteId = flags.site || site.id
    let siteData = {}
    if (siteId) {
      try {
        siteData = await api.getSite({ siteId })
      } catch (error_) {
        // TODO specifically handle known cases (e.g. no account access)
        if (error_.status === 404) {
          error('Site not found')
        } else {
          error(error_.message)
        }
      }
    } else {
      log("This folder isn't linked to a site yet")
      const NEW_SITE = '+  Create & configure a new site'
      const EXISTING_SITE = 'Link this directory to an existing site'

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
        // run site:create command
        siteData = await SitesCreateCommand.run([])
        site.id = siteData.id
        siteId = site.id
      } else if (initChoice === EXISTING_SITE) {
        // run link command
        siteData = await LinkCommand.run([], false)
        site.id = siteData.id
        siteId = site.id
      }
    }

    const deployToProduction = flags.prod || (flags.prodIfUnlocked && !siteData.published_deploy.locked)

    if (flags.trigger) {
      return triggerDeploy({ api, siteId, siteData, error })
    }

    const newConfig = await handleBuild({ context: this, flags })
    const config = newConfig || this.netlify.config

    const deployFolder = await getDeployFolder({ flags, config, site, siteData })
    const functionsFolder = getFunctionsFolder({ flags, config, site, siteData })
    const { configPath } = site

    log(
      prettyjson.render({
        'Deploy path': deployFolder,
        'Functions path': functionsFolder,
        'Configuration path': configPath,
      }),
    )

    const { functionsFolderStat } = await validateFolders({
      deployFolder,
      functionsFolder,
      error,
    })
    const functionsConfig = normalizeFunctionsConfig({ functionsConfig: config.functions, projectRoot: site.root })
    const results = await runDeploy({
      flags,
      deployToProduction,
      site,
      siteData,
      api,
      siteId,
      deployFolder,
      functionsConfig,
      configPath,
      // pass undefined functionsFolder if doesn't exist
      functionsFolder: functionsFolderStat && functionsFolder,
      alias,
      warn,
      error,
      exit,
    })

    printResults({ flags, results, deployToProduction, exit })

    if (flags.open) {
      const urlToOpen = deployToProduction ? results.siteUrl : results.deployUrl
      await openBrowser({ url: urlToOpen })
      exit()
    }
  }
}

DeployCommand.description = `Create a new deploy from the contents of a folder

Deploys from the build settings found in the netlify.toml file, or settings from the API.

The following environment variables can be used to override configuration file lookups and prompts:

- \`NETLIFY_AUTH_TOKEN\` - an access token to use when authenticating commands. Keep this value private.
- \`NETLIFY_SITE_ID\` - override any linked site in the current working directory.

Lambda functions in the function folder can be in the following configurations for deployment:


Built Go binaries:
------------------

\`\`\`
functions/
└── nameOfGoFunction
\`\`\`

Build binaries of your Go language functions into the functions folder as part of your build process.


Single file Node.js functions:
-----------------------------

Build dependency bundled Node.js lambda functions with tools like netlify-lambda, webpack or browserify into the function folder as part of your build process.

\`\`\`
functions/
└── nameOfBundledNodeJSFunction.js
\`\`\`

Unbundled Node.js functions that have dependencies outside or inside of the functions folder:
---------------------------------------------------------------------------------------------

You can ship unbundled Node.js functions with the CLI, utilizing top level project dependencies, or a nested package.json.
If you use nested dependencies, be sure to populate the nested node_modules as part of your build process before deploying using npm or yarn.

\`\`\`
project/
├── functions
│   ├── functionName/
│   │   ├── functionName.js  (Note the folder and the function name need to match)
│   │   ├── package.json
│   │   └── node_modules/
│   └── unbundledFunction.js
├── package.json
├── netlify.toml
└── node_modules/
\`\`\`

Any mix of these configurations works as well.


Node.js function entry points
-----------------------------

Function entry points are determined by the file name and name of the folder they are in:

\`\`\`
functions/
├── aFolderlessFunctionEntrypoint.js
└── functionName/
    ├── notTheEntryPoint.js
    └── functionName.js
\`\`\`

Support for package.json's main field, and intrinsic index.js entrypoints are coming soon.
`

DeployCommand.examples = [
  'netlify deploy',
  'netlify deploy --prod',
  'netlify deploy --prod --open',
  'netlify deploy --prodIfUnlocked',
  'netlify deploy --message "A message with an $ENV_VAR"',
  'netlify deploy --auth $NETLIFY_AUTH_TOKEN',
  'netlify deploy --trigger',
]

DeployCommand.flags = {
  dir: flagsLib.string({
    char: 'd',
    description: 'Specify a folder to deploy',
  }),
  functions: flagsLib.string({
    char: 'f',
    description: 'Specify a functions folder to deploy',
  }),
  prod: flagsLib.boolean({
    char: 'p',
    description: 'Deploy to production',
    default: false,
    exclusive: ['alias', 'branch', 'prodIfUnlocked'],
  }),
  prodIfUnlocked: flagsLib.boolean({
    description: 'Deploy to production if unlocked, create a draft otherwise',
    default: false,
    exclusive: ['alias', 'branch', 'prod'],
  }),
  alias: flagsLib.string({
    description:
      'Specifies the alias for deployment, the string at the beginning of the deploy subdomain. Useful for creating predictable deployment URLs. Avoid setting an alias string to the same value as a deployed branch. `alias` doesn’t create a branch deploy and can’t be used in conjunction with the branch subdomain feature. Maximum 37 characters.',
  }),
  branch: flagsLib.string({
    char: 'b',
    description: 'Serves the same functionality as --alias. Deprecated and will be removed in future versions',
  }),
  open: flagsLib.boolean({
    char: 'o',
    description: 'Open site after deploy',
    default: false,
  }),
  message: flagsLib.string({
    char: 'm',
    description: 'A short message to include in the deploy log',
  }),
  auth: flagsLib.string({
    char: 'a',
    description: 'Netlify auth token to deploy with',
    env: 'NETLIFY_AUTH_TOKEN',
  }),
  site: flagsLib.string({
    char: 's',
    description: 'A site ID to deploy to',
    env: 'NETLIFY_SITE_ID',
  }),
  json: flagsLib.boolean({
    description: 'Output deployment data as JSON',
  }),
  timeout: flagsLib.integer({
    description: 'Timeout to wait for deployment to finish',
  }),
  trigger: flagsLib.boolean({
    description: 'Trigger a new build of your site on Netlify without uploading local files',
    exclusive: ['build'],
  }),
  build: flagsLib.boolean({
    description: 'Run build command before deploying',
  }),
  ...DeployCommand.flags,
}

const deployProgressCb = function () {
  const events = {}
  // event: {
  //         type: name-of-step
  //         msg: msg to print
  //         phase: [start, progress, stop]
  // }
  //
  return (event) => {
    switch (event.phase) {
      case 'start': {
        events[event.type] = startSpinner({
          text: event.msg,
        })
        return
      }
      case 'progress': {
        const spinner = events[event.type]
        if (spinner) {
          spinner.text = event.msg
        }
        return
      }
      case 'stop':
      default: {
        stopSpinner({ spinner: events[event.type], text: event.msg })
        delete events[event.type]
      }
    }
  }
}

module.exports = DeployCommand
