import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Users } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import { createGroup, fetchGroups, joinGroup } from '../../services/community'
import { LIMITS, communityError, validateGroup } from '../../utils/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

function CreateGroup({ userId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', privacy: 'public' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    const problem = validateGroup(form)
    if (problem) { setError(tr(problem)); return }
    setBusy(true); setError(null)
    try { const g = await createGroup(userId, form); onCreated(g) } catch (e) { setError(tr(communityError(e) || (/duplicate|23505/.test(String(e?.message)) ? 'A group with this name already exists.' : friendlyError(e)))) } finally { setBusy(false) }
  }
  return (
    <Modal title="Create a group" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm font-medium">{tr('Group name')}<input className="input mt-1 w-full" maxLength={LIMITS.groupName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block text-sm font-medium">{tr('Description')}<textarea className="input mt-1 w-full" maxLength={LIMITS.groupDesc} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="block text-sm font-medium">{tr('Who can join?')}
          <select className="input mt-1 w-full" value={form.privacy} onChange={(e) => setForm({ ...form, privacy: e.target.value })}>
            <option value="public">{tr('Anyone can join and read')}</option>
            <option value="private">{tr('Members approved by you')}</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button className="w-full" loading={busy} onClick={submit}>{tr('Create group')}</Button>
      </div>
    </Modal>
  )
}

export default function GroupsPanel({ userId, search }) {
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const load = useCallback(async () => { try { setGroups(await fetchGroups({ search })); setError(null) } catch (e) { setError(tr(friendlyError(e))) } }, [search])
  useEffect(() => { load() }, [load])

  const join = async (g) => { setBusyId(g.id); try { await joinGroup(userId, g); await load() } catch (e) { setError(tr(communityError(e) || friendlyError(e))) } finally { setBusyId(null) } }

  if (error) return <ErrorState message={error} onRetry={load} />
  return (
    <div>
      <Button className="mb-4 w-full sm:w-auto" onClick={() => setCreating(true)}>{tr('Create a group')}</Button>
      {groups === null ? <Spinner /> : groups.length === 0 ? <EmptyState icon={Users} title="No groups yet" text={tr('Create the first group and invite people to talk.')} /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-words font-semibold">{g.name}</p>
                  {g.privacy === 'private' && <Badge tone="neutral"><Lock size={12} className="mr-1" aria-hidden="true" />{tr('Private')}</Badge>}
                </div>
                {g.description && <p className="mt-1 break-words text-sm text-slate-500">{g.description}</p>}
                <p className="mt-2 text-xs text-slate-400">{tr('{n} members', { n: g.member_count })}</p>
                <div className="mt-auto pt-3">
                  {g.my_status === 'active' ? <Link to={`/community?group=${g.id}`} className="btn btn-secondary w-full">{tr('Open group')}</Link>
                    : g.my_status === 'pending' ? <Badge tone="warn">{tr('Request sent')}</Badge>
                    : g.my_status === 'banned' ? null
                    : <Button className="w-full" loading={busyId === g.id} onClick={() => join(g)}>{g.privacy === 'private' ? tr('Request to join') : tr('Join')}</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateGroup userId={userId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}
    </div>
  )
}
