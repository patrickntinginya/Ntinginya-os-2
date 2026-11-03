export const AI_CONTEXT_CATEGORIES = Object.freeze([
  'tasks',
  'schedule',
  'goals',
  'habits',
  'learning',
  'finance',
  'ideas',
])

export function normalizeAiContextCategories(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((category) => AI_CONTEXT_CATEGORIES.includes(category)))]
}
