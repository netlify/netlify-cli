const path = require('path')

const chalk = require('chalk')
const inquirer = require('inquirer')
const isEmpty = require('lodash/isEmpty')

const { listSites } = require('../../lib/api')
const { log } = require('../command-helpers')
const { getRepoData } = require('../get-repo-data')
const { track } = require('../telemetry')

module.exports = async function linkPrompts(context, flags = {}) {
  const { api, state } = context.netlify

  const SITE_NAME_PROMPT = 'Search by full or partial site name'
  const SITE_LIST_PROMPT = 'Choose from a list of your recently updated sites'
  const SITE_ID_PROMPT = 'Enter a site ID'

  let GIT_REMOTE_PROMPT = 'Use the current git remote origin URL'
  let site
  // Get git remote data if exists
  const repoData = await getRepoData({ remoteName: flags.gitRemoteName })

  let linkChoices = [SITE_NAME_PROMPT, SITE_LIST_PROMPT, SITE_ID_PROMPT]

  if (!repoData.error) {
    // Add git GIT_REMOTE_PROMPT if in a repo
    GIT_REMOTE_PROMPT = `Use current git remote origin (${repoData.httpsUrl})`
    linkChoices = [GIT_REMOTE_PROMPT, ...linkChoices]
  }

  log()
  log(`${chalk.cyanBright('netlify link')} will connect this folder to a site on Netlify`)
  log()
  const { linkType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'linkType',
      message: 'How do you want to link this folder to a site?',
      choices: linkChoices,
    },
  ])

  let kind
  switch (linkType) {
    case GIT_REMOTE_PROMPT: {
      kind = 'gitRemote'
      log()
      log(`Looking for sites connected to '${repoData.httpsUrl}'...`)
      log()
      const sites = await listSites({ api, options: { filter: 'all' } })

      if (isEmpty(sites)) {
        context.error(
          new Error(`You don't have any sites yet. Run ${chalk.cyanBright('netlify sites:create')} to create a site.`),
        )
      }

      const matchingSites = sites.filter(
        ({ build_settings: buildSettings = {} }) => repoData.httpsUrl === buildSettings.repo_url,
      )

      // If no remote matches. Throw error
      if (isEmpty(matchingSites)) {
        log(chalk.redBright.bold.underline(`No Matching Site Found`))
        log()
        log(`No site found with the remote ${repoData.httpsUrl}.

Double check you are in the correct working directory and a remote origin repo is configured.

Run ${chalk.cyanBright('git remote -v')} to see a list of your git remotes.`)

        context.exit()
      }

      // Matches a single site hooray!
      if (matchingSites.length === 1) {
        const [firstSite] = matchingSites
        site = firstSite
      } else if (matchingSites.length > 1) {
        // Matches multiple sites. Users must choose which to link.
        console.log(`Found ${matchingSites.length} matching sites!`)

        // Prompt which options
        const { selectedSite } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedSite',
            message: 'Which site do you want to link?',
            choices: matchingSites.map((matchingSite) => ({
              name: `${matchingSite.name} - ${matchingSite.ssl_url}`,
              value: matchingSite,
            })),
          },
        ])
        if (!selectedSite) {
          context.error('No site selected')
        }
        site = selectedSite
      }
      break
    }
    case SITE_NAME_PROMPT: {
      kind = 'byName'
      const { searchTerm } = await inquirer.prompt([
        {
          type: 'input',
          name: 'searchTerm',
          message: 'Enter the site name (or just part of it):',
        },
      ])
      log(`Looking for sites with names containing '${searchTerm}'...`)
      log()

      let matchingSites
      try {
        matchingSites = await listSites({
          api,
          options: { name: searchTerm, filter: 'all' },
        })
      } catch (error) {
        if (error.status === 404) {
          context.error(`'${searchTerm}' not found`)
        } else {
          context.error(error)
        }
      }

      if (isEmpty(matchingSites)) {
        context.error(`No site names found containing '${searchTerm}'.

Run ${chalk.cyanBright('netlify link')} again to try a new search,
or run ${chalk.cyanBright('netlify sites:create')} to create a site.`)
      }

      if (matchingSites.length > 1) {
        console.log(`Found ${matchingSites.length} matching sites!`)
        const { selectedSite } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedSite',
            message: 'Which site do you want to link?',
            paginated: true,
            choices: matchingSites.map((matchingSite) => ({ name: matchingSite.name, value: matchingSite })),
          },
        ])
        if (!selectedSite) {
          context.error('No site selected')
        }
        site = selectedSite
      } else {
        const [firstSite] = matchingSites
        site = firstSite
      }
      break
    }
    case SITE_LIST_PROMPT: {
      kind = 'fromList'
      log(`Fetching recently updated sites...`)
      log()

      let sites
      try {
        sites = await listSites({ api, options: { maxPages: 1, filter: 'all' } })
      } catch (error) {
        context.error(error)
      }

      if (isEmpty(sites)) {
        context.error(`You don't have any sites yet. Run ${chalk.cyanBright('netlify sites:create')} to create a site.`)
      }

      const { selectedSite } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedSite',
          message: 'Which site do you want to link?',
          paginated: true,
          choices: sites.map((matchingSite) => ({ name: matchingSite.name, value: matchingSite })),
        },
      ])
      if (!selectedSite) {
        context.error('No site selected')
      }
      site = selectedSite
      break
    }
    case SITE_ID_PROMPT: {
      kind = 'bySiteId'
      const { siteId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'siteId',
          message: 'What is the site ID?',
        },
      ])

      try {
        site = await api.getSite({ siteId })
      } catch (error) {
        if (error.status === 404) {
          context.error(new Error(`Site ID '${siteId}' not found`))
        } else {
          context.error(error)
        }
      }
      break
    }
    default:
      return
  }

  if (!site) {
    context.error(new Error(`No site found`))
  }

  // Save site ID to config
  state.set('siteId', site.id)

  await track('sites_linked', {
    siteId: site.id,
    linkType: 'prompt',
    kind,
  })

  // Log output
  log()
  log(chalk.greenBright.bold.underline(`Directory Linked`))
  log()
  log(`Admin url: ${chalk.magentaBright(site.admin_url)}`)
  log(`Site url:  ${chalk.cyanBright(site.ssl_url || site.url)}`)
  log()

  log(`Site id saved to ${path.join(context.netlify.site.root, '/.netlify/state.json')}`)
  // log(`Local Config: .netlify/config.json`)
  log()
  log(`You can now run other \`netlify\` cli commands in this directory`)

  return site
}
