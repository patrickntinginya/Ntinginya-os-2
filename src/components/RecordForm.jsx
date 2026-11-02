import { useState } from 'react'
import Modal from './ui/Modal'
import Field from './ui/Fields'
import Button from './ui/Button'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

const NUMERIC = ['number', 'range']

/** Turn raw form state into a DB payload: '' -> null, numeric fields -> Number, tags -> array. */
function normalize(values, fields) {
  const out = {}
  for (const f of fields) {
    let v = values[f.name]
    if (f.type === 'tags') {
      v = [...new Set(String(v || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10)
    } else if (NUMERIC.includes(f.type) || f.cast === 'number') v = v === '' || v == null ? null : Number(v)
    else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim()
    out[f.name] = v
  }
  return out
}

const initialValue = (f, initial, defaults) => {
  const v = initial?.[f.name] ?? defaults[f.name]
  if (f.type === 'tags') return Array.isArray(v) ? v.join(', ') : v ?? ''
  if (v !== undefined && v !== null) return f.type === 'time' ? String(v).slice(0, 5) : v
  return f.type === 'range' ? 0 : ''
}

export default function RecordForm({ title, fields, initial, defaults = {}, validate, warn, onSubmit, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, initialValue(f, initial, defaults)])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null) // { text, key } - shown once; saving again with the same values confirms it

  const setField = (name, value) => setValues((v) => ({ ...v, [name]: value }))

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const problem = validate?.(values)
    if (problem) return setError(problem)
    const key = JSON.stringify(values)
    const caution = warn?.(values)
    if (caution && warning?.key !== key) {
      setWarning({ text: caution, key })
      return
    }
    setSaving(true)
    try {
      await onSubmit(normalize(values, fields))
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setSaving(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-4">
        {fields.map((f) => (
          <Field key={f.name} field={f} value={values[f.name]} onChange={setField} />
        ))}
        {error && (
          <p className="col-span-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
        {warning && warning.key === JSON.stringify(values) && (
          <p className="col-span-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
            {warning.text}
          </p>
        )}
        <div className="col-span-2 mt-1 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Cancel')}</Button>
          <Button type="submit" loading={saving}>{warning && warning.key === JSON.stringify(values) ? tr('Save anyway') : tr('Save')}</Button>
        </div>
      </form>
    </Modal>
  )
}
