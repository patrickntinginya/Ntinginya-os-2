// Offline media library core. Framework-free: the storage (IndexedDB), the network and the clock are INJECTED, so it is unit-tested with fakes.
//
// What may be downloaded: ONLY files that live in the app's own private Supabase bucket and that the signed-in person owns or that an
// administrator shared with every member through Safe Mode. YouTube and any other external link is NEVER downloaded: it stays "online only".
//
// Safety rules implemented here
//  * a record says "downloaded" only after the full file was fetched, its size matched the cloud record, and the bytes were stored;
//  * a failed or cancelled download never leaves a half file behind and never overwrites a good copy;
//  * the same file is never downloaded twice at the same time (one in-flight promise per file);
//  * a file is removed from the device because it was deleted in the cloud ONLY when the cloud list was fetched completely and successfully;
//  * the browser may evict stored data under pressure, so reconcile() drops records whose bytes are gone instead of pretending they are offline.
export const MAX_BYTES = 52428800 // 50 MB, same as the bucket limit
export const TYPES = ['image', 'audio', 'video']
const SPACE_MARGIN = 5 * 1024 * 1024
export const CLOUD_LIST_LIMIT = 1000 // a list this long may be truncated, so it is never used to decide what was deleted

/** { ok:true } or { ok:false, code }. Codes: not_cloud | bad_type | too_big | not_allowed. */
export function downloadability(item, userId) {
  if (!item || typeof item.id !== 'string' || !item.storage_path) return { ok: false, code: 'not_cloud' }
  if (!TYPES.includes(item.media_type)) return { ok: false, code: 'bad_type' }
  const size = Number(item.size_bytes)
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return { ok: false, code: 'too_big' }
  const first = String(item.storage_path).split('/')[0]
  const own = item.visibility === 'personal' && item.user_id === userId && first === userId
  const shared = item.visibility === 'shared' && first === 'shared'
  return own || shared ? { ok: true } : { ok: false, code: 'not_allowed' }
}

/** What the screen shows for one file: 'offline' | 'update' | 'failed' | 'downloading' | 'cloud'. */
export function stateOf(meta, progress) {
  if (progress) return 'downloading'
  if (meta && meta.status === 'downloaded') return meta.stale ? 'update' : 'offline'
  if (meta && meta.status === 'failed') return 'failed'
  return 'cloud'
}

// `extra` carries small context the owner of the item wants back (for chat voice: conversation id, sender name, duration). Nothing sensitive.
const pick = (item) => ({ id: item.id, title: item.title, media_type: item.media_type, mime_type: item.mime_type || null, size_bytes: Number(item.size_bytes), storage_path: item.storage_path, visibility: item.visibility, created_at: item.created_at, extra: item.extra || null })

/** `eligible(item, userId)` decides what may be downloaded; the default is the Safe Mode rule above. Chat voice messages pass their own stricter rule. */
export function createOfflineMedia({ store, getSignedUrl, eligible = downloadability, fetchFn = (...a) => fetch(...a), estimate = async () => null, now = () => Date.now() }) {
  const inflight = new Map()

  async function failed(item, code, { persist = true } = {}) {
    if (persist) {
      const existing = await store.getMeta(item.id).catch(() => null)
      if (!existing || existing.status !== 'downloaded') await store.putMeta({ ...pick(item), status: 'failed', error: code, failed_at: now() }).catch(() => {})
    }
    return { ok: false, code }
  }

  async function run(item, { onProgress, signal }) {
    const space = await estimate().catch(() => null)
    if (space && Number.isFinite(space.quota) && Number.isFinite(space.usage) && space.quota - space.usage < item.size_bytes * 1.1 + SPACE_MARGIN) return failed(item, 'no_space')
    let url
    try { url = await getSignedUrl(item.storage_path) } catch { return failed(item, 'url') }
    if (!url) return failed(item, 'url')
    let res
    try { res = await fetchFn(url, { signal }) } catch (e) { return e && e.name === 'AbortError' ? { ok: false, code: 'cancelled' } : failed(item, 'network') }
    if (!res.ok) return failed(item, res.status === 404 ? 'missing' : res.status === 400 || res.status === 401 || res.status === 403 ? 'expired' : 'http')
    const total = Number(res.headers && res.headers.get && res.headers.get('content-length')) || item.size_bytes
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || item.mime_type || 'application/octet-stream'
    let blob
    try {
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader(); const chunks = []; let loaded = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value); loaded += value.byteLength
          if (loaded > MAX_BYTES) { try { await reader.cancel() } catch { /* ignore */ } return failed(item, 'too_big') }
          if (onProgress) onProgress({ loaded, total })
        }
        blob = new Blob(chunks, { type })
      } else blob = await res.blob()
    } catch (e) { return e && e.name === 'AbortError' ? { ok: false, code: 'cancelled' } : failed(item, 'network') }
    if (blob.size !== item.size_bytes) return failed(item, 'size_mismatch')
    try {
      await store.putBlob(item.id, blob)
      await store.putMeta({ ...pick(item), status: 'downloaded', stale: false, downloaded_at: now(), error: null })
    } catch {
      await store.deleteBlob(item.id).catch(() => {})
      return failed(item, 'storage')
    }
    return { ok: true, status: 'downloaded' }
  }

  return {
    /** Downloads one file. Returns { ok, status|code }. Calling it again while it runs returns the SAME promise (no second download). */
    async download(item, { userId, onProgress, signal, force = false } = {}) {
      const check = eligible(item, userId)
      if (!check.ok) return { ok: false, code: check.code }
      // Registered synchronously (before any await) so two quick taps can never start two downloads.
      if (inflight.has(item.id)) return inflight.get(item.id)
      const p = (async () => {
        const meta = await store.getMeta(item.id)
        if (!force && meta && meta.status === 'downloaded' && !meta.stale && meta.storage_path === item.storage_path && meta.size_bytes === Number(item.size_bytes) && (await store.hasBlob(item.id))) return { ok: true, status: 'already' }
        return run(item, { onProgress, signal })
      })().finally(() => inflight.delete(item.id))
      inflight.set(item.id, p)
      return p
    },
    isDownloading: (id) => inflight.has(id),
    async list() { return store.listMeta() },
    async get(id) { return store.getMeta(id) },
    /** { blob, meta } of a stored file, or null. */
    async playable(id) {
      const meta = await store.getMeta(id)
      if (!meta || meta.status !== 'downloaded') return null
      const blob = await store.getBlob(id)
      return blob ? { blob, meta } : null
    },
    async remove(id) { await store.deleteBlob(id); await store.deleteMeta(id) },
    /** Removes every stored file whose record matches `test(meta)`. Returns how many were removed. */
    async removeWhere(test) { let n = 0; for (const m of await store.listMeta()) if (test(m)) { await store.deleteBlob(m.id); await store.deleteMeta(m.id); n += 1 } return n },
    async removeAll() { const metas = await store.listMeta(); for (const m of metas) { await store.deleteBlob(m.id); await store.deleteMeta(m.id) } for (const id of await store.listBlobIds()) await store.deleteBlob(id); return metas.length },
    async usage() {
      const metas = (await store.listMeta()).filter((m) => m.status === 'downloaded')
      return { count: metas.length, bytes: metas.reduce((s, m) => s + (Number(m.size_bytes) || 0), 0) }
    },
    /**
     * Compares the device with the cloud list. Never deletes anything unless `complete` is true (the whole list was fetched without error).
     * Returns { removed, stale, renamed }.
     */
    async sync({ cloudRows, complete }) {
      const out = { removed: 0, stale: 0, renamed: 0 }
      if (!Array.isArray(cloudRows)) return out
      const cloud = new Map(cloudRows.map((r) => [r.id, r]))
      for (const meta of await store.listMeta()) {
        const row = cloud.get(meta.id)
        if (!row) { if (complete && cloudRows.length < CLOUD_LIST_LIMIT) { await this.remove(meta.id); out.removed += 1 } continue }
        if (meta.status !== 'downloaded') continue
        const changed = row.storage_path !== meta.storage_path || Number(row.size_bytes) !== meta.size_bytes
        if (changed && !meta.stale) { await store.putMeta({ ...meta, stale: true }); out.stale += 1 }
        else if (!changed && (row.title !== meta.title || row.visibility !== meta.visibility)) { await store.putMeta({ ...meta, title: row.title, visibility: row.visibility }); out.renamed += 1 }
      }
      return out
    },
    /** Removes stored bytes without a record (a crash mid-write) and records whose bytes the browser evicted. */
    async reconcile() {
      const metas = await store.listMeta(); const known = new Set(metas.map((m) => m.id)); const out = { orphans: 0, evicted: 0 }
      for (const id of await store.listBlobIds()) if (!known.has(id)) { await store.deleteBlob(id); out.orphans += 1 }
      for (const m of metas) if (m.status === 'downloaded' && !(await store.hasBlob(m.id))) { await store.deleteMeta(m.id); out.evicted += 1 }
      return out
    },
  }
}
