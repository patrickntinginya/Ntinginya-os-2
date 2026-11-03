import { AI_CONTEXT_CATEGORIES } from '../../lib/ai/contextCategories'
import { tr } from '../../i18n'

const LABELS = {
  tasks: 'Tasks and reminders',
  schedule: 'Schedule',
  goals: 'Goals and projects',
  habits: 'Habits',
  learning: 'Learning',
  finance: 'Finances',
  ideas: 'Ideas',
}

export default function AiContextSelector({ categories, onChange }) {
  return (
    <fieldset className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-surface-dark">
      <legend className="px-1 text-sm font-semibold">{tr('Personal data for this reply (optional)')}</legend>
      <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {tr('Personal records are not queried for this reply unless you select categories. Selected summaries, your message, and recent conversation are sent to the configured AI provider (Gemini or OpenRouter). Earlier messages or replies in this conversation may contain personal details.')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {AI_CONTEXT_CATEGORIES.map((category) => (
          <label key={category} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm">
            <input
              type="checkbox"
              checked={categories.includes(category)}
              onChange={(event) => onChange((selected) => (
                event.target.checked
                  ? [...selected, category]
                  : selected.filter((item) => item !== category)
              ))}
            />
            <span>{tr(LABELS[category])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
