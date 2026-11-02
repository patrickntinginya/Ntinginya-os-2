import { useState } from 'react'
import { Check, Heart } from 'lucide-react'
import Card from '../ui/Card'
import { t } from '../../i18n'
import { pick } from '../../lib/motivationContent'
import { toggleFavorite } from '../../lib/media'

const routineKey = (scope, kind, date) => `life-os-routine:${scope || 'device'}:${kind}:${date}`
const readRoutine = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }

/** Affirmations (both languages shown) plus a checklist routine that resets each local day. */
export default function Affirmations({ kind, items, routine, lang, today, userId, state, setState }) {
  const key = routineKey(userId, kind, today)
  const [done, setDone] = useState(() => readRoutine(key))
  const tick = (id) => {
    const next = new Set(done)
    next.has(id) ? next.delete(id) : next.add(id)
    setDone(next)
    try { localStorage.setItem(key, JSON.stringify([...next])) } catch { /* storage blocked: the tick still works for this visit */ }
  }
  const other = lang === 'en' ? 'sw' : 'en'
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {items.map((a) => (
          <li key={a.id}>
            <Card className="flex items-start gap-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-medium leading-snug">{pick(a, lang)}</p>
                <p lang={other} className="mt-1 text-sm text-slate-500 dark:text-slate-400">{pick(a, other)}</p>
              </div>
              <button type="button" className="icon-btn" aria-pressed={state.favorites.includes(a.id)} aria-label={t('mot.favorite')} onClick={() => setState(toggleFavorite(state, a.id))}>
                <Heart size={20} className={state.favorites.includes(a.id) ? 'fill-red-500 text-red-500' : ''} />
              </button>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t(kind === 'morning' ? 'mot.morningRoutine' : 'mot.nightRoutine')}</h2>
        <ul className="space-y-1">
          {routine.map((r) => (
            <li key={r.id}>
              <button type="button" role="checkbox" aria-checked={done.has(r.id)} onClick={() => tick(r.id)} className="flex min-h-[48px] w-full items-center gap-3 text-left">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${done.has(r.id) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>{done.has(r.id) && <Check size={16} strokeWidth={3} />}</span>
                <span className={done.has(r.id) ? 'text-slate-500 line-through' : ''}>{pick(r, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
        {done.size >= routine.length && <p role="status" className="mt-2 text-sm font-medium text-brand-700 dark:text-brand-300">{t('mot.routineDone')}</p>}
      </Card>
    </div>
  )
}
