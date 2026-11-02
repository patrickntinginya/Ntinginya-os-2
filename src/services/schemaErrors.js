// The V5 tables (reflections, habit_safe_mode) come from supabase/migrations/004_v5.sql, which the owner must run once.
// Until then Supabase answers with "relation does not exist" / "column not found". These helpers turn that into a clear message.
export const MISSING_CODES = ['42P01', '42703', 'PGRST204', 'PGRST205']
export const isMissingSchema = (e) => MISSING_CODES.includes(e?.code) || /does not exist|schema cache|could not find the/i.test(String(e?.message || ''))
