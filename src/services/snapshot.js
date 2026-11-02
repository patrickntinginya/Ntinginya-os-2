// Loads the user's real data for dashboards, reviews, insights and the AI context.
// It takes a Supabase client as an argument so the SAME code runs in the browser (signed-in client)
// and in the server-side AI function (client scoped to the user's token). Either way Row Level Security applies.
import { addDays, startOfMonth, startOfNextMonth, startOfPrevMonth, startOfWeek } from '../utils/date.js'

const q = async (promise) => {
  const { data, error } = await promise
  if (error) throw error
  return data
}

// PostgREST returns at most 1000 rows per request, so large tables are read in pages.
async function qAll(make, maxRows = 10000) {
  let rows = []
  for (let from = 0; rows.length < maxRows; from += 1000) {
    const page = await q(make().range(from, from + 999))
    rows = rows.concat(page)
    if (page.length < 1000) break
  }
  return rows
}

export const LOADERS = {
  habits: (c) => q(c.from('habits').select('*').order('created_at').limit(200)),
  habitEntries: (c, today) => qAll(() => c.from('habit_entries').select('habit_id,entry_date').gte('entry_date', addDays(today, -400)).order('entry_date', { ascending: false })),
  recurring: (c) => q(c.from('recurring_transactions').select('*').eq('is_active', true).limit(200)),
  tasks: (c) => q(c.from('tasks').select('*').order('created_at', { ascending: false }).limit(1000)),
  goals: (c) => q(c.from('goals').select('*').order('created_at', { ascending: false }).limit(500)),
  milestones: (c) => q(c.from('milestones').select('*').order('position').limit(1000)),
  events: (c) => q(c.from('schedule_events').select('*').order('event_date').limit(1000)),
  reminders: (c) => q(c.from('reminders').select('*').order('remind_date').limit(500)),
  learning: (c) => q(c.from('learning_items').select('*').order('created_at', { ascending: false }).limit(500)),
  sessions: (c, today) => q(c.from('study_sessions').select('*').gte('session_date', addDays(today, -120)).limit(1000)),
  projects: (c) => q(c.from('projects').select('*').order('created_at', { ascending: false }).limit(200)),
  ideas: (c) => q(c.from('ideas').select('*').order('created_at', { ascending: false }).limit(200)),
  budgets: (c, today) => q(c.from('budgets').select('*').eq('month', startOfMonth(today))),
  savingsGoals: (c) => q(c.from('financial_goals').select('*').order('created_at', { ascending: false }).limit(200)),
  totals: async (c) => {
    const rows = await q(c.rpc('finance_totals'))
    const r = rows?.[0] ?? {}
    return { income: Number(r.total_income) || 0, expenses: Number(r.total_expenses) || 0 }
  },
  monthly: async (c, today) =>
    (await q(c.rpc('finance_monthly', { p_months: 6, p_today: today }))).map((m) => ({
      month: m.month, income: Number(m.income) || 0, expenses: Number(m.expenses) || 0,
    })),
  catThis: async (c, today) =>
    (await q(c.rpc('finance_expense_by_category', { p_from: startOfMonth(today), p_to: startOfNextMonth(today) }))).map((r) => ({ category: r.category, amount: Number(r.total) || 0 })),
  catPrev: async (c, today) =>
    (await q(c.rpc('finance_expense_by_category', { p_from: startOfPrevMonth(today), p_to: startOfMonth(today) }))).map((r) => ({ category: r.category, amount: Number(r.total) || 0 })),
  weekIncome: (c, today) => q(c.from('income').select('amount,category,entry_date').gte('entry_date', startOfWeek(today)).lt('entry_date', addDays(startOfWeek(today), 7))),
  weekExpenses: (c, today) => q(c.from('expenses').select('amount,category,entry_date').gte('entry_date', startOfWeek(today)).lt('entry_date', addDays(startOfWeek(today), 7))),
}

export const FINANCE_KEYS = ['totals', 'monthly', 'catThis', 'catPrev', 'weekIncome', 'weekExpenses', 'budgets']

/** Each key loads independently: one failing table never blanks a whole page. */
export async function loadSnapshot(client, keys, today) {
  const results = await Promise.allSettled(keys.map((k) => LOADERS[k](client, today)))
  const data = {}
  const errors = {}
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') data[keys[i]] = r.value
    else {
      data[keys[i]] = null
      errors[keys[i]] = r.reason
    }
  })
  return { data, errors }
}
