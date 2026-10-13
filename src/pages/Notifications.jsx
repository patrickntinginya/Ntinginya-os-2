import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckSquare, Wallet, Target, BookOpen, Sparkles } from 'lucide-react'
import { db } from '../services/db'
import { markAllRead, setRead, syncNotifications } from '../services/notifications'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Tabs from '../components/ui/Tabs'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import EmptyState from '../components/ui/EmptyState'
import DeviceNotificationsCard from '../components/DeviceNotificationsCard'
import NativeNotificationsCard from '../native/NativeNotificationsCard'
import { isNativePlatform } from '../lib/platform'
import { dateOfTimestamp, formatDate } from '../utils/date'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

const ICONS = { reminder: Bell, overdue_task: CheckSquare, budget: Wallet, goal_deadline: Target, learning: BookOpen, ai: Sparkles }
const changed = () => window.dispatchEvent(new Event('life-os:notifications-changed'))

export default function Notifications() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      await syncNotifications().catch(() => {})
      setItems(await db.list('notifications', { order: [{ column: 'created_at', ascending: false }], limit: 200 }))
      setError(null)
      changed()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn()
      setItems(await db.list('notifications', { order: [{ column: 'created_at', ascending: false }], limit: 200 }))
      changed()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const unread = items.filter((n) => !n.is_read).length
  const shown = filter === 'unread' ? items.filter((n) => !n.is_read) : items

  return (
    <div>
      <PageHeader title={tr('Notifications')} subtitle={tr('Built from your reminders, tasks, budgets, goals and study activity.')}
        action={<Button variant="secondary" className="!min-h-[44px]" disabled={!unread} loading={busy} onClick={() => act(markAllRead)}>{tr('Mark all read')}</Button>} />
      <Tabs tabs={[{ value: 'all', label: `All (${items.length})` }, { value: 'unread', label: `Unread (${unread})` }]} value={filter} onChange={setFilter} label={tr('Filter notifications')} />
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={load} /> : shown.length === 0 ? (
        <EmptyState icon={Bell} title={filter === 'unread' ? 'No unread notifications' : 'No notifications'} text={tr('Reminders due, overdue tasks, budget warnings and goal deadlines will show up here.')} />
      ) : (
        <ul className="space-y-3">
          {shown.map((n) => {
            const Icon = ICONS[n.type] || Bell
            return (
              <li key={n.id}>
                <Card className={`flex items-start gap-3 p-4 ${n.is_read ? 'opacity-70' : 'ring-1 ring-brand-300 dark:ring-brand-500/40'}`}>
                  <Icon size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className={n.is_read ? 'font-medium' : 'font-semibold'}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDate(dateOfTimestamp(n.created_at))}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      {n.link && <Link to={n.link} onClick={() => !n.is_read && setRead([n.id], true).then(changed)} className="flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Open')}</Link>}
                      <button type="button" className="min-h-[44px] text-sm font-medium text-slate-600 dark:text-slate-300" onClick={() => act(() => setRead([n.id], !n.is_read))}>{n.is_read ? tr('Mark unread') : tr('Mark read')}</button>
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <Card className="mt-6 p-4"><h2 className="mb-2 text-base font-semibold">{tr('Device notifications')}</h2>{isNativePlatform() ? <NativeNotificationsCard /> : <DeviceNotificationsCard />}</Card>
    </div>
  )
}
