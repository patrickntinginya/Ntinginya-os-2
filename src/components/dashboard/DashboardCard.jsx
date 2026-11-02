import { tr } from '../../i18n'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import ErrorState from '../ui/ErrorState'
import Spinner from '../ui/Spinner'

/** Shared shell for every dashboard card: title, "view all" link, and loading / error / empty states. */
export default function DashboardCard({ title, icon: Icon, to, linkLabel = 'View all', loading, error, empty, emptyText, emptyAction, children }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {Icon && <Icon size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />}
          {tr(title)}
        </h2>
        {to && !empty && (
          <Link to={to} className="flex min-h-[44px] items-center px-1 text-sm font-medium text-brand-700 dark:text-brand-300">
            {linkLabel}
          </Link>
        )}
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} compact />
      ) : empty ? (
        <div className="py-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
          {to && emptyAction && (
            <Link to={to} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 dark:text-brand-300">
              {emptyAction}
            </Link>
          )}
        </div>
      ) : (
        children
      )}
    </Card>
  )
}
