import { useRef, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import Button from '../ui/Button'
import VoiceRecorder from '../voice/VoiceRecorder'
import { CHAT, CHAT_MIME, validateChatMessage } from '../../utils/chat'
import { tr } from '../../i18n'

/** Type a message, attach a file, reply to or edit one. Enter sends on a computer; on a phone Enter adds a new line and the Send button sends. */
export default function ChatComposer({ onSend, onTyping, replyTo, onCancelReply, editing, onCancelEdit, onSaveEdit, disabledReason }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false) // recording or previewing: the normal controls step aside
  const input = useRef(null)
  const [initialEdit, setInitialEdit] = useState(null)
  if (editing && initialEdit !== editing.id) { setInitialEdit(editing.id); setText(editing.body || '') }
  if (!editing && initialEdit) setInitialEdit(null)

  const submit = async () => {
    if (busy) return
    if (editing) {
      const problem = validateChatMessage({ body: text }); if (problem) { setError(problem); return }
      setBusy(true); setError(null)
      try { await onSaveEdit(editing, text); setText('') } catch (e) { setError(e.userMessage || 'Could not save the change.') } finally { setBusy(false) }
      return
    }
    const problem = validateChatMessage({ body: text, file }); if (problem) { setError(problem); return }
    setError(null)
    const args = { body: text, file, replyTo: replyTo ? replyTo.id : null }
    setText(''); setFile(null); if (input.current) input.current.value = ''; if (onCancelReply) onCancelReply(); if (onTyping) onTyping('')
    const r = await onSend(args)
    if (r && !r.ok && r.error) setError(r.error)
  }
  const showMic = !editing && !text.trim() && !file
  const sendVoice = async ({ file: voice, durationMs }) => {
    setError(null)
    const r = await onSend({ body: '', file: voice, kind: 'voice', durationMs, replyTo: replyTo ? replyTo.id : null })
    if (onCancelReply) onCancelReply()
    if (r && !r.ok && r.error) setError(r.error)
  }
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); submit() } }

  if (disabledReason) return <p role="status" className="border-t border-slate-200 p-3 text-center text-sm text-slate-500 dark:border-white/10">{tr(disabledReason)}</p>
  return (
    <div className="border-t border-slate-200 p-2 dark:border-white/10">
      {replyTo && <p className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-1 text-xs dark:bg-white/10"><span className="truncate">{tr('Replying to')}: {replyTo.body || replyTo.media_name || tr('Attachment')}</span><button type="button" aria-label={tr('Cancel reply')} onClick={onCancelReply} className="p-2"><X size={14} /></button></p>}
      {editing && <p className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 py-1 text-xs text-amber-900"><span>{tr('Editing message')}</span><button type="button" aria-label={tr('Cancel')} onClick={() => { onCancelEdit(); setText('') }} className="p-2"><X size={14} /></button></p>}
      {file && <p className="mb-1 flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-1 text-xs dark:bg-white/10"><span className="truncate">{file.name}</span><button type="button" aria-label={tr('Remove attachment')} onClick={() => { setFile(null); if (input.current) input.current.value = '' }} className="p-2"><X size={14} /></button></p>}
      {error && <p role="alert" className="mb-1 text-xs text-red-600 dark:text-red-400">{tr(error)}</p>}
      <div className="flex items-end gap-2">
        {!editing && <>
          <input ref={input} type="file" className="hidden" accept={CHAT_MIME.join(',')} onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null) }} />
          <button type="button" className={`icon-btn ${voiceActive ? 'hidden' : ''}`} aria-label={tr('Attach a file')} onClick={() => input.current && input.current.click()}><Paperclip size={20} /></button>
        </>}
        <textarea className={`input max-h-32 min-h-[44px] flex-1 resize-none ${voiceActive ? 'hidden' : ''}`} rows={1} maxLength={CHAT.body} aria-label={tr('Message')} placeholder={tr('Write a message')} value={text}
          onChange={(e) => { setText(e.target.value); if (onTyping && !editing) onTyping(e.target.value) }} onKeyDown={onKey} />
        {!editing && <div className={voiceActive ? 'flex min-w-0 flex-1' : showMic ? '' : 'hidden'}><VoiceRecorder onSend={sendVoice} onActiveChange={setVoiceActive} /></div>}
        <Button className={`min-h-[44px] ${voiceActive || showMic ? 'hidden' : ''}`} loading={busy} onClick={submit} aria-label={editing ? tr('Save') : tr('Send')}><Send size={18} aria-hidden="true" /></Button>
      </div>
    </div>
  )
}
