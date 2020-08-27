const fetch = require('node-fetch')
const execa = require('execa')
const chalk = require('chalk')
const {
  NETLIFYDEVLOG,
  // NETLIFYDEVWARN,
  NETLIFYDEVERR,
} = require('./logo')
const { getPathInHome } = require('../lib/settings')
const { shouldFetchLatestVersion, fetchLatestVersion } = require('../lib/exec-fetcher')

const PACKAGE_NAME = 'live-tunnel-client'

async function createTunnel(siteId, netlifyApiToken, log) {
  await installTunnelClient(log)

  if (!siteId) {
    console.error(
      `${NETLIFYDEVERR} Error: no siteId defined, did you forget to run ${chalk.yellow(
        'netlify init'
      )} or ${chalk.yellow('netlify link')}?`
    )
    process.exit(1)
  }
  log(`${NETLIFYDEVLOG} Creating Live Tunnel for ` + siteId)
  const url = `https://api.netlify.com/api/v1/live_sessions?site_id=${siteId}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${netlifyApiToken}`,
    },
    body: JSON.stringify({}),
  })

  const data = await response.json()

  if (response.status !== 201) {
    throw new Error(data.message)
  }

  return data
}

async function connectTunnel(session, netlifyApiToken, localPort, log) {
  const execPath = getPathInHome(['tunnel', 'bin', PACKAGE_NAME])
  const args = ['connect', '-s', session.id, '-t', netlifyApiToken, '-l', localPort]
  if (process.env.DEBUG) {
    args.push('-v')
    log(execPath, args)
  }

  const ps = execa(execPath, args, { stdio: 'inherit' })
  ps.on('close', code => process.exit(code))
  ps.on('SIGINT', process.exit)
  ps.on('SIGTERM', process.exit)
}

async function installTunnelClient(log) {
  const binPath = getPathInHome(['tunnel', 'bin'])
  const shouldFetch = await shouldFetchLatestVersion({ binPath, packageName: PACKAGE_NAME })
  if (!shouldFetch) {
    return
  }

  log(`${NETLIFYDEVLOG} Installing Live Tunnel Client`)

  await fetchLatestVersion({
    packageName: PACKAGE_NAME,
    destination: binPath,
  })
}

module.exports = {
  createTunnel,
  connectTunnel,
}
