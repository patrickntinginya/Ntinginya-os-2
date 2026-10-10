import aiChat from '../netlify/functions/ai-chat.js'

export default async function handler(req, res) {
  try {
    const host = req.headers.host || 'localhost'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const url = new URL(req.url || '/api/ai-chat', `${protocol}://${host}`)

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
      }
    }

    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      body = Buffer.concat(chunks)
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      ...(body && body.length ? { body } : {})
    })

    const response = await aiChat(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    res.end(await response.text())
  } catch (error) {
    console.error('AI API error:', error)
    res.status(500).json({ error: 'server_error' })
  }
}
