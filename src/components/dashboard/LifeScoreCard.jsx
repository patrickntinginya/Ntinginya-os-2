import { useState } from 'react'
import { ChevronDown, Gauge, TrendingDown, TrendingUp } from 'lucide-react'
import Card from '../ui/Card'
import ProgressBar from '../ui/ProgressBar'
import { DIMENSIONS, LABELS } from '../../utils/lifeScore'
import { tr } from '../../i18n'

/** Shows the Life Score with the reason for every number. */
export default function LifeScoreCard({ score }) {
  const [open, setOpen] = useState(false)
  const { overall, dimensions, trend, explanation } = score

  const scoreValue = Math.max(0, Math.min(100, Number(overall) || 0))
  const scoreLevel =
    scoreValue >= 80 ? 'high' :
    scoreValue >= 50 ? 'medium' : 'low'

  return (
    <Card className="dashboard-score p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Gauge size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />
          {tr('Life Score')}
        </h2>
      </div>

      {overall == null ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {explanation}
        </p>
      ) : (
        <>
          <div className="life-score-summary">
            <div
              className={`life-score-ring life-score-${scoreLevel}`}
              style={{ '--score-progress': `${scoreValue}%` }}
              role="img"
              aria-label={`${tr('Life Score')}: ${overall}/100`}
            >
              <div className="life-score-ring-inner">
                <strong>{overall}</strong>
                <span>/100</span>
              </div>
            </div>

            <div className="life-score-meta">
              <p className="life-score-caption">{tr('Life Score')}</p>

              {trend && trend.change !== 0 ? (
                <p className={`life-score-trend ${trend.change > 0 ? 'positive' : 'negative'}`}>
                  {trend.change > 0
                    ? <TrendingUp size={17} aria-hidden="true" />
                    : <TrendingDown size={17} aria-hidden="true" />}
                  {trend.change > 0 ? '+' : ''}{trend.change} {tr('vs last week')}
                </p>
              ) : (
                <p className="life-score-trend-neutral">
                  {tr('Trend needs the same data a week ago.')}
                </p>
              )}

              {trend && (
                <p className="life-score-basis">
                  {tr('Trend based on')} {trend.basis}.
                </p>
              )}
            </div>
          </div>

          <div className="life-score-divider" />

          <div className="life-score-dimensions">
            <h3>{tr('Life Score')}</h3>

            <ul className="mt-3 space-y-3">
              {DIMENSIONS.map((d) => (
                <li key={d}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{LABELS[d]}</span>
                    <span className="tabular-nums font-semibold text-slate-600 dark:text-slate-300">
                      {dimensions[d] ? dimensions[d].score : tr('No data yet')}
                    </span>
                  </div>

                  {dimensions[d] && (
                    <ProgressBar
                      value={dimensions[d].score}
                      label={`${LABELS[d]} score`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {overall != null && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300"
          >
            {tr('How is this calculated?')}
            <ChevronDown
              size={18}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {open && (
            <div className="life-score-explanation space-y-2 text-sm">
              <p>{explanation}</p>
              {DIMENSIONS.filter((d) => dimensions[d]).map((d) => (
                <p key={d}>
                  <span className="font-semibold">
                    {LABELS[d]} {dimensions[d].score}:
                  </span>{' '}
                  {dimensions[d].why}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
