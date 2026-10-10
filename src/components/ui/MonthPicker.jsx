import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, formatMonth } from '../../utils/date'
import { tr } from '../../i18n'

/** month is the first day of a month (YYYY-MM-01). */
export default function MonthPicker({ month, onChange, maxMonth }) {
  const atMax = maxMonth && month >= maxMonth
  return (
    <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-1 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
      <button type="button" className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label={tr('Previous month')}>
        <ChevronLeft size={20} />
      </button>
      <span className="font-semibold">{formatMonth(month)}</span>
      <button type="button" className="icon-btn disabled:opacity-30" onClick={() => onChange(addMonths(month, 1))} disabled={atMax} aria-label={tr('Next month')}>
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
