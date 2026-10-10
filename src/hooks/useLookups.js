import { useEffect, useMemo, useState } from 'react'
import { db } from '../services/db'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/constants'

const DEFS = {
  goals: { table: 'goals', label: 'name' },
  projects: { table: 'projects', label: 'name' },
  tasks: { table: 'tasks', label: 'title' },
  learning_items: { table: 'learning_items', label: 'topic' },
}

const cap = (v) => String(v).replace(/^\w/, (c) => c.toUpperCase())

/**
 * Loads reference lists for form dropdowns.
 * Names: goals, projects, tasks, learning_items, expense_categories, income_categories.
 * Returns { options: {name: [{value,label}]}, rows: {name: [...]}, ready }.
 */
export function useLookups(names = [], reloadKey = 0) {
  const key = names.join(',')
  const [rows, setRows] = useState({})
  const [ready, setReady] = useState(names.length === 0)

  useEffect(() => {
    if (!names.length) return undefined
    let active = true
    const wanted = key.split(',')
    Promise.all(
      wanted.map(async (name) => {
        try {
          if (DEFS[name]) return [name, await db.list(DEFS[name].table, { order: [{ column: 'created_at', ascending: false }], limit: 500 })]
          const kind = name === 'expense_categories' ? 'expense' : 'income'
          return [name, await db.list('finance_categories', { filters: [{ op: 'eq', column: 'kind', value: kind }], order: [{ column: 'name', ascending: true }] })]
        } catch {
          return [name, []]
        }
      }),
    ).then((entries) => {
      if (!active) return
      setRows(Object.fromEntries(entries))
      setReady(true)
    })
    return () => {
      active = false
    }
  }, [key, reloadKey])

  const options = useMemo(() => {
    const out = {}
    for (const name of key ? key.split(',') : []) {
      const list = rows[name] || []
      if (DEFS[name]) {
        out[name] = list.map((r) => ({ value: r.id, label: r[DEFS[name].label] }))
      } else {
        const defaults = name === 'expense_categories' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
        const custom = list
          .map((r) => ({ value: r.name.trim().toLowerCase(), label: cap(r.name.trim()) }))
          .filter((c) => !defaults.some((d) => d.value === c.value))
        out[name] = [...defaults, ...custom]
      }
    }
    return out
  }, [rows, key])

  return { options, rows, ready }
}
