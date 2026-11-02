import { useState } from 'react'
import { MessageSquarePlus, Settings, UsersRound } from 'lucide-react'
import Avatar from '../community/Avatar'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import Button from '../ui/Button'
import NewChatDialog from './NewChatDialog'
import SavedVoice from './SavedVoice'
import ChatPrivacy from './ChatPrivacy'
import { timeAgo } from '../../utils/community'
import { tr } from '../../i18n'

const preview = (r) => (r.last_kind == null ? '' : r.last_preview == null ? tr('Message deleted') : r.last_preview || ({ image: tr('Photo'), video: tr('Video'), voice: tr('Voice message'), file: tr('File') }[r.last_kind] || ''))

/** The list of my conversations with unread counts. Opening one is handled by the parent (it owns the ?chat= link). */
export default function ChatPanel({ me, inbox, onOpen }) {
  const { rows, profiles, loading, error, refresh } = inbox
  const [dialog, setDialog] = useState(null) // 'new' | 'group' | 'privacy'
  if (loading) return <Spinner />
  if (error) return <div className="space-y-3"><ErrorState message={tr('Could not load your chats.')} onRetry={refresh} /><SavedVoice me={me} /></div>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog('new')}><MessageSquarePlus size={18} aria-hidden="true" />{tr('New chat')}</Button>
        <Button variant="secondary" onClick={() => setDialog('group')}><UsersRound size={18} aria-hidden="true" />{tr('New group')}</Button>
        <Button variant="ghost" onClick={() => setDialog('privacy')} aria-label={tr('Chat privacy')}><Settings size={18} aria-hidden="true" /></Button>
      </div>
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/20">{tr('No chats yet. Start one with a member or create a group.')}</p> : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-surface-dark">
          {rows.map((r) => {
            const name = r.kind === 'group' ? r.title : profiles[r.other_user]?.display_name || tr('Member')
            return (
              <li key={r.conversation_id}>
                <button type="button" onClick={() => onOpen(r.conversation_id)} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5">
                  <Avatar name={name} size={44} />
                  <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className={`truncate ${r.unread > 0 ? 'font-bold' : 'font-medium'}`}>{name}{r.kind === 'group' ? ` · ${r.member_count}` : ''}</span><span className="shrink-0 text-xs text-slate-500">{r.last_message_at ? (timeAgo(r.last_message_at) === 'now' ? tr('now') : timeAgo(r.last_message_at)) : ''}</span></span>
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm text-slate-500">{preview(r)}</span>{r.unread > 0 && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white ${r.muted ? 'bg-slate-400' : 'bg-brand-600'}`} aria-label={tr('{n} unread', { n: r.unread })}>{r.unread > 99 ? '99+' : r.unread}</span>}</span></span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <SavedVoice me={me} />
      {(dialog === 'new' || dialog === 'group') && <NewChatDialog me={me} groupOnly={dialog === 'group'} onClose={() => setDialog(null)} onOpen={(id) => { setDialog(null); onOpen(id) }} />}
      {dialog === 'privacy' && <ChatPrivacy me={me} onClose={() => setDialog(null)} />}
    </div>
  )
}
