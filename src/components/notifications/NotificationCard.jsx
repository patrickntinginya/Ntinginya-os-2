import { Link } from 'react-router-dom'
import { Bell, BellRing, CheckSquare, Wallet, Target, BookOpen, Sparkles, Repeat, FolderKanban, Users, CalendarCheck, CreditCard, Crown, ShieldAlert, Clock } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { isActionable, isOverdue, isSnoozed } from '../../utils/smartActions'
import { dateOfTimestamp, formatDate } from '../../utils/date'
import { tr } from '../../i18n'

const ICONS = {
  reminder: Bell, overdue_task: CheckSquare, budget: Wallet, goal_deadline: Target, learning: BookOpen, ai: Sparkles, habit: Repeat, project: FolderKanban,
  briefing: BellRing, weekly_review: BellRing, community: Users, appointment: CalendarCheck, payment: CreditCard, subscription: Crown, security: ShieldAlert,
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function NotificationCard({ n, now, busy, message, onDoIt, onSnooze, onToggleRead, onDelete, onOpen }) {
  const Icon = ICONS[n.type] || Bell
  const actionable = isActionable(n)
  const snoozed = isSnoozed(n, now)
  const overdue = isOverdue(n, now)
  const working = Boolean(busy)
  return (
    <Card className={`p-4 ${n.is_read ? 'opacity-80' : 'ring-1 ring-brand-300 dark:ring-brand-500/40'}`}>
      <div className="flex items-start gap-3">
        <Icon size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`${n.is_read ? 'font-medium' : 'font-semibold'} break-words`}>{n.title}</p>
            {overdue && <Badge tone="danger">{tr('Overdue')}</Badge>}
            {snoozed && <Badge tone="info"><Clock size={12} className="mr-1" aria-hidden="true" />{tr('Snoozed until {time}', { time: hhmm(n.snoozed_until) })}</Badge>}
            {n.status === 'done' && <Badge tone="brand">{tr('Done')}</Badge>}
          </div>
          {n.body && <p className="mt-0.5 break-words text-sm text-slate-500 dark:text-slate-400">{n.body}</p>}
          <p className="mt-1 text-xs text-slate-400">{formatDate(dateOfTimestamp(n.created_at))}</p>
        </div>
      </div>

      {actionable && !snoozed && (
        <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <Button className="!min-h-[48px] !text-sm" loading={busy === 'do'} disabled={working} onClick={() => onDoIt(n)}>{tr('DO IT')}</Button>
          <Button variant="secondary" className="!min-h-[48px] !text-sm" loading={busy === 'snooze'} disabled={working} onClick={() => onSnooze(n)}>{tr('REMIND ME AFTER 5M')}</Button>
        </div>
      )}
      {message && <p role={message.error ? 'alert' : 'status'} className={`mt-2 text-sm ${message.error ? 'text-red-600 dark:text-red-400' : 'text-brand-700 dark:text-brand-300'}`}>
        {message.text} {message.link && <Link to={message.link} className="font-semibold underline">{tr('View')}</Link>}
      </p>}

      <div className="mt-1 flex flex-wrap gap-x-4">
        {n.link && <Link to={n.link} onClick={() => onOpen(n)} className="flex min-h-[44px] items-center text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Open')}</Link>}
        <button type="button" className="min-h-[44px] text-sm font-medium text-slate-600 dark:text-slate-300" onClick={() => onToggleRead(n)}>{n.is_read ? tr('Mark unread') : tr('Mark read')}</button>
        {(n.status === 'done' || n.status === 'dismissed' || !actionable) && <button type="button" className="min-h-[44px] text-sm font-medium text-red-600 dark:text-red-400" onClick={() => onDelete(n)}>{tr('Delete')}</button>}
      </div>
    </Card>
  )
}
