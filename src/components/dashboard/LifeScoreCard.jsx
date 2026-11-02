import { useState } from 'react'
import { ChevronDown, Gauge, TrendingDown, TrendingUp } from 'lucide-react'
import Card from '../ui/Card'
import ProgressBar from '../ui/ProgressBar'
import { DIMENSIONS, LABELS } from '../../utils/lifeScore'
import { tr } from '../../i18n'

/** Shows the Life Score with the reason for every number. Nothing here is estimated: see utils/lifeScore.js. */
export default function LifeScoreCard({ score }) {
  const [open, setOpen] = useState(false)
  const { overall, dimensions, trend, explanation } = score
  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Gauge size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" /> {tr('Life Score')}</h2>
      {overall == null ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{explanation}</p>
      ) : (
        <>
          <div className="mt-2 flex items-end gap-3">
            <p className="text-4xl font-bold tabular-nums">{overall}<span className="text-lg font-medium text-slate-400">/100</span></p>
            {trend && trend.change !== 0 && (
              <p className={`mb-1 inline-flex items-center gap-1 text-sm font-medium ${trend.change > 0 ? 'text-brand-700 dark:text-brand-300' : 'text-red-600 dark:text-red-400'}`}>
                {trend.change > 0 ? <TrendingUp size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}
                {trend.change > 0 ? '+' : ''}{trend.change} {tr('vs last week')}
              </p>
            )}
          </div>
          {trend && <p className="text-xs text-slate-500 dark:text-slate-400">{tr('Trend based on')} {trend.basis}.</p>}
          {!trend && <p className="text-xs text-slate-500 dark:text-slate-400">{tr('Trend needs the same data a week ago.')}</p>}
          <ul className="mt-3 space-y-2.5">
            {DIMENSIONS.map((d) => (
              <li key={d}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{LABELS[d]}</span><span className="tabular-nums">{dimensions[d] ? dimensions[d].score : tr('No data yet')}</span></div>
                {dimensions[d] && <ProgressBar value={dimensions[d].score} label={`${LABELS[d]} score`} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {overall != null && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300">
            {tr('How is this calculated?')} <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
          </button>
          {open && (
            <div className="space-y-2 text-sm">
              <p>{explanation}</p>
              {DIMENSIONS.filter((d) => dimensions[d]).map((d) => <p key={d}><span className="font-semibold">{LABELS[d]} {dimensions[d].score}:</span> {dimensions[d].why}</p>)}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
