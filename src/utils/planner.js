import { timeToMinutes } from './date.js'

export const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Suggests time blocks for the highest-ranked tasks (and one study block) in the FREE time between events.
 * It never moves or overlaps an existing event. Everything it returns is only a suggestion.
 *
 * events: today's event occurrences. ranked: [{task}] best first. study: optional learning item.
 */
export function buildPlan({ events, ranked, study = null, startMin = 8 * 60, endMin = 20 * 60, block = 45, buffer = 10, nowMin = null, maxBlocks = 6 }) {
  const busy = events
    .map((e) => ({ start: timeToMinutes(e.start_time), end: e.end_time ? timeToMinutes(e.end_time) : timeToMinutes(e.start_time) + 60, title: e.title }))
    .sort((a, b) => a.start - b.start)

  const from = nowMin == null ? startMin : Math.min(endMin, Math.max(startMin, Math.ceil(nowMin / 15) * 15))
  const free = []
  let cursor = from
  for (const b of busy) {
    if (b.end <= cursor) continue
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, endMin) })
    cursor = Math.max(cursor, b.end)
    if (cursor >= endMin) break
  }
  if (cursor < endMin) free.push({ start: cursor, end: endMin })

  const candidates = ranked.slice(0, maxBlocks).map((r) => ({ kind: 'task', title: r.task.title, refId: r.task.id }))
  if (study) candidates.splice(Math.min(2, candidates.length), 0, { kind: 'study', title: `Study: ${study.topic}`, refId: study.id })

  const blocks = []
  const unscheduled = []
  for (const c of candidates.slice(0, maxBlocks)) {
    const slot = free.find((f) => f.end - f.start >= block)
    if (!slot) {
      if (c.kind === 'task') unscheduled.push(c)
      continue
    }
    blocks.push({ ...c, start: slot.start, end: slot.start + block })
    slot.start += block + buffer
  }
  return { fixed: busy, blocks: blocks.sort((a, b) => a.start - b.start), unscheduled }
}
