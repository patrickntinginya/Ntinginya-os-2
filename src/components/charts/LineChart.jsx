import { formatCompact } from '../../utils/format'
import { tr } from '../../i18n'

/** Simple SVG line chart that handles negative values (zero line drawn). points: [{label, value}] */
export default function LineChart({ points, summary, colorClass = 'stroke-brand-600', unit = 'money' }) {
  const W = 300
  const H = 120
  const pad = 8
  const values = points.map((p) => p.value)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values, 1)
  const span = max - min || 1
  const x = (i) => pad + (points.length === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (points.length - 1))
  const y = (v) => pad + ((max - v) / span) * (H - 2 * pad)
  const fmt = unit === 'money' ? formatCompact : (v) => String(Math.round(v))
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-white/20" strokeDasharray="3 3" />
        <polyline fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className={colorClass}
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
        {points.map((p, i) => (
          <circle key={p.label} cx={x(i)} cy={y(p.value)} r="3.5" className="fill-brand-600">
            <title>{`${p.label}: ${fmt(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
        {points.map((p) => <span key={p.label}>{p.label}</span>)}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{tr('Range')} {fmt(min)} {tr('to')} {fmt(max)}</p>
    </figure>
  )
}
