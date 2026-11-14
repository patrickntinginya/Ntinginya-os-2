export default function ProgressBar({ value = 0, label }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <div className="premium-progress flex items-center gap-3">
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-100 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 via-emerald-500 to-emerald-300 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-sm font-bold tabular-nums text-brand-800 dark:text-emerald-200">{pct}%</span>
    </div>
  )
}
