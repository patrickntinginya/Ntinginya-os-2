import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import Feed from './Feed'
import Composer from './Composer'
import { decideJoinRequest, leaveGroup, listJoinRequests } from '../../services/community'
import { friendlyError } from '../../utils/format'
import { supabase } from '../../lib/supabase'
import { tr } from '../../i18n'

export default function GroupView({ groupId, me }) {
  const [group, setGroup] = useState(undefined)
  const [requests, setRequests] = useState([])
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.from('community_groups_view').select('*').eq('id', groupId).maybeSingle()
      if (e) throw e
      setGroup(data)
      if (data && ['owner', 'moderator'].includes(data.my_role)) setRequests(await listJoinRequests(groupId))
    } catch (e) { setError(tr(friendlyError(e))); setGroup(null) }
  }, [groupId])
  useEffect(() => { load() }, [load])

  if (group === undefined) return <Spinner />
  if (!group) return <p className="text-slate-500">{error || tr('This group does not exist or you cannot see it.')}</p>
  const member = group.my_status === 'active'
  return (
    <div>
      <Link to="/community" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300"><ArrowLeft size={18} aria-hidden="true" />{tr('Back to Community')}</Link>
      <Card className="mb-4 p-4">
        <h2 className="break-words text-lg font-semibold">{group.name}</h2>
        {group.description && <p className="mt-1 break-words text-sm text-slate-500">{group.description}</p>}
        <p className="mt-2 text-xs text-slate-400">{tr('{n} members', { n: group.member_count })}</p>
        {member && group.my_role !== 'owner' && <Button variant="secondary" className="mt-3" onClick={async () => { await leaveGroup(me, group.id); load() }}>{tr('Leave group')}</Button>}
      </Card>
      {requests.length > 0 && (
        <Card className="mb-4 p-4">
          <h3 className="mb-2 font-semibold">{tr('Join requests')}</h3>
          <ul className="space-y-2">{requests.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{tr('A member asked to join')} · {new Date(r.created_at).toLocaleDateString()}</span>
              <Button className="!min-h-[44px]" onClick={async () => { await decideJoinRequest(r.id, true); load() }}>{tr('Approve')}</Button>
              <Button variant="secondary" className="!min-h-[44px]" onClick={async () => { await decideJoinRequest(r.id, false); load() }}>{tr('Decline')}</Button>
            </li>
          ))}</ul>
        </Card>
      )}
      {member ? <Composer userId={me} groupId={group.id} onPosted={() => setRefresh((n) => n + 1)} /> : <p className="mb-4 text-sm text-slate-500">{group.privacy === 'private' ? tr('Join this private group to read and post.') : tr('Join this group to post.')}</p>}
      {(member || group.privacy === 'public') && <Feed scope="group" groupId={group.id} me={me} refreshKey={refresh} emptyText="No discussions yet. Start one." />}
    </div>
  )
}
