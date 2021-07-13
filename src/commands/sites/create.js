const { flags: flagsLib } = require('@oclif/command')
const slugify = require('@sindresorhus/slugify')
const chalk = require('chalk')
const inquirer = require('inquirer')
const pick = require('lodash/pick')
const sample = require('lodash/sample')
const prettyjson = require('prettyjson')
const { v4: uuidv4 } = require('uuid')

const Command = require('../../utils/command')
const { log, logJson } = require('../../utils/command-helpers')
const { getRepoData } = require('../../utils/get-repo-data')
const { configureRepo } = require('../../utils/init/config')
const { track } = require('../../utils/telemetry')

const SITE_NAME_SUGGESTION_SUFFIX_LENGTH = 5

class SitesCreateCommand extends Command {
  async run() {
    const { flags } = this.parse(SitesCreateCommand)
    const { api } = this.netlify

    await this.authenticate()

    const accounts = await api.listAccountsForUser()

    let accountSlug = flags['account-slug']
    if (!accountSlug) {
      const { accountSlug: accountSlugInput } = await inquirer.prompt([
        {
          type: 'list',
          name: 'accountSlug',
          message: 'Team:',
          choices: accounts.map((account) => ({
            value: account.slug,
            name: account.name,
          })),
        },
      ])
      accountSlug = accountSlugInput
    }

    const { name: nameFlag } = flags
    let user
    let site

    // Allow the user to reenter site name if selected one isn't available
    const inputSiteName = async (name) => {
      if (!user) user = await api.getCurrentUser()

      if (!name) {
        let { slug } = user
        let suffix = ''

        // If the user doesn't have a slug, we'll compute one. Because `full_name` is not guaranteed to be unique, we
        // append a short randomly-generated ID to reduce the likelihood of a conflict.
        if (!slug) {
          slug = slugify(user.full_name || user.email)
          suffix = `-${uuidv4().slice(0, SITE_NAME_SUGGESTION_SUFFIX_LENGTH)}`
        }

        const suggestions = [
          `super-cool-site-by-${slug}${suffix}`,
          `the-awesome-${slug}-site${suffix}`,
          `${slug}-makes-great-sites${suffix}`,
          `netlify-thinks-${slug}-is-great${suffix}`,
          `the-great-${slug}-site${suffix}`,
          `isnt-${slug}-awesome${suffix}`,
        ]
        const siteSuggestion = sample(suggestions)

        console.log(
          `Choose a unique site name (e.g. ${siteSuggestion}.netlify.app) or leave it blank for a random name. You can update the site name later.`,
        )
        const { name: nameInput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Site name (optional):',
            filter: (val) => (val === '' ? undefined : val),
            validate: (input) => /^[a-zA-Z\d-]+$/.test(input) || 'Only alphanumeric characters and hyphens are allowed',
          },
        ])
        name = nameInput
      }

      const body = {}
      if (typeof name === 'string') {
        body.name = name.trim()
      }
      try {
        site = await api.createSiteInTeam({
          accountSlug,
          body,
        })
      } catch (error) {
        if (error.status === 422) {
          this.warn(`${name}.netlify.app already exists. Please try a different slug.`)
          await inputSiteName()
        } else {
          this.error(`createSiteInTeam error: ${error.status}: ${error.message}`)
        }
      }
    }
    await inputSiteName(nameFlag)

    log()
    log(chalk.greenBright.bold.underline(`Site Created`))
    log()

    const siteUrl = site.ssl_url || site.url
    log(
      prettyjson.render({
        'Admin URL': site.admin_url,
        URL: siteUrl,
        'Site ID': site.id,
      }),
    )

    track('sites_created', {
      siteId: site.id,
      adminUrl: site.admin_url,
      siteUrl,
    })

    if (flags['with-ci']) {
      log('Configuring CI')
      const repoData = await getRepoData()
      await configureRepo({ context: this, siteId: site.id, repoData, manual: flags.manual })
    }

    if (flags.json) {
      logJson(
        pick(site, [
          'id',
          'state',
          'plan',
          'name',
          'custom_domain',
          'domain_aliases',
          'url',
          'ssl_url',
          'admin_url',
          'screenshot_url',
          'created_at',
          'updated_at',
          'user_id',
          'ssl',
          'force_ssl',
          'managed_dns',
          'deploy_url',
          'account_name',
          'account_slug',
          'git_provider',
          'deploy_hook',
          'capabilities',
          'id_domain',
        ]),
      )
    }

    return site
  }
}

SitesCreateCommand.description = `Create an empty site (advanced)

Create a blank site that isn't associated with any git remote.  Does not link to the current working directory.
`

SitesCreateCommand.flags = {
  name: flagsLib.string({
    char: 'n',
    description: 'name of site',
  }),
  'account-slug': flagsLib.string({
    char: 'a',
    description: 'account slug to create the site under',
  }),
  'with-ci': flagsLib.boolean({
    char: 'c',
    description: 'initialize CI hooks during site creation',
  }),
  manual: flagsLib.boolean({
    char: 'm',
    description: 'Force manual CI setup.  Used --with-ci flag',
  }),
  ...SitesCreateCommand.flags,
}

module.exports = SitesCreateCommand
