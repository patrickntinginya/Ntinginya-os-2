import { Link } from 'react-router-dom'
import { Sunrise } from 'lucide-react'
import Card from '../ui/Card'
import { greeting } from '../../utils/date'
import { tr } from '../../i18n'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The daily briefing. Every line comes from buildBriefing() on real data; lines with nothing to say are omitted. */
export default function BriefingCard({ briefing, name }) {
  const { hasData, counts, priorities, goalFocus, financeAlert, habit } = briefing
  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Sunrise size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" /> {tr('Daily briefing')}</h2>
      <p className="mt-1 text-lg font-semibold">{greeting().toUpperCase()}{name ? `, ${name.toUpperCase()}` : ''}</p>
      {!hasData ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tr('Not enough data yet. Add a task, event, habit or goal and your briefing will appear here.')}</p>
      ) : (
        <div className="mt-2 space-y-3 text-[15px]">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Today')}</p>
            <ul className="mt-0.5">
              <li>{plural(counts.tasks, 'task')}{counts.overdue ? ` (${counts.overdue} overdue)` : ''}</li>
              <li>{plural(counts.events, 'scheduled event')}</li>
              <li>{plural(counts.reminders, 'reminder')}</li>
            </ul>
          </div>
          {priorities.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Priority')}</p>
              <ol className="mt-0.5 list-decimal pl-5">{priorities.map((p) => <li key={p}>{p}</li>)}</ol>
            </div>
          )}
          {goalFocus && <div><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Goal focus')}</p><p>{goalFocus.name} - {goalFocus.percent}%</p></div>}
          {financeAlert && <div><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Financial alert')}</p><p>{financeAlert}</p></div>}
          {habit && (
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Habits')}</p>
              <p>{habit.done} {tr('of')} {habit.due} {tr('done today')}{habit.best ? `. ${habit.best.name}: ${habit.best.streak}-day streak` : ''}</p>
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tr('Counted from your own data, no AI involved.')} <Link to="/reviews/daily" className="font-medium text-brand-700 dark:text-brand-300">{tr('Daily review')}</Link></p>
    </Card>
  )
}
