import { Link } from 'react-router-dom'
import {
  Sunrise,
  CalendarDays,
  ListTodo,
  Bell,
  ArrowUpRight,
  Target,
  Wallet,
  Flame,
  AlertCircle,
} from 'lucide-react'
import Card from '../ui/Card'
import { greeting } from '../../utils/date'
import { tr } from '../../i18n'

const plural = (n, one, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/** Daily briefing based entirely on the user's existing data. */
export default function BriefingCard({ briefing, name }) {
  const { hasData, counts, priorities, goalFocus, financeAlert, habit } = briefing
  const firstPriority = priorities?.[0]
  const remainingPriorities = priorities?.slice(1) || []

  return (
    <Card className="dashboard-briefing p-5">
      <div className="briefing-heading">
        <div className="briefing-heading-icon">
          <Sunrise size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold">{tr('Daily briefing')}</h2>
          <p className="briefing-eyebrow">{tr('Today')}</p>
        </div>
      </div>

      <div className="briefing-greeting">
        <p>
          {greeting().toUpperCase()}
          {name ? `, ${name.toUpperCase()}` : ''}
        </p>
      </div>

      {!hasData ? (
        <div className="briefing-empty">
          <Sunrise size={25} aria-hidden="true" />
          <p>
            {tr('Not enough data yet. Add a task, event, habit or goal and your briefing will appear here.')}
          </p>
        </div>
      ) : (
        <div className="briefing-content">
          <div className="briefing-counts">
            <div className="briefing-count">
              <span className="briefing-count-icon tasks">
                <ListTodo size={17} aria-hidden="true" />
              </span>
              <strong>{counts.tasks}</strong>
              <span>{plural(counts.tasks, 'task')}</span>
              {counts.overdue > 0 && (
                <small className="briefing-overdue">
                  {counts.overdue} overdue
                </small>
              )}
            </div>

            <div className="briefing-count">
              <span className="briefing-count-icon events">
                <CalendarDays size={17} aria-hidden="true" />
              </span>
              <strong>{counts.events}</strong>
              <span>{plural(counts.events, 'scheduled event')}</span>
            </div>

            <div className="briefing-count">
              <span className="briefing-count-icon reminders">
                <Bell size={17} aria-hidden="true" />
              </span>
              <strong>{counts.reminders}</strong>
              <span>{plural(counts.reminders, 'reminder')}</span>
            </div>
          </div>

          {priorities.length > 0 && (
            <section className="briefing-priority">
              <div className="briefing-section-label">
                <AlertCircle size={15} aria-hidden="true" />
                {tr('Priority')}
              </div>

              <div className="briefing-main-priority">
                <span className="briefing-priority-number">01</span>
                <p>{firstPriority}</p>
              </div>

              {remainingPriorities.length > 0 && (
                <ol className="briefing-secondary-priorities">
                  {remainingPriorities.map((priority, index) => (
                    <li key={`${priority}-${index}`}>
                      <span>{String(index + 2).padStart(2, '0')}</span>
                      {priority}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <div className="briefing-details">
            {goalFocus && (
              <div className="briefing-detail">
                <span className="briefing-detail-icon goal">
                  <Target size={17} aria-hidden="true" />
                </span>
                <div className="briefing-detail-body">
                  <span>{tr('Goal focus')}</span>
                  <strong>{goalFocus.name}</strong>
                  <div className="briefing-goal-track">
                    <span style={{ width: `${Math.max(0, Math.min(100, Number(goalFocus.percent) || 0))}%` }} />
                  </div>
                  <small>{goalFocus.percent}%</small>
                </div>
              </div>
            )}

            {financeAlert && (
              <div className="briefing-detail">
                <span className="briefing-detail-icon finance">
                  <Wallet size={17} aria-hidden="true" />
                </span>
                <div className="briefing-detail-body">
                  <span>{tr('Financial alert')}</span>
                  <strong>{financeAlert}</strong>
                </div>
              </div>
            )}

            {habit && (
              <div className="briefing-detail">
                <span className="briefing-detail-icon habit">
                  <Flame size={17} aria-hidden="true" />
                </span>
                <div className="briefing-detail-body">
                  <span>{tr('Habits')}</span>
                  <strong>
                    {habit.done} {tr('of')} {habit.due} {tr('done today')}
                  </strong>
                  {habit.best && (
                    <small>
                      {habit.best.name}: {habit.best.streak}-day streak
                    </small>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="briefing-footer">
        <span>{tr('Counted from your own data, no AI involved.')}</span>
        <Link to="/reviews/daily">
          {tr('Daily review')}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  )
}
