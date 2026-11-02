import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import SafeModeSupport from '../components/SafeModeSupport'
import MediaLibrary from '../components/media/MediaLibrary'
import { useOfflineMedia } from '../hooks/useOfflineMedia'
import { CLOUD_LIST_LIMIT } from '../lib/offlineMedia'
import { signUrls } from '../lib/signedUrls'

const BUCKET = 'safe-mode-media'
const MAX_BYTES = 50 * 1024 * 1024
const COPY = {
  en: {
    headerTitle: 'Safe Mode', headerSubtitle: 'A calmer space for motivation, breathing, and media that helps you reset.', motivation: 'Motivation', calm: 'Calm & breathing', reflections: 'Reflections', library: 'Media library', libraryHint: 'Upload your own images, audio, or videos. Your personal files stay private.', upload: 'Upload media', titleLabel: 'Title (optional)', shared: 'Share with everyone', uploadHint: 'Images, audio, or video files up to 50 MB each.', uploading: 'Uploading…', loading: 'Loading your media…', empty: 'No media yet. Upload a photo, audio track, or video to get started.', delete: 'Delete', deleteConfirm: 'Delete this media file? This cannot be undone.', errorLoad: 'Could not load media. Check that the Safe Mode database migration has been applied.', errorType: 'Choose an image, audio, or video file.', errorSize: 'This file is larger than the 50 MB limit.', errorUpload: 'Upload failed. Check your connection and Supabase Storage setup, then try again.', errorDelete: 'Could not delete this file. Check permissions and try again.', uploadSuccess: 'Media uploaded successfully.', privateBadge: 'Private', sharedBadge: 'Shared', all: 'All', images: 'Images', audio: 'Audio', video: 'Video', adminNotice: 'Admin sharing is available when your Supabase account has the admin or owner role in app metadata.', open: 'Open', emptyFilter: 'No files in this category yet.', search: 'Search media', downloaded: 'Downloaded', favorites: 'Favorites', favorite: 'Add to favorites', unfavorite: 'Remove from favorites', view: 'View', play: 'Play',
    offlineNote: 'You are offline or the cloud is unreachable. Showing the files saved on this device.', cloudBadge: 'In cloud (needs internet)', offlineBadge: 'Available offline', updateBadge: 'Update available', failedBadge: 'Download failed',
    download: 'Download for offline', downloading: 'Downloading…', cancel: 'Cancel', retry: 'Try again', update: 'Update download', removeDownload: 'Remove download',
    storageTitle: 'Offline storage on this device', storageDeleteAll: 'Delete all downloads', storageDeleteConfirm: 'Delete every downloaded file from this device? Your cloud files are not affected.', unsupported: 'This browser cannot store files for offline use.',
    onlyOwn: 'Only your own files and files shared by the administrator can be downloaded. YouTube videos and web links are online only and cannot be downloaded.', deviceOnlyFav: 'Favorites and playback positions are saved on this device only.',
    dl_no_space: 'Not enough free space on this device.', dl_network: 'The connection dropped. Try again.', dl_expired: 'The download link expired. Try again.', dl_missing: 'This file no longer exists in the cloud.', dl_size_mismatch: 'The file arrived incomplete. Try again.', dl_storage: 'The device could not store this file. Free some space and try again.', dl_too_big: 'This file is larger than 50 MB.', dl_http: 'The download failed. Try again.', dl_url: 'Could not get a download link. Try again.', dl_not_allowed: 'You are not allowed to download this file.', dl_not_cloud: 'Only files in your cloud library can be downloaded.', dl_evicted: 'The device removed this file to free space. Download it again.', dl_unsupported: 'This browser cannot store files for offline use.',
    url_network: 'Some files could not be prepared because the connection failed. Files already downloaded still work.', url_server: 'The storage service is busy. Try again in a moment.', url_auth: 'Your session expired. Sign in again to see these files.', url_missing: 'Some files were not found in storage.', url_unknown: 'Some files could not be prepared.'
  },
  sw: {
    headerTitle: 'Hali Salama', headerSubtitle: 'Sehemu tulivu ya kupata motisha, kufanya mazoezi ya kupumua na kutumia media kukusaidia kujituliza.', motivation: 'Motisha', calm: 'Utulivu na kupumua', reflections: 'Tafakari', library: 'Maktaba ya media', libraryHint: 'Pakia picha, sauti au video zako. Faili zako binafsi zitaonekana kwako tu.', upload: 'Pakia media', titleLabel: 'Jina (si lazima)', shared: 'Shiriki na watumiaji wote', uploadHint: 'Picha, sauti au video zisizozidi MB 50 kila moja.', uploading: 'Inapakia…', loading: 'Inapakia media zako…', empty: 'Bado hakuna media. Pakia picha, sauti au video ili kuanza.', delete: 'Futa', deleteConfirm: 'Ufute faili hili? Kitendo hiki hakiwezi kutenduliwa.', errorLoad: 'Imeshindwa kupakia media. Hakikisha migration ya Safe Mode imetekelezwa kwenye Supabase.', errorType: 'Chagua faili la picha, sauti au video.', errorSize: 'Faili hili limezidi kikomo cha MB 50.', errorUpload: 'Upakiaji umeshindikana. Kagua intaneti na mipangilio ya Supabase Storage, kisha ujaribu tena.', errorDelete: 'Imeshindwa kufuta faili. Kagua ruhusa kisha ujaribu tena.', uploadSuccess: 'Media imepakiwa vizuri.', privateBadge: 'Binafsi', sharedBadge: 'Imeshirikiwa', all: 'Zote', images: 'Picha', audio: 'Sauti', video: 'Video', adminNotice: 'Kushiriki kama admin kunapatikana akaunti yako ya Supabase ikiwa na role ya admin au owner kwenye app metadata.', open: 'Fungua', emptyFilter: 'Hakuna faili katika kundi hili bado.', search: 'Tafuta media', downloaded: 'Zilizopakuliwa', favorites: 'Vipendwa', favorite: 'Weka kwenye vipendwa', unfavorite: 'Ondoa kwenye vipendwa', view: 'Tazama', play: 'Cheza',
    offlineNote: 'Huna mtandao au wingu halifikiki. Inaonyesha faili zilizohifadhiwa kwenye kifaa hiki.', cloudBadge: 'Kwenye wingu (inahitaji intaneti)', offlineBadge: 'Inapatikana bila mtandao', updateBadge: 'Toleo jipya lipo', failedBadge: 'Upakuaji umeshindwa',
    download: 'Pakua kwa matumizi bila mtandao', downloading: 'Inapakua…', cancel: 'Ghairi', retry: 'Jaribu tena', update: 'Sasisha upakuaji', removeDownload: 'Ondoa upakuaji',
    storageTitle: 'Hifadhi ya nje ya mtandao kwenye kifaa hiki', storageDeleteAll: 'Futa upakuaji wote', storageDeleteConfirm: 'Ufute kila faili lililopakuliwa kwenye kifaa hiki? Faili zako za wingu hazitaathirika.', unsupported: 'Kivinjari hiki hakiwezi kuhifadhi faili kwa matumizi bila mtandao.',
    onlyOwn: 'Ni faili zako mwenyewe na zile zilizoshirikiwa na msimamizi pekee ndizo zinaweza kupakuliwa. Video za YouTube na viungo vya wavuti ni vya mtandaoni tu na haviwezi kupakuliwa.', deviceOnlyFav: 'Vipendwa na mahali ulipoishia kucheza vinahifadhiwa kwenye kifaa hiki tu.',
    dl_no_space: 'Hakuna nafasi ya kutosha kwenye kifaa hiki.', dl_network: 'Muunganisho umekatika. Jaribu tena.', dl_expired: 'Kiungo cha upakuaji kimeisha muda. Jaribu tena.', dl_missing: 'Faili hili halipo tena kwenye wingu.', dl_size_mismatch: 'Faili limefika pungufu. Jaribu tena.', dl_storage: 'Kifaa kimeshindwa kuhifadhi faili hili. Futa nafasi kisha ujaribu tena.', dl_too_big: 'Faili hili ni kubwa kuliko MB 50.', dl_http: 'Upakuaji umeshindwa. Jaribu tena.', dl_url: 'Imeshindwa kupata kiungo cha upakuaji. Jaribu tena.', dl_not_allowed: 'Huruhusiwi kupakua faili hili.', dl_not_cloud: 'Ni faili za maktaba yako ya wingu pekee zinazoweza kupakuliwa.', dl_evicted: 'Kifaa kimeondoa faili hili ili kupata nafasi. Likipakue tena.', dl_unsupported: 'Kivinjari hiki hakiwezi kuhifadhi faili kwa matumizi bila mtandao.',
    url_network: 'Baadhi ya faili hazikuweza kutayarishwa kwa sababu mtandao umekatika. Faili ulizopakua zinaendelea kufanya kazi.', url_server: 'Huduma ya hifadhi ina shughuli nyingi. Jaribu tena baada ya muda mfupi.', url_auth: 'Kipindi chako kimeisha. Ingia tena ili uone faili hizi.', url_missing: 'Baadhi ya faili hazikupatikana kwenye hifadhi.', url_unknown: 'Baadhi ya faili hazikuweza kutayarishwa.'
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
  const [cloudOk, setCloudOk] = useState(true)
  const [urlIssue, setUrlIssue] = useState(null)
  const offline = useOfflineMedia(user?.id)
  const { sync: syncOffline } = offline
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('') // `loading` only covers the FIRST load, so reloading when the connection returns never resets the person's search and filters
    try {
      const { data, error: queryError } = await supabase.from('safe_mode_media').select('*').order('created_at', { ascending: false }).limit(CLOUD_LIST_LIMIT)
      if (queryError) throw queryError
      // One batched request signs every file. Errors are checked in all three places supabase-js reports them, transient failures are retried,
      // and anything still failing is shown to the person (urlIssue) instead of silently leaving blank cards.
      const signed = await signUrls(supabase, BUCKET, (data || []).map((i) => i.storage_path), { seconds: 3600 })
      setUrlIssue(signed.failed.length ? { reason: signed.reason, count: signed.failed.length } : null)
      setItems((data || []).map((item) => ({ ...item, signedUrl: signed.urls[item.storage_path] || null })))
      setCloudOk(true)
      syncOffline(data || [], true).catch(() => {}) // flags changed files, drops files deleted in the cloud (only after a complete, successful list)
    } catch {
      setCloudOk(false) // offline or unreachable: the library shows the files stored on this device
    } finally { setLoading(false) }
  }, [syncOffline])
  useEffect(() => { load() }, [load])
  useEffect(() => { window.addEventListener('online', load); return () => window.removeEventListener('online', load) }, [load])

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
    await offline.remove(item.id).catch(() => {})
    setItems((current) => current.filter((entry) => entry.id !== item.id))
  }
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
    {urlIssue && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100"><span>{c[`url_${urlIssue.reason}`] || c.url_unknown} ({urlIssue.count})</span>{urlIssue.reason !== 'auth' && <button type="button" className="btn btn-secondary min-h-[44px]" onClick={load}>{c.retry}</button>}</div>}
    {loading ? <p className="py-8 text-center text-sm text-slate-500">{c.loading}</p> : <MediaLibrary items={items} cloudOk={cloudOk} user={user} isAdmin={isAdmin} offline={offline} c={c} onDelete={remove} onLoadError={load} />}
  </main>
}
