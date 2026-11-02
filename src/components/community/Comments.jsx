import { useCallback, useEffect, useState } from 'react'
import { Flag, Trash2, X } from 'lucide-react'
import VoiceRecorder from '../voice/VoiceRecorder'
import VoicePlayer from '../voice/VoicePlayer'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { addComment, deleteComment, fetchComments, signCommentMedia } from '../../services/community'
import { LIMITS, communityError, threadComments, timeAgo, validateComment } from '../../utils/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

function CommentRow({ c, me, urls, onReply, onDelete, onReport, nested = false }) {
  return (
    <div className={nested ? 'ml-6 border-l border-slate-200 pl-3 dark:border-white/10' : ''}>
      <p className="text-sm"><span className="font-semibold">{c.author_name}</span> <span className="text-xs text-slate-400">{timeAgo(c.created_at)}</span></p>
      {c.body ? <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p> : null}
      {c.media_kind === 'voice' && (urls[c.media_path]
        ? <div className="mt-1"><VoicePlayer src={urls[c.media_path]} durationMs={c.duration_ms} label={tr('Voice comment')} /></div>
        : <p className="text-xs text-slate-500">{tr('Loading voice message…')}</p>)}
      <div className="flex gap-3">
        {!nested && <button type="button" className="min-h-[36px] text-xs font-medium text-brand-700 dark:text-brand-300" onClick={() => onReply(c)}>{tr('Reply')}</button>}
        {c.user_id === me ? (
          <button type="button" className="flex min-h-[36px] items-center gap-1 text-xs text-red-600 dark:text-red-400" onClick={() => onDelete(c)}><Trash2 size={14} aria-hidden="true" />{tr('Delete')}</button>
        ) : (
          <button type="button" className="flex min-h-[36px] items-center gap-1 text-xs text-slate-500" onClick={() => onReport(c)}><Flag size={14} aria-hidden="true" />{tr('Report')}</button>
        )}
      </div>
    </div>
  )
}

export default function Comments({ post, me, onCountChange, onReport }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [voice, setVoice] = useState(null) // { file, durationMs } waiting to be sent
  const [voiceUrl, setVoiceUrl] = useState(null)
  const [recording, setRecording] = useState(false)
  const [percent, setPercent] = useState(0)
  const [urls, setUrls] = useState({})

  useEffect(() => {
    if (!voice) { setVoiceUrl(null); return undefined }
    const url = URL.createObjectURL(voice.file)
    setVoiceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [voice])

  // Voice comments are in a private bucket: sign their links (with the shared retry handling) whenever new ones appear.
  useEffect(() => {
    const need = (list || []).filter((c) => c.media_path && !urls[c.media_path]).map((c) => c.media_path)
    if (!need.length) return
    signCommentMedia(need).then((r) => setUrls((u) => ({ ...u, ...r.urls }))).catch(() => {})
  }, [list, urls])

  const load = useCallback(async () => {
    try { setList(await fetchComments(post.id)); setError(null) } catch (e) { setError(tr(friendlyError(e))) }
  }, [post.id])
  useEffect(() => { load() }, [load])

  const send = async () => {
    const problem = validateComment(text, { voice: Boolean(voice) })
    if (problem) { setError(tr(problem)); return }
    setBusy(true); setError(null); setPercent(0)
    try {
      await addComment({ postId: post.id, parentId: replyTo?.id || null, body: text, userId: me, voice, onProgress: (p) => setPercent(p.percent) })
      setText(''); setVoice(null); setReplyTo(null); await load(); onCountChange?.(1)
    } catch (e) { setError(tr(communityError(e) || friendlyError(e))) } finally { setBusy(false) }
  }
  const remove = async (c) => { try { await deleteComment(c); await load(); onCountChange?.(-1) } catch (e) { setError(tr(friendlyError(e))) } }

  const threads = threadComments(list || [])
  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-white/10">
      {list === null && !error ? <Spinner /> : threads.length === 0 ? <p className="text-sm text-slate-500">{tr('No comments yet.')}</p> : threads.map((c) => (
        <div key={c.id} className="space-y-2">
          <CommentRow c={c} me={me} urls={urls} onReply={setReplyTo} onDelete={remove} onReport={(x) => onReport({ commentId: x.id })} />
          {c.replies.map((r) => <CommentRow key={r.id} c={r} me={me} urls={urls} nested onReply={setReplyTo} onDelete={remove} onReport={(x) => onReport({ commentId: x.id })} />)}
        </div>
      ))}
      {post.allow_comments ? (
        <div>
          {replyTo && <p className="mb-1 text-xs text-slate-500">{tr('Replying to {name}', { name: replyTo.author_name })} <button type="button" className="underline" onClick={() => setReplyTo(null)}>{tr('Cancel')}</button></p>}
          <label className="sr-only" htmlFor={`c-${post.id}`}>{tr('Write a comment')}</label>
          {!recording && <textarea id={`c-${post.id}`} className="input w-full" rows={2} maxLength={LIMITS.comment} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Write a comment')} />}
          {voice && voiceUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-2 dark:bg-white/10">
              <VoicePlayer src={voiceUrl} durationMs={voice.durationMs} label={tr('Voice comment')} />
              <button type="button" className="icon-btn ml-auto" aria-label={tr('Remove voice message')} disabled={busy} onClick={() => setVoice(null)}><X size={18} /></button>
            </div>
          )}
          {busy && voice && <p role="status" className="mt-1 text-xs text-slate-500">{tr('Uploading voice message…')} {percent > 0 ? `${percent}%` : ''}</p>}
          <div className="mt-2 flex items-center gap-2">
            {!voice && !busy && <div className={recording ? 'flex min-w-0 flex-1' : ''}><VoiceRecorder onSend={(v) => setVoice(v)} onActiveChange={setRecording} /></div>}
            {!recording && <Button className="!min-h-[44px]" loading={busy} disabled={!text.trim() && !voice} onClick={send}>{tr('Send')}</Button>}
          </div>
        </div>
      ) : <p className="text-sm text-slate-500">{tr('Comments are closed on this post.')}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
