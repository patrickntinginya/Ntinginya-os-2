import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { chat } from '../../services/chatApi'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/** Who may see when I was last online and who may start a chat with me. Both default to "yes"; the database enforces them. */
export default function ChatPrivacy({ me, onClose }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { chat.settings(me).then(setS).catch((e) => setMsg({ error: true, text: tr(friendlyError(e)) })) }, [me])
  const save = async () => { setBusy(true); setMsg(null); try { await chat.saveSettings(me, s); setMsg({ text: tr('Saved.') }) } catch (e) { setMsg({ error: true, text: tr(friendlyError(e)) }) } finally { setBusy(false) } }
  return (
    <Modal title="Chat privacy" onClose={onClose}>
      {!s ? <p className="text-sm text-slate-500">{msg ? msg.text : tr('Loading…')}</p> : (
        <div className="space-y-3">
          <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={s.show_last_seen} onChange={(e) => setS({ ...s, show_last_seen: e.target.checked })} /><span>{tr('Let people I chat with see when I was last online')}</span></label>
          <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={s.allow_new_chats} onChange={(e) => setS({ ...s, allow_new_chats: e.target.checked })} /><span>{tr('Let members start a chat with me or add me to a group')}</span></label>
          <p className="text-xs text-slate-500">{tr('Read receipts and typing indicators are always shown inside a conversation. You can block anyone from a message menu.')}</p>
          {msg && <p role={msg.error ? 'alert' : 'status'} className={`text-sm ${msg.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'}`}>{msg.text}</p>}
          <Button className="w-full" loading={busy} onClick={save}>{tr('Save')}</Button>
        </div>
      )}
    </Modal>
  )
}
