const { dirname } = require('path')

const execa = require('execa')
const tempy = require('tempy')

const { runFunctionsProxy } = require('../../local-proxy')

const getBuildFunction = ({ func }) => {
  const functionDirectory = dirname(func.mainFile)
  const binaryPath = tempy.file()

  return async () => {
    await execa('go', ['build', '-o', binaryPath], { cwd: functionDirectory })

    return { binaryPath, srcFiles: [functionDirectory] }
  }
}

const invokeFunction = async ({ context, event, func, timeout }) => {
  const requestData = {
    ...event,
    requestContext: context,
  }
  const { stdout } = await runFunctionsProxy({
    binaryPath: func.buildData.binaryPath,
    directory: dirname(func.mainFile),
    name: func.name,
    requestData,
    timeout,
  })

  try {
    const { body, headers, statusCode } = JSON.parse(stdout)

    return {
      body,
      headers,
      statusCode,
    }
  } catch (error) {
    return {
      statusCode: 500,
    }
  }
}

module.exports = { getBuildFunction, invokeFunction, name: 'go' }
