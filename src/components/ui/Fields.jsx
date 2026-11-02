import { tr } from '../../i18n'
/** Renders one form field from a config object: { name, label, type, options, required, placeholder, half }. */
export default function Field({ field, value, onChange }) {
  const { name, label, type = 'text', options = [], required, placeholder, step, min, max, hint } = field
  const id = `field-${name}`

  let control
  if (type === 'textarea') {
    control = (
      <textarea id={id} className="input" value={value} onChange={(e) => onChange(name, e.target.value)}
        required={required} placeholder={tr(placeholder)} rows={field.rows || 3} />
    )
  } else if (type === 'select') {
    control = (
      <select id={id} className="input" value={value} onChange={(e) => onChange(name, e.target.value)} required={required}>
        {!required && <option value="">{tr('None')}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{tr(o.label)}</option>
        ))}
        {value && !options.some((o) => String(o.value) === String(value)) && <option value={value}>{String(value)}</option>}
      </select>
    )
  } else if (type === 'range') {
    control = (
      <div className="flex min-h-[48px] items-center gap-3">
        <input id={id} type="range" min={0} max={100} step={5} value={value === '' ? 0 : value}
          onChange={(e) => onChange(name, Number(e.target.value))} className="h-2 flex-1 accent-brand-600" />
        <span className="w-12 text-right font-medium tabular-nums">{value === '' ? 0 : value}%</span>
      </div>
    )
  } else {
    control = (
      <input id={id} className="input" type={type === 'tags' ? 'text' : type} value={value}
        onChange={(e) => onChange(name, e.target.value)}
        required={required} placeholder={type === 'tags' ? placeholder || 'comma, separated, tags' : placeholder}
        step={step} min={min} max={max} inputMode={type === 'number' ? 'decimal' : undefined} />
    )
  }

  return (
    <div className={field.half ? 'col-span-1' : 'col-span-2'}>
      <label htmlFor={id} className="label">
        {tr(label)}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tr(hint)}</p>}
    </div>
  )
}
