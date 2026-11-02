import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { CONVERSIONS } from '../utils/convert'
import { convert, findConverted } from '../services/convert'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

/**
 * Turns one record into another (idea -> project, note -> task, ...). It first looks for a record already made from
 * this source and shows a link to it instead of creating a second one.
 */
export default function ConvertButton({ kind, source, label }) {
  const c = CONVERSIONS[kind]
  const [state, setState] = useState('checking') // checking | ready | busy | done
  const [created, setCreated] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    findConverted(kind, source.id)
      .then((row) => active && setState(row ? 'done' : 'ready'))
      .catch(() => active && setState('ready'))
    return () => { active = false }
  }, [kind, source.id])

  const run = async () => {
    setState('busy')
    setError(null)
    try {
      const r = await convert(kind, source)
      setCreated(r.created)
      setState('done')
    } catch (e) {
      setError(friendlyError(e))
      setState('ready')
    }
  }

  if (state === 'done') {
    return (
      <span className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-brand-800 dark:text-brand-200">
        <Check size={16} aria-hidden="true" />
        {created ? tr('Created') : tr('Already created')}.
        <Link to={c.to} className="font-medium underline">{tr('Open')}</Link>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={run} disabled={state !== 'ready'} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-brand-700 disabled:opacity-60 dark:text-brand-300">
        {state === 'busy' ? tr('Creating...') : label || c.label} <ArrowRight size={16} aria-hidden="true" />
      </button>
      {error && <span role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
