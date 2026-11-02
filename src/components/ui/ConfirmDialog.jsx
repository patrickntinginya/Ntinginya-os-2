import { useState } from 'react'
import Modal from './Modal'
import Button from './Button'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-slate-600 dark:text-slate-300">{message}</p>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
        <Button variant="danger" onClick={run} loading={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
