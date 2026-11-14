import { tr } from '../../i18n'

/** Segmented control. Scrolls sideways on small screens when there are many tabs. */
export default function Tabs({ tabs, value, onChange, label }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="premium-tabs -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold transition-all duration-200 ${
            value === t.value
              ? 'bg-brand-700 text-white shadow-md shadow-brand-900/15 dark:bg-emerald-600'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-800 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200'
          }`}
        >
          {tr(t.label)}
          {t.badge > 0 && <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white" aria-label={tr('{n} unread', { n: t.badge })}>{t.badge > 99 ? '99+' : t.badge}</span>}
        </button>
      ))}
    </div>
  )
}
