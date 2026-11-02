import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { readResume, writeResume } from '../../lib/resume'

/** A video file (mp4/webm...) that plays in a normal <video> element inside the app. preload="none": nothing is fetched until play. */
export default function DirectVideo({ id, title, url }) {
  const ref = useRef(null)
  const [failed, setFailed] = useState(false)
  const save = () => { const v = ref.current; if (v) writeResume(window.localStorage, 'video', id, v.currentTime, v.duration) }
  return (
    <div>
      <video ref={ref} controls playsInline preload="none" src={url} title={title} className="aspect-video w-full rounded-xl bg-black"
        onLoadedMetadata={() => { const s = readResume(window.localStorage, 'video', id); if (s && ref.current && s < ref.current.duration) ref.current.currentTime = s }}
        onPause={save} onEnded={save} onError={() => setFailed(true)} />
      {failed && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{t('media.videoFailed')}</p>}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('media.badge.online')}</p>
    </div>
  )
}
