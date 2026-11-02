import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Video, X } from 'lucide-react'
import VoiceRecorder from '../voice/VoiceRecorder'
import VoicePlayer from '../voice/VoicePlayer'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { LIMITS, communityError, mediaKindOf, validatePost } from '../../utils/community'
import { createPost } from '../../services/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

export default function Composer({ userId, groupId = null, onPosted }) {
  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [allowComments, setAllowComments] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [voice, setVoice] = useState(null) // { file, durationMs }: a recorded voice message waiting to be posted
  const [voiceUrl, setVoiceUrl] = useState(null)
  const [recording, setRecording] = useState(false) // recording or previewing: the other controls step aside
  const [percent, setPercent] = useState(0)
  const input = useRef(null)

  useEffect(() => {
    if (!voice) { setVoiceUrl(null); return undefined }
    const url = URL.createObjectURL(voice.file)
    setVoiceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [voice])

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const problem = validatePost({ body: 'x', file: f })
    if (problem) { setError(tr(problem)); return }
    setError(null); setFile(f)
  }

  const submit = async () => {
    const problem = voice && !file ? (body.trim() ? validatePost({ body, file: null }) : null) : validatePost({ body, file })
    if (problem) { setError(tr(problem)); return }
    setBusy(true); setError(null); setPercent(0)
    try {
      const post = await createPost(userId, { body, groupId, file, voice, allowComments, onProgress: (p) => setPercent(p.percent) })
      setBody(''); setFile(null); setVoice(null); setAllowComments(true)
      onPosted?.(post)
    } catch (e) { setError(tr(communityError(e) || friendlyError(e))) }
    finally { setBusy(false) }
  }

  const kind = file ? mediaKindOf(file.type) : null
  return (
    <Card className="mb-4 p-4">
      <label className="sr-only" htmlFor="community-post">{tr('Write a post')}</label>
      <textarea id="community-post" className="input w-full" rows={3} maxLength={LIMITS.post} placeholder={tr('Share something with the community')} value={body} onChange={(e) => setBody(e.target.value)} />
      {preview && (
        <div className="relative mt-2">
          {kind === 'image' ? <img src={preview} alt="" className="max-h-64 w-full rounded-xl object-cover" /> : <video src={preview} controls playsInline preload="metadata" className="max-h-64 w-full rounded-xl bg-black" />}
          <button type="button" className="icon-btn absolute right-2 top-2 bg-black/60 text-white" aria-label={tr('Remove file')} onClick={() => setFile(null)}><X size={18} /></button>
        </div>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" className="hidden" onChange={pick} />
      {voice && voiceUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-2 dark:bg-white/10">
          <VoicePlayer src={voiceUrl} durationMs={voice.durationMs} label={tr('Voice message')} />
          <button type="button" className="icon-btn ml-auto" aria-label={tr('Remove voice message')} disabled={busy} onClick={() => setVoice(null)}><X size={18} /></button>
        </div>
      )}
      {busy && voice && <p role="status" className="mt-1 text-xs text-slate-500">{tr('Uploading voice message…')} {percent > 0 ? `${percent}%` : ''}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!recording && <Button variant="secondary" className="!min-h-[44px]" onClick={() => input.current?.click()} disabled={busy || Boolean(voice)}><ImagePlus size={18} aria-hidden="true" /><Video size={18} aria-hidden="true" />{tr('Photo or video')}</Button>}
        {!file && !voice && !busy && <div className={recording ? 'flex min-w-0 flex-1' : ''}><VoiceRecorder onSend={(v) => setVoice(v)} onActiveChange={setRecording} /></div>}
        {!recording && <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />{tr('Allow comments')}</label>}
        {!recording && <Button className="ml-auto !min-h-[44px]" loading={busy} onClick={submit} disabled={!body.trim() && !file && !voice}>{tr('Post')}</Button>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  )
}
