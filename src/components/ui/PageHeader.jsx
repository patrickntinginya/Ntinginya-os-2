import { tr } from '../../i18n'
export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{tr(title)}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{tr(subtitle)}</p>}
      </div>
      {action}
    </div>
  )
}
