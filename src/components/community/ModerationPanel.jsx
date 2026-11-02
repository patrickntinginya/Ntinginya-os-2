import { useCallback, useEffect, useState } from 'react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import Tabs from '../ui/Tabs'
import { ShieldCheck } from 'lucide-react'
import { fetchModerationLog, fetchReports, fetchSuspended, moderate, restoreUser } from '../../services/community'
import { REPORT_REASONS } from '../../utils/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/** Administrator moderation. Everything shown or changed here is re-checked by the database (is_admin via app_metadata). */
export default function ModerationPanel() {
  const [tab, setTab] = useState('open')
  const [reports, setReports] = useState(null)
  const [suspended, setSuspended] = useState([])
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState({})

  const load = useCallback(async () => {
    try {
      setError(null)
      if (tab === 'suspended') setSuspended(await fetchSuspended())
      else if (tab === 'log') setLog(await fetchModerationLog())
      else setReports(await fetchReports(tab))
    } catch (e) { setError(tr(friendlyError(e))) }
  }, [tab])
  useEffect(() => { setReports(null); load() }, [load])

  const act = async (report, action) => {
    setBusy(`${report.id}:${action}`)
    try { await moderate({ report, action, note: note[report.id] }); await load() } catch (e) { setError(tr(friendlyError(e))) } finally { setBusy(null) }
  }
  const reason = (v) => tr(REPORT_REASONS.find((r) => r.value === v)?.label || v)

  return (
    <div>
      <Tabs tabs={[{ value: 'open', label: 'Open reports' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'suspended', label: 'Suspended' }, { value: 'log', label: 'Action log' }]} value={tab} onChange={setTab} label={tr('Moderation')} />
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && tab === 'suspended' && (suspended.length === 0 ? <EmptyState icon={ShieldCheck} title="No suspended accounts" text="" /> : (
        <ul className="space-y-2">{suspended.map((s) => <li key={s.user_id}><Card className="flex items-center gap-2 p-3"><div className="min-w-0 flex-1"><p className="font-medium">{s.display_name}</p>{s.suspended_reason && <p className="text-sm text-slate-500">{s.suspended_reason}</p>}</div><Button variant="secondary" onClick={async () => { await restoreUser(s.user_id); load() }}>{tr('Restore')}</Button></Card></li>)}</ul>
      ))}
      {!error && tab === 'log' && (log.length === 0 ? <EmptyState icon={ShieldCheck} title="No actions yet" text="" /> : (
        <ul className="space-y-1 text-sm">{log.map((l) => <li key={l.id} className="rounded-lg bg-white p-2 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">{new Date(l.created_at).toLocaleString()} · <span className="font-medium">{l.action}</span> · {l.target_type}{l.reason ? ` · ${l.reason}` : ''}</li>)}</ul>
      ))}
      {!error && !['suspended', 'log'].includes(tab) && (reports === null ? <Spinner /> : reports.length === 0 ? <EmptyState icon={ShieldCheck} title="No reports here" text="" /> : (
        <ul className="space-y-3">{reports.map((r) => (
          <li key={r.id}><Card className="p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">{reason(r.reason)}</Badge><span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span></div>
            {r.details && <p className="mt-1 text-sm">{r.details}</p>}
            <p className="mt-2 break-words rounded-lg bg-slate-50 p-2 text-sm dark:bg-white/5">{r.post?.body || r.comment?.body || tr('(member report or content already deleted)')}</p>
            {tab === 'open' && (
              <>
                <input className="input mt-2 w-full" maxLength={500} placeholder={tr('Note (kept in the action log)')} value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="secondary" className="!min-h-[44px]" loading={busy === `${r.id}:hide`} onClick={() => act(r, 'hide')}>{tr('Hide content')}</Button>
                  <Button variant="danger" className="!min-h-[44px]" loading={busy === `${r.id}:remove`} onClick={() => act(r, 'remove')}>{tr('Remove content')}</Button>
                  <Button variant="secondary" className="!min-h-[44px]" loading={busy === `${r.id}:suspend_user`} onClick={() => act(r, 'suspend_user')}>{tr('Suspend author')}</Button>
                  <Button variant="ghost" className="!min-h-[44px]" loading={busy === `${r.id}:dismiss`} onClick={() => act(r, 'dismiss')}>{tr('Dismiss')}</Button>
                </div>
              </>
            )}
          </Card></li>
        ))}</ul>
      ))}
    </div>
  )
}
