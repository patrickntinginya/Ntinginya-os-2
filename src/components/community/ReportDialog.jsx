import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { REPORT_REASONS, LIMITS, communityError } from '../../utils/community'
import { reportTarget } from '../../services/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/** Report a post, a comment or a member. One report per member per target (the database enforces it). */
export default function ReportDialog({ target, onClose, onDone }) {
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    setBusy(true); setError(null)
    try { await reportTarget({ ...target, reason, details }); setSent(true); onDone?.() }
    catch (e) { setError(tr(communityError(e) || friendlyError(e))) }
    finally { setBusy(false) }
  }
  return (
    <Modal title="Report" onClose={onClose}>
      {sent ? (
        <div>
          <p>{tr('Thank you. A moderator will review this.')}</p>
          <Button className="mt-4 w-full" onClick={onClose}>{tr('Close')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">{tr('Reason')}
            <select className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{tr(r.label)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">{tr('Details (optional)')}
            <textarea className="input mt-1 w-full" maxLength={LIMITS.report} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={submit}>{tr('Send report')}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
