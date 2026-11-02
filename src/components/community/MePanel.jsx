import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Avatar from './Avatar'
import Feed from './Feed'
import { listBlocks, saveProfile, signedUrls, unblockUser } from '../../services/community'
import { LIMITS, communityError, validateProfile } from '../../utils/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

export default function MePanel({ profile, onSaved }) {
  const [form, setForm] = useState({ display_name: profile.display_name, bio: profile.bio || '', show_bio: profile.show_bio })
  const [file, setFile] = useState(null)
  const [avatar, setAvatar] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [blocks, setBlocks] = useState([])
  useEffect(() => { listBlocks().then(setBlocks).catch(() => {}) }, [])
  useEffect(() => { if (profile.avatar_path) signedUrls([profile.avatar_path]).then((m) => setAvatar(m[profile.avatar_path])).catch(() => {}) }, [profile.avatar_path])

  const save = async () => {
    const problem = validateProfile(form)
    if (problem) { setMsg({ error: true, text: tr(problem) }); return }
    setBusy(true); setMsg(null)
    try { const row = await saveProfile(profile.user_id, { ...form, avatarFile: file }); setFile(null); onSaved(row); setMsg({ text: tr('Saved.') }) }
    catch (e) { setMsg({ error: true, text: tr(communityError(e) || friendlyError(e)) }) } finally { setBusy(false) }
  }
  const unblock = async (b) => { try { await unblockUser(b.blocked_user_id); setBlocks((l) => l.filter((x) => x.id !== b.id)) } catch (e) { setMsg({ error: true, text: tr(friendlyError(e)) }) } }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3"><Avatar name={form.display_name} url={avatar} size={56} />
          <label className="text-sm font-medium">{tr('Profile picture')}<input type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label></div>
        <label className="mt-3 block text-sm font-medium">{tr('Display name')}<input className="input mt-1 w-full" maxLength={LIMITS.name} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        <label className="mt-3 block text-sm font-medium">{tr('About you')}<textarea className="input mt-1 w-full" maxLength={LIMITS.bio} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={form.show_bio} onChange={(e) => setForm({ ...form, show_bio: e.target.checked })} />{tr('Show my bio to other members')}</label>
        <Button className="mt-2 w-full sm:w-auto" loading={busy} onClick={save}>{tr('Save')}</Button>
        {msg && <p role={msg.error ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.error ? 'text-red-600 dark:text-red-400' : 'text-brand-700 dark:text-brand-300'}`}>{msg.text}</p>}
      </Card>
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">{tr('Blocked members')}</h3>
        {blocks.length === 0 ? <p className="text-sm text-slate-500">{tr('You have not blocked anyone.')}</p> : (
          <ul className="space-y-1">{blocks.map((b) => <li key={b.id} className="flex items-center gap-2"><span className="flex-1 text-sm">{b.blocked_name || tr('Member')}</span><Button variant="secondary" className="!min-h-[44px]" onClick={() => unblock(b)}>{tr('Unblock')}</Button></li>)}</ul>
        )}
      </Card>
      <div><h3 className="mb-2 font-semibold">{tr('My posts')}</h3><Feed scope="mine" me={profile.user_id} emptyText="You have not posted yet." /></div>
    </div>
  )
}
