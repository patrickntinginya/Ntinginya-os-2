import { useState } from 'react'
import { AlertCircle, Check, CheckCheck, Clock, FileText, MoreVertical } from 'lucide-react'
import { messageStatus, canEdit } from '../../utils/chat'
import { timeAgo } from '../../utils/community'
import VoicePlayer from '../voice/VoicePlayer'
import { tr } from '../../i18n'

function Ticks({ info }) {
  const label = { sending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[info.status]
  const cls = info.status === 'read' ? 'text-sky-500' : info.status === 'failed' ? 'text-red-500' : 'text-slate-400'
  const Icon = info.status === 'sending' ? Clock : info.status === 'failed' ? AlertCircle : info.status === 'sent' ? Check : CheckCheck
  return <span className={`inline-flex items-center gap-1 ${cls}`} title={tr(label)}><Icon size={14} aria-hidden="true" /><span className="sr-only">{tr(label)}</span>{info.total > 1 && info.status !== 'sent' && info.status !== 'sending' ? <span className="text-[10px]">{info.readBy}/{info.total}</span> : null}</span>
}

function VoiceNote({ m, url, onBroken, mine, offline }) {
  const saved = offline && offline.isSaved(m.id)
  const busy = offline && offline.busy(m.id)
  if (m._pending) return <div className="w-64 max-w-full text-xs" role="status"><p>{tr('Sending voice message…')} {m._progress > 0 ? `${m._progress}%` : ''}</p><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m._progress || 0}><div className="h-full bg-current transition-all" style={{ width: `${m._progress || 0}%` }} /></div></div>
  return (
    <div>
      <VoicePlayer src={offline && offline.localUrl(m.id) || url} durationMs={m.duration_ms} onBroken={onBroken} light={mine} label={tr('Voice message')} />
      {offline && url && <button type="button" disabled={busy} onClick={() => (saved ? offline.remove(m) : offline.save(m))} className="mt-1 inline-flex min-h-[36px] items-center gap-1 text-[11px] underline disabled:opacity-60">{busy ? tr('Saving…') : saved ? tr('Saved on this device · Remove') : tr('Save for offline listening')}</button>}
      {offline && offline.error(m.id) && <p role="alert" className="text-[11px] text-red-300 dark:text-red-400">{tr(offline.error(m.id))}</p>}
    </div>
  )
}

function Attachment({ m, url, onBroken }) {
  if (!url) return <p className="text-xs italic opacity-80">{m._pending ? tr('Uploading…') : tr('Attachment unavailable. Try again later.')}</p>
  if (m.kind === 'image') return <img src={url} alt={m.media_name || tr('Photo')} loading="lazy" onError={onBroken} className="max-h-72 w-full rounded-lg object-contain" />
  if (m.kind === 'video') return <video src={url} controls preload="metadata" playsInline onError={onBroken} className="max-h-72 w-full rounded-lg" />
  return <a href={url} download={m.media_name || 'file'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 underline"><FileText size={18} aria-hidden="true" /><span className="break-all">{m.media_name || tr('File')}</span></a>
}

/** One message. Own messages sit right with delivery ticks; deleted ones become a quiet note. The menu offers only what the person may do. */
export default function MessageBubble({ m, me, senderName, showName, members, urls, voiceOffline, onEdit, onDelete, onReport, onBlock, onRetry, onDiscard, onBroken, onReply }) {
  const [menu, setMenu] = useState(false)
  const mine = m.sender_id === me
  if (m.deleted_at) return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><p className="rounded-2xl border border-dashed border-slate-300 px-3 py-1.5 text-xs italic text-slate-500 dark:border-white/20">{tr('Message deleted')}</p></div>
  const info = mine ? messageStatus(m, me, members) : null
  const bubble = mine ? 'bg-brand-600 text-white' : 'bg-white text-slate-900 dark:bg-white/10 dark:text-slate-100'
  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${bubble}`}>
        {!mine && showName && <p className="mb-0.5 text-xs font-semibold opacity-80">{senderName}</p>}
        {m.reply_preview && <p className="mb-1 border-l-2 border-current pl-2 text-xs opacity-80">{m.reply_preview}</p>}
        {m.kind === 'voice' ? <VoiceNote m={m} mine={mine} url={m.media_path ? urls[m.media_path] : null} onBroken={() => m.media_path && onBroken(m.media_path)} offline={voiceOffline} />
          : m.media_path || (m._pending && m.media_name) ? <Attachment m={m} url={m.media_path ? urls[m.media_path] : null} onBroken={() => m.media_path && onBroken(m.media_path)} /> : null}
        {m.body && <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>}
        <div className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${mine ? 'text-white/80' : 'text-slate-500'}`}>
          {m.edited_at && <span>{tr('edited')}</span>}
          <span>{timeAgo(m.created_at) === 'now' ? tr('now') : timeAgo(m.created_at)}</span>
          {info && <Ticks info={info} />}
          {!m._pending && !m._failed && <button type="button" className="rounded p-1 hover:bg-black/10" aria-label={tr('Message options')} aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreVertical size={14} aria-hidden="true" /></button>}
        </div>
        {m._failed && <p role="alert" className="mt-1 text-xs text-red-100 dark:text-red-300">{m._error ? tr(m._error) : tr('Could not send.')} <button type="button" className="underline" onClick={() => onRetry(m)}>{tr('Try again')}</button> · <button type="button" className="underline" onClick={() => onDiscard(m)}>{tr('Discard')}</button></p>}
        {menu && (
          <div role="menu" className="absolute right-2 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-900 shadow-lg dark:border-white/15 dark:bg-surface-dark dark:text-slate-100">
            <button role="menuitem" type="button" className="block min-h-[44px] w-full px-3 text-left hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => { setMenu(false); onReply(m) }}>{tr('Reply')}</button>
            {canEdit(m, me) && <button role="menuitem" type="button" className="block min-h-[44px] w-full px-3 text-left hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => { setMenu(false); onEdit(m) }}>{tr('Edit')}</button>}
            {mine && <button role="menuitem" type="button" className="block min-h-[44px] w-full px-3 text-left text-red-600 hover:bg-slate-100 dark:text-red-400 dark:hover:bg-white/10" onClick={() => { setMenu(false); onDelete(m) }}>{tr('Delete')}</button>}
            {!mine && <button role="menuitem" type="button" className="block min-h-[44px] w-full px-3 text-left hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => { setMenu(false); onReport(m) }}>{tr('Report')}</button>}
            {!mine && <button role="menuitem" type="button" className="block min-h-[44px] w-full px-3 text-left text-red-600 hover:bg-slate-100 dark:text-red-400 dark:hover:bg-white/10" onClick={() => { setMenu(false); onBlock(m) }}>{tr('Block this person')}</button>}
          </div>
        )}
      </div>
    </div>
  )
}
