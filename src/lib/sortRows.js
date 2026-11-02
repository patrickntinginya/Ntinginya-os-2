// Sorts rows the way db.list() asks Supabase to: by several columns, each ascending/descending, with nulls last
// unless nullsFirst is true. Used for the offline view so the order matches the online list.
function cmp(a, b) {
  if (a === b) return 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? 1 : -1
  return a < b ? -1 : 1
}

export function sortRows(rows, order = []) {
  if (!order.length) return rows.slice()
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      for (const o of order) {
        const a = x.row[o.column]
        const b = y.row[o.column]
        const aNull = a === null || a === undefined
        const bNull = b === null || b === undefined
        if (aNull || bNull) {
          if (aNull && bNull) continue
          return (aNull ? 1 : -1) * (o.nullsFirst ? -1 : 1)
        }
        const c = cmp(a, b)
        if (c) return o.ascending === false ? -c : c
      }
      return x.index - y.index
    })
    .map((x) => x.row)
}
