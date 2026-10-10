import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import { searchAll } from '../services/search'
import { cleanTerm } from '../utils/searchTerm'
import { tr } from '../i18n'

const snippet = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').slice(0, 90))

/** Searches only the signed-in user's own records (Row Level Security enforces the owner on every table). */
export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState(null)
  const [loading, setLoading] = useState(false)
  const term = cleanTerm(query)

  useEffect(() => {
    if (term.length < 2) {
      setGroups(null)
      return undefined
    }
    let active = true
    setLoading(true)
    // Wait for the user to stop typing so we do not send a request per keystroke.
    const id = setTimeout(() => {
      searchAll(term)
        .then((g) => active && setGroups(g))
        .catch(() => active && setGroups([]))
        .finally(() => active && setLoading(false))
    }, 350)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [term])

  const total = groups ? groups.reduce((n, g) => n + g.rows.length, 0) : 0

  return (
    <div>
      <PageHeader title={tr('Search')} subtitle={tr('Tasks, schedule, goals, projects, ideas, notes, learning and finance.')} />
      <form onSubmit={(e) => e.preventDefault()} role="search" className="relative mb-5">
        <label htmlFor="global-search" className="sr-only">{tr('Search everything')}</label>
        <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input id="global-search" type="search" autoFocus className="input !pl-10" placeholder={tr('Type at least 2 letters')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>

      {loading ? (
        <Spinner label={tr('Searching')} />
      ) : term.length < 2 ? (
        <EmptyState icon={SearchIcon} title={tr('Search your data')} text={tr('Find a task, note, idea, goal or expense by a word you remember.')} />
      ) : groups && total === 0 && !groups.some((g) => g.failed) ? (
        <EmptyState icon={SearchIcon} title={tr('No matches')} text={`Nothing found for "${term}".`} />
      ) : (
        <div className="space-y-5">
          {(groups || []).map((g) => (
            <section key={g.table} aria-label={tr(g.label)}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{tr(g.label)}</h2>
              {g.failed ? (
                <p className="text-sm text-red-600 dark:text-red-400">{tr('This section could not be searched. Please try again.')}</p>
              ) : (
                <ul className="space-y-2">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link to={g.to}>
                        <Card className="p-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
                          <p className="font-medium">{snippet(r[g.title]) || g.label.replace(/s$/, '')}</p>
                          {r[g.sub] && <p className="mt-0.5 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">{snippet(r[g.sub])}</p>}
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
