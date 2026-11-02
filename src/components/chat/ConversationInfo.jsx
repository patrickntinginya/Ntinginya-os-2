import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Avatar from '../community/Avatar'
import ConfirmDialog from '../ui/ConfirmDialog'
import { chat } from '../../services/chatApi'
import { CHAT, chatError } from '../../utils/chat'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/** Group details: members, add/remove (group admins), rename, mute, leave. For a one-to-one chat only mute is offered. */
export default function ConversationInfo({ conv, members, profiles, me, muted, onClose, onChanged, onLeft, inboxRow }) {
  const isGroup = conv.kind === 'group'
  const amAdmin = members.some((m) => m.user_id === me && m.role === 'admin')
  const [title, setTitle] = useState(conv.title || '')
  const [text, setText] = useState('')
  const [found, setFound] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [mutedNow, setMutedNow] = useState(Boolean(muted))
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); await onChanged() } catch (e) { setError(tr(chatError(e) || friendlyError(e))) } finally { setBusy(false) } }
  const search = async (v) => { setText(v); if (!v.trim()) { setFound([]); return } try { const r = await chat.findMembers(v); setFound(r.filter((x) => !members.some((m) => m.user_id === x.user_id))) } catch { setFound([]) } }
  return (
    <Modal title={isGroup ? 'Group info' : 'Chat info'} onClose={onClose}>
      <div className="space-y-4">
        {isGroup && amAdmin && <div className="flex gap-2"><input className="input flex-1" maxLength={CHAT.title} aria-label={tr('Group name')} value={title} onChange={(e) => setTitle(e.target.value)} /><Button variant="secondary" loading={busy} onClick={() => run(() => chat.rename(conv.id, title))}>{tr('Rename')}</Button></div>}
        <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" checked={mutedNow} onChange={(e) => { const v = e.target.checked; setMutedNow(v); run(() => chat.setMuted(conv.id, v)) }} />{tr('Mute notifications for this chat')}</label>
        <div>
          <h3 className="mb-1 text-sm font-semibold">{tr('Members')} ({members.length})</h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {members.map((m) => (
              <li key={m.user_id} className="flex min-h-[44px] items-center gap-3"><Avatar name={profiles[m.user_id]?.display_name} size={32} /><span className="flex-1 truncate text-sm">{profiles[m.user_id]?.display_name || tr('Member')}{m.user_id === me ? ` (${tr('you')})` : ''}</span>{m.role === 'admin' && <span className="text-xs text-slate-500">{tr('Admin')}</span>}
                {isGroup && amAdmin && m.user_id !== me && <button type="button" className="min-h-[40px] px-2 text-xs text-red-600 dark:text-red-400" onClick={() => run(() => chat.removeMember(conv.id, m.user_id))}>{tr('Remove')}</button>}</li>
            ))}
          </ul>
        </div>
        {isGroup && amAdmin && <div>
          <label className="block text-sm font-medium">{tr('Add members')}<input type="search" className="input mt-1 w-full" maxLength={60} placeholder={tr('Type a name')} value={text} onChange={(e) => search(e.target.value)} /></label>
          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">{found.map((u) => <li key={u.user_id}><button type="button" disabled={busy} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => run(async () => { await chat.addMembers(conv.id, [u.user_id]); setText(''); setFound([]) })}><Avatar name={u.display_name} size={32} /><span className="truncate text-sm">{u.display_name}</span></button></li>)}</ul>
          <p className="mt-1 text-xs text-slate-500">{tr('New members only see messages sent after they join.')}</p>
        </div>}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isGroup && <Button variant="danger" className="w-full" onClick={() => setConfirmLeave(true)}>{tr('Leave group')}</Button>}
      </div>
      {confirmLeave && <ConfirmDialog title="Leave this group?" message="You will stop receiving its messages and cannot read it again unless an admin adds you back." confirmLabel="Leave" onClose={() => setConfirmLeave(false)} onConfirm={async () => { await chat.leave(conv.id); onLeft() }} />}
    </Modal>
  )
}
