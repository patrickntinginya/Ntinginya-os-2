import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Breathing from '../components/motivation/Breathing'
import { t } from '../i18n'
import { GROUNDING, NEXT_ACTIONS, REASSURANCE, pick } from '../lib/motivationContent'
import { createReflection } from '../services/reflections'
import { isMissingSchema } from '../services/schemaErrors'
import { validateReflection } from '../utils/reflections'
import { friendlyError } from '../utils/format'
import { todayISO } from '../utils/date'

/** Emergency / panic mode. A calm pause: breathing, grounding, one small action. It does not contact anyone or diagnose anything. */
export default function Calm() {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'sw'
  const reassurance = useMemo(() => REASSURANCE[Math.floor(Date.now() / 60000) % REASSURANCE.length], [])
  const [action, setAction] = useState(() => NEXT_ACTIONS[Math.floor(Math.random() * NEXT_ACTIONS.length)])
  const [text, setText] = useState('')
  const [state, setState] = useState('idle') // idle | saving | saved | error
  const [error, setError] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const checked = validateReflection({ kind: 'calm', note: text, mood: '', energy: '' }, todayISO())
    if (!checked.ok) return setError(t(checked.error))
    setState('saving')
    setError(null)
    try {
      await createReflection(checked.values)
      setState('saved')
      setText('')
    } catch (err) {
      setError(isMissingSchema(err) ? t('refl.err.migration') : friendlyError(err))
      setState('error')
    }
  }
  const nextAction = () => setAction((a) => NEXT_ACTIONS[(NEXT_ACTIONS.indexOf(a) + 1) % NEXT_ACTIONS.length])

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t('calm.title')}</h1>
      <p className="text-lg leading-snug">{pick(reassurance, lang)}</p>
      <Card className="p-4"><h2 className="mb-2 font-semibold">{t('calm.breathe')}</h2><Breathing /></Card>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('calm.ground')}</h2>
        <ol className="space-y-2">{GROUNDING.map((g) => <li key={g.n} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100">{g.n}</span><span>{pick(g, lang)}</span></li>)}</ol>
      </Card>
      <Card className="p-4">
        <h2 className="mb-1 font-semibold">{t('calm.next')}</h2>
        <p className="text-lg">{pick(action, lang)}</p>
        <Button variant="ghost" className="mt-1" onClick={nextAction}>{t('calm.another')}</Button>
      </Card>
      <Link to="/motivation" className="btn btn-secondary w-full">{t('calm.toCenter')}</Link>
      <Card className="p-4">
        <h2 className="mb-1 font-semibold">{t('calm.reflect')}</h2>
        <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">{t('calm.reflectHint')}</p>
        <form onSubmit={save} className="space-y-3">
          <label htmlFor="calm-note" className="sr-only">{t('calm.reflect')}</label>
          <textarea id="calm-note" className="input" maxLength={8000} value={text} onChange={(e) => { setText(e.target.value); setState('idle') }} />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {state === 'saved' && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{t('refl.saved')}</p>}
          <Button type="submit" loading={state === 'saving'} disabled={!text.trim()} className="w-full">{t('refl.save')}</Button>
        </form>
      </Card>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('calm.disclaimer')}</p>
    </div>
  )
}
