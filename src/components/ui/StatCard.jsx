import { tr } from '../../i18n'
import Card from './Card'

export default function StatCard({ label, value, hint, tone }) {
  const color =
    tone === 'negative'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'positive'
        ? 'text-brand-700 dark:text-emerald-300'
        : 'text-slate-900 dark:text-white'

  return (
    <Card className="premium-stat-card p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {tr(label)}
      </p>
      <p className={`mt-2 truncate text-xl font-extrabold tabular-nums sm:text-2xl ${color}`}>
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {tr(hint)}
        </p>
      )}
    </Card>
  )
}
