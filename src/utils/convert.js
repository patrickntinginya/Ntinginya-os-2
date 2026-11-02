// Builds the row to create when converting one record into another (Second Brain). Pure; the service saves it.
const cut = (s, n) => (s ? String(s).trim().slice(0, n) : null)
const join = (parts) => parts.filter(Boolean).join('\n\n') || null

export const CONVERSIONS = {
  idea_to_project: { table: 'projects', sourceColumn: 'source_idea_id', label: 'Create project', to: '/projects' },
  idea_to_task: { table: 'tasks', sourceColumn: 'source_idea_id', label: 'Create task', to: '/tasks' },
  note_to_project: { table: 'projects', sourceColumn: 'source_note_id', label: 'Create project', to: '/projects' },
  note_to_task: { table: 'tasks', sourceColumn: 'source_note_id', label: 'Create task', to: '/tasks' },
  learning_to_goal: { table: 'goals', sourceColumn: 'source_learning_id', label: 'Create goal', to: '/goals' },
  goal_to_project: { table: 'projects', sourceColumn: 'source_goal_id', label: 'Create project', to: '/projects' },
}

export function buildConversion(kind, r) {
  switch (kind) {
    case 'idea_to_project':
      return { name: cut(r.title, 200), description: cut(r.description || r.problem, 2000), notes: cut(join([r.proposed_solution && `Solution: ${r.proposed_solution}`, r.business_opportunity && `Opportunity: ${r.business_opportunity}`, r.notes]), 4000), status: 'planning', source_idea_id: r.id }
    case 'idea_to_task':
      return { title: cut(r.next_action || `Work on idea: ${r.title}`, 200), notes: cut(join([`From idea: ${r.title}`, r.description]), 2000), category: 'business', priority: 'medium', source_idea_id: r.id }
    case 'note_to_project':
      return { name: cut(r.title, 200), description: cut(r.content, 2000), status: 'planning', source_note_id: r.id }
    case 'note_to_task':
      return { title: cut(r.title, 200), notes: cut(r.content, 2000), source_note_id: r.id }
    case 'learning_to_goal':
      return { name: cut(`Learn ${r.topic}`, 200), description: cut(r.learning_goal || r.description, 2000), category: 'learning', target_date: r.target_date || null, source_learning_id: r.id }
    case 'goal_to_project':
      return { name: cut(r.name, 200), description: cut(r.description, 2000), status: 'planning', deadline: r.target_date || null, goal_id: r.id, source_goal_id: r.id }
    default:
      throw new Error('Unknown conversion')
  }
}
