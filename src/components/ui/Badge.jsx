const TONES = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
}

export default function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>{children}</span>
  )
}
