import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { useLookups } from '../hooks/useLookups'
import { db } from '../services/db'
import PageHeader from './ui/PageHeader'
import Button from './ui/Button'
import Spinner from './ui/Spinner'
import ErrorState from './ui/ErrorState'
import EmptyState from './ui/EmptyState'
import ConfirmDialog from './ui/ConfirmDialog'
import RecordForm from './RecordForm'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

const resolve = (v, arg) => (typeof v === 'function' ? v(arg) : v)

/**
 * Config-driven CRUD screen. A page supplies a config; this component provides loading, error and empty
 * states, the add/edit form, delete confirmation, optional filter chips and text search.
 *
 * config: table, title, subtitle, singular, icon, order, queryFilters, fields (array or fn(lookups)),
 *   defaults (object or fn), lookups: [names], extras: [tables], renderItem(item, actions, lookups, ctx),
 *   sections(items), empty, filter, search: [fields], validate, beforeSave, onMutated, itemLabel
 */
export default function ResourcePage({ config, embedded = false, onItemsChange, headerExtra, openNewSignal }) {
  const {
    table, title, subtitle, singular, icon, order, queryFilters, fields, defaults, renderItem, sections, empty,
    filter, search, validate, warn, beforeSave, onMutated, lookups: lookupNames = [], extras: extraNames = [],
    itemLabel = (i) => i.title || i.name || i.topic,
  } = config

  const { items, loading, error, reload, create, update, remove } = useResource(table, { order, filters: queryFilters, onMutated })
  const lookups = useLookups(lookupNames)
  const [extras, setExtras] = useState({})
  const [form, setForm] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [actionError, setActionError] = useState(null)

  const extraKey = extraNames.join(',')
  const reloadExtras = useCallback(async () => {
    if (!extraKey) return
    const entries = await Promise.all(
      extraKey.split(',').map(async (name) => {
        try {
          return [name, await db.list(name, { order: [{ column: 'created_at', ascending: true }], limit: 1000 })]
        } catch {
          return [name, []]
        }
      }),
    )
    setExtras(Object.fromEntries(entries))
  }, [extraKey])
  useEffect(() => {
    reloadExtras()
  }, [reloadExtras])

  useEffect(() => {
    onItemsChange?.(items)
  }, [items, onItemsChange])

  useEffect(() => {
    if (openNewSignal) setForm({})
  }, [openNewSignal])

  const visible = useMemo(() => {
    let rows = filter && activeFilter !== 'all' ? items.filter((i) => i[filter.field] === activeFilter) : items
    const needle = query.trim().toLowerCase()
    if (search && needle) {
      rows = rows.filter((r) => search.some((f) => (Array.isArray(r[f]) ? r[f].join(' ') : String(r[f] ?? '')).toLowerCase().includes(needle)))
    }
    return rows
  }, [items, filter, activeFilter, query, search])

  const groups = sections ? sections(visible, lookups) : [{ key: 'all', title: null, items: visible }]

  const actionsFor = (item) => ({
    edit: () => setForm({ item }),
    remove: () => setToDelete(item),
    reload,
    reloadExtras,
    update: async (patch) => {
      setActionError(null)
      try {
        await update(item.id, patch)
      } catch (e) {
        setActionError(friendlyError(e))
      }
    },
    create: async (values) => {
      setActionError(null)
      try {
        await create(values)
      } catch (e) {
        setActionError(friendlyError(e))
      }
    },
  })
  const ctx = { extras, reloadExtras }

  const save = async (values) => {
    const payload = beforeSave ? beforeSave(values, form.item) : values
    if (form.item) await update(form.item.id, payload)
    else await create(payload)
    reloadExtras()
  }

  const addButton = (
    <Button onClick={() => setForm({})} className="shrink-0">
      <Plus size={20} aria-hidden="true" />
      {tr('Add')}
    </Button>
  )

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex items-center justify-end gap-2">{headerExtra}{addButton}</div>
      ) : (
        <PageHeader title={title} subtitle={subtitle} action={<div className="flex items-center gap-2">{headerExtra}{addButton}</div>} />
      )}

      {search && items.length > 0 && (
        <div className="relative mb-4">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor={`search-${table}`} className="sr-only">{tr('Search')} {title}</label>
          <input id={`search-${table}`} type="search" className="input !pl-10" placeholder={`Search ${(title || 'items').toLowerCase()}`}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {filter && items.length > 0 && (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[{ value: 'all', label: 'All' }, ...filter.options].map((o) => (
            <button key={o.value} type="button" onClick={() => setActiveFilter(o.value)} aria-pressed={activeFilter === o.value}
              className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-medium ${
                activeFilter === o.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10'
              }`}>
              {tr(o.label)}
            </button>
          ))}
        </div>
      )}

      {actionError && <div className="mb-4"><ErrorState message={actionError} compact /></div>}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState icon={icon} title={empty.title} text={empty.text} action={<Button onClick={() => setForm({})}>{tr(empty.action)}</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={icon} title={tr('Nothing here')} text={tr('No items match your search or filter.')} />
      ) : (
        <div className="space-y-6">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.key} aria-label={g.title || title}>
                  {g.title && <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{g.title}</h2>}
                  <ul className="space-y-3">
                    {g.items.map((item) => (
                      <li key={item.id}>{renderItem(item, actionsFor(item), lookups, ctx)}</li>
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}

      {form && (
        <RecordForm
          title={tr(`${form.item ? 'Edit' : 'New'} ${singular}`)}
          fields={resolve(fields, lookups)}
          initial={form.item}
          defaults={resolve(defaults, undefined) || {}}
          validate={validate}
          warn={warn}
          onSubmit={save}
          onClose={() => setForm(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={tr(`Delete ${singular}?`)}
          message={tr('"{name}" will be permanently deleted.', { name: itemLabel(toDelete) || tr(singular) })}
          onConfirm={async () => {
            await remove(toDelete.id)
            reloadExtras()
          }}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
