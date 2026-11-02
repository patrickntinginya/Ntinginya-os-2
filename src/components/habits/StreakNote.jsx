import { Flame, Sprout } from 'lucide-react'
import { t } from '../../i18n'

/** Gentle streak feedback. Never uses failure language: a miss is a "fresh start", history is kept. */
export default function StreakNote({ report, safeDays = 0 }) {
  if (!report) return null
  const lines = []
  if (report.needsRestart) lines.push({ key: 'restart', icon: Sprout, text: t('streak.restart') })
  else if (report.current === 0 && report.best > 0) lines.push({ key: 'again', icon: Sprout, text: t('streak.again', { best: report.best }) })
  if (report.current > 0 && report.comeback) lines.push({ key: 'comeback', icon: Sprout, text: t('streak.comeback', { n: report.current }) })
  if (report.milestone) lines.push({ key: 'milestone', icon: Flame, text: t('streak.milestone', { n: report.milestone }) })
  if (report.next && report.current > 0) lines.push({ key: 'next', icon: Flame, text: t('streak.next', { n: report.daysToNext, m: report.next }) })
  if (safeDays > 0) lines.push({ key: 'safe', icon: Sprout, text: t('streak.safeDays', { n: safeDays }) })
  return (
    <div className="mt-3 space-y-1.5 text-sm" aria-live="polite">
      <dl className="grid grid-cols-2 gap-2 text-center">
        <div><dd className="text-lg font-bold tabular-nums">{report.current}</dd><dt className="text-xs text-slate-500 dark:text-slate-400">{t('streak.current')}</dt></div>
        <div><dd className="text-lg font-bold tabular-nums">{report.best}</dd><dt className="text-xs text-slate-500 dark:text-slate-400">{t('streak.best')}</dt></div>
      </dl>
      {lines.map(({ key, icon: Icon, text }) => (
        <p key={key} className="flex items-start gap-2 text-slate-700 dark:text-slate-200"><Icon size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />{text}</p>
      ))}
      <details className="text-xs text-slate-500 dark:text-slate-400">
        <summary className="min-h-[44px] cursor-pointer py-3 font-medium">{t('streak.rulesTitle')}</summary>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('streak.rule1')}</li>
          <li>{t('streak.rule2')}</li>
          <li>{t('streak.rule3')}</li>
          <li>{t('streak.rule4')}</li>
        </ul>
      </details>
    </div>
  )
}
