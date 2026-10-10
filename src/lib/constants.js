import { tr } from '../i18n/index.js'
const toOptions = (values) =>
  values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }))

export const TASK_PRIORITIES = toOptions(['low', 'medium', 'high', 'urgent'])
export const TASK_STATUSES = toOptions(['todo', 'in_progress', 'completed', 'cancelled'])
export const RECURRENCE_OPTIONS = toOptions(['none', 'daily', 'weekly', 'monthly'])
export const IMPORTANCE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` }))
export const ACTIVITY_CATEGORIES = toOptions(['personal', 'business', 'learning', 'finance', 'health', 'other'])
export const GOAL_CATEGORIES = toOptions(['personal', 'business', 'financial', 'learning', 'other'])
export const GOAL_PRIORITIES = toOptions(['low', 'medium', 'high'])
export const GOAL_STATUSES = toOptions(['active', 'completed', 'paused', 'archived'])
export const PROJECT_STATUSES = toOptions(['planning', 'active', 'on_hold', 'completed', 'archived'])
export const IDEA_STATUSES = toOptions(['idea', 'exploring', 'validating', 'active', 'paused', 'rejected', 'completed'])
export const IDEA_POTENTIAL = toOptions(['low', 'medium', 'high'])
export const LEARNING_STATUSES = toOptions(['not_started', 'learning', 'completed'])
export const REMINDER_REPEAT = toOptions(['none', 'daily', 'weekly', 'monthly', 'custom'])
export const REMINDER_PRIORITIES = toOptions(['low', 'medium', 'high'])
export const EVENT_REPEAT = toOptions(['none', 'daily', 'weekly', 'monthly'])
export const EVENT_REMINDER_OPTIONS = [
  { value: '0', label: 'At start time' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
]

// Default finance categories. Users can add their own (stored in finance_categories).
export const EXPENSE_CATEGORIES = toOptions([
  'food', 'transport', 'housing', 'education', 'business', 'health', 'communication',
  'family', 'entertainment', 'shopping', 'agriculture', 'technology', 'other',
])
export const INCOME_CATEGORIES = toOptions(['salary', 'business', 'freelance', 'agriculture', 'gift', 'other'])

// V1 stored a currency choice; V2 uses TZS everywhere. The code path for other currencies stays in formatMoney.
export const CURRENCIES = ['TZS']

const prettify = (v) => String(v ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** Label for a stored value. Custom or legacy values that are not in the list still display nicely. */
export const labelOf = (options, value) => tr(options.find((o) => o.value === value)?.label ?? prettify(value))
