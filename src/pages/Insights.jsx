import { useMemo } from 'react'
import { useSnapshot } from '../hooks/useSnapshot'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import StatCard from '../components/ui/StatCard'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import ProgressBar from '../components/ui/ProgressBar'
import BarChart from '../components/charts/BarChart'
import LineChart from '../components/charts/LineChart'
import { addDays, formatDate, formatMonthShort } from '../utils/date'
import { formatMoney } from '../utils/format'
import { completedPerWeek, minutesPerWeek, savingsRate, studyDaysInRange, taskStats } from '../utils/metrics'
import { effectiveProgress } from '../utils/goals'
import { tr } from '../i18n'

const KEYS = ['tasks', 'sessions', 'monthly', 'goals', 'milestones', 'learning']
const NotEnough = () => <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">{tr('Not enough data yet.')}</p>
const Section = ({ title, children }) => <Card className="p-4"><h2 className="mb-3 text-base font-semibold">{title}</h2>{children}</Card>
const weekLabel = (iso) => formatDate(iso).replace(/^\w+, /, '')

export default function Insights() {
  const { data, errors, loading, reload, today } = useSnapshot(KEYS)
  const v = useMemo(() => {
    const tasks = data.tasks || []
    const monthly = data.monthly || []
    const perWeek = completedPerWeek(tasks, today, 8)
    const study = minutesPerWeek(data.sessions || [], today, 8)
    return {
      stats: taskStats(tasks, today), perWeek, study, monthly,
      weeksWithTasks: perWeek.filter((w) => w.count > 0).length,
      weeksWithStudy: study.filter((w) => w.minutes > 0).length,
      monthsWithData: monthly.filter((m) => m.income > 0 || m.expenses > 0).length,
      studyDays30: studyDaysInRange(data.sessions || [], addDays(today, -29), addDays(today, 1)),
      goals: data.goals || [], milestones: data.milestones || [],
    }
  }, [data, today])

  if (loading) return <Spinner />
  const failed = Object.values(errors)[0]
  if (failed && !data.tasks) return <ErrorState message={failed} onRetry={reload} />

  const goalCounts = ['active', 'completed', 'paused', 'archived'].map((s) => [s, v.goals.filter((g) => g.status === s).length])
  return (
    <div>
      <PageHeader title={tr('Insights')} subtitle={tr('Trends from your own records. Charts need at least two periods of data.')} />
      <div className="space-y-4">
        <Section title={tr('Productivity')}>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatCard label={tr('Done this week')} value={v.stats.completedThisWeek} />
            <StatCard label={tr('Overdue now')} value={v.stats.overdue.length} tone={v.stats.overdue.length ? 'negative' : undefined} />
            <StatCard label={tr('Week completion')} value={v.stats.weekCompletionRate == null ? '-' : `${v.stats.weekCompletionRate}%`} hint={v.stats.dueThisWeekCount ? `of ${v.stats.dueThisWeekCount} due` : 'Nothing was due'} />
          </div>
          {v.weeksWithTasks >= 2 ? <BarChart unit="count" data={v.perWeek.map((w) => ({ label: weekLabel(w.week), values: [w.count] }))} series={[{ name: 'Tasks completed', className: 'bg-brand-500' }]} summary="Tasks completed per week" /> : <NotEnough />}
        </Section>

        <Section title={tr('Finance (TSh)')}>
          {v.monthsWithData >= 2 ? (
            <div className="space-y-5">
              <div><p className="mb-1 text-sm font-medium">{tr('Monthly expenses')}</p><LineChart points={v.monthly.map((m) => ({ label: formatMonthShort(m.month), value: m.expenses }))} summary="Monthly expenses in TSh" /></div>
              <div><p className="mb-1 text-sm font-medium">{tr('Savings (income minus expenses)')}</p><LineChart points={v.monthly.map((m) => ({ label: formatMonthShort(m.month), value: m.income - m.expenses }))} summary="Monthly savings in TSh" /></div>
              <ul className="space-y-1 text-sm">
                {v.monthly.filter((m) => m.income > 0).slice(-3).map((m) => <li key={m.month}>{formatMonthShort(m.month)}{tr(': saved')} {formatMoney(m.income - m.expenses)} ({savingsRate(m.income, m.expenses)}{tr('% of income)')}</li>)}
              </ul>
            </div>
          ) : <NotEnough />}
        </Section>

        <Section title={tr('Goals')}>
          {v.goals.length === 0 ? <NotEnough /> : (
            <>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{goalCounts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(', ')}</p>
              <ul className="space-y-3">{v.goals.filter((g) => g.status === 'active').map((g) => <li key={g.id}><p className="mb-1 text-sm font-medium">{g.name}</p><ProgressBar value={effectiveProgress(g, v.milestones)} label={`${g.name} progress`} /></li>)}</ul>
            </>
          )}
        </Section>

        <Section title={tr('Learning')}>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{v.studyDays30 > 0 ? `You studied on ${v.studyDays30} of the last 30 days.` : tr('No study sessions in the last 30 days.')}</p>
          {v.weeksWithStudy >= 2 ? <BarChart unit="count" data={v.study.map((w) => ({ label: weekLabel(w.week), values: [w.minutes] }))} series={[{ name: 'Minutes studied', className: 'bg-brand-500' }]} summary="Minutes studied per week" /> : <NotEnough />}
        </Section>
      </div>
    </div>
  )
}
