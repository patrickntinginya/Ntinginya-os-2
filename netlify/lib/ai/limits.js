/** Best-effort per-user burst limiter. Serverless instances do not share memory, so this only smooths bursts;
 *  the real cost guard is the daily limit counted from the database. */
export function makeBurstLimiter({ max = 8, windowMs = 60000, now = () => Date.now() } = {}) {
  const hits = new Map()
  return {
    allow(id) {
      const t = now()
      const recent = (hits.get(id) || []).filter((x) => t - x < windowMs)
      if (recent.length >= max) { hits.set(id, recent); return false }
      recent.push(t)
      hits.set(id, recent)
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= windowMs) hits.delete(k)
      return true
    },
  }
}

export const dailyLimitReached = (count, limit) => (count ?? 0) >= limit
