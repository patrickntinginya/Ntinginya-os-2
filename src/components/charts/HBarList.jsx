import { formatMoney } from '../../utils/format'
import { labelOf } from '../../lib/constants'

/** Horizontal bars for category totals: items [{ category, total }]. */
export default function HBarList({ items, limit = 8 }) {
  const shown = items.slice(0, limit)
  const max = Math.max(1, ...shown.map((i) => i.total))
  const total = items.reduce((t, i) => t + i.total, 0)
  return (
    <ul className="space-y-3">
      {shown.map((i) => (
        <li key={i.category}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{labelOf([], i.category)}</span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">
              {formatMoney(i.total)} <span className="text-xs text-slate-400">({Math.round((i.total / total) * 100)}%)</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(i.total / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
