// code walkthrough: https://www.netlify.com/blog/2018/03/29/jamstack-architecture-on-netlify-how-identity-and-functions-work-together/#updating-user-data-with-the-identity-api
// demo repo: https://github.com/biilmann/testing-slack-tutorial/tree/v3-one-message-an-hour
// note: requires SLACK_WEBHOOK_URL environment variable
const process = require('process')

const slackURL = process.env.SLACK_WEBHOOK_URL
const fetch = require('node-fetch')

class IdentityAPI {
  constructor(apiURL, token) {
    this.apiURL = apiURL
    this.token = token
  }

  headers(headers = {}) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...headers,
    }
  }

  static async parseJsonResponse(response) {
    const json = await response.json()
    if (!response.ok) {
      const error = `JSON: ${JSON.stringify(json)}. Status: ${response.status}`
      throw new Error(error)
    }
    return json
  }

  async request(path, options = {}) {
    const headers = this.headers(options.headers || {})
    const response = await fetch(this.apiURL + path, { ...options, headers })
    const contentType = response.headers.get('Content-Type')
    if (contentType && /json/.test(contentType)) {
      return IdentityAPI.parseJsonResponse(response)
    }

    if (!response.ok) {
      const data = await response.text()
      const error = `Data: ${data}. Status: ${response.status}`
      throw new Error(error)
    }
    return await response.text()
  }
}

//
// Fetch a user from GoTrue via id
//
const fetchUser = function (identity, id) {
  const api = new IdentityAPI(identity.url, identity.token)
  return api.request(`/admin/users/${id}`)
}

//
// Update the app_metadata of a user
//
const updateUser = function (identity, user, appMetadata) {
  const api = new IdentityAPI(identity.url, identity.token)

  return api.request(`/admin/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ app_metadata: { ...user.app_metadata, ...appMetadata } }),
  })
}

// One hour
const MESSAGE_RATE_LIMIT = 36e5

module.exports = async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 410,
      body: 'Unsupported Request Method',
    }
  }

  const claims = context.clientContext && context.clientContext.user
  if (!claims) {
    return {
      statusCode: 401,
      body: 'You must be signed in to call this function',
    }
  }

  const user = await fetchUser(context.clientContext.identity, claims.sub)
  const lastMessage = new Date(user.app_metadata.last_message_at || 0).getTime()
  const cutOff = Date.now() - MESSAGE_RATE_LIMIT
  if (lastMessage > cutOff) {
    return {
      statusCode: 401,
      body: 'Only one message an hour allowed',
    }
  }

  try {
    const payload = JSON.parse(event.body)

    await fetch(slackURL, {
      method: 'POST',
      body: JSON.stringify({
        text: payload.text,
        attachments: [{ text: `From ${user.email}` }],
      }),
    })
    await updateUser(context.clientContext.identity, user, {
      last_message_at: Date.now(),
    })
    return { statusCode: 204 }
  } catch (error) {
    return { statusCode: 500, body: `Internal Server Error: ${error}` }
  }
}
