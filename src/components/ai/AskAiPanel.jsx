import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import AiActionCard from './AiActionCard'
import { AiError, AiNotConfiguredError, sendToAssistant } from '../../services/aiClient'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/**
 * One-tap or one-question AI helper used across the app (reviews, idea validator, goal coach, learning coach...).
 * It calls the server-side function; the answer is based on the user's real data and any proposed change
 * appears as a card that needs Confirm. Nothing is generated until the user presses the button.
 */
export default function AskAiPanel({
  title = 'Ask the assistant', description, mode = 'chat', entityId, prompt, buttonLabel = 'Ask AI',
  inputLabel, inputPlaceholder, disclaimer, onResult, onActionChanged, className = '',
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [result, setResult] = useState(null)

  const message = inputLabel ? input.trim() : prompt
  const ask = async (e) => {
    e?.preventDefault()
    if (!message) return
    setBusy(true)
    setError(null)
    setNotConfigured(false)
    try {
      const res = await sendToAssistant({ message, mode, entityId })
      setResult(res)
      onResult?.(res)
    } catch (err) {
      if (err instanceof AiNotConfiguredError) setNotConfigured(true)
      else if (err instanceof AiError) setError(err.message)
      else setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={`p-4 ${className}`}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Sparkles size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" /> {title}
      </h2>
      {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}

      <form onSubmit={ask} className="mt-3 space-y-3">
        {inputLabel && (
          <div>
            <label htmlFor={`ai-${mode}`} className="label">{inputLabel}</label>
            <input id={`ai-${mode}`} className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={inputPlaceholder} maxLength={300} />
          </div>
        )}
        <Button type="submit" loading={busy} disabled={!message} className="w-full sm:w-auto">{result ? tr('Ask again') : buttonLabel}</Button>
      </form>

      {notConfigured && (
        <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {tr('AI Assistant is not configured yet. An AI provider must be set up on the server (see the README). The rest of the app works without it.')}
        </p>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="whitespace-pre-line rounded-xl bg-slate-50 p-4 text-[15px] leading-relaxed dark:bg-white/5">{result.reply}</div>
          {result.actions?.map((a) => <AiActionCard key={a.id} request={a} onChanged={onActionChanged} />)}
          {disclaimer && <p className="text-xs text-slate-500 dark:text-slate-400">{disclaimer}</p>}
          <Link to="/ai" className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Continue in AI chat')}</Link>
        </div>
      )}
    </Card>
  )
}

export const FINANCE_DISCLAIMER = 'General AI guidance based on the data you recorded. It is not professional financial advice.'
