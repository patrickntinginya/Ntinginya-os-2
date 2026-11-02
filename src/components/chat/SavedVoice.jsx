import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import VoicePlayer from '../voice/VoicePlayer'
import { useOfflineMedia } from '../../hooks/useOfflineMedia'
import { VOICE_OFFLINE } from '../../hooks/useVoiceSaved'
import { formatBytes } from '../../lib/bytes'
import { tr } from '../../i18n'

function Item({ meta, offline }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(false)
  const open = async () => { setErr(false); const p = await offline.playable(meta.id); if (!p) { setErr(true); await offline.remove(meta.id); return } setUrl(URL.createObjectURL(p.blob)) }
  const when = meta.created_at ? new Date(meta.created_at).toLocaleDateString() : ''
  return (
    <li className="space-y-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm"><span className="font-medium">{meta.title}</span>{meta.extra && meta.extra.conversation_title ? <span className="text-slate-500"> · {meta.extra.conversation_title}</span> : null}<span className="block text-xs text-slate-500">{when} · {formatBytes(meta.size_bytes)}</span></p>
        <button type="button" className="icon-btn shrink-0" aria-label={tr('Remove saved voice message')} onClick={() => offline.remove(meta.id)}><Trash2 size={18} /></button>
      </div>
      {url ? <VoicePlayer src={url} durationMs={meta.extra && meta.extra.duration_ms} label={meta.title} /> : <button type="button" onClick={open} className="btn btn-secondary min-h-[44px]">{tr('Play')}</button>}
      {err && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{tr('The device removed this file to free space.')}</p>}
    </li>
  )
}

/** Voice messages saved on this device. Works with no internet: it reads only the device's own storage. */
export default function SavedVoice({ me }) {
  const offline = useOfflineMedia(me, VOICE_OFFLINE)
  const list = Object.values(offline.metas).filter((m) => m.status === 'downloaded').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  if (!offline.supported || list.length === 0) return null
  const clear = async () => { if (window.confirm(tr('Delete all saved voice messages from this device? Nothing is deleted from your chats.'))) await offline.removeAll() }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-surface-dark" aria-label={tr('Saved voice messages')}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3"><h3 className="font-semibold">{tr('Saved voice messages')}</h3><button type="button" onClick={clear} className="min-h-[40px] text-sm text-red-600 dark:text-red-400">{tr('Delete all')}</button></div>
      <p className="px-3 pb-1 text-xs text-slate-500">{tr('These play without internet. They stay on this device until you remove them, leave the chat, or the message is deleted.')}</p>
      <ul className="divide-y divide-slate-200 dark:divide-white/10">{list.map((m) => <Item key={m.id} meta={m} offline={offline} />)}</ul>
    </section>
  )
}
