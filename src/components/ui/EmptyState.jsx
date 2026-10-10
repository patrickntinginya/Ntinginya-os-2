import { tr } from '../../i18n'
export default function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-white/15">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
          <Icon size={22} aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-semibold">{tr(title)}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">{tr(text)}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
