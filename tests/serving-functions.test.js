/* eslint-disable require-await */
const { join } = require('path')
const process = require('process')

// eslint-disable-next-line ava/use-test
const avaTest = require('ava')
const pWaitFor = require('p-wait-for')

const { withDevServer } = require('./utils/dev-server')
const got = require('./utils/got')
const { withSiteBuilder } = require('./utils/site-builder')

const test = process.env.CI === 'true' ? avaTest.serial.bind(avaTest) : avaTest
const testMatrix = [{ args: [] }, { args: ['esbuild'] }]
const testName = (title, args) => (args.length <= 0 ? title : `${title} - ${args.join(' ')}`)

const WAIT_INTERVAL = 1800
const WAIT_TIMEOUT = 10000

const gotCatch404 = async (url, options) => {
  try {
    return await got(url, options)
  } catch (error) {
    if (error.response && error.response.statusCode === 404) {
      return error.response
    }
    throw error
  }
}

testMatrix.forEach(({ args }) => {
  test(testName('Updates a JavaScript function when its main file is modified', args), async (t) => {
    await withSiteBuilder('js-function-update-main-file', async (builder) => {
      const bundlerConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            ...bundlerConfig,
          },
        })
        .withFunction({
          path: 'hello.js',
          handler: async () => ({
            statusCode: 200,
            body: 'Hello',
          }),
        })
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        t.is(await got(`http://localhost:${port}/.netlify/functions/hello`).text(), 'Hello')

        await builder
          .withFunction({
            path: 'hello.js',
            handler: async () => ({
              statusCode: 200,
              body: 'Goodbye',
            }),
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

            return response === 'Goodbye'
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Updates a TypeScript function when its main file is modified', args), async (t) => {
    await withSiteBuilder('ts-function-update-main-file', async (builder) => {
      const bundlerConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            ...bundlerConfig,
          },
        })
        .withContentFile({
          path: 'functions/hello.ts',
          content: `
  interface Book {
    title: string
    author: string
  }

  const handler = async () => {
    const book1: Book = {
      title: 'Modern Web Development on the JAMStack',
      author: 'Mathias Biilmann & Phil Hawksworth'
    }

    return {
      statusCode: 200,
      body: book1.title
    }
  }

  export { handler }
            `,
        })
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        t.is(
          await got(`http://localhost:${port}/.netlify/functions/hello`).text(),
          'Modern Web Development on the JAMStack',
        )

        await builder
          .withContentFile({
            path: 'functions/hello.ts',
            content: `
  interface Book {
    title: string
    author: string
  }

  const handler = async () => {
    const book1: Book = {
      title: 'Modern Web Development on the Jamstack',
      author: 'Mathias Biilmann & Phil Hawksworth'
    }

    return {
      statusCode: 200,
      body: book1.title
    }
  }

  export { handler }
            `,
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

            return response === 'Modern Web Development on the Jamstack'
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Updates a JavaScript function when a supporting file is modified', args), async (t) => {
    await withSiteBuilder('js-function-update-supporting-file', async (builder) => {
      const functionsConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions', ...functionsConfig },
          },
        })
        .withContentFiles([
          { path: 'functions/lib/util.js', content: `exports.bark = () => 'WOOF!'` },
          {
            path: 'functions/hello.js',
            content: `const { bark } = require('./lib/util'); exports.handler = async () => ({ statusCode: 200, body: bark() })`,
          },
        ])
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        t.is(await got(`http://localhost:${port}/.netlify/functions/hello`).text(), 'WOOF!')

        await builder
          .withContentFile({ path: 'functions/lib/util.js', content: `exports.bark = () => 'WOOF WOOF!'` })
          .buildAsync()

        await pWaitFor(
          async () => {
            const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

            return response === 'WOOF WOOF!'
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Updates a TypeScript function when a supporting file is modified', args), async (t) => {
    await withSiteBuilder('ts-function-update-supporting-file', async (builder) => {
      const functionsConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions', ...functionsConfig },
          },
        })
        .withContentFiles([
          {
            path: 'functions/lib/util.ts',
            content: `
  const title: string = 'Modern Web Development on the JAMStack'

  export { title }
  `,
          },
          {
            path: 'functions/hello.ts',
            content: `
  import { title } from './lib/util'

  interface Book {
    title: string
    author: string
  }

  const handler = async () => {
    const book1: Book = {
      title,
      author: 'Mathias Biilmann & Phil Hawksworth'
    }

    return {
      statusCode: 200,
      body: book1.title
    }
  }

  export { handler }
            `,
          },
        ])
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        t.is(
          await got(`http://localhost:${port}/.netlify/functions/hello`).text(),
          'Modern Web Development on the JAMStack',
        )

        await builder
          .withContentFile({
            path: 'functions/lib/util.ts',
            content: `
  const title: string = 'Modern Web Development on the Jamstack'

  export { title }
  `,
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

            return response === 'Modern Web Development on the Jamstack'
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Adds a new JavaScript function when a function file is created', args), async (t) => {
    await withSiteBuilder('js-function-create-function-file', async (builder) => {
      const bundlerConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            ...bundlerConfig,
          },
        })
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        const unauthenticatedResponse = await gotCatch404(`http://localhost:${port}/.netlify/functions/hello`)

        t.is(unauthenticatedResponse.statusCode, 404)

        await builder
          .withFunction({
            path: 'hello.js',
            handler: async () => ({
              statusCode: 200,
              body: 'Hello',
            }),
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            try {
              const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

              return response === 'Hello'
            } catch (_) {
              return false
            }
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Adds a new TypeScript function when a function file is created', args), async (t) => {
    await withSiteBuilder('ts-function-create-function-file', async (builder) => {
      const bundlerConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withContentFile({
          path: 'functions/help.ts',
          content: `
const handler = async () => {
  return {
    statusCode: 200,
    body: 'I need somebody. Not just anybody.'
  }
}

export { handler }
      `,
        })
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            ...bundlerConfig,
          },
        })
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        const unauthenticatedResponse = await gotCatch404(`http://localhost:${port}/.netlify/functions/hello`)

        t.is(unauthenticatedResponse.statusCode, 404)

        await builder
          .withContentFile({
            path: 'functions/hello.ts',
            content: `
  interface Book {
    title: string
    author: string
  }

  const handler = async () => {
    const book1: Book = {
      title: 'Modern Web Development on the Jamstack',
      author: 'Mathias Biilmann & Phil Hawksworth'
    }

    return {
      statusCode: 200,
      body: book1.title
    }
  }

  export { handler }
          `,
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            try {
              const response = await got(`http://localhost:${port}/.netlify/functions/hello`).text()

              return response === 'Modern Web Development on the Jamstack'
            } catch (_) {
              return false
            }
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })

  test(testName('Removes a function when a function file is deleted', args), async (t) => {
    await withSiteBuilder('function-remove-function-file', async (builder) => {
      const bundlerConfig = args.includes('esbuild') ? { node_bundler: 'esbuild' } : {}

      await builder
        .withNetlifyToml({
          config: {
            build: { publish: 'public' },
            functions: { directory: 'functions' },
            ...bundlerConfig,
          },
        })
        .withFunction({
          path: 'hello.js',
          handler: async () => ({
            statusCode: 200,
            body: 'Hello',
          }),
        })
        .buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async ({ port }) => {
        t.is(await got(`http://localhost:${port}/.netlify/functions/hello`).text(), 'Hello')

        await builder
          .withoutFile({
            path: 'functions/hello.js',
          })
          .buildAsync()

        await pWaitFor(
          async () => {
            const { statusCode } = await gotCatch404(`http://localhost:${port}/.netlify/functions/hello`)

            return statusCode === 404
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      })
    })
  })
})

test('Serves functions that dynamically load files included in the `functions.included_files` config property', async (t) => {
  await withSiteBuilder('function-with-included-files', async (builder) => {
    await builder
      .withContentFiles([
        {
          path: 'files/one.json',
          content: `{"data": "one"}`,
        },
        {
          path: 'files/two.json',
          content: `{"data": "two"}`,
        },
      ])
      .withFunction({
        path: 'hello.js',
        handler: async (event) => {
          const { name } = event.queryStringParameters

          // eslint-disable-next-line import/no-dynamic-require, node/global-require
          const { data } = require(`../files/${name}.json`)

          return {
            statusCode: 200,
            body: data,
          }
        },
      })
      .withNetlifyToml({
        config: {
          build: { publish: 'public' },
          functions: { directory: 'functions', included_files: ['files/*'], node_bundler: 'esbuild' },
        },
      })
      .buildAsync()

    await withDevServer({ cwd: builder.directory }, async ({ port }) => {
      t.is(await got(`http://localhost:${port}/.netlify/functions/hello?name=one`).text(), 'one')
      t.is(await got(`http://localhost:${port}/.netlify/functions/hello?name=two`).text(), 'two')
    })
  })
})

test('Uses sourcemaps to show correct paths and locations in stack trace', async (t) => {
  await withSiteBuilder('function-with-sourcemaps', async (builder) => {
    await builder
      .withFunction({
        path: 'hello.js',
        handler: async () => {
          throw new Error('Something went wrong')
        },
      })
      .withNetlifyToml({
        config: {
          build: { publish: 'public' },
          functions: { directory: 'functions', node_bundler: 'esbuild' },
        },
      })
      .buildAsync()

    await withDevServer({ cwd: builder.directory }, async ({ port }) => {
      try {
        await got(`http://localhost:${port}/.netlify/functions/hello`)

        t.fail()
      } catch (error) {
        t.true(error.response.body.includes(join(builder.directory, 'functions', 'hello.js')))
        t.false(error.response.body.includes(join('.netlify', 'functions-serve')))
      }
    })
  })
})
/* eslint-enable require-await */
