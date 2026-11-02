import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Info, Search, WifiOff, X } from 'lucide-react'
import Avatar from '../community/Avatar'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import ConfirmDialog from '../ui/ConfirmDialog'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import MessageBubble from './MessageBubble'
import ChatComposer from './ChatComposer'
import ConversationInfo from './ConversationInfo'
import { useConversation } from '../../hooks/useConversation'
import { useVoiceSaved } from '../../hooks/useVoiceSaved'
import { chat } from '../../services/chatApi'
import { blockUser } from '../../services/community'
import { CHAT_REPORT_REASONS, chatError, sameDay } from '../../utils/chat'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

function ReportMessage({ message, onClose }) {
  const [reason, setReason] = useState('spam'); const [details, setDetails] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const [sent, setSent] = useState(false)
  const go = async () => { setBusy(true); setError(null); try { await chat.report(message.id, reason, details.trim() || null); setSent(true) } catch (e) { setError(tr(chatError(e) || friendlyError(e))) } finally { setBusy(false) } }
  return (
    <Modal title="Report message" onClose={onClose}>
      {sent ? <div><p>{tr('Thank you. A moderator will review this message. Only the reported message is shared with moderators.')}</p><Button className="mt-4 w-full" onClick={onClose}>{tr('Close')}</Button></div> : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">{tr('Reason')}<select className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)}>{CHAT_REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{tr(r.label)}</option>)}</select></label>
          <label className="block text-sm font-medium">{tr('Details (optional)')}<textarea className="input mt-1 w-full" maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button className="w-full" loading={busy} onClick={go}>{tr('Send report')}</Button>
        </div>
      )}
    </Modal>
  )
}

function dayLabel(iso) { const d = new Date(iso); const today = new Date(); const y = new Date(Date.now() - 86400000); return d.toDateString() === today.toDateString() ? tr('Today') : d.toDateString() === y.toDateString() ? tr('Yesterday') : d.toLocaleDateString() }

/** A whole conversation: live messages, delivery ticks, typing, online / last seen, attachments, search, edit/delete, report/block, group info. */
export default function ConversationView({ id, me, onBack, inboxRow }) {
  const c = useConversation(id, me)
  const [info, setInfo] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [toReport, setToReport] = useState(null)
  const [toBlock, setToBlock] = useState(null)
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [actionError, setActionError] = useState(null)
  const bottom = useRef(null)
  const scroller = useRef(null)
  const stick = useRef(true)

  const other = c.otherId
  const name = c.conv ? (c.conv.kind === 'group' ? c.conv.title : c.profiles[other]?.display_name || tr('Member')) : ''
  const voice = useVoiceSaved(me, { messages: c.messages, conversationId: id, conversationTitle: name, nameOf: (uid) => c.profiles[uid]?.display_name || '' })
  const lostAccess = Boolean(c.error && c.error.message === 'not_found')
  const { purgeConversation } = voice
  useEffect(() => { if (lostAccess) purgeConversation().catch(() => {}) }, [lostAccess, purgeConversation]) // the conversation is no longer visible to me: my saved copies go too
  const byId = useMemo(() => new Map(c.messages.map((m) => [m.id, m])), [c.messages])
  const blocked = c.conv && c.conv.kind === 'direct' && c.members.length < 2

  useEffect(() => { if (stick.current && bottom.current) bottom.current.scrollIntoView({ block: 'end' }) }, [c.messages.length, c.typingNames.length])
  useEffect(() => { const id2 = setTimeout(async () => { if (!q.trim()) { setResults(null); return } try { setResults(await chat.search(q, id)) } catch { setResults([]) } }, 350); return () => clearTimeout(id2) }, [q, id])

  if (c.loading) return <Spinner />
  if (c.error || !c.conv) return <ErrorState message={tr('This conversation is not available.')} onRetry={onBack} />

  const status = c.typingNames.length ? (c.typingNames.length === 1 ? tr('{name} is typing…', { name: c.typingNames[0] }) : tr('Several people are typing…'))
    : c.conv.kind === 'group' ? tr('{n} members', { n: c.members.length })
      : c.online.includes(other) ? tr('Online')
        : (() => { const s = c.lastSeenInfo(c.lastSeen); return s.key === 'online' ? tr('Online') : s.key === 'minutes' ? tr('Last seen {n} min ago', { n: s.n }) : s.key === 'hours' ? tr('Last seen {n} h ago', { n: s.n }) : s.key === 'days' ? tr('Last seen {n} d ago', { n: s.n }) : s.key === 'long' ? tr('Last seen a while ago') : '' })()
  const nameOf = (uid) => c.profiles[uid]?.display_name || tr('Member')
  const doBlock = async () => { try { await blockUser(toBlock.sender_id, nameOf(toBlock.sender_id)); setToBlock(null); onBack() } catch (e) { setActionError(tr(chatError(e) || friendlyError(e))); setToBlock(null) } }
  const disabledReason = c.conv.status === 'locked' ? 'This conversation has been locked by a moderator.' : blocked ? 'This person is no longer in the conversation.' : null

  let lastDay = null
  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-900/40 md:h-[calc(100dvh-9rem)]">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-surface-dark">
        <button type="button" className="icon-btn" aria-label={tr('Back to chats')} onClick={onBack}><ArrowLeft size={20} /></button>
        <Avatar name={name} size={36} />
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{name}</p><p className="truncate text-xs text-slate-500" aria-live="polite">{status}</p></div>
        <button type="button" className="icon-btn" aria-label={tr('Search in this chat')} onClick={() => { setSearching((v) => !v); setQ('') }}><Search size={20} /></button>
        <button type="button" className="icon-btn" aria-label={tr('Chat info')} onClick={() => setInfo(true)}><Info size={20} /></button>
      </header>
      {c.live === 'offline' && <p role="status" className="flex items-center gap-2 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100"><WifiOff size={14} aria-hidden="true" />{tr('Reconnecting… new messages will appear when the connection returns.')}</p>}
      {c.urlIssue && <p role="alert" className="bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{tr('Some attachments could not be prepared. Try again in a moment.')}</p>}
      {searching && <div className="border-b border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-surface-dark"><div className="flex items-center gap-2"><input type="search" autoFocus className="input flex-1" maxLength={60} aria-label={tr('Search messages')} placeholder={tr('Search messages')} value={q} onChange={(e) => setQ(e.target.value)} /><button type="button" className="icon-btn" aria-label={tr('Close search')} onClick={() => { setSearching(false); setQ('') }}><X size={18} /></button></div>
        {results && <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">{results.length === 0 ? <li className="p-2 text-slate-500">{tr('No messages found.')}</li> : results.map((r) => <li key={r.id} className="rounded-lg bg-slate-100 p-2 dark:bg-white/10"><p className="text-xs text-slate-500">{nameOf(r.sender_id)} · {new Date(r.created_at).toLocaleString()}</p><p className="break-words">{r.body}</p></li>)}</ul>}</div>}

      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto p-3" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}>
        {c.hasMore && <div className="text-center"><Button variant="secondary" loading={c.loadingOlder} onClick={c.loadOlder}>{tr('Load earlier messages')}</Button></div>}
        {c.messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">{tr('No messages yet. Say hello!')}</p>}
        {c.messages.map((m) => {
          const sep = !lastDay || !sameDay(lastDay, m.created_at); lastDay = m.created_at
          const rep = m.reply_to ? byId.get(m.reply_to) : null
          const withReply = rep ? { ...m, reply_preview: rep.deleted_at ? tr('Message deleted') : (rep.body || rep.media_name || tr('Attachment')).slice(0, 80) } : m
          return (
            <div key={m.id}>
              {sep && <p className="my-2 text-center text-xs text-slate-500">{dayLabel(m.created_at)}</p>}
              <MessageBubble m={withReply} me={me} senderName={nameOf(m.sender_id)} showName={c.conv.kind === 'group'} members={c.members} urls={c.urls} voiceOffline={voice.supported ? voice : null}
                onReply={setReplyTo} onEdit={(x) => { setReplyTo(null); setEditing(x) }} onDelete={setToDelete} onReport={setToReport} onBlock={setToBlock}
                onRetry={c.retry} onDiscard={c.discard} onBroken={c.resign} />
            </div>
          )
        })}
        <div ref={bottom} />
      </div>
      {actionError && <p role="alert" className="px-3 pb-1 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
      <ChatComposer onSend={(args) => c.send(args)} onTyping={c.typing} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} editing={editing} onCancelEdit={() => setEditing(null)} disabledReason={disabledReason}
        onSaveEdit={async (m, body) => { try { await c.edit(m.id, body); setEditing(null) } catch (e) { const err = new Error('edit'); err.userMessage = chatError(e) || friendlyError(e); throw err } }} />

      {info && <ConversationInfo conv={c.conv} members={c.members} profiles={c.profiles} me={me} muted={inboxRow?.muted} onClose={() => setInfo(false)} onChanged={c.reloadMembers} onLeft={() => { setInfo(false); voice.purgeConversation().catch(() => {}); onBack() }} />}
      {toDelete && <ConfirmDialog title="Delete this message?" message="It will be removed for everyone in this chat." confirmLabel="Delete" onClose={() => setToDelete(null)} onConfirm={async () => { try { await c.remove(toDelete.id) } catch (e) { setActionError(tr(chatError(e) || friendlyError(e))) } setToDelete(null) }} />}
      {toBlock && <ConfirmDialog title="Block this person?" message="You will no longer see their messages, posts or comments, and they cannot message you. You can unblock them from your Community profile." confirmLabel="Block" onClose={() => setToBlock(null)} onConfirm={doBlock} />}
      {toReport && <ReportMessage message={toReport} onClose={() => setToReport(null)} />}
    </div>
  )
}
