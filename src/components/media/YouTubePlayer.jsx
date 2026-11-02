import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw, WifiOff } from 'lucide-react'
import Button from '../ui/Button'
import { t } from '../../i18n'
import { createYouTubeSession } from '../../lib/youtubeSession'
import { youTubeWatchUrl } from '../../lib/media'

const MESSAGE = {
  offline: 'media.yt.offline', blocked: 'media.yt.scriptBlocked', timeout: 'media.yt.timeout',
  embed_blocked: 'media.yt.embedBlocked', unavailable: 'media.yt.unavailable', invalid: 'media.yt.invalid', html5: 'media.yt.problem', unknown: 'media.yt.problem',
}

/**
 * Plays a YouTube video INSIDE the page with YouTube's own embedded player and controls. There is no link to youtube.com and nothing
 * here navigates: when a video cannot be embedded the reason is explained in place, and the person can copy the link to use elsewhere.
 * Remembers the position on this device so "continue where you left off" works.
 */
export default function YouTubePlayer({ videoId, title }) {
  const box = useRef(null)
  const [view, setView] = useState({ status: 'loading', retry: false })
  const [run, setRun] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const container = box.current
    if (!container) return undefined
    // YT.Player replaces the element it is given, so it gets its own child that React never touches.
    const mount = document.createElement('div')
    container.appendChild(mount)
    const session = createYouTubeSession({
      videoId, mount, storage: window.localStorage, origin: window.location.origin, onChange: setView,
    })
    session.start()
    return () => { session.destroy(); container.textContent = '' }
  }, [videoId, run])

  const failed = MESSAGE[view.status]
  const link = youTubeWatchUrl(videoId)
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }, [link])

  return (
    <div>
      {/* The player stays mounted while loading/playing; a failure replaces it with an explanation in the same box. */}
      <div ref={box} title={title} className={failed ? 'hidden' : 'aspect-video w-full overflow-hidden rounded-xl bg-black [&>iframe]:h-full [&>iframe]:w-full'} />
      {view.status === 'loading' && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400" role="status">{t('media.yt.loading')}</p>}
      {failed && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-medium">{view.status === 'offline' && <WifiOff size={18} aria-hidden="true" className="mt-0.5 shrink-0" />}<span>{t(failed)}</span></p>
          <p className="mt-1">{t('media.yt.stay')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.retry && <Button variant="secondary" className="!min-h-[44px]" onClick={() => setRun((n) => n + 1)}><RefreshCw size={16} aria-hidden="true" />{t('media.retry')}</Button>}
            <Button variant="secondary" className="!min-h-[44px]" onClick={copy}><Copy size={16} aria-hidden="true" />{copied ? t('media.copied') : t('media.copyLink')}</Button>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('media.badge.online')}</p>
    </div>
  )
}
