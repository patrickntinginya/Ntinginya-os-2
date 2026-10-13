// Client-side UUID v4 for offline-created records. The server column is `uuid default gen_random_uuid()`, so an id
// supplied by the client is accepted, and it doubles as the idempotency key: retrying the same create can never make a second row.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

export function uuidv4(c = globalThis.crypto) {
  if (c?.randomUUID) return c.randomUUID()
  if (!c?.getRandomValues) throw new Error('No secure random source available')
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
