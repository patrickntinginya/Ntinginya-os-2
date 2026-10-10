import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useSnapshot } from '../hooks/useSnapshot'
import PageHeader from '../components/ui/PageHeader'
import Tabs from '../components/ui/Tabs'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import StatCard from '../components/ui/StatCard'
import AskAiPanel from '../components/ai/AskAiPanel'
import { addDays, formatDate, formatLongDate, startOfWeek } from '../utils/date'
import { formatMoney } from '../utils/format'
import { expandEvents } from '../utils/metrics'
import { buildDailyReview, buildWeeklyLifeReview } from '../utils/reviews'
import { labelOf } from '../lib/constants'
import { tr } from '../i18n'

const DAILY_KEYS = ['tasks', 'events', 'reminders', 'goals', 'milestones', 'learning', 'monthly', 'catThis', 'catPrev', 'budgets']
const WEEKLY_KEYS = ['tasks', 'goals', 'milestones', 'learning', 'sessions', 'weekIncome', 'weekExpenses', 'budgets', 'catThis', 'projects', 'habits', 'habitEntries']

const List = ({ items }) => <ul className="space-y-1.5 text-[15px]">{items.map((i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-slate-400">-</span><span>{i}</span></li>)}</ul>
const Block = ({ title, children }) => <Card className="p-4"><h2 className="mb-2 text-base font-semibold">{title}</h2>{children}</Card>

function Daily({ data, today }) {
  const r = useMemo(() => buildDailyReview({
    tasks: data.tasks || [], eventsToday: expandEvents(data.events || [], today, today), reminders: data.reminders || [], goals: data.goals || [],
    milestones: data.milestones || [], learning: data.learning || [], monthly: data.monthly || [], catThis: (data.catThis || []).map((c) => ({ category: c.category, amount: c.amount })),
    catPrev: (data.catPrev || []).map((c) => ({ category: c.category, amount: c.amount })), budgets: data.budgets || [],
  }, today), [data, today])

  const matters = [
    ...r.matters.priorities.map((p) => `${p.title}${p.reasons.length ? ` (${p.reasons.join(', ')})` : ''}`),
    ...r.matters.events.map((e) => `${e.start} ${e.title}`),
    ...r.matters.reminders.map((t) => `Reminder: ${t}`),
  ]
  return (
    <div className="space-y-4">
      <Block title={tr('What matters today')}>{matters.length ? <List items={matters} /> : <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Nothing is due or scheduled today.')}</p>}</Block>
      <Block title={tr('Potential conflicts')}><List items={r.conflicts} /></Block>
      <Block title={tr('Financial observation')}><List items={r.finance} /></Block>
      <Block title={tr('Goal observation')}><List items={r.goals} /></Block>
      <Block title={tr('Learning recommendation')}><p className="text-[15px]">{r.learning}</p></Block>
      <Block title={tr('Suggested priorities')}>{r.suggested.length ? <ol className="list-decimal space-y-1.5 pl-5 text-[15px]">{r.suggested.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Not enough data yet.')}</p>}</Block>
      <AskAiPanel title={tr('AI daily summary')} mode="daily_review" description={tr('A written review of today from your real data. Nothing is saved unless you confirm a proposed action.')}
        prompt={tr('Write my daily review.')} buttonLabel={tr('Write my daily review')} />
    </div>
  )
}

function Weekly({ data, today }) {
  const r = useMemo(() => buildWeeklyLifeReview({
    projects: data.projects || [], habits: data.habits || [], entries: data.habitEntries || [],
    tasks: data.tasks || [], goals: data.goals || [], milestones: data.milestones || [], learning: data.learning || [], sessions: data.sessions || [],
    weekIncome: data.weekIncome || [], weekExpenses: data.weekExpenses || [], budgets: data.budgets || [], catThis: (data.catThis || []).map((c) => ({ category: c.category, amount: c.amount })),
  }, today), [data, today])
  const ws = startOfWeek(today)
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Week of')} {formatDate(ws)} {tr('to')} {formatDate(addDays(ws, 6))}</p>
      <Block title={tr('Productivity')}>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={tr('Completed')} value={r.productivity.completed} />
          <StatCard label={tr('Overdue')} value={r.productivity.overdue} tone={r.productivity.overdue ? 'negative' : undefined} />
          <StatCard label={tr('Completion rate')} value={r.productivity.rate == null ? '-' : `${r.productivity.rate}%`} hint={r.productivity.rate == null ? 'No tasks were due' : `of ${r.productivity.dueThisWeek} due`} />
        </div>
      </Block>
      <Block title={tr('Finance (TSh)')}>
        {r.finance.hasData ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label={tr('Income')} value={formatMoney(r.finance.income)} />
              <StatCard label={tr('Expenses')} value={formatMoney(r.finance.expenses)} />
              <StatCard label={tr('Savings')} value={formatMoney(r.finance.savings)} tone={r.finance.savings < 0 ? 'negative' : 'positive'} />
            </div>
            {r.finance.topCategories.length > 0 && <p className="mt-3 text-sm">{tr('Largest expense categories:')} {r.finance.topCategories.map((c) => `${labelOf([], c.category)} (${formatMoney(c.total)})`).join(', ')}.</p>}
          </>
        ) : <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No income or expenses recorded this week.')}</p>}
      </Block>
      <Block title={tr('Goals')}>
        <p className="text-[15px]">{r.goals.active} {tr('active')} {r.goals.active === 1 ? 'goal' : 'goals'}.</p>
        {r.goals.neglected.length > 0 && <p className="mt-1 text-sm">{tr('Neglected:')} {r.goals.neglected.join(', ')}.</p>}
        {r.goals.deadlines.length > 0 && <p className="mt-1 text-sm">{tr('Upcoming deadlines:')} {r.goals.deadlines.map((d) => `${d.name} (${formatDate(d.date)})`).join(', ')}.</p>}
      </Block>
      <Block title={tr('Projects')}>
        {r.projects.active.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No active projects.')}</p>
        ) : (
          <ul className="space-y-1 text-[15px]">
            {r.projects.active.map((p) => <li key={p.name}>{p.name}: {p.progress == null ? 'no tasks yet' : `${p.progress}%`}</li>)}
          </ul>
        )}
        <p className="mt-2 text-sm">{r.projects.completedMilestones} {tr('milestone(s) completed this week.')}</p>
        {r.projects.delayed.length > 0 && <p className="mt-1 text-sm">{tr('Delayed:')} {r.projects.delayed.join(', ')}.</p>}
      </Block>
      <Block title={tr('Habits')}>
        {r.habits.count === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No habits yet.')}</p>
        ) : (
          <p className="text-[15px]">
            {r.habits.rate == null ? tr('No habit days were due this week.') : `${r.habits.rate}% of habit days completed (${r.habits.done} of ${r.habits.due}).`}
            {r.habits.bestStreak ? ` Best current streak: ${r.habits.bestStreak.name}, ${r.habits.bestStreak.streak} day(s).` : ''}
          </p>
        )}
      </Block>
      <Block title={tr('Learning')}>
        <p className="text-[15px]">{r.learning.minutes > 0 ? `${r.learning.minutes} minutes studied on ${r.learning.consistency}.` : tr('No study sessions logged this week.')}</p>
      </Block>
      <Block title={tr('What went well')}><List items={r.wentWell} /></Block>
      <Block title={tr('What needs improvement')}><List items={r.needsWork} /></Block>
      <Block title={tr('Recommended focus for next week')}><List items={r.focus} /></Block>
      <AskAiPanel title={tr('AI weekly summary')} mode="weekly_review" description={tr('A written review of your week from your real data.')}
        prompt={tr('Write my weekly review.')} buttonLabel={tr('Write my weekly review')} />
    </div>
  )
}

export default function Reviews() {
  const { kind } = useParams()
  const navigate = useNavigate()
  if (kind !== 'daily' && kind !== 'weekly') return <Navigate to="/reviews/daily" replace />
  return <ReviewBody kind={kind} onKind={(k) => navigate(`/reviews/${k}`)} />
}

function ReviewBody({ kind, onKind }) {
  const keys = kind === 'daily' ? DAILY_KEYS : WEEKLY_KEYS
  const { data, errors, loading, reload, today } = useSnapshot(keys)
  return (
    <div>
      <PageHeader title={kind === 'daily' ? 'Daily review' : 'Weekly review'} subtitle={kind === 'daily' ? formatLongDate() : undefined} />
      <Tabs tabs={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} value={kind} onChange={onKind} label={tr('Review type')} />
      {loading ? <Spinner /> : errors.tasks ? <ErrorState message={errors.tasks} onRetry={reload} /> : kind === 'daily' ? <Daily data={data} today={today} /> : <Weekly data={data} today={today} />}
    </div>
  )
}
