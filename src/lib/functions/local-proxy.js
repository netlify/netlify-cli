const { getBinaryPath: getFunctionsProxyPath } = require('@netlify/local-functions-proxy')
const execa = require('execa')

const runFunctionsProxy = ({ binaryPath, directory, name, requestData, timeout }) => {
  const functionsProxyPath = getFunctionsProxyPath()

  if (functionsProxyPath === null) {
    throw new Error('Host machine does not support local functions proxy server')
  }

  return execa(functionsProxyPath, [JSON.stringify(requestData), binaryPath, directory, name, `${timeout}s`])
}

module.exports = { runFunctionsProxy }
