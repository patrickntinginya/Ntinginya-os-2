import { tr } from '../../i18n'
import { Loader2 } from 'lucide-react'

export default function Spinner({ label = 'Loading', fullScreen = false }) {
  const body = (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500 dark:text-slate-400" role="status">
      <Loader2 className="animate-spin" size={20} aria-hidden="true" />
      <span className="text-sm">{tr(label)}...</span>
    </div>
  )
  return fullScreen ? <div className="flex min-h-dvh items-center justify-center">{body}</div> : body
}
