// Signing storage URLs with real error handling. supabase-js reports problems in THREE places and all of them matter:
//   1. the whole call can return { error }            (network down, expired session, server error)
//   2. the whole call can throw                        (fetch rejected)
//   3. each item can carry its own `error`/no URL      (e.g. "Object not found")
// Transient problems (network, 5xx, 429) are retried with a growing delay; permanent ones (not found, not allowed) are not.
// Result: { urls: {path: url}, failed: [{ path, reason }], reason: null | 'network' | 'auth' | 'server' | 'missing' | 'unknown' , attempts }
export const CHUNK = 100
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 'network' | 'auth' | 'server' | 'missing' | 'unknown' */
export function classifyStorageError(e) {
  if (!e) return 'unknown'
  const status = Number(e.statusCode ?? e.status)
  const msg = String(e.message || e.error || e).toLowerCase()
  if (e instanceof TypeError || /failed to fetch|network|load failed|timeout|offline/.test(msg)) return 'network'
  if (status === 401 || status === 403 || /jwt|not authorized|unauthorized|forbidden|row-level security/.test(msg)) return 'auth'
  if (status === 404 || /not found|no such object/.test(msg)) return 'missing'
  if (status === 429 || (status >= 500 && status < 600) || /server|unavailable|gateway/.test(msg)) return 'server'
  return 'unknown'
}
const transient = (reason) => reason === 'network' || reason === 'server' || reason === 'unknown'

export async function signUrls(client, bucket, paths, { seconds = 3600, attempts = 3, delayMs = 400, sleep = wait } = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  const urls = {}
  if (!unique.length) return { urls, failed: [], reason: null, attempts: 0 }
  let pending = unique // paths still worth trying
  const permanent = [] // paths that failed for a reason a retry cannot fix
  let used = 0
  for (let attempt = 1; attempt <= attempts && pending.length; attempt += 1) {
    used = attempt
    const failures = []
    for (let i = 0; i < pending.length; i += CHUNK) {
      const batch = pending.slice(i, i + CHUNK)
      let res
      try { res = await client.storage.from(bucket).createSignedUrls(batch, seconds) } catch (e) { res = { data: null, error: e } }
      if (res.error || !Array.isArray(res.data)) { const reason = classifyStorageError(res.error); for (const path of batch) failures.push({ path, reason }); continue }
      const seen = new Set()
      for (const r of res.data) {
        seen.add(r.path)
        if (r.signedUrl && !r.error) urls[r.path] = r.signedUrl
        else failures.push({ path: r.path, reason: classifyStorageError({ message: r.error }) })
      }
      for (const path of batch) if (!seen.has(path)) failures.push({ path, reason: 'unknown' }) // the server skipped it
    }
    permanent.push(...failures.filter((f) => !transient(f.reason)))
    const retry = failures.filter((f) => transient(f.reason))
    pending = retry.map((f) => f.path)
    if (!pending.length) break
    if (attempt === attempts) { permanent.push(...retry); break }
    await sleep(delayMs * 2 ** (attempt - 1))
  }
  const failed = permanent.filter((f) => !urls[f.path])
  const reasons = failed.map((f) => f.reason)
  const reason = failed.length ? ['auth', 'network', 'server', 'missing', 'unknown'].find((r) => reasons.includes(r)) : null
  return { urls, failed, reason, attempts: used }
}
