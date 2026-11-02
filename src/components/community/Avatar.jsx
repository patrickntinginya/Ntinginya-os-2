import { initials } from '../../utils/community'

export default function Avatar({ name, url, size = 40 }) {
  const style = { width: size, height: size }
  return url ? (
    <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" loading="lazy" />
  ) : (
    <span style={style} aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100">{initials(name)}</span>
  )
}
