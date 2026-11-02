import { formatCompact } from '../../utils/format'

/**
 * Grouped vertical bars drawn from real numbers.
 * data: [{ label, values: [n, n] }]  series: [{ name, className }]  Values are in TSh unless `unit` says otherwise.
 */
export default function BarChart({ data, series, height = 160, summary, unit = 'money' }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => Math.max(0, v))))
  const fmt = unit === 'money' ? formatCompact : (v) => String(Math.round(v))
  return (
    <figure>
      {series.length > 1 && (
        <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm ${s.className}`} aria-hidden="true" /> {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <div role="img" aria-label={summary} className="overflow-x-auto">
        <div className="relative flex items-end gap-2" style={{ height, minWidth: Math.max(240, data.length * 52) }}>
          <span className="absolute left-0 top-0 text-[10px] text-slate-400">{fmt(max)}</span>
          {data.map((d) => (
            <div key={d.label} className="flex h-full min-w-[40px] flex-1 flex-col justify-end">
              <div className="flex flex-1 items-end justify-center gap-1">
                {d.values.map((v, i) => (
                  <div
                    key={i}
                    className={`w-full max-w-[22px] rounded-t ${series[i].className}`}
                    style={{ height: `${(Math.max(0, v) / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                    title={`${d.label} - ${series[i].name}: ${fmt(v)}`}
                  />
                ))}
              </div>
              <span className="mt-1 text-center text-[11px] text-slate-500 dark:text-slate-400">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  )
}
