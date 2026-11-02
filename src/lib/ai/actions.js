// The ONLY things the AI assistant may propose. Each action is validated here before it is shown to the user,
// and validated again in the browser before it runs after the user presses Confirm.
// There are deliberately no delete/update actions: the assistant can only propose new records.
import { formatMoney } from '../../utils/format.js'

class Invalid extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

const str = (v, name, { max = 200, required = false } = {}) => {
  if (v == null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw new Invalid(`${name} is required`)
    return null
  }
  if (typeof v !== 'string') throw new Invalid(`${name} must be text`)
  const t = v.trim()
  if (t.length > max) throw new Invalid(`${name} is too long`)
  return t
}
const oneOf = (v, name, list, fallback = null) => {
  if (v == null || v === '') return fallback
  if (!list.includes(v)) throw new Invalid(`${name} is not valid`)
  return v
}
const date = (v, name, required = false) => {
  if (v == null || v === '') {
    if (required) throw new Invalid(`${name} is required`)
    return null
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be a date (YYYY-MM-DD)`)
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new Invalid(`${name} is not a real date`)
  return v
}
const time = (v, name, required = false) => {
  if (v == null || v === '') {
    if (required) throw new Invalid(`${name} is required`)
    return null
  }
  if (typeof v !== 'string' || !TIME.test(v)) throw new Invalid(`${name} must be a time (HH:MM)`)
  return v.slice(0, 5)
}
const amount = (v, name) => {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e12) throw new Invalid(`${name} must be a positive amount in TSh`)
  return Math.round(n * 100) / 100
}
const uuid = (v, name, required = false) => {
  if (v == null || v === '') {
    if (required) throw new Invalid(`${name} is required`)
    return null
  }
  if (typeof v !== 'string' || !UUID.test(v)) throw new Invalid(`${name} is not valid`)
  return v
}
const list = (v, name, max) => {
  if (!Array.isArray(v) || v.length === 0) throw new Invalid(`${name} needs at least one item`)
  if (v.length > max) throw new Invalid(`${name} has too many items`)
  return v
}

const PRIORITY4 = ['low', 'medium', 'high', 'urgent']
const PRIORITY3 = ['low', 'medium', 'high']
const ACTIVITY = ['personal', 'business', 'learning', 'finance', 'health', 'other']
const EXPENSE_DEFAULTS = ['food', 'transport', 'housing', 'education', 'business', 'health', 'communication', 'family', 'entertainment', 'shopping', 'agriculture', 'technology', 'other']

const s = (description, extra = {}) => ({ type: 'string', description, ...extra })
const DATE_S = (d) => s(`${d} (YYYY-MM-DD)`)

export const ACTIONS = {
  create_task: {
    label: 'Create task',
    table: 'tasks',
    description: 'Propose a new task.',
    properties: {
      title: s('Task title'), due_date: DATE_S('Due date'), priority: s('Priority', { enum: PRIORITY4 }),
      category: s('Category', { enum: ACTIVITY }), notes: s('Notes'), goal_id: s('Id of an existing goal from the data'),
      project_id: s('Id of an existing project from the data'),
    },
    required: ['title'],
    validate: (p) => ({
      title: str(p.title, 'Title', { required: true }), due_date: date(p.due_date, 'Due date'),
      priority: oneOf(p.priority, 'Priority', PRIORITY4, 'medium'), category: oneOf(p.category, 'Category', ACTIVITY, 'personal'),
      notes: str(p.notes, 'Notes', { max: 2000 }), goal_id: uuid(p.goal_id, 'Goal'), project_id: uuid(p.project_id, 'Project'),
    }),
    describe: (v) => `Create task "${v.title}"${v.due_date ? ` due ${v.due_date}` : ''} (${v.priority} priority)`,
  },
  create_reminder: {
    label: 'Create reminder',
    table: 'reminders',
    description: 'Propose a reminder.',
    properties: {
      title: s('Reminder title'), remind_date: DATE_S('Date'), remind_time: s('Time (HH:MM, 24 hour)'),
      description: s('Details'), repeat_option: s('Repeat', { enum: ['none', 'daily', 'weekly', 'monthly'] }),
    },
    required: ['title', 'remind_date'],
    validate: (p) => ({
      title: str(p.title, 'Title', { required: true }), remind_date: date(p.remind_date, 'Date', true),
      remind_time: time(p.remind_time, 'Time'), description: str(p.description, 'Description', { max: 1000 }),
      repeat_option: oneOf(p.repeat_option, 'Repeat', ['none', 'daily', 'weekly', 'monthly'], 'none'),
    }),
    describe: (v) => `Create reminder "${v.title}" on ${v.remind_date}${v.remind_time ? ` at ${v.remind_time}` : ''}`,
  },
  create_event: {
    label: 'Create schedule event',
    table: 'schedule_events',
    description: 'Propose a calendar event. Never move or change existing events.',
    properties: {
      title: s('Event title'), event_date: DATE_S('Date'), start_time: s('Start time (HH:MM)'), end_time: s('End time (HH:MM)'),
      description: s('Details'), location: s('Location'), category: s('Category', { enum: ACTIVITY }),
    },
    required: ['title', 'event_date', 'start_time'],
    validate: (p) => {
      const v = {
        title: str(p.title, 'Title', { required: true }), event_date: date(p.event_date, 'Date', true),
        start_time: time(p.start_time, 'Start time', true), end_time: time(p.end_time, 'End time'),
        description: str(p.description, 'Description', { max: 1000 }), location: str(p.location, 'Location', { max: 200 }),
        category: oneOf(p.category, 'Category', ACTIVITY, 'personal'),
      }
      if (v.end_time && v.end_time <= v.start_time) throw new Invalid('End time must be after the start time')
      return v
    },
    describe: (v) => `Add event "${v.title}" on ${v.event_date} at ${v.start_time}${v.end_time ? `-${v.end_time}` : ''}`,
  },
  create_goal: {
    label: 'Create goal',
    table: 'goals',
    description: 'Propose a new goal.',
    properties: {
      name: s('Goal name'), description: s('Description'), category: s('Category', { enum: ['personal', 'business', 'financial', 'learning', 'other'] }),
      priority: s('Priority', { enum: PRIORITY3 }), target_date: DATE_S('Target date'),
    },
    required: ['name'],
    validate: (p) => ({
      name: str(p.name, 'Name', { required: true }), description: str(p.description, 'Description', { max: 2000 }),
      category: oneOf(p.category, 'Category', ['personal', 'business', 'financial', 'learning', 'other'], 'personal'),
      priority: oneOf(p.priority, 'Priority', PRIORITY3, 'medium'), target_date: date(p.target_date, 'Target date'),
    }),
    describe: (v) => `Create goal "${v.name}"${v.target_date ? ` by ${v.target_date}` : ''}`,
  },
  create_project: {
    label: 'Create project',
    table: 'projects',
    description: 'Propose a new project.',
    properties: { name: s('Project name'), description: s('Description'), deadline: DATE_S('Deadline') },
    required: ['name'],
    validate: (p) => ({ name: str(p.name, 'Name', { required: true }), description: str(p.description, 'Description', { max: 2000 }), deadline: date(p.deadline, 'Deadline') }),
    describe: (v) => `Create project "${v.name}"`,
  },
  create_idea: {
    label: 'Create idea',
    table: 'ideas',
    description: 'Propose saving a new idea.',
    properties: { title: s('Idea title'), description: s('Description'), category: s('Category'), next_action: s('Next action') },
    required: ['title'],
    validate: (p) => ({
      title: str(p.title, 'Title', { required: true }), description: str(p.description, 'Description', { max: 2000 }),
      category: str(p.category, 'Category', { max: 60 }), next_action: str(p.next_action, 'Next action', { max: 300 }),
    }),
    describe: (v) => `Save idea "${v.title}"`,
  },
  create_learning_item: {
    label: 'Create learning topic',
    table: 'learning_items',
    description: 'Propose a learning topic.',
    properties: { topic: s('Topic'), description: s('Description'), learning_goal: s('Learning goal'), target_date: DATE_S('Target date') },
    required: ['topic'],
    validate: (p) => ({
      topic: str(p.topic, 'Topic', { required: true }), description: str(p.description, 'Description', { max: 2000 }),
      learning_goal: str(p.learning_goal, 'Learning goal', { max: 300 }), target_date: date(p.target_date, 'Target date'),
    }),
    describe: (v) => `Add learning topic "${v.topic}"`,
  },
  record_expense: {
    label: 'Record expense',
    table: 'expenses',
    description: 'Propose recording an expense. Amount is in Tanzanian Shillings (TSh) as a plain number.',
    properties: {
      amount: { type: 'number', description: 'Amount in TSh, e.g. 20000' }, category: s('Category, e.g. transport'),
      entry_date: DATE_S('Date of the expense'), notes: s('Notes'),
    },
    required: ['amount', 'category'],
    validate: (p) => ({
      amount: amount(p.amount, 'Amount'), category: str(p.category, 'Category', { required: true, max: 40 }).toLowerCase(),
      entry_date: date(p.entry_date, 'Date'), notes: str(p.notes, 'Notes', { max: 1000 }),
    }),
    describe: (v) => `Record an expense of ${formatMoney(v.amount)} for ${v.category}${v.entry_date ? ` on ${v.entry_date}` : ''}`,
  },
  record_income: {
    label: 'Record income',
    table: 'income',
    description: 'Propose recording income. Amount is in TSh as a plain number.',
    properties: {
      amount: { type: 'number', description: 'Amount in TSh' }, source: s('Who or what paid'), category: s('Category'),
      entry_date: DATE_S('Date received'), notes: s('Notes'),
    },
    required: ['amount'],
    validate: (p) => ({
      amount: amount(p.amount, 'Amount'), source: str(p.source, 'Source', { max: 120 }),
      category: str(p.category, 'Category', { max: 40 })?.toLowerCase() ?? null, entry_date: date(p.entry_date, 'Date'),
      notes: str(p.notes, 'Notes', { max: 1000 }),
    }),
    describe: (v) => `Record income of ${formatMoney(v.amount)}${v.source ? ` from ${v.source}` : ''}`,
  },
  create_budget: {
    label: 'Create budget',
    table: 'budgets',
    description: 'Propose a monthly budget for one category, in TSh.',
    properties: { category: s('Category'), amount: { type: 'number', description: 'Monthly budget in TSh' }, month: DATE_S('First day of the month; default is the current month') },
    required: ['category', 'amount'],
    validate: (p) => {
      const month = date(p.month, 'Month')
      return {
        category: str(p.category, 'Category', { required: true, max: 40 }).toLowerCase(), amount: amount(p.amount, 'Amount'),
        month: month ? `${month.slice(0, 7)}-01` : null,
      }
    },
    describe: (v) => `Set a budget of ${formatMoney(v.amount)} for ${v.category}${v.month ? ` (${v.month.slice(0, 7)})` : ''}`,
  },
  create_goal_plan: {
    label: 'Add milestones and tasks to a goal',
    table: null,
    description: 'Propose milestones (each with optional tasks) for an EXISTING goal. Use goal_id from the data.',
    properties: {
      goal_id: s('Id of the existing goal'),
      milestones: {
        type: 'array', description: 'Up to 8 milestones',
        items: {
          type: 'object',
          properties: {
            title: s('Milestone title'), due_date: DATE_S('Due date'),
            tasks: { type: 'array', description: 'Up to 6 tasks', items: { type: 'object', properties: { title: s('Task title'), due_date: DATE_S('Due date'), priority: s('Priority', { enum: PRIORITY4 }) }, required: ['title'] } },
          },
          required: ['title'],
        },
      },
    },
    required: ['goal_id', 'milestones'],
    validate: (p) => ({
      goal_id: uuid(p.goal_id, 'Goal', true),
      milestones: list(p.milestones, 'Milestones', 8).map((m) => ({
        title: str(m?.title, 'Milestone title', { required: true }), due_date: date(m?.due_date, 'Milestone due date'),
        tasks: (Array.isArray(m?.tasks) ? m.tasks : []).slice(0, 6).map((t) => ({
          title: str(t?.title, 'Task title', { required: true }), due_date: date(t?.due_date, 'Task due date'),
          priority: oneOf(t?.priority, 'Priority', PRIORITY4, 'medium'),
        })),
      })),
    }),
    describe: (v) => `Add ${v.milestones.length} milestone(s) and ${v.milestones.reduce((n, m) => n + m.tasks.length, 0)} task(s) to your goal`,
  },
  create_learning_plan: {
    label: 'Save learning plan',
    table: null,
    description: 'Propose a learning topic plus step tasks.',
    properties: {
      topic: s('Topic'), learning_goal: s('What the user wants to achieve'), description: s('Short summary of the plan'),
      target_date: DATE_S('Target date'),
      steps: { type: 'array', description: 'Up to 10 study steps', items: { type: 'object', properties: { title: s('Step'), due_date: DATE_S('Due date') }, required: ['title'] } },
    },
    required: ['topic', 'steps'],
    validate: (p) => ({
      topic: str(p.topic, 'Topic', { required: true }), learning_goal: str(p.learning_goal, 'Learning goal', { max: 300 }),
      description: str(p.description, 'Description', { max: 2000 }), target_date: date(p.target_date, 'Target date'),
      steps: list(p.steps, 'Steps', 10).map((st) => ({ title: str(st?.title, 'Step', { required: true }), due_date: date(st?.due_date, 'Step due date') })),
    }),
    describe: (v) => `Save learning plan "${v.topic}" with ${v.steps.length} step task(s)`,
  },
}

export const ACTION_TYPES = Object.keys(ACTIONS)

/** Returns { ok: true, values, summary } or { ok: false, error }. */
export function validateAction(type, payload) {
  const def = ACTIONS[type]
  if (!def) return { ok: false, error: 'Unknown action' }
  try {
    const values = def.validate(payload && typeof payload === 'object' ? payload : {})
    return { ok: true, values, summary: def.describe(values) }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

/** Tool definitions in the JSON-schema shape used by tool-calling model APIs. */
export function toolDefinitions() {
  return ACTION_TYPES.map((name) => ({
    name,
    description: ACTIONS[name].description,
    input_schema: { type: 'object', properties: ACTIONS[name].properties, required: ACTIONS[name].required },
  }))
}

export { EXPENSE_DEFAULTS }
