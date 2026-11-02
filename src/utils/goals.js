import { goalMilestoneCounts } from './metrics.js'

/** Progress follows milestones when the goal has any; otherwise the manual progress value is used. */
export const effectiveProgress = (goal, milestones) => {
  const c = goalMilestoneCounts(goal.id, milestones)
  return c.total > 0 ? Math.round((c.done / c.total) * 100) : Number(goal.progress) || 0
}
