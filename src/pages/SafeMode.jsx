import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Image as ImageIcon, Music2, ShieldCheck, Sparkles, Trash2, UploadCloud, Video } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SafeModeSupport from '../components/SafeModeSupport'

const BUCKET = 'safe-mode-media'
const MAX_BYTES = 50 * 1024 * 1024
const COPY = {
  en: {
    headerTitle: 'Safe Mode', headerSubtitle: 'A calmer space for motivation, breathing, and media that helps you reset.', motivation: 'Motivation', calm: 'Calm & breathing', reflections: 'Reflections', library: 'Media library', libraryHint: 'Upload your own images, audio, or videos. Your personal files stay private.', upload: 'Upload media', titleLabel: 'Title (optional)', shared: 'Share with everyone', uploadHint: 'Images, audio, or video files up to 50 MB each.', uploading: 'Uploading…', loading: 'Loading your media…', empty: 'No media yet. Upload a photo, audio track, or video to get started.', delete: 'Delete', deleteConfirm: 'Delete this media file? This cannot be undone.', errorLoad: 'Could not load media. Check that the Safe Mode database migration has been applied.', errorType: 'Choose an image, audio, or video file.', errorSize: 'This file is larger than the 50 MB limit.', errorUpload: 'Upload failed. Check your connection and Supabase Storage setup, then try again.', errorDelete: 'Could not delete this file. Check permissions and try again.', uploadSuccess: 'Media uploaded successfully.', privateBadge: 'Private', sharedBadge: 'Shared', all: 'All', images: 'Images', audio: 'Audio', video: 'Video', adminNotice: 'Admin sharing is available when your Supabase account has the admin or owner role in app metadata.', open: 'Open', emptyFilter: 'No files in this category yet.'
  },
  sw: {
    headerTitle: 'Hali Salama', headerSubtitle: 'Sehemu tulivu ya kupata motisha, kufanya mazoezi ya kupumua na kutumia media kukusaidia kujituliza.', motivation: 'Motisha', calm: 'Utulivu na kupumua', reflections: 'Tafakari', library: 'Maktaba ya media', libraryHint: 'Pakia picha, sauti au video zako. Faili zako binafsi zitaonekana kwako tu.', upload: 'Pakia media', titleLabel: 'Jina (si lazima)', shared: 'Shiriki na watumiaji wote', uploadHint: 'Picha, sauti au video zisizozidi MB 50 kila moja.', uploading: 'Inapakia…', loading: 'Inapakia media zako…', empty: 'Bado hakuna media. Pakia picha, sauti au video ili kuanza.', delete: 'Futa', deleteConfirm: 'Ufute faili hili? Kitendo hiki hakiwezi kutenduliwa.', errorLoad: 'Imeshindwa kupakia media. Hakikisha migration ya Safe Mode imetekelezwa kwenye Supabase.', errorType: 'Chagua faili la picha, sauti au video.', errorSize: 'Faili hili limezidi kikomo cha MB 50.', errorUpload: 'Upakiaji umeshindikana. Kagua intaneti na mipangilio ya Supabase Storage, kisha ujaribu tena.', errorDelete: 'Imeshindwa kufuta faili. Kagua ruhusa kisha ujaribu tena.', uploadSuccess: 'Media imepakiwa vizuri.', privateBadge: 'Binafsi', sharedBadge: 'Imeshirikiwa', all: 'Zote', images: 'Picha', audio: 'Sauti', video: 'Video', adminNotice: 'Kushiriki kama admin kunapatikana akaunti yako ya Supabase ikiwa na role ya admin au owner kwenye app metadata.', open: 'Fungua', emptyFilter: 'Hakuna faili katika kundi hili bado.'
  }
}
const EXTENSIONS = { image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'], audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'webm'], video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'] }
function mediaType(file) {
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  return Object.entries(EXTENSIONS).find(([, list]) => list.includes(ext))?.[0] || null
}
function safeName(name) { return String(name || 'media').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100) || 'media' }
function IconFor({ type, size = 18 }) {
  if (type === 'image') return <ImageIcon size={size} aria-hidden="true" />
  if (type === 'audio') return <Music2 size={size} aria-hidden="true" />
  return <Video size={size} aria-hidden="true" />
}
export default function SafeMode() {
  const { user } = useAuth()
  const lang = document.documentElement.lang?.toLowerCase().startsWith('en') ? 'en' : 'sw'
  const c = COPY[lang]
  const isAdmin = ['admin', 'owner'].includes(user?.app_metadata?.role)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [shareWithAll, setShareWithAll] = useState(false)
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: queryError } = await supabase.from('safe_mode_media').select('*').order('created_at', { ascending: false })
    if (queryError) { setError(c.errorLoad); setItems([]); setLoading(false); return }
    const signed = await Promise.all((data || []).map(async (item) => {
      const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(item.storage_path, 3600)
      return { ...item, signedUrl: urlData?.signedUrl || null }
    }))
    setItems(signed); setLoading(false)
  }, [c.errorLoad])
  useEffect(() => { load() }, [load])
  const visibleItems = useMemo(() => filter === 'all' ? items : items.filter((item) => item.media_type === filter), [items, filter])

  async function upload(e) {
    e.preventDefault(); setNotice(''); setError('')
    const input = e.currentTarget.elements.namedItem('media-file')
    const file = input?.files?.[0]
    if (!file || !mediaType(file)) { setError(c.errorType); return }
    if (file.size > MAX_BYTES) { setError(c.errorSize); return }
    setUploading(true)
    const type = mediaType(file)
    const visibility = isAdmin && shareWithAll ? 'shared' : 'personal'
    const folder = visibility === 'shared' ? `shared/${user.id}` : user.id
    const path = `${folder}/${crypto.randomUUID()}-${safeName(file.name)}`
    try {
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      if (storageError) throw storageError
      const cleanTitle = (title.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 120)
      const { error: rowError } = await supabase.from('safe_mode_media').insert({ user_id: user.id, title: cleanTitle, media_type: type, visibility, storage_path: path, mime_type: file.type || null, size_bytes: file.size })
      if (rowError) { await supabase.storage.from(BUCKET).remove([path]); throw rowError }
      setTitle(''); setShareWithAll(false); if (input) input.value = ''; setNotice(c.uploadSuccess); await load()
    } catch { setError(c.errorUpload) } finally { setUploading(false) }
  }
  async function remove(item) {
    if (!window.confirm(c.deleteConfirm)) return
    setError(''); setNotice('')
    const { error: rowError } = await supabase.from('safe_mode_media').delete().eq('id', item.id)
    if (rowError) { setError(c.errorDelete); return }
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([item.storage_path])
    if (storageError) { setError(c.errorDelete); return }
    setItems((current) => current.filter((entry) => entry.id !== item.id))
  }
  const filters = [['all', c.all], ['image', c.images], ['audio', c.audio], ['video', c.video]]
  return <main className="mx-auto max-w-5xl space-y-5">
    <header className="rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-900 p-5 text-white sm:p-7">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-white/15 p-3"><ShieldCheck size={26} aria-hidden="true" /></span><div><h1 className="text-2xl font-bold tracking-tight">{c.headerTitle}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/90">{c.headerSubtitle}</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><Link to="/motivation" className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-white/10 px-4 py-3 font-medium hover:bg-white/20"><span className="flex items-center gap-2"><Sparkles size={18} />{c.motivation}</span><ArrowUpRight size={17} /></Link><Link to="/calm" className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-white/10 px-4 py-3 font-medium hover:bg-white/20"><span className="flex items-center gap-2"><ShieldCheck size={18} />{c.calm}</span><ArrowUpRight size={17} /></Link><Link to="/reflections" className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-white/10 px-4 py-3 font-medium">{c.reflections}<ArrowUpRight size={17} /></Link></div>
    </header>
    <SafeModeSupport />
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-surface-dark sm:p-5">
      <h2 className="text-lg font-semibold">{c.library}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{c.libraryHint}</p>{isAdmin && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{c.adminNotice}</p>}
      <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm font-medium">{c.titleLabel}<input className="input mt-1" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block text-sm font-medium">{c.upload}<input className="input mt-1" type="file" name="media-file" accept="image/*,audio/*,video/*" required /></label>
        <button className="btn btn-primary min-h-[44px]" type="submit" disabled={uploading || !user}>{uploading ? c.uploading : <><UploadCloud size={18} />{c.upload}</>}</button>
        {isAdmin && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={shareWithAll} onChange={(e) => setShareWithAll(e.target.checked)} />{c.shared}</label>}
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-3">{c.uploadHint}</p>
      </form>
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
    <section className="space-y-3"><div className="flex flex-wrap gap-2" role="group" aria-label={c.library}>{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-[42px] rounded-full px-4 text-sm font-medium ${filter === value ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark'}`}>{label}</button>)}</div>
      {loading ? <p className="py-8 text-center text-sm text-slate-500">{c.loading}</p> : visibleItems.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/20">{filter === 'all' ? c.empty : c.emptyFilter}</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleItems.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark"><div className="flex min-h-32 items-center justify-center bg-slate-50 p-3 dark:bg-white/5">{!item.signedUrl ? <IconFor type={item.media_type} size={32} /> : item.media_type === 'image' ? <img src={item.signedUrl} alt={item.title} loading="lazy" className="max-h-64 w-full rounded-lg object-contain" /> : item.media_type === 'audio' ? <audio controls preload="none" src={item.signedUrl} className="w-full" /> : <video controls preload="none" src={item.signedUrl} className="max-h-64 w-full" />}</div><div className="space-y-2 p-4"><div className="flex items-start justify-between gap-2"><h3 className="break-words font-semibold">{item.title}</h3><IconFor type={item.media_type} /></div><div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{item.visibility === 'shared' ? c.sharedBadge : c.privateBadge}</span><span>{new Date(item.created_at).toLocaleDateString()}</span></div>{item.signedUrl && <a href={item.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300">{c.open} <ArrowUpRight size={15} /></a>}{(item.user_id === user?.id || isAdmin) && <button type="button" onClick={() => remove(item)} className="ml-3 inline-flex min-h-[40px] items-center gap-1 text-sm text-red-600 dark:text-red-400"><Trash2 size={15} />{c.delete}</button>}</div></article>)}</div>}
    </section>
  </main>
}
