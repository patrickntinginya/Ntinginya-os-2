import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Tabs from '../components/ui/Tabs'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import Feed from '../components/community/Feed'
import Composer from '../components/community/Composer'
import GroupsPanel from '../components/community/GroupsPanel'
import GroupView from '../components/community/GroupView'
import MePanel from '../components/community/MePanel'
import ModerationPanel from '../components/community/ModerationPanel'
import ChatPanel from '../components/chat/ChatPanel'
import SavedVoice from '../components/chat/SavedVoice'
import ConversationView from '../components/chat/ConversationView'
import { useChatInbox } from '../hooks/useChatInbox'
import { useAuth } from '../contexts/AuthContext'
import { createProfile, getMyProfile } from '../services/community'
import { LIMITS, communityError, isAdminUser, validateProfile } from '../utils/community'
import { friendlyError } from '../utils/format'
import { isUuid } from '../lib/uuid'
import { tr } from '../i18n'

function Join({ user, defaultName, onDone }) {
  const [name, setName] = useState(defaultName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const go = async () => {
    const problem = validateProfile({ display_name: name })
    if (problem) { setError(tr(problem)); return }
    setBusy(true); setError(null)
    try { onDone(await createProfile(user.id, { display_name: name })) } catch (e) { setError(tr(communityError(e) || friendlyError(e))) } finally { setBusy(false) }
  }
  return (
    <Card className="mx-auto max-w-md p-5">
      <h2 className="text-lg font-semibold">{tr('Join the Community')}</h2>
      <p className="mt-1 text-sm text-slate-500">{tr('Other members will see this name on your posts and comments. Your finances, tasks and notes always stay private.')}</p>
      <label className="mt-4 block text-sm font-medium">{tr('Display name')}<input className="input mt-1 w-full" maxLength={LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} /></label>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button className="mt-4 w-full" loading={busy} onClick={go}>{tr('Join')}</Button>
    </Card>
  )
}

export default function Community() {
  const { user, profile: appProfile } = useAuth()
  const [params, setParams] = useSearchParams()
  const groupId = params.get('group')
  const postParam = params.get('post')
  const postId = isUuid(postParam) ? postParam : null // a malformed link falls back to the normal feed
  const chatParam = params.get('chat')
  const chatId = isUuid(chatParam) ? chatParam : null
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('feed')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const admin = isAdminUser(user)
  const inbox = useChatInbox(user.id) // live conversation list + unread count (also keeps delivery marks and last seen current)

  useEffect(() => { const id = setTimeout(() => setSearch(searchText), 300); return () => clearTimeout(id) }, [searchText])
  useEffect(() => {
    let live = true
    getMyProfile(user.id).then((p) => live && setProfile(p)).catch((e) => live && (setError(tr(friendlyError(e))), setProfile(null)))
    return () => { live = false }
  }, [user.id])

  if (profile === undefined) return <Spinner />
  // Offline the profile request fails; voice messages saved on this device still play (SavedVoice reads only the device's own storage).
  if (error) return <div className="space-y-4"><ErrorState message={error} onRetry={() => window.location.reload()} /><SavedVoice me={user.id} /></div>
  if (!profile) return <div><PageHeader title={tr('Community')} subtitle={tr('Talk with other members, share progress and join groups.')} /><Join user={user} defaultName={appProfile?.full_name} onDone={setProfile} /></div>
  if (profile.status === 'suspended') return <div><PageHeader title={tr('Community')} /><Card className="p-4"><p role="alert">{tr('Your Community access is suspended.')}</p>{profile.suspended_reason && <p className="mt-1 text-sm text-slate-500">{profile.suspended_reason}</p>}</Card></div>
  if (chatId) return <div><PageHeader title={tr('Community')} /><ConversationView key={chatId} id={chatId} me={user.id} inboxRow={inbox.rows.find((r) => r.conversation_id === chatId)} onBack={() => { setParams({}); inbox.refresh() }} /></div>
  if (postId) return <div><PageHeader title={tr('Community')} action={<Link to="/community" className="flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Back to Community')}</Link>} /><Feed scope="post" postId={postId} me={user.id} emptyText="This post is no longer available." /></div>
  if (groupId) return <div><PageHeader title={tr('Community')} /><GroupView groupId={groupId} me={user.id} /></div>

  const tabs = [{ value: 'feed', label: 'Feed' }, { value: 'messages', label: 'Messages', badge: inbox.unreadTotal }, { value: 'trending', label: 'Trending' }, { value: 'groups', label: 'Groups' }, { value: 'me', label: 'My profile' }, ...(admin ? [{ value: 'moderation', label: 'Moderation' }] : [])]
  return (
    <div>
      <PageHeader title={tr('Community')} subtitle={tr('Talk with other members, share progress and join groups.')} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={tr('Community sections')} />
      {['feed', 'trending', 'groups'].includes(tab) && (
        <label className="relative mb-4 block">
          <span className="sr-only">{tr('Search Community')}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" className="input w-full pl-10" maxLength={LIMITS.search} placeholder={tr('Search posts, members and groups')} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </label>
      )}
      {tab === 'feed' && <><Composer userId={user.id} onPosted={() => setRefresh((n) => n + 1)} /><Feed scope="feed" search={search} me={user.id} refreshKey={refresh} /></>}
      {tab === 'messages' && <ChatPanel me={user.id} inbox={inbox} onOpen={(id) => setParams({ chat: id })} />}
      {tab === 'trending' && <Feed scope="trending" search={search} me={user.id} emptyText="Nothing is trending yet. React or comment to get it started." />}
      {tab === 'groups' && <GroupsPanel userId={user.id} search={search} />}
      {tab === 'me' && <MePanel profile={profile} onSaved={setProfile} />}
      {tab === 'moderation' && admin && <ModerationPanel />}
    </div>
  )
}
