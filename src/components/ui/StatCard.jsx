import { tr } from '../../i18n'
import Card from './Card'

export default function StatCard({ label, value, hint, tone }) {
  const color = tone === 'negative' ? 'text-red-600 dark:text-red-400' : tone === 'positive' ? 'text-brand-700 dark:text-brand-300' : ''
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{tr(label)}</p>
      <p className={`mt-1 truncate text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{tr(hint)}</p>}
    </Card>
  )
}
