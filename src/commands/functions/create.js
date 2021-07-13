const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const process = require('process')
const { promisify } = require('util')

const { flags: flagsLib } = require('@oclif/command')
const chalk = require('chalk')
const copy = promisify(require('copy-template-dir'))
const fuzzy = require('fuzzy')
const inquirer = require('inquirer')
const inquirerAutocompletePrompt = require('inquirer-autocomplete-prompt')
const fetch = require('node-fetch')
const ora = require('ora')

const { mkdirRecursiveSync } = require('../../lib/fs')
const { getSiteData, getAddons, getCurrentAddon } = require('../../utils/addons/prepare')
const Command = require('../../utils/command')
const { log } = require('../../utils/command-helpers')
const { injectEnvVariables } = require('../../utils/dev')
const { NETLIFYDEVLOG, NETLIFYDEVWARN, NETLIFYDEVERR } = require('../../utils/logo')
const { readRepoURL, validateRepoURL } = require('../../utils/read-repo-url')

const templatesDir = path.resolve(__dirname, '../../functions-templates')

/**
 * Be very clear what is the SOURCE (templates dir) vs the DEST (functions dir)
 */
class FunctionsCreateCommand extends Command {
  async run() {
    const { flags, args } = this.parse(FunctionsCreateCommand)

    const functionsDir = await ensureFunctionDirExists(this)

    /* either download from URL or scaffold from template */
    const mainFunc = flags.url ? downloadFromURL : scaffoldFromTemplate
    await mainFunc(this, flags, args, functionsDir)
  }
}

FunctionsCreateCommand.args = [
  {
    name: 'name',
    description: 'name of your new function file inside your functions directory',
  },
]

FunctionsCreateCommand.description = `Create a new function locally`

FunctionsCreateCommand.examples = [
  'netlify functions:create',
  'netlify functions:create hello-world',
  'netlify functions:create --name hello-world',
]
FunctionsCreateCommand.aliases = ['function:create']
FunctionsCreateCommand.flags = {
  name: flagsLib.string({ char: 'n', description: 'function name' }),
  url: flagsLib.string({ char: 'u', description: 'pull template from URL' }),
  ...FunctionsCreateCommand.flags,
}
module.exports = FunctionsCreateCommand

/**
 * all subsections of code called from the main logic flow above
 */

// prompt for a name if name not supplied
const getNameFromArgs = async function (args, flags, defaultName) {
  if (flags.name) {
    if (args.name) {
      throw new Error('function name specified in both flag and arg format, pick one')
    }
    return flags.name
  }

  if (args.name) {
    return args.name
  }

  const { name } = await inquirer.prompt([
    {
      name: 'name',
      message: 'name your function: ',
      default: defaultName,
      type: 'input',
      validate: (val) => Boolean(val) && /^[\w.-]+$/i.test(val),
      // make sure it is not undefined and is a valid filename.
      // this has some nuance i have ignored, eg crossenv and i18n concerns
    },
  ])
  return name
}

const filterRegistry = function (registry, input) {
  const temp = registry.map((value) => value.name + value.description)
  // TODO: remove once https://github.com/sindresorhus/eslint-plugin-unicorn/issues/1394 is fixed
  // eslint-disable-next-line unicorn/no-array-method-this-argument
  const filteredTemplates = fuzzy.filter(input, temp)
  const filteredTemplateNames = new Set(
    filteredTemplates.map((filteredTemplate) => (input ? filteredTemplate.string : filteredTemplate)),
  )
  return registry
    .filter((t) => filteredTemplateNames.has(t.name + t.description))
    .map((t) => {
      // add the score
      const { score } = filteredTemplates.find((filteredTemplate) => filteredTemplate.string === t.name + t.description)
      t.score = score
      return t
    })
}

const formatRegistryArrayForInquirer = function (lang) {
  const folderNames = fs.readdirSync(path.join(templatesDir, lang))
  const registry = folderNames
    // filter out markdown files
    .filter((folderName) => !folderName.endsWith('.md'))
    // eslint-disable-next-line node/global-require, import/no-dynamic-require
    .map((folderName) => require(path.join(templatesDir, lang, folderName, '.netlify-function-template.js')))
    .sort(
      (folderNameA, folderNameB) =>
        (folderNameA.priority || DEFAULT_PRIORITY) - (folderNameB.priority || DEFAULT_PRIORITY),
    )
    .map((t) => {
      t.lang = lang
      return {
        // confusing but this is the format inquirer wants
        name: `[${t.name}] ${t.description}`,
        value: t,
        short: `${lang}-${t.name}`,
      }
    })
  return registry
}

// pick template from our existing templates
const pickTemplate = async function () {
  inquirer.registerPrompt('autocomplete', inquirerAutocompletePrompt)
  // doesnt scale but will be ok for now
  const [
    jsreg,
    // tsreg, goreg
  ] = [
    'js',
    // 'ts', 'go'
  ].map(formatRegistryArrayForInquirer)
  const specialCommands = [
    new inquirer.Separator(`----[Special Commands]----`),
    {
      name: `*** Clone template from Github URL ***`,
      value: 'url',
      short: 'gh-url',
    },
    {
      name: `*** Report issue with, or suggest a new template ***`,
      value: 'report',
      short: 'gh-report',
    },
  ]
  const { chosentemplate } = await inquirer.prompt({
    name: 'chosentemplate',
    message: 'Pick a template',
    type: 'autocomplete',
    // suggestOnly: true, // we can explore this for entering URL in future
    source(answersSoFar, input) {
      if (!input || input === '') {
        // show separators
        return [
          new inquirer.Separator(`----[JS]----`),
          ...jsreg,
          // new inquirer.Separator(`----[TS]----`),
          // ...tsreg,
          // new inquirer.Separator(`----[GO]----`),
          // ...goreg
          ...specialCommands,
        ]
      }
      // only show filtered results sorted by score
      const answers = [
        ...filterRegistry(jsreg, input),
        // ...filterRegistry(tsreg, input),
        // ...filterRegistry(goreg, input)
        ...specialCommands,
      ].sort((answerA, answerB) => answerB.score - answerA.score)
      return answers
    },
  })
  return chosentemplate
}

const DEFAULT_PRIORITY = 999

/**
 * Get functions directory (and make it if necessary)
 * @param {FunctionsCreateCommand} context
 * @returns {string | never} - functions directory or throws an error
 */
const ensureFunctionDirExists = async function (context) {
  const { api, config, site } = context.netlify
  const siteId = site.id
  let functionsDirHolder = config.functionsDirectory

  if (!functionsDirHolder) {
    log(`${NETLIFYDEVLOG} functions directory not specified in netlify.toml or UI settings`)

    if (!siteId) {
      context.error(`${NETLIFYDEVERR} No site id found, please run inside a site directory or \`netlify link\``)
    }

    const { functionsDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'functionsDir',
        message:
          'Enter the path, relative to your site’s base directory in your repository, where your functions should live:',
        default: 'netlify/functions',
      },
    ])

    functionsDirHolder = functionsDir

    try {
      log(`${NETLIFYDEVLOG} updating site settings with ${chalk.magenta.inverse(functionsDirHolder)}`)

      await api.updateSite({
        siteId: site.id,
        body: {
          build_settings: {
            functions_dir: functionsDirHolder,
          },
        },
      })

      log(`${NETLIFYDEVLOG} functions directory ${chalk.magenta.inverse(functionsDirHolder)} updated in site settings`)
    } catch (error) {
      throw error('Error updating site settings')
    }
  }

  if (!fs.existsSync(functionsDirHolder)) {
    log(
      `${NETLIFYDEVLOG} functions directory ${chalk.magenta.inverse(
        functionsDirHolder,
      )} does not exist yet, creating it...`,
    )

    fs.mkdirSync(functionsDirHolder, { recursive: true })

    log(`${NETLIFYDEVLOG} functions directory ${chalk.magenta.inverse(functionsDirHolder)} created`)
  }

  return functionsDirHolder
}

// Download files from a given github URL
const downloadFromURL = async function (context, flags, args, functionsDir) {
  const folderContents = await readRepoURL(flags.url)
  const [functionName] = flags.url.split('/').slice(-1)
  const nameToUse = await getNameFromArgs(args, flags, functionName)

  const fnFolder = path.join(functionsDir, nameToUse)
  if (fs.existsSync(`${fnFolder}.js`) && fs.lstatSync(`${fnFolder}.js`).isFile()) {
    log(
      `${NETLIFYDEVWARN}: A single file version of the function ${nameToUse} already exists at ${fnFolder}.js. Terminating without further action.`,
    )
    process.exit(1)
  }

  try {
    mkdirRecursiveSync(fnFolder)
  } catch (error) {
    // Ignore
  }
  await Promise.all(
    folderContents.map(async ({ name, download_url: downloadUrl }) => {
      try {
        const res = await fetch(downloadUrl)
        const finalName = path.basename(name, '.js') === functionName ? `${nameToUse}.js` : name
        const dest = fs.createWriteStream(path.join(fnFolder, finalName))
        res.body.pipe(dest)
      } catch (error) {
        throw new Error(`Error while retrieving ${downloadUrl} ${error}`)
      }
    }),
  )

  log(`${NETLIFYDEVLOG} Installing dependencies for ${nameToUse}...`)
  cp.exec('npm i', { cwd: path.join(functionsDir, nameToUse) }, () => {
    log(`${NETLIFYDEVLOG} Installing dependencies for ${nameToUse} complete `)
  })

  // read, execute, and delete function template file if exists
  const fnTemplateFile = path.join(fnFolder, '.netlify-function-template.js')
  if (fs.existsSync(fnTemplateFile)) {
    // eslint-disable-next-line node/global-require, import/no-dynamic-require
    const { onComplete, addons = [] } = require(fnTemplateFile)

    await installAddons(context, addons, path.resolve(fnFolder))
    await handleOnComplete({ context, onComplete })
    // delete
    fs.unlinkSync(fnTemplateFile)
  }
}

const installDeps = function (functionPath) {
  return new Promise((resolve) => {
    cp.exec('npm i', { cwd: path.join(functionPath) }, () => {
      resolve()
    })
  })
}

// no --url flag specified, pick from a provided template
const scaffoldFromTemplate = async function (context, flags, args, functionsDir) {
  // pull the rest of the metadata from the template
  const chosentemplate = await pickTemplate()
  if (chosentemplate === 'url') {
    const { chosenurl } = await inquirer.prompt([
      {
        name: 'chosenurl',
        message: 'URL to clone: ',
        type: 'input',
        validate: (val) => Boolean(validateRepoURL(val)),
        // make sure it is not undefined and is a valid filename.
        // this has some nuance i have ignored, eg crossenv and i18n concerns
      },
    ])
    flags.url = chosenurl.trim()
    try {
      await downloadFromURL(context, flags, args, functionsDir)
    } catch (error) {
      context.error(`$${NETLIFYDEVERR} Error downloading from URL: ${flags.url}`)
      context.error(error)
      process.exit(1)
    }
  } else if (chosentemplate === 'report') {
    log(`${NETLIFYDEVLOG} Open in browser: https://github.com/netlify/cli/issues/new`)
  } else {
    const { onComplete, name: templateName, lang, addons = [] } = chosentemplate

    const pathToTemplate = path.join(templatesDir, lang, templateName)
    if (!fs.existsSync(pathToTemplate)) {
      throw new Error(
        `there isnt a corresponding directory to the selected name, ${templateName} template is misconfigured`,
      )
    }

    const name = await getNameFromArgs(args, flags, templateName)

    log(`${NETLIFYDEVLOG} Creating function ${chalk.cyan.inverse(name)}`)
    const functionPath = ensureFunctionPathIsOk(functionsDir, name)

    // SWYX: note to future devs - useful for debugging source to output issues
    // this.log('from ', pathToTemplate, ' to ', functionPath)
    // SWYX: TODO
    const vars = { NETLIFY_STUFF_TO_REPLACE: 'REPLACEMENT' }
    let hasPackageJSON = false

    const createdFiles = await copy(pathToTemplate, functionPath, vars)
    createdFiles.forEach((filePath) => {
      if (filePath.endsWith('.netlify-function-template.js')) return
      context.log(`${NETLIFYDEVLOG} ${chalk.greenBright('Created')} ${filePath}`)
      fs.chmodSync(path.resolve(filePath), TEMPLATE_PERMISSIONS)
      if (filePath.includes('package.json')) hasPackageJSON = true
    })
    // delete function template file that was copied over by copydir
    fs.unlinkSync(path.join(functionPath, '.netlify-function-template.js'))
    // rename the root function file if it has a different name from default
    if (name !== templateName) {
      fs.renameSync(path.join(functionPath, `${templateName}.js`), path.join(functionPath, `${name}.js`))
    }
    // npm install
    if (hasPackageJSON) {
      const spinner = ora({
        text: `installing dependencies for ${name}`,
        spinner: 'moon',
      }).start()
      await installDeps(functionPath)
      spinner.succeed(`installed dependencies for ${name}`)
    }

    await installAddons(context, addons, path.resolve(functionPath))
    await handleOnComplete({ context, onComplete })
  }
}

const TEMPLATE_PERMISSIONS = 0o777

const createFunctionAddon = async function ({ api, addons, siteId, addonName, siteData, error }) {
  try {
    const addon = getCurrentAddon({ addons, addonName })
    if (addon && addon.id) {
      log(`The "${addonName} add-on" already exists for ${siteData.name}`)
      return false
    }
    await api.createServiceInstance({
      siteId,
      addon: addonName,
      body: { config: {} },
    })
    log(`Add-on "${addonName}" created for ${siteData.name}`)
    return true
  } catch (error_) {
    error(error_.message)
  }
}

const injectEnvVariablesFromContext = async ({ context }) => {
  const { warn, netlify } = context
  const { cachedConfig, site } = netlify
  await injectEnvVariables({ env: cachedConfig.env, site, warn })
}

const handleOnComplete = async ({ context, onComplete }) => {
  if (onComplete) {
    await injectEnvVariablesFromContext({ context })
    await onComplete.call(context)
  }
}

const handleAddonDidInstall = async ({ addonCreated, addonDidInstall, context, fnPath }) => {
  if (!addonCreated || !addonDidInstall) {
    return
  }

  const { confirmPostInstall } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmPostInstall',
      message: `This template has an optional setup script that runs after addon install. This can be helpful for first time users to try out templates. Run the script?`,
      default: false,
    },
  ])

  if (!confirmPostInstall) {
    return
  }

  await injectEnvVariablesFromContext({ context })
  addonDidInstall(fnPath)
}

const installAddons = async function (context, functionAddons, fnPath) {
  if (functionAddons.length === 0) {
    return
  }

  const { error } = context
  const { api, site } = context.netlify
  const siteId = site.id
  if (!siteId) {
    log('No site id found, please run inside a site directory or `netlify link`')
    return false
  }
  log(`${NETLIFYDEVLOG} checking Netlify APIs...`)

  const [siteData, siteAddons] = await Promise.all([
    getSiteData({ api, siteId, error }),
    getAddons({ api, siteId, error }),
  ])

  const arr = functionAddons.map(async ({ addonName, addonDidInstall }) => {
    log(`${NETLIFYDEVLOG} installing addon: ${chalk.yellow.inverse(addonName)}`)
    try {
      const addonCreated = await createFunctionAddon({
        api,
        addons: siteAddons,
        siteId,
        addonName,
        siteData,
        error,
      })

      await handleAddonDidInstall({ addonCreated, addonDidInstall, context, fnPath })
    } catch (error_) {
      error(`${NETLIFYDEVERR} Error installing addon: `, error_)
    }
  })
  return Promise.all(arr)
}

// we used to allow for a --dir command,
// but have retired that to force every scaffolded function to be a directory
const ensureFunctionPathIsOk = function (functionsDir, name) {
  const functionPath = path.join(functionsDir, name)
  if (fs.existsSync(functionPath)) {
    log(`${NETLIFYDEVLOG} Function ${functionPath} already exists, cancelling...`)
    process.exit(1)
  }
  return functionPath
}
