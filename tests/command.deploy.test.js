const process = require('process')

const test = require('ava')
const omit = require('omit.js').default

const { supportsEdgeHandlers } = require('../src/lib/account')
const { getToken } = require('../src/utils/command')

const callCli = require('./utils/call-cli')
const { generateSiteName, createLiveTestSite } = require('./utils/create-live-test-site')
const got = require('./utils/got')
const { withSiteBuilder } = require('./utils/site-builder')

const SITE_NAME = generateSiteName('netlify-test-deploy-')

const validateContent = async ({ siteUrl, path, content, t }) => {
  try {
    const { body } = await got(`${siteUrl}${path}`)
    t.is(body, content)
  } catch (error) {
    const {
      response: { statusCode, statusMessage, body },
    } = error
    if (content === undefined) {
      t.is(statusCode, 404)
      return
    }
    throw new Error(`Failed getting content: ${statusCode} - ${statusMessage} - ${body}`)
  }
}

const validateDeploy = async ({ deploy, siteName, content, t }) => {
  t.truthy(deploy.site_name)
  t.truthy(deploy.deploy_url)
  t.truthy(deploy.deploy_id)
  t.truthy(deploy.logs)
  t.is(deploy.site_name, siteName)

  await validateContent({ siteUrl: deploy.deploy_url, path: '', content, t })
}

if (process.env.NETLIFY_TEST_DISABLE_LIVE !== 'true') {
  test.before(async (t) => {
    const { siteId, account } = await createLiveTestSite(SITE_NAME)
    t.context.siteId = siteId
    t.context.account = account
  })

  test.serial('should deploy site when dir flag is passed', async (t) => {
    await withSiteBuilder('site-with-public-folder', async (builder) => {
      const content = '<h1>⊂◉‿◉つ</h1>'
      builder.withContentFile({
        path: 'public/index.html',
        content,
      })

      await builder.buildAsync()

      const deploy = await callCli(['deploy', '--json', '--dir', 'public'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      }).then((output) => JSON.parse(output))

      await validateDeploy({ deploy, siteName: SITE_NAME, content, t })
    })
  })

  test.serial('should deploy site when publish directory set in netlify.toml', async (t) => {
    await withSiteBuilder('site-with-public-folder', async (builder) => {
      const content = '<h1>⊂◉‿◉つ</h1>'
      builder
        .withContentFile({
          path: 'public/index.html',
          content,
        })
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
          },
        })

      await builder.buildAsync()

      const deploy = await callCli(['deploy', '--json'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      }).then((output) => JSON.parse(output))

      await validateDeploy({ deploy, siteName: SITE_NAME, content, t })
    })
  })

  // the edge handlers plugin only works on node >= 10
  const version = Number.parseInt(process.version.slice(1).split('.')[0])
  const EDGE_HANDLER_MIN_VERSION = 10
  const EDGE_HANDLER_MIN_LENGTH = 50
  if (version >= EDGE_HANDLER_MIN_VERSION) {
    test.serial('should deploy edge handlers when directory exists', async (t) => {
      if (!supportsEdgeHandlers(t.context.account)) {
        console.warn(`Skipping edge handlers deploy test for account ${t.context.account.slug}`)
        return
      }
      await withSiteBuilder('site-with-public-folder', async (builder) => {
        const content = '<h1>⊂◉‿◉つ</h1>'
        builder
          .withContentFile({
            path: 'public/index.html',
            content,
          })
          .withNetlifyToml({
            config: {
              build: { publish: 'public', command: 'echo "no op"' },
            },
          })
          .withEdgeHandlers({
            handlers: {
              onRequest: (event) => {
                console.log(`Incoming request for ${event.request.url}`)
              },
            },
          })

        await builder.buildAsync()

        const options = {
          cwd: builder.directory,
          env: { NETLIFY_SITE_ID: t.context.siteId },
        }
        // build the edge handlers first
        await callCli(['build'], options)
        const deploy = await callCli(['deploy', '--json'], options).then((output) => JSON.parse(output))

        await validateDeploy({ deploy, siteName: SITE_NAME, content, t })

        // validate edge handlers
        // use this until we can use `netlify api`
        const [apiToken] = await getToken()
        const { content_length: contentLength, ...rest } = await got(
          `https://api.netlify.com/api/v1/deploys/${deploy.deploy_id}/edge_handlers`,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
          },
        ).json()

        t.deepEqual(omit(rest, ['created_at', 'sha']), {
          content_type: 'application/javascript',
          handlers: ['index'],
          valid: true,
        })
        t.is(contentLength > EDGE_HANDLER_MIN_LENGTH, true)
      })
    })
  }

  test.serial('should run build command before deploy when build flag is passed', async (t) => {
    await withSiteBuilder('site-with-public-folder', async (builder) => {
      const content = '<h1>⊂◉‿◉つ</h1>'
      builder
        .withContentFile({
          path: 'public/index.html',
          content,
        })
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
          },
        })

      await builder.buildAsync()

      const output = await callCli(['deploy', '--build'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      })

      t.is(output.includes('Netlify Build completed in'), true)
    })
  })

  test.serial('should return valid json when both --build and --json are passed', async (t) => {
    await withSiteBuilder('site-with-public-folder', async (builder) => {
      const content = '<h1>⊂◉‿◉つ</h1>'
      builder
        .withContentFile({
          path: 'public/index.html',
          content,
        })
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
          },
        })

      await builder.buildAsync()

      const output = await callCli(['deploy', '--build', '--json'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      })

      JSON.parse(output)
    })
  })

  test.serial('should deploy hidden public folder but ignore hidden/__MACOSX files', async (t) => {
    await withSiteBuilder('site-with-a-dedicated-publish-folder', async (builder) => {
      builder
        .withContentFiles([
          {
            path: '.public/index.html',
            content: 'index',
          },
          {
            path: '.public/.hidden-file.html',
            content: 'hidden-file',
          },
          {
            path: '.public/.hidden-dir/index.html',
            content: 'hidden-dir',
          },
          {
            path: '.public/__MACOSX/index.html',
            content: 'macosx',
          },
        ])
        .withNetlifyToml({
          config: {
            build: { publish: '.public' },
          },
        })

      await builder.buildAsync()

      const deploy = await callCli(['deploy', '--json'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      }).then((output) => JSON.parse(output))

      await validateDeploy({ deploy, siteName: SITE_NAME, content: 'index', t })
      await validateContent({
        siteUrl: deploy.deploy_url,
        content: undefined,
        path: '/.hidden-file',
        t,
      })
      await validateContent({
        siteUrl: deploy.deploy_url,
        content: undefined,
        path: '/.hidden-dir',
        t,
      })
      await validateContent({
        siteUrl: deploy.deploy_url,
        content: undefined,
        path: '/__MACOSX',
        t,
      })
    })
  })

  test.serial('should filter node_modules from root directory', async (t) => {
    await withSiteBuilder('site-with-a-project-directory', async (builder) => {
      builder
        .withContentFiles([
          {
            path: 'index.html',
            content: 'index',
          },
          {
            path: 'node_modules/package.json',
            content: '{}',
          },
        ])
        .withNetlifyToml({
          config: {
            build: { publish: '.' },
          },
        })

      await builder.buildAsync()

      const deploy = await callCli(['deploy', '--json'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      }).then((output) => JSON.parse(output))

      await validateDeploy({ deploy, siteName: SITE_NAME, content: 'index', t })
      await validateContent({
        siteUrl: deploy.deploy_url,
        content: undefined,
        path: '/node_modules/package.json',
        t,
      })
    })
  })

  test.serial('should not filter node_modules from publish directory', async (t) => {
    await withSiteBuilder('site-with-a-project-directory', async (builder) => {
      builder
        .withContentFiles([
          {
            path: 'public/index.html',
            content: 'index',
          },
          {
            path: 'public/node_modules/package.json',
            content: '{}',
          },
        ])
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
          },
        })

      await builder.buildAsync()

      const deploy = await callCli(['deploy', '--json'], {
        cwd: builder.directory,
        env: { NETLIFY_SITE_ID: t.context.siteId },
      }).then((output) => JSON.parse(output))

      await validateDeploy({ deploy, siteName: SITE_NAME, content: 'index', t })
      await validateContent({
        siteUrl: deploy.deploy_url,
        content: '{}',
        path: '/node_modules/package.json',
        t,
      })
    })
  })

  test.serial('should exit with error when deploying an empty directory', async (t) => {
    await withSiteBuilder('site-with-an-empty-directory', async (builder) => {
      await builder.buildAsync()

      try {
        await callCli(['deploy', '--dir', '.'], {
          cwd: builder.directory,
          env: { NETLIFY_SITE_ID: t.context.siteId },
        })
      } catch (error) {
        t.is(error.stderr.includes('Error: No files or functions to deploy'), true)
      }
    })
  })

  test.serial('should refresh configuration when --build is passed', async (t) => {
    await withSiteBuilder('site-with-public-folder', async (builder) => {
      await builder
        .withContentFile({
          path: 'public/index.html',
          content: '<h1>⊂◉‿◉つ</h1>',
        })
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            plugins: [{ package: './plugins/mutator' }],
          },
        })
        .withBuildPlugin({
          name: 'mutator',
          plugin: {
            onPreBuild: async ({ netlifyConfig }) => {
              // eslint-disable-next-line node/global-require
              const [fs, util] = [require('fs'), require('util')]
              const [writeFile, mkdir] = [fs.writeFile, fs.mkdir].map(util.promisify)

              const generatedFunctionsDir = 'new_functions'
              netlifyConfig.functions.directory = generatedFunctionsDir

              await mkdir(generatedFunctionsDir)
              await writeFile(
                `${generatedFunctionsDir}/hello.js`,
                `exports.handler = async () => ({ statusCode: 200, body: 'Hello' })`,
              )
            },
          },
        })
        .buildAsync()

      const { deploy_url: deployUrl } = await callCli(
        ['deploy', '--build', '--json'],
        {
          cwd: builder.directory,
          env: { NETLIFY_SITE_ID: t.context.siteId },
        },
        true,
      )

      const { body, statusCode } = await got(`${deployUrl}/.netlify/functions/hello`)
      t.is(body, 'Hello')
      t.is(statusCode, 200)
    })
  })

  test.after('cleanup', async (t) => {
    const { siteId } = t.context
    console.log(`deleting test site "${SITE_NAME}". ${siteId}`)
    await callCli(['sites:delete', siteId, '--force'])
  })
}
