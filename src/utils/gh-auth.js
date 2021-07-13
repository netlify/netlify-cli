// A simple ghauth inspired library for getting a personal access token
const http = require('http')
const process = require('process')
const querystring = require('querystring')

const { Octokit } = require('@octokit/rest')
const getPort = require('get-port')
const inquirer = require('inquirer')

const { log } = require('./command-helpers')
const { createDeferred } = require('./deferred')
const openBrowser = require('./open-browser')

const SERVER_PORT = 3000

const promptForAuthMethod = async () => {
  const authChoiceNetlify = 'Authorize with GitHub through app.netlify.com'
  const authChoiceToken = 'Authorize with a GitHub personal access token'
  const authChoices = [authChoiceNetlify, authChoiceToken]

  const { authMethod } = await inquirer.prompt([
    {
      type: 'list',
      name: 'authMethod',
      message:
        'Netlify CLI needs access to your GitHub account to configure Webhooks and Deploy Keys. ' +
        'What would you like to do?',
      choices: authChoices,
    },
  ])

  return authMethod === authChoiceNetlify
}

const authWithNetlify = async () => {
  const port = await getPort({ port: SERVER_PORT })
  const { promise: deferredPromise, reject: deferredReject, resolve: deferredResolve } = createDeferred()

  const server = http.createServer(function onRequest(req, res) {
    const parameters = querystring.parse(req.url.slice(req.url.indexOf('?') + 1))
    if (parameters.token) {
      deferredResolve(parameters)
      res.end(
        `${
          "<html><head><script>if(history.replaceState){history.replaceState({},'','/')}</script><style>html{font-family:sans-serif;background:#0e1e25}body{overflow:hidden;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;width:100vw;}h3{margin:0}.card{position:relative;display:flex;flex-direction:column;width:75%;max-width:364px;padding:24px;background:white;color:rgb(14,30,37);border-radius:8px;box-shadow:0 2px 4px 0 rgba(14,30,37,.16);}</style></head>" +
          "<body><div class=card><h3>Logged In</h3><p>You're now logged into Netlify CLI with your "
        }${parameters.provider} credentials. Please close this window.</p></div>`,
      )
      server.close()
      return
    }
    res.end('BAD PARAMETERS')
    server.close()
    deferredReject(new Error('Got invalid parameters for CLI login'))
  })

  await new Promise(function waitForListening(resolve, reject) {
    server.on('error', reject)
    server.listen(port, resolve)
  })

  const webUI = process.env.NETLIFY_WEB_UI || 'https://app.netlify.com'
  const url = `${webUI}/cli?${querystring.encode({
    host: `http://localhost:${port}`,
    provider: 'github',
  })}`

  await openBrowser({ url })

  return deferredPromise
}

const getPersonalAccessToken = async () => {
  const { token } = await inquirer.prompt([
    {
      type: 'input',
      name: 'token',
      message: 'Your GitHub personal access token:',
      filter: (input) => input.trim(),
    },
  ])

  return { token }
}

const authWithToken = async () => {
  const { token } = await getPersonalAccessToken()
  if (token) {
    const octokit = new Octokit({
      auth: `token ${token}`,
    })
    const { login: user } = await octokit.users.getAuthenticated()
    return { token, user, provider: 'github' }
  }
  const error = new Error('Github authentication failed')
  throw error
}

module.exports = async function getGitHubToken() {
  log('')

  const withNetlify = await promptForAuthMethod()
  if (withNetlify) {
    return await authWithNetlify()
  }

  return await authWithToken()
}
