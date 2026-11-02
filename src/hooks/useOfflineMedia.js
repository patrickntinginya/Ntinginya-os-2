import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createOfflineMedia } from '../lib/offlineMedia'
import { createIndexedDbStore, offlineSupported, requestPersistence, storageEstimate } from '../lib/offlineStore'

export const MEDIA_BUCKET = 'safe-mode-media'

/** Offline library for ONE signed-in user: downloads, progress, device usage and cloud sync. Files live in an IndexedDB database named after the user. */
/**
 * Offline library for ONE signed-in user. Safe Mode uses the defaults; chat voice messages pass { bucket, dbPrefix, eligible } so they live in their own
 * database with their own (stricter) download rule.
 */
export function useOfflineMedia(userId, { bucket = MEDIA_BUCKET, dbPrefix = 'ntinginya-offline-media', eligible } = {}) {
  const supported = offlineSupported()
  const core = useMemo(() => (supported && userId ? createOfflineMedia({
    store: createIndexedDbStore(userId, dbPrefix),
    eligible,
    getSignedUrl: async (path) => { const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300); if (error) throw error; return data.signedUrl },
    estimate: storageEstimate,
  }) : null), [supported, userId, bucket, dbPrefix, eligible])
  const [metas, setMetas] = useState({})
  const [progress, setProgress] = useState({})
  const [usage, setUsage] = useState({ count: 0, bytes: 0 })
  const [ready, setReady] = useState(false)
  const controllers = useRef(new Map())
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const refresh = useCallback(async () => {
    if (!core) return
    try {
      const list = await core.list()
      if (!alive.current) return
      setMetas(Object.fromEntries(list.map((m) => [m.id, m])))
      setUsage(await core.usage())
    } catch { /* storage unavailable (private mode): the library simply shows cloud files */ }
  }, [core])

  useEffect(() => {
    let live = true
    if (!core) { setReady(true); return undefined }
    core.reconcile().catch(() => {}).then(refresh).finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [core, refresh])

  const download = useCallback(async (item, { force = false } = {}) => {
    if (!core) return { ok: false, code: 'unsupported' }
    const ctl = new AbortController(); controllers.current.set(item.id, ctl)
    let last = -1
    setProgress((p) => ({ ...p, [item.id]: { percent: 0 } }))
    const r = await core.download(item, { userId, force, signal: ctl.signal, onProgress: ({ loaded, total }) => {
      const percent = Math.min(100, Math.floor((loaded / (total || item.size_bytes)) * 100))
      if (percent !== last) { last = percent; if (alive.current) setProgress((p) => ({ ...p, [item.id]: { percent } })) }
    } })
    controllers.current.delete(item.id)
    if (alive.current) setProgress((p) => { const n = { ...p }; delete n[item.id]; return n })
    if (r.ok) requestPersistence()
    await refresh()
    return r
  }, [core, userId, refresh])

  const cancel = useCallback((id) => { const c = controllers.current.get(id); if (c) c.abort() }, [])
  const remove = useCallback(async (id) => { if (core) { await core.remove(id); await refresh() } }, [core, refresh])
  const removeAll = useCallback(async () => { if (core) { const n = await core.removeAll(); await refresh(); return n } return 0 }, [core, refresh])
  const sync = useCallback(async (cloudRows, complete) => { if (!core) return null; const r = await core.sync({ cloudRows, complete }); await refresh(); return r }, [core, refresh])
  const removeWhere = useCallback(async (test) => { if (!core) return 0; const n = await core.removeWhere(test); await refresh(); return n }, [core, refresh])
  const playable = useCallback((id) => (core ? core.playable(id) : Promise.resolve(null)), [core])

  return { supported, ready, metas, progress, usage, download, cancel, remove, removeAll, sync, playable, removeWhere }
}
