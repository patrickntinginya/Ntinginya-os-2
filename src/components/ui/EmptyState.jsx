import { tr } from '../../i18n'

export default function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="premium-empty-state flex flex-col items-center rounded-3xl border border-dashed border-brand-200 bg-gradient-to-b from-brand-50/80 to-white px-6 py-11 text-center dark:border-emerald-400/20 dark:from-emerald-500/[0.07] dark:to-surface-dark">
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-emerald-100 text-brand-700 shadow-sm dark:from-emerald-500/20 dark:to-brand-500/10 dark:text-emerald-200">
          <Icon size={24} aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-bold tracking-tight text-slate-800 dark:text-white">{tr(title)}</p>
      {text && <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">{tr(text)}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
