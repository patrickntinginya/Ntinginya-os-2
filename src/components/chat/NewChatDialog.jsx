import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Avatar from '../community/Avatar'
import { chat } from '../../services/chatApi'
import { CHAT, chatError, validateGroup } from '../../utils/chat'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/** Start a one-to-one chat or create a group. Members are found by their Community display name. */
export default function NewChatDialog({ me, onClose, onOpen, groupOnly = false }) {
  const [mode, setMode] = useState(groupOnly ? 'group' : 'direct')
  const [text, setText] = useState('')
  const [found, setFound] = useState([])
  const [picked, setPicked] = useState([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    const id = setTimeout(() => { chat.findMembers(text).then((r) => live && setFound(r.filter((x) => x.user_id !== me))).catch(() => live && setFound([])) }, 300)
    return () => { live = false; clearTimeout(id) }
  }, [text, me])

  const fail = (e) => setError(tr(chatError(e) || friendlyError(e)))
  const startDirect = async (u) => { setBusy(true); setError(null); try { onOpen(await chat.startDirect(u.user_id)) } catch (e) { fail(e) } finally { setBusy(false) } }
  const create = async () => {
    const problem = validateGroup({ title, memberIds: picked.map((p) => p.user_id) })
    if (problem) { setError(tr(problem)); return }
    setBusy(true); setError(null)
    try { onOpen(await chat.createGroup(title, picked.map((p) => p.user_id))) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const toggle = (u) => setPicked((l) => (l.some((x) => x.user_id === u.user_id) ? l.filter((x) => x.user_id !== u.user_id) : [...l, u]))

  return (
    <Modal title={mode === 'group' ? 'New group' : 'New chat'} onClose={onClose}>
      <div className="space-y-3">
        {!groupOnly && <div className="flex gap-2" role="group" aria-label={tr('Chat type')}>
          {[['direct', 'One to one'], ['group', 'Group']].map(([v, l]) => <button key={v} type="button" aria-pressed={mode === v} onClick={() => { setMode(v); setError(null) }} className={`min-h-[42px] flex-1 rounded-full px-4 text-sm font-medium ${mode === v ? 'bg-brand-600 text-white' : 'border border-slate-200 dark:border-white/15'}`}>{tr(l)}</button>)}
        </div>}
        {mode === 'group' && <label className="block text-sm font-medium">{tr('Group name')}<input className="input mt-1 w-full" maxLength={CHAT.title} value={title} onChange={(e) => setTitle(e.target.value)} /></label>}
        {mode === 'group' && picked.length > 0 && <p className="text-xs text-slate-500">{tr('Selected')}: {picked.map((p) => p.display_name).join(', ')}</p>}
        <label className="block text-sm font-medium">{tr('Find a member')}<input type="search" className="input mt-1 w-full" maxLength={60} placeholder={tr('Type a name')} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {found.map((u) => { const on = picked.some((x) => x.user_id === u.user_id); return (
            <li key={u.user_id}><button type="button" disabled={busy} onClick={() => (mode === 'direct' ? startDirect(u) : toggle(u))} aria-pressed={mode === 'group' ? on : undefined} className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-slate-100 dark:hover:bg-white/10 ${on ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}><Avatar name={u.display_name} size={36} /><span className="flex-1 truncate">{u.display_name}</span>{mode === 'group' && <span aria-hidden="true">{on ? '✓' : ''}</span>}</button></li>
          ) })}
          {text.trim() && found.length === 0 && <li className="p-2 text-sm text-slate-500">{tr('No members found.')}</li>}
        </ul>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {mode === 'group' && <Button className="w-full" loading={busy} onClick={create}>{tr('Create group')}</Button>}
      </div>
    </Modal>
  )
}
