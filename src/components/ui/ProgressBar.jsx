export default function ProgressBar({ value = 0, label }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-medium tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
    </div>
  )
}
