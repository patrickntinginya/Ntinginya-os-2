import { useState } from 'react'
import { Check, X } from 'lucide-react'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { ACTIONS } from '../../lib/ai/actions'
import { cancelAction, confirmAction } from '../../services/aiActions'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

const STATUS = {
  confirmed: { tone: 'brand', label: 'Done' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  failed: { tone: 'danger', label: 'Failed' },
}

function Details({ payload }) {
  const rows = Object.entries(payload || {}).filter(([k, v]) => v !== null && v !== '' && k !== 'goal_id')
  if (!rows.length) return null
  return (
    <dl className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="shrink-0 font-medium">{tr(k.replace(/_/g, ' '))}:</dt>
          <dd className="min-w-0 whitespace-pre-line break-words">{typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A proposed change. Nothing is saved until the user presses Confirm. */
export default function AiActionCard({ request, onChanged }) {
  const [status, setStatus] = useState(request.status)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  const run = async (kind) => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'confirm') await confirmAction(request)
      else await cancelAction(request)
      setStatus(kind === 'confirm' ? 'confirmed' : 'cancelled')
      onChanged?.()
    } catch (e) {
      setError(e.message && !/^(PGRST|\d{5})/.test(e.message) && e.message.length < 200 && /^(Only part|The topic|This action)/.test(e.message) ? e.message : friendlyError(e))
      if (kind === 'confirm') setStatus('failed')
    } finally {
      setBusy(null)
    }
  }

  const pending = status === 'pending'
  return (
    <div className="rounded-2xl border border-brand-300 bg-brand-50 p-4 dark:border-brand-500/40 dark:bg-brand-500/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-800 dark:text-brand-200">{ACTIONS[request.action_type]?.label || tr('Proposed action')}</p>
          <p className="mt-0.5 font-medium">{request.summary}</p>
        </div>
        {!pending && <Badge tone={STATUS[status]?.tone}>{tr(STATUS[status]?.label)}</Badge>}
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 min-h-[36px] text-xs font-medium text-brand-700 dark:text-brand-300" aria-expanded={open}>
        {open ? tr('Hide details') : tr('Show details')}
      </button>
      {open && <Details payload={request.payload} />}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {pending && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button onClick={() => run('confirm')} loading={busy === 'confirm'} disabled={busy === 'cancel'}>
            <Check size={18} aria-hidden="true" /> {tr('Confirm')}
          </Button>
          <Button variant="secondary" onClick={() => run('cancel')} loading={busy === 'cancel'} disabled={busy === 'confirm'}>
            <X size={18} aria-hidden="true" /> {tr('Cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
