// Bridges Vercel's Node request/response objects to the web-standard Request/Response used by handler.js.
// Why it exists: the platform may already have parsed the JSON body (req.body), in which case the stream is empty,
// and forwarding raw Node headers (host, connection, content-length) into a new Request is fragile.
const MAX_BODY = 64 * 1024

export async function readNodeBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
    return JSON.stringify(req.body)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('too_large'), { code: 'too_large' })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const FORWARDED = ['authorization', 'content-type', 'origin', 'host', 'x-forwarded-host', 'x-forwarded-proto']

export async function toWebRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const headers = new Headers()
  for (const name of FORWARDED) {
    const v = req.headers[name]
    if (v !== undefined) headers.set(name, Array.isArray(v) ? v.join(', ') : String(v))
  }
  const init = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') init.body = await readNodeBody(req)
  return new Request(new URL(req.url || '/api/ai-chat', `${proto}://${String(host).split(',')[0].trim()}`), init)
}

export async function sendWebResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
