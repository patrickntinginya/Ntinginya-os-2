import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bell, BookOpen, CalendarDays, CheckSquare, FolderKanban, Lightbulb, Repeat, Target, Wallet } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSnapshot } from '../hooks/useSnapshot'
import { useUnreadCount } from '../hooks/useAppServices'
import DashboardCard from '../components/dashboard/DashboardCard'
import BriefingCard from '../components/dashboard/BriefingCard'
import LifeScoreCard from '../components/dashboard/LifeScoreCard'
import ProgressBar from '../components/ui/ProgressBar'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import Card from '../components/ui/Card'
import { addDays, dateOfTimestamp, formatDate, formatLongDate, formatTime, greeting } from '../utils/date'
import { formatMoney } from '../utils/format'
import { budgetUsage, expandEvents, goalsNeedingAttention, nextActionForGoal, recommendNextTopic, savingsPlan, savingsRate, studyMinutes, taskStats } from '../utils/metrics'
import { rankTasks } from '../utils/priority'
import { buildBriefing, lifeInsights } from '../utils/briefing'
import { lifeScore } from '../utils/lifeScore'
import { doneMap, habitSummary } from '../utils/habits'
import { projectProgress, projectsNeedingAttention, rolledUpProgress } from '../utils/projects'
import { financeAlerts } from '../utils/financeIntel'
import { labelOf, TASK_PRIORITIES } from '../lib/constants'
import { tr } from '../i18n'

const KEYS = ['tasks', 'events', 'reminders', 'goals', 'milestones', 'projects', 'learning', 'sessions', 'habits', 'habitEntries', 'savingsGoals', 'totals', 'monthly', 'catThis', 'catPrev', 'budgets']

const Row = ({ children }) => <li className="flex items-start justify-between gap-3 border-t border-slate-100 py-2.5 first:border-t-0 first:pt-0 dark:border-white/5">{children}</li>
const Sub = ({ children }) => <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{children}</span>
const Muted = ({ children }) => <p className="text-xs text-slate-500 dark:text-slate-400">{children}</p>
const Group = ({ title, children }) => (
  <section aria-label={title} className="mb-8">
    <h2 className="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</h2>
    <div className="grid gap-4 md:grid-cols-2">{children}</div>
  </section>
)

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { data, errors, loading, today } = useSnapshot(KEYS)
  const unread = useUnreadCount()
  const firstName = (profile?.full_name || user?.user_metadata?.full_name || '').trim().split(' ')[0]

  const v = useMemo(() => {
    const tasks = data.tasks || []
    const goals = data.goals || []
    const milestones = data.milestones || []
    const projects = data.projects || []
    const habits = data.habits || []
    const entries = data.habitEntries || []
    const monthly = data.monthly || []
    const catThis = (data.catThis || []).map((c) => ({ category: c.category, amount: c.amount }))
    const catPrev = (data.catPrev || []).map((c) => ({ category: c.category, amount: c.amount }))
    const budgets = data.budgets || []
    const events = expandEvents(data.events || [], today, addDays(today, 7))
    const input = { tasks, events: data.events || [], reminders: data.reminders || [], goals, milestones, projects, habits, entries, learning: data.learning || [], sessions: data.sessions || [], monthly, budgets, catThis, catPrev }
    const map = doneMap(entries)
    const now = monthly[monthly.length - 1] || { income: 0, expenses: 0 }
    const monthAgo = addDays(today, -30)
    return {
      tasks, goals, milestones, projects, habits, now, budgets,
      stats: taskStats(tasks, today),
      ranked: rankTasks(tasks, { today, goalsById: Object.fromEntries(goals.map((g) => [g.id, g])) }),
      todayEvents: events.filter((e) => e.occurrence_date === today),
      next: events.find((e) => e.occurrence_date > today),
      dueReminders: (data.reminders || []).filter((r) => !r.is_done && r.remind_date <= today),
      briefing: buildBriefing(input, today),
      score: lifeScore(input, today),
      insights: lifeInsights(input, today),
      flags: goalsNeedingAttention(goals, milestones, tasks, today),
      activeGoals: goals.filter((g) => g.status === 'active').slice(0, 4),
      doneGoals: goals.filter((g) => g.status === 'completed' && g.updated_at && dateOfTimestamp(g.updated_at) >= monthAgo).slice(0, 3),
      activeProjects: projects.filter((p) => p.status === 'active' || p.status === 'planning').slice(0, 4),
      projectFlags: projectsNeedingAttention(projects, tasks, milestones, today),
      usage: budgetUsage(budgets, catThis),
      alerts: financeAlerts({ monthIncome: now.income, monthExpenses: now.expenses, budgets, catThis, catPrev, today }),
      habitSums: habits.filter((h) => !h.archived_at).map((h) => habitSummary(h, map.get(h.id) || new Set(), today)),
      studyWeek: studyMinutes(data.sessions || [], addDays(today, -6), addDays(today, 1)),
      learningNow: (data.learning || []).filter((l) => l.status === 'learning').slice(0, 3),
      nextTopic: recommendNextTopic(data.learning || []),
      savings: (data.savingsGoals || []).filter((g) => g.status === 'active').slice(0, 3),
    }
  }, [data, today])

  const hasFinance = (data.totals?.income || 0) + (data.totals?.expenses || 0) > 0
  const dueHabits = v.habitSums.filter((s) => s.dueToday)
  const habitDone = dueHabits.filter((s) => s.doneToday).length
  const habitPct = dueHabits.length ? Math.round((habitDone / dueHabits.length) * 100) : null
  const bestStreak = [...v.habitSums].sort((a, b) => b.streak - a.streak)[0]

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">{formatLongDate()}</p>
      </header>

      {loading ? <Spinner /> : (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <BriefingCard briefing={v.briefing} name={firstName} />
          <LifeScoreCard score={v.score} />
          <Card className="p-4 md:col-span-2">
            <h2 className="text-base font-semibold">{tr('Life insights')}</h2>
            {v.insights.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{v.briefing.hasData ? tr('Nothing needs your attention right now.') : tr('Not enough data yet.')}</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[15px]">
                {v.insights.slice(0, 6).map((i) => <li key={i.text}><Link to={i.to} className="hover:underline">{i.text}</Link></li>)}
              </ul>
            )}
            <Muted>{tr('Rule-based: simple comparisons of your own numbers. No AI is used here.')}</Muted>
          </Card>
        </div>
      )}

      <Group title={tr('Today')}>
        <DashboardCard title={tr('Important tasks')} icon={CheckSquare} to="/today" linkLabel={tr('My Day')} loading={loading} error={errors.tasks}
          empty={v.ranked.length === 0} emptyText={tr('No open tasks. Nothing is waiting for you.')} emptyAction={tr('Add a task')}>
          {v.stats.overdue.length > 0 && <p className="mb-2 text-sm font-medium text-red-600 dark:text-red-400">{v.stats.overdue.length} {tr('overdue')}</p>}
          <ol className="space-y-2">
            {v.ranked.slice(0, 4).map(({ task, rec }) => (
              <li key={task.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-medium">{task.title}</p>{rec.reasons[0] && <Muted>{rec.reasons.join(', ')}</Muted>}</div>
                <Badge tone={task.priority === 'urgent' || task.priority === 'high' ? 'danger' : 'neutral'}>{labelOf(TASK_PRIORITIES, task.priority)}</Badge>
              </li>
            ))}
          </ol>
        </DashboardCard>

        <DashboardCard title={tr('Schedule and reminders')} icon={CalendarDays} to="/schedule" loading={loading} error={errors.events || errors.reminders}
          empty={v.todayEvents.length + v.dueReminders.length === 0} emptyText={v.next ? `Nothing today. Next: ${v.next.title}, ${formatDate(v.next.occurrence_date)}.` : 'Nothing scheduled today.'} emptyAction={tr('Plan an activity')}>
          <ul>
            {v.todayEvents.map((e) => <Row key={`${e.id}${e.occurrence_date}`}><span className="min-w-0 flex-1 font-medium">{e.title}</span><Sub>{formatTime(e.start_time)}</Sub></Row>)}
            {v.dueReminders.slice(0, 4).map((r) => <Row key={r.id}><span className="flex min-w-0 flex-1 items-center gap-2 font-medium"><Bell size={14} aria-hidden="true" />{r.title}</span><Sub>{r.remind_date < today ? tr('Overdue') : r.remind_time ? formatTime(r.remind_time) : tr('Today')}</Sub></Row>)}
          </ul>
        </DashboardCard>

        <DashboardCard title={tr('Today\'s habits')} icon={Repeat} to="/habits" loading={loading} error={errors.habits}
          empty={v.habitSums.length === 0} emptyText={tr('No habits yet.')} emptyAction={tr('Create a habit')}>
          {dueHabits.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No habits are due today.')}</p> : (
            <>
              <p className="mb-2 text-sm"><span className="font-semibold tabular-nums">{habitDone}/{dueHabits.length}</span> {tr('done (')}{habitPct}%)</p>
              <ProgressBar value={habitPct} label={tr('Habits done today')} />
              <ul className="mt-3">{dueHabits.slice(0, 5).map((s) => <Row key={s.habit.id}><span className={`min-w-0 flex-1 font-medium ${s.doneToday ? 'text-slate-400 line-through' : ''}`}>{s.habit.name}</span><Sub>{s.streak ? `${s.streak}-day streak` : ''}</Sub></Row>)}</ul>
            </>
          )}
          {bestStreak && bestStreak.streak > 0 && <Muted>{tr('Longest running streak:')} {bestStreak.habit.name}, {bestStreak.streak} {tr('days.')}</Muted>}
        </DashboardCard>

        <DashboardCard title={tr('Notifications')} icon={Bell} to="/notifications" linkLabel={tr('Open')} loading={false} empty={unread === 0} emptyText={tr('You are all caught up.')} emptyAction="">
          <p className="text-[15px]"><span className="font-semibold tabular-nums">{unread}</span> {tr('unread')} {unread === 1 ? 'notification' : 'notifications'}.</p>
        </DashboardCard>
      </Group>

      <Group title={tr('Goals and projects')}>
        <DashboardCard title={tr('Goals')} icon={Target} to="/goals" loading={loading} error={errors.goals}
          empty={v.activeGoals.length === 0 && v.doneGoals.length === 0} emptyText={tr('No active goals yet.')} emptyAction={tr('Add a goal')}>
          <ul className="space-y-4">
            {v.activeGoals.map((g) => {
              const next = nextActionForGoal(g, v.milestones, v.tasks)
              const risk = v.flags.find((f) => f.goal.id === g.id)
              const pr = rolledUpProgress(g, { milestones: v.milestones, tasks: v.tasks, projects: v.projects })
              return (
                <li key={g.id}>
                  <div className="mb-1 flex items-start justify-between gap-2"><p className="font-medium">{g.name}</p>{risk ? <Badge tone="warn">{tr('At risk')}</Badge> : g.target_date && <Sub>{formatDate(g.target_date)}</Sub>}</div>
                  <ProgressBar value={pr.percent} label={`${g.name} progress`} />
                  {risk && <Muted>{risk.reasons[0]}</Muted>}
                  {!risk && next.type !== 'none' && <Muted>{tr('Next:')} {next.text.replace(/^(Do: |Work toward milestone: )/, '')}</Muted>}
                </li>
              )
            })}
          </ul>
          {v.doneGoals.length > 0 && <Muted>{tr('Recently completed:')} {v.doneGoals.map((g) => g.name).join(', ')}.</Muted>}
        </DashboardCard>

        <DashboardCard title={tr('Projects')} icon={FolderKanban} to="/projects" loading={loading} error={errors.projects}
          empty={v.activeProjects.length === 0} emptyText={tr('No active projects yet.')} emptyAction={tr('Create a project')}>
          <ul className="space-y-3">
            {v.activeProjects.map((p) => {
              const prog = projectProgress(p, v.tasks)
              const flag = v.projectFlags.find((f) => f.project.id === p.id)
              return (
                <li key={p.id}>
                  <div className="mb-1 flex items-start justify-between gap-2"><p className="font-medium">{p.name}</p>{flag && <Badge tone="warn">{tr('Needs attention')}</Badge>}</div>
                  {prog ? <ProgressBar value={prog.percent} label={`${p.name} progress`} /> : <Muted>{tr('No tasks linked yet, so no progress to show.')}</Muted>}
                  {flag && <Muted>{flag.reasons.join('. ')}</Muted>}
                </li>
              )
            })}
          </ul>
        </DashboardCard>
      </Group>

      <Group title={tr('Finance (TSh)')}>
        <DashboardCard title={tr('This month')} icon={Wallet} to="/finance" linkLabel={tr('Open')} loading={loading} error={errors.totals || errors.monthly}
          empty={!hasFinance} emptyText={tr('No income or expenses recorded yet. Your financial data will appear here.')} emptyAction={tr('Record income or an expense')}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Spending')}</dt><dd className="text-lg font-bold tabular-nums">{formatMoney(v.now.expenses)}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Income')}</dt><dd className="text-lg font-bold tabular-nums">{formatMoney(v.now.income)}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Savings')}</dt><dd className="font-semibold tabular-nums">{formatMoney(v.now.income - v.now.expenses)}{savingsRate(v.now.income, v.now.expenses) != null && <span className="text-xs font-normal text-slate-500"> ({savingsRate(v.now.income, v.now.expenses)}%)</span>}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Budget left')}</dt><dd className="font-semibold tabular-nums">{v.usage.length ? formatMoney(v.usage.reduce((t, u) => t + u.remaining, 0)) : tr('No budgets')}</dd></div>
          </dl>
          {v.alerts.length > 0 && <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-white/5">{v.alerts.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ul>}
        </DashboardCard>

        <DashboardCard title={tr('Savings progress')} icon={Wallet} to="/finance" linkLabel={tr('Savings')} loading={loading} error={errors.savingsGoals}
          empty={v.savings.length === 0} emptyText={tr('No savings goals yet.')} emptyAction={tr('Create a savings goal')}>
          <ul className="space-y-3">
            {v.savings.map((g) => {
              const percent = Math.min(100, Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100))
              const plan = savingsPlan(g, today)
              return (
                <li key={g.id}>
                  <div className="mb-1 flex justify-between gap-2"><p className="font-medium">{g.name}</p><Sub>{formatMoney(g.current_amount)} / {formatMoney(g.target_amount)}</Sub></div>
                  <ProgressBar value={percent} label={`${g.name} savings progress`} />
                  {plan.monthly && <Muted>{tr('Save about')} {formatMoney(plan.monthly)} {tr('a month to reach it by')} {formatDate(g.target_date)}.</Muted>}
                </li>
              )
            })}
          </ul>
        </DashboardCard>
      </Group>

      <Group title={tr('Learning')}>
        <DashboardCard title={tr('Learning')} icon={BookOpen} to="/knowledge" loading={loading} error={errors.learning}
          empty={(data.learning || []).length === 0} emptyText={tr('Add something you are learning to track it here.')} emptyAction={tr('Add a topic')}>
          <p className="mb-2 text-sm"><span className="font-semibold tabular-nums">{v.studyWeek}</span> {tr('minutes studied in the last 7 days.')}</p>
          <ul className="space-y-3">{v.learningNow.map((l) => <li key={l.id}><p className="mb-1 font-medium">{l.topic}</p><ProgressBar value={l.progress} label={`${l.topic} progress`} /></li>)}</ul>
          {v.nextTopic && <p className="mt-3 text-sm">{tr('Suggested next:')} <span className="font-medium">{v.nextTopic.item.topic}</span> <span className="text-xs text-slate-500">({v.nextTopic.why})</span></p>}
        </DashboardCard>
        <DashboardCard title={tr('Second brain')} icon={Lightbulb} to="/brainstorm" linkLabel={tr('Ideas')} loading={false} empty={false}>
          <p className="text-sm">{tr('Turn ideas and notes into projects and tasks, and learning topics into goals, with one tap.')}</p>
          <div className="mt-2 flex flex-wrap gap-x-4"><Link to="/brainstorm" className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Ideas')}</Link><Link to="/notes" className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Notes')}</Link><Link to="/knowledge" className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Knowledge')}</Link></div>
        </DashboardCard>
      </Group>
    </div>
  )
}
