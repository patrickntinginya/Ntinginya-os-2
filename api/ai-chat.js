import aiChat from '../netlify/functions/ai-chat.js'

const allowedOrigins = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'https://ntinginyaos2-2j3nj4036-patrickntinginya.vercel.app',
  ...(process.env.AI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
])

function applyCors(req, res) {
  const origin = req.headers.origin
  res.setHeader('Vary', 'Origin')

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    )
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  return !origin || allowedOrigins.has(origin)
}

export default async function handler(req, res) {
  try {
    const originAllowed = applyCors(req, res)

    if (req.method === 'OPTIONS') {
      if (!originAllowed) {
        return res.status(403).json({ error: 'origin_not_allowed' })
      }

      return res.status(204).end()
    }

    if (req.headers.origin && !originAllowed) {
      return res.status(403).json({ error: 'origin_not_allowed' })
    }

    const host = req.headers.host || 'localhost'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const url = new URL(
      req.url || '/api/ai-chat',
      `${protocol}://${host}`
    )

    const headers = new Headers()

    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(', ') : String(value)
        )
      }
    }

    let body

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []

      for await (const chunk of req) {
        chunks.push(chunk)
      }

      body = Buffer.concat(chunks)
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      ...(body && body.length ? { body } : {}),
    })

    const response = await aiChat(request)

    res.statusCode = response.status

    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    applyCors(req, res)

    res.end(await response.text())
  } catch (error) {
    console.error('AI API error:', error)
    res.status(500).json({ error: 'server_error' })
  }
}
