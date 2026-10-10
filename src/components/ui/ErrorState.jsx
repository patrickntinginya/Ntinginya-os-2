import { AlertTriangle } from 'lucide-react'
import Button from './Button'
import { tr } from '../../i18n'

export default function ErrorState({ message, onRetry, compact = false }) {
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 ${
        compact ? 'p-3 text-sm' : 'p-5'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-medium">{tr('Something went wrong')}</p>
          <p className="mt-0.5 text-sm opacity-90">{message}</p>
          {onRetry && (
            <Button variant="secondary" className="mt-3 !min-h-[44px]" onClick={onRetry}>
              {tr('Try again')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
