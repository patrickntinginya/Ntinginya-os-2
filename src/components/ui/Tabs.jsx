import { tr } from '../../i18n'
/** Segmented control. Scrolls sideways on small screens when there are many tabs. */
export default function Tabs({ tabs, value, onChange, label }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold ${
            value === t.value
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10'
          }`}
        >
          {tr(t.label)}
        </button>
      ))}
    </div>
  )
}
