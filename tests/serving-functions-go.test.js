const test = require('ava')
const pWaitFor = require('p-wait-for')

const { withDevServer } = require('./utils/dev-server')
const got = require('./utils/got')
const { withSiteBuilder } = require('./utils/site-builder')

const WAIT_INTERVAL = 1800
const WAIT_TIMEOUT = 30000

test('Updates a Go function when a file is modified', async (t) => {
  const goSource = `
package main

import (
  "github.com/aws/aws-lambda-go/events"
  "github.com/aws/aws-lambda-go/lambda"
)

func handler(request events.APIGatewayProxyRequest) (*events.APIGatewayProxyResponse, error) {
  return &events.APIGatewayProxyResponse{
    StatusCode:      200,
    Headers:         map[string]string{"Content-Type": "text/plain"},
    Body:            "Hello, world!",
    IsBase64Encoded: false,
  }, nil
}

func main() {
  lambda.Start(handler)
}`
  await withSiteBuilder('go-function-update', async (builder) => {
    await builder
      .withNetlifyToml({
        config: {
          build: { publish: 'public' },
          functions: { directory: 'functions' },
        },
      })
      .withContentFiles([
        {
          path: 'functions/go-func/go.mod',
          content: `
module github.com/netlify/local-functions-poc-marcus/funcs/test

go 1.15

require github.com/aws/aws-lambda-go v1.20.0`,
        },
        {
          path: 'functions/go-func/go.sum',
          content: `
        github.com/BurntSushi/toml v0.3.1/go.mod h1:xHWCNGjB5oqiDr8zfno3MHue2Ht5sIBksp03qcyfWMU=
        github.com/aws/aws-lambda-go v1.20.0 h1:ZSweJx/Hy9BoIDXKBEh16vbHH0t0dehnF8MKpMiOWc0=
        github.com/aws/aws-lambda-go v1.20.0/go.mod h1:jJmlefzPfGnckuHdXX7/80O3BvUUi12XOkbv4w9SGLU=
        github.com/cpuguy83/go-md2man/v2 v2.0.0-20190314233015-f79a8a8ca69d/go.mod h1:maD7wRr/U5Z6m/iR4s+kqSMx2CaBsrgA7czyZG/E6dU=
        github.com/cpuguy83/go-md2man/v2 v2.0.0/go.mod h1:maD7wRr/U5Z6m/iR4s+kqSMx2CaBsrgA7czyZG/E6dU=
        github.com/davecgh/go-spew v1.1.0/go.mod h1:J7Y8YcW2NihsgmVo/mv3lAwl/skON4iLHjSsI+c5H38=
        github.com/davecgh/go-spew v1.1.1 h1:vj9j/u1bqnvCEfJOwUhtlOARqs3+rkHYY13jYWTU97c=
        github.com/davecgh/go-spew v1.1.1/go.mod h1:J7Y8YcW2NihsgmVo/mv3lAwl/skON4iLHjSsI+c5H38=
        github.com/pmezard/go-difflib v1.0.0 h1:4DBwDE0NGyQoBHbLQYPwSUPoCMWR5BEzIk/f1lZbAQM=
        github.com/pmezard/go-difflib v1.0.0/go.mod h1:iKH77koFhYxTK1pcRnkKkqfTogsbg7gZNVY4sRDYZ/4=
        github.com/russross/blackfriday/v2 v2.0.1/go.mod h1:+Rmxgy9KzJVeS9/2gXHxylqXiyQDYRxCVz55jmeOWTM=
        github.com/shurcooL/sanitized_anchor_name v1.0.0/go.mod h1:1NzhyTcUVG4SuEtjjoZeVRXNmyL/1OwPU0+IJeTBvfc=
        github.com/stretchr/objx v0.1.0/go.mod h1:HFkY916IF+rwdDfMAkV7OtwuqBVzrE8GR6GFx+wExME=
        github.com/stretchr/testify v1.6.1 h1:hDPOHmpOpP40lSULcqw7IrRb/u7w6RpDC9399XyoNd0=
        github.com/stretchr/testify v1.6.1/go.mod h1:6Fq8oRcR53rry900zMqJjRRixrwX3KX962/h/Wwjteg=
        github.com/urfave/cli/v2 v2.2.0/go.mod h1:SE9GqnLQmjVa0iPEY0f1w3ygNIYcIJ0OKPMoW2caLfQ=
        gopkg.in/check.v1 v0.0.0-20161208181325-20d25e280405 h1:yhCVgyC4o1eVCa2tZl7eS0r+SDo693bJlVdllGtEeKM=
        gopkg.in/check.v1 v0.0.0-20161208181325-20d25e280405/go.mod h1:Co6ibVJAznAaIkqp8huTwlJQCZ016jof/cbN4VW5Yz0=
        gopkg.in/yaml.v2 v2.2.2/go.mod h1:hI93XBmqTisBFMUTm0b8Fm+jr3Dg1NNxqwp+5A1VGuI=
        gopkg.in/yaml.v3 v3.0.0-20200313102051-9f266ea9e77c/go.mod h1:K4uyk7z7BCEPqu6E+C64Yfv1cQ7kz7rIZviUmN+EgEM=
        gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776 h1:tQIYjPdBoyREyB9XMu+nnTclpTYkz2zFM+lzLJFO4gQ=
        gopkg.in/yaml.v3 v3.0.0-20200615113413-eeeca48fe776/go.mod h1:K4uyk7z7BCEPqu6E+C64Yfv1cQ7kz7rIZviUmN+EgEM=
`,
        },
        {
          path: 'functions/go-func/main.go',
          content: goSource,
        },
      ])
      .buildAsync()

    await withDevServer(
      { cwd: builder.directory, env: { NETLIFY_EXPERIMENTAL_BUILD_GO_SOURCE: 'true' } },
      async ({ port }) => {
        t.is(await got(`http://localhost:${port}/.netlify/functions/go-func`).text(), 'Hello, world!')

        await builder
          .withContentFile({ path: 'functions/go-func/main.go', content: goSource.replace('world', 'Netlify') })
          .buildAsync()

        await pWaitFor(
          async () => {
            const response = await got(`http://localhost:${port}/.netlify/functions/go-func`).text()

            return response === 'Hello, Netlify!'
          },
          { interval: WAIT_INTERVAL, timeout: WAIT_TIMEOUT },
        )
      },
    )
  })
})
