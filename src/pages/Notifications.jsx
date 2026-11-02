import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import { deleteNotification, fetchNotificationPage, markAllRead, notificationCounts, setRead, syncNotifications } from '../services/notifications'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Tabs from '../components/ui/Tabs'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import NotificationCard from '../components/notifications/NotificationCard'
import DeviceNotificationsCard from '../components/DeviceNotificationsCard'
import NativeNotificationsCard from '../native/NativeNotificationsCard'
import { useSmartActions } from '../hooks/useSmartActions'
import { isNativePlatform } from '../lib/platform'
import { CATEGORIES, FILTERS, matchesFilter } from '../utils/smartActions'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

const changed = () => window.dispatchEvent(new Event('life-os:notifications-changed'))

export default function Notifications() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [rows, setRows] = useState([])
  const [cursor, setCursor] = useState(null)
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const requestId = useRef(0)

  // Debounce typing so every keystroke is not a request.
  useEffect(() => { const id = setTimeout(() => setSearch(searchText), 300); return () => clearTimeout(id) }, [searchText])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])

  const load = useCallback(async ({ sync = false } = {}) => {
    const mine = ++requestId.current
    setLoading(true)
    try {
      if (sync) await syncNotifications().catch(() => {})
      const [page, c] = await Promise.all([fetchNotificationPage({ filter, category, search }), notificationCounts()])
      if (mine !== requestId.current) return // a newer request replaced this one
      setRows(page.rows); setCursor(page.nextCursor); setCounts(c); setError(null)
      changed()
    } catch (e) {
      if (mine === requestId.current) setError(friendlyError(e))
    } finally {
      if (mine === requestId.current) setLoading(false)
    }
  }, [filter, category, search])

  const firstLoad = useRef(true)
  useEffect(() => { load({ sync: firstLoad.current }); firstLoad.current = false }, [load])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchNotificationPage({ filter, category, search, cursor })
      setRows((prev) => { const seen = new Set(prev.map((r) => r.id)); return [...prev, ...page.rows.filter((r) => !seen.has(r.id))] })
      setCursor(page.nextCursor)
    } catch (e) { setError(friendlyError(e)) } finally { setLoadingMore(false) }
  }

  // Patch the visible row after DO IT / snooze instead of reloading the whole list.
  const onResult = useCallback((n, outcome) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== n.id) return r
      if (outcome.type === 'snoozed') return { ...r, snoozed_until: outcome.snoozed_until, is_read: true }
      return { ...r, status: 'done', is_read: true, snoozed_until: null }
    }))
    notificationCounts().then(setCounts).catch(() => {})
    changed()
  }, [])
  const actions = useSmartActions({ onResult, navigate })

  // Opened from a device notification button: /notifications?act=do|snooze&n=<id> (or &r=<reminder id>). Runs once, then cleans the URL.
  const handledLink = useRef('')
  useEffect(() => {
    const act = params.get('act'); const id = params.get('n'); const key = `${act}:${id}:${params.get('r')}`
    if (!act || handledLink.current === key) return
    handledLink.current = key
    ;(async () => {
      try {
        const { findOpenNotificationForReminder } = await import('../services/notifications')
        let n = rows.find((r) => r.id === id)
        if (!n && id) { const p = await fetchNotificationPage({ pageSize: 100 }); n = p.rows.find((r) => r.id === id) }
        if (!n && params.get('r')) { await syncNotifications().catch(() => {}); n = await findOpenNotificationForReminder(params.get('r')) }
        if (n) (act === 'snooze' ? actions.snooze(n) : actions.doIt(n))
      } finally { navigate('/notifications', { replace: true }) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const toggleRead = async (n) => {
    try { await setRead([n.id], !n.is_read); setRows((p) => p.map((r) => (r.id === n.id ? { ...r, is_read: !n.is_read } : r))); changed(); notificationCounts().then(setCounts).catch(() => {}) } catch (e) { setError(friendlyError(e)) }
  }
  const onOpen = (n) => { if (!n.is_read) setRead([n.id], true).then(changed).catch(() => {}) }
  const [toDelete, setToDelete] = useState(null)
  const doDelete = async () => { await deleteNotification(toDelete.id); setRows((p) => p.filter((r) => r.id !== toDelete.id)); notificationCounts().then(setCounts).catch(() => {}); changed() }
  const markAll = async () => { setBulkBusy(true); try { await markAllRead(); await load() } catch (e) { setError(friendlyError(e)) } finally { setBulkBusy(false) } }

  const shown = useMemo(() => rows.filter((r) => matchesFilter(r, filter, now)), [rows, filter, now])
  const tabs = FILTERS.map((f) => ({ value: f.value, label: counts && counts[f.value] != null ? `${tr(f.label)} (${counts[f.value]})` : f.label }))

  return (
    <div>
      <PageHeader title={tr('Notifications')} subtitle={tr('Built from your reminders, tasks, budgets, goals and study activity.')}
        action={<Button variant="secondary" className="!min-h-[44px]" disabled={!counts?.unread} loading={bulkBusy} onClick={markAll}>{tr('Mark all read')}</Button>} />
      <Tabs tabs={tabs} value={filter} onChange={setFilter} label={tr('Filter notifications')} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <label className="relative block">
          <span className="sr-only">{tr('Search notifications')}</span>
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={tr('Search notifications')} className="input w-full pl-10" maxLength={60} />
        </label>
        <label className="block">
          <span className="sr-only">{tr('Category')}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input w-full">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{tr(c.label)}</option>)}
          </select>
        </label>
      </div>

      {loading && rows.length === 0 ? <Spinner /> : error ? <ErrorState message={error} onRetry={() => load()} /> : shown.length === 0 ? (
        <EmptyState icon={Bell} title={filter === 'all' && !search && category === 'all' ? 'No notifications' : 'Nothing matches these filters'} text={tr('Reminders due, overdue tasks, budget warnings and goal deadlines will show up here.')} />
      ) : (
        <>
          <ul className="space-y-3" aria-live="polite">
            {shown.map((n) => (
              <li key={n.id}>
                <NotificationCard n={n} now={now}
                  busy={actions.busy === `${n.id}:do` ? 'do' : actions.busy === `${n.id}:snooze` ? 'snooze' : null}
                  message={actions.message?.id === n.id ? actions.message : null}
                  onDoIt={actions.doIt} onSnooze={actions.snooze} onToggleRead={toggleRead} onDelete={setToDelete} onOpen={onOpen} />
              </li>
            ))}
          </ul>
          {cursor && <div className="mt-4 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={loadMore}>{tr('Load more')}</Button></div>}
        </>
      )}
      <Card className="mt-6 p-4"><h2 className="mb-2 text-base font-semibold">{tr('Device notifications')}</h2>{isNativePlatform() ? <NativeNotificationsCard /> : <DeviceNotificationsCard />}</Card>

      {actions.confirm && (
        <ConfirmDialog title="Complete this task?" message={tr('This marks the task as completed. If it repeats, its next copy is created.')} confirmLabel="DO IT"
          onConfirm={() => actions.execute(actions.confirm)} onClose={actions.closeConfirm} />
      )}
      {toDelete && <ConfirmDialog title="Delete this notification?" message={tr('It will be removed from your history.')} confirmLabel="Delete" onConfirm={doDelete} onClose={() => setToDelete(null)} />}
    </div>
  )
}
