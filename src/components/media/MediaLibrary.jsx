import { useEffect, useMemo, useState } from 'react'
import { CloudDownload, Heart, Image as ImageIcon, Music2, RefreshCw, Search, Trash2, Video, WifiOff, X } from 'lucide-react'
import { stateOf } from '../../lib/offlineMedia'
import { formatBytes } from '../../lib/bytes'
import { readResume, writeResume } from '../../lib/resume'

export function IconFor({ type, size = 18 }) {
  if (type === 'image') return <ImageIcon size={size} aria-hidden="true" />
  if (type === 'audio') return <Music2 size={size} aria-hidden="true" />
  return <Video size={size} aria-hidden="true" />
}

const favKey = (userId) => `life-os-media-fav:${userId}`
const loadFavs = (userId) => { try { return new Set(JSON.parse(window.localStorage.getItem(favKey(userId)) || '[]')) } catch { return new Set() } }

/** Plays/shows ONE file. A downloaded file is read from the device (on tap, so a long list does not load every file into memory). */
function Preview({ item, local, offline, c, userId }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => () => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url) }, [url])
  const openLocal = async () => {
    setError(false)
    const p = await offline.playable(item.id)
    if (!p) { setError(true); await offline.remove(item.id); return }
    setUrl(URL.createObjectURL(p.blob))
  }
  const src = url || (!local ? item.signedUrl : null)
  if (!src) {
    return local ? (
      <div className="w-full text-center">
        <button type="button" onClick={openLocal} className="btn btn-secondary min-h-[44px]">{item.media_type === 'image' ? c.view : c.play}</button>
        {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{c.dl_evicted}</p>}
      </div>
    ) : <IconFor type={item.media_type} size={32} />
  }
  if (item.media_type === 'image') return <img src={src} alt={item.title} loading="lazy" className="max-h-64 w-full rounded-lg object-contain" />
  const save = (e) => writeResume(window.localStorage, 'safe-media', `${userId}:${item.id}`, e.currentTarget.currentTime, e.currentTarget.duration)
  const seek = (e) => { const s = readResume(window.localStorage, 'safe-media', `${userId}:${item.id}`); if (s && s < e.currentTarget.duration) e.currentTarget.currentTime = s }
  const common = { controls: true, preload: 'metadata', src, onLoadedMetadata: seek, onPause: save, onEnded: save, autoPlay: Boolean(url) }
  return item.media_type === 'audio' ? <audio {...common} className="w-full" /> : <video {...common} playsInline className="max-h-64 w-full" />
}

function Badge({ state, c }) {
  const map = { offline: ['bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200', c.offlineBadge], update: ['bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200', c.updateBadge], failed: ['bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200', c.failedBadge], downloading: ['bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200', c.downloading], cloud: ['bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200', c.cloudBadge] }
  const [cls, label] = map[state]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

/**
 * The Safe Mode media library: browse, search, filter, favourite, download for offline, play online or offline.
 * Every file is labelled: In cloud (needs internet) / Available offline (stored on this device). YouTube and other links are never listed
 * here and can never be downloaded; they are "online only" in the Motivation screen.
 */
export default function MediaLibrary({ items, cloudOk, user, isAdmin, offline, c, onDelete, onLoadError }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [favs, setFavs] = useState(() => loadFavs(user?.id))
  const [msg, setMsg] = useState({})
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) } }, [])

  // With no cloud list (offline or the request failed) the library still shows everything stored on the device.
  const list = useMemo(() => (cloudOk ? items : Object.values(offline.metas).filter((m) => m.status === 'downloaded').map((m) => ({ ...m, signedUrl: null }))), [cloudOk, items, offline.metas])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter((i) => {
      if (q && !String(i.title).toLowerCase().includes(q)) return false
      if (filter === 'downloaded') return offline.metas[i.id]?.status === 'downloaded'
      if (filter === 'favorites') return favs.has(i.id)
      return filter === 'all' || i.media_type === filter
    })
  }, [list, filter, query, favs, offline.metas])

  const toggleFav = (id) => setFavs((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); try { window.localStorage.setItem(favKey(user.id), JSON.stringify([...n].slice(0, 500))) } catch { /* storage full */ } return n })
  const doDownload = async (item, force) => { setMsg((m) => ({ ...m, [item.id]: null })); const r = await offline.download(item, { force }); if (!r.ok && r.code !== 'cancelled') setMsg((m) => ({ ...m, [item.id]: c[`dl_${r.code}`] || c.dl_http })) }
  const clearAll = async () => { if (window.confirm(c.storageDeleteConfirm)) await offline.removeAll() }

  const chips = [['all', c.all], ['image', c.images], ['audio', c.audio], ['video', c.video], ['downloaded', c.downloaded], ['favorites', c.favorites]]
  return (
    <section className="space-y-3">
      {(!online || !cloudOk) && <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100"><WifiOff size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{c.offlineNote}{!cloudOk && onLoadError && <button type="button" onClick={onLoadError} className="ml-2 underline">{c.retry}</button>}</p>}
      <label className="relative block"><span className="sr-only">{c.search}</span><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input type="search" className="input w-full pl-10" maxLength={60} placeholder={c.search} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={c.library}>{chips.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-[42px] rounded-full px-4 text-sm font-medium ${filter === value ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark'}`}>{label}</button>)}</div>

      {shown.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/20">{list.length === 0 ? c.empty : c.emptyFilter}</p> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => {
            const meta = offline.metas[item.id]; const prog = offline.progress[item.id]; const state = stateOf(meta, prog)
            const local = meta?.status === 'downloaded'; const mine = cloudOk && (item.user_id === user?.id || isAdmin)
            return (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark">
                <div className="flex min-h-32 items-center justify-center bg-slate-50 p-3 dark:bg-white/5"><Preview item={item} local={local} offline={offline} c={c} userId={user.id} /></div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{item.title}</h3>
                    <button type="button" className="icon-btn shrink-0" aria-pressed={favs.has(item.id)} aria-label={favs.has(item.id) ? c.unfavorite : c.favorite} onClick={() => toggleFav(item.id)}><Heart size={20} className={favs.has(item.id) ? 'fill-red-500 text-red-500' : ''} /></button></div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Badge state={state} c={c} /><span>{item.visibility === 'shared' ? c.sharedBadge : c.privateBadge}</span><span>{formatBytes(item.size_bytes)}</span></div>
                  {state === 'downloading' && <div><div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.percent} aria-label={c.downloading}><div className="h-full bg-brand-600 transition-all" style={{ width: `${prog.percent}%` }} /></div>
                    <div className="mt-1 flex items-center justify-between text-xs"><span>{prog.percent}%</span><button type="button" className="inline-flex min-h-[40px] items-center gap-1 text-sm" onClick={() => offline.cancel(item.id)}><X size={15} aria-hidden="true" />{c.cancel}</button></div></div>}
                  {msg[item.id] && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{msg[item.id]}</p>}
                  {state === 'failed' && !msg[item.id] && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{c[`dl_${meta.error}`] || c.dl_http}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {cloudOk && offline.supported && (state === 'cloud' || state === 'failed') && online && <button type="button" onClick={() => doDownload(item, false)} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300">{state === 'failed' ? <RefreshCw size={16} aria-hidden="true" /> : <CloudDownload size={16} aria-hidden="true" />}{state === 'failed' ? c.retry : c.download}</button>}
                    {cloudOk && state === 'update' && online && <button type="button" onClick={() => doDownload(item, true)} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300"><RefreshCw size={16} aria-hidden="true" />{c.update}</button>}
                    {local && <button type="button" onClick={() => offline.remove(item.id)} className="inline-flex min-h-[44px] items-center gap-1 text-sm">{c.removeDownload}</button>}
                    {mine && <button type="button" onClick={() => onDelete(item)} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-red-600 dark:text-red-400"><Trash2 size={15} aria-hidden="true" />{c.delete}</button>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-surface-dark">
        <h3 className="font-semibold">{c.storageTitle}</h3>
        {!offline.supported ? <p className="mt-1 text-slate-500">{c.unsupported}</p> : <>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{offline.usage.count} · {formatBytes(offline.usage.bytes)}</p>
          {offline.usage.count > 0 && <button type="button" onClick={clearAll} className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-red-600 dark:text-red-400"><Trash2 size={15} aria-hidden="true" />{c.storageDeleteAll}</button>}
        </>}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{c.onlyOwn}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{c.deviceOnlyFav}</p>
      </div>
    </section>
  )
}
