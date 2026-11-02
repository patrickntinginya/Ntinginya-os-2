import { useMemo, useState } from 'react'
import { Heart, Plus, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { t } from '../../i18n'
import { addItem, isDirectVideo, removeItem, toggleFavorite, youTubeId } from '../../lib/media'
import YouTubePlayer from '../media/YouTubePlayer'
import DirectVideo from '../media/DirectVideo'
import { pick } from '../../lib/motivationContent'
import { uuidv4 } from '../../lib/uuid'

const RATES = [0.75, 1, 1.25, 1.5]

// Safe Mode never sends the person away: YouTube plays in the embedded player, video files play in the page, and any other link is
// explained (it cannot be played here) with a copy button instead of an automatic jump to another site.
function Video({ item }) {
  const id = item.youtubeId || youTubeId(item.url)
  const [copied, setCopied] = useState(false)
  if (id) return <YouTubePlayer videoId={id} title={item.title} />
  if (isDirectVideo(item.url)) return <DirectVideo id={item.id} title={item.title} url={item.url} />
  const copy = async () => { try { await navigator.clipboard.writeText(item.url); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) } }
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-white/15">
      <p>{t('media.noEmbed')}</p>
      <Button variant="secondary" className="mt-2 !min-h-[44px]" onClick={copy}>{copied ? t('media.copied') : t('media.copyLink')}</Button>
    </div>
  )
}

function Audio({ item }) {
  const [rate, setRate] = useState(1)
  const [failed, setFailed] = useState(false)
  return (
    <div>
      {/* preload="none": nothing is downloaded until the user presses play */}
      <audio controls preload="none" src={item.url} className="w-full" ref={(el) => { if (el) el.playbackRate = rate }} onError={() => setFailed(true)} />
      {failed && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{t('media.audioFailed')}</p>}
      <div className="mt-2 flex items-center gap-2" role="group" aria-label={t('media.speed')}>
        {RATES.map((r) => <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)} className={`min-h-[44px] rounded-full px-3 text-sm ${rate === r ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-white/10'}`}>{r}x</button>)}
      </div>
    </div>
  )
}

function Image({ item }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className="text-sm text-slate-500 dark:text-slate-400">{t('media.imageFailed')}</p>
  return <img src={item.url} alt={item.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-80 w-full rounded-xl object-contain" />
}

const VIEW = { video: Video, audio: Audio, image: Image }

/** One tab for videos, audio or images. Items = curated catalogue (may be empty) + links the user added on this device. */
export default function MediaTab({ kind, curated, state, setState, userId, quotes }) {
  const [form, setForm] = useState({ title: '', url: '' })
  const [error, setError] = useState(null)
  const View = VIEW[kind]
  const lang = document.documentElement.lang === 'en' ? 'en' : 'sw'
  const catalogue = useMemo(() => curated.map((c) => ({ id: c.id, kind, title: pick(c.title, lang), url: c.url, curated: true })), [curated, kind, lang])
  const mine = state.items.filter((i) => i.kind === kind)
  const all = [...catalogue, ...mine]

  const add = (e) => {
    e.preventDefault()
    const r = addItem(state, { kind, title: form.title, url: form.url }, uuidv4())
    if (!r.ok) return setError(t(r.error))
    setError(null)
    setState(r.state)
    setForm({ title: '', url: '' })
  }

  return (
    <div className="space-y-4">
      {quotes}
      {all.length === 0 && !quotes && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">{t(`media.empty.${kind}`)}</p>}
      <ul className="space-y-3">
        {all.map((item) => (
          <li key={item.id}>
            <Card className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-medium">{item.title}</h3>
                <div className="flex shrink-0">
                  <button type="button" className="icon-btn" aria-pressed={state.favorites.includes(item.id)} aria-label={t('mot.favorite')} onClick={() => setState(toggleFavorite(state, item.id))}>
                    <Heart size={20} className={state.favorites.includes(item.id) ? 'fill-red-500 text-red-500' : ''} />
                  </button>
                  {!item.curated && <button type="button" className="icon-btn" aria-label={t('media.remove')} onClick={() => setState(removeItem(state, item.id))}><Trash2 size={18} /></button>}
                </div>
              </div>
              <View item={item} />
            </Card>
          </li>
        ))}
      </ul>
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">{t('media.addTitle')}</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t(`media.hint.${kind}`)} {t('media.deviceOnly')}</p>
        <form onSubmit={add} className="space-y-3">
          <div><label htmlFor={`m-title-${kind}`} className="label">{t('media.name')}</label><input id={`m-title-${kind}`} className="input" maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><label htmlFor={`m-url-${kind}`} className="label">{t('media.link')}</label><input id={`m-url-${kind}`} className="input" type="url" inputMode="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" className="w-full"><Plus size={18} aria-hidden="true" />{t('media.add')}</Button>
        </form>
      </Card>
    </div>
  )
}
