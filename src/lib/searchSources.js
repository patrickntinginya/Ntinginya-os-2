// Which columns are searched in each table, and where the result opens.
export const SOURCES = [
  { table: 'habits', label: 'Habits', to: '/habits', title: 'name', sub: 'description', cols: ['name', 'description'] },
  { table: 'tasks', label: 'Tasks', to: '/tasks', title: 'title', sub: 'notes', cols: ['title', 'notes'] },
  { table: 'schedule_events', label: 'Schedule', to: '/schedule', title: 'title', sub: 'event_date', cols: ['title', 'description', 'location'] },
  { table: 'goals', label: 'Goals', to: '/goals', title: 'name', sub: 'description', cols: ['name', 'description'] },
  { table: 'projects', label: 'Projects', to: '/projects', title: 'name', sub: 'description', cols: ['name', 'description', 'notes'] },
  { table: 'ideas', label: 'Ideas', to: '/brainstorm', title: 'title', sub: 'description', cols: ['title', 'description', 'problem', 'proposed_solution', 'notes'] },
  { table: 'notes', label: 'Notes', to: '/notes', title: 'title', sub: 'content', cols: ['title', 'content', 'category'] },
  { table: 'learning_items', label: 'Learning', to: '/knowledge', title: 'topic', sub: 'description', cols: ['topic', 'description', 'learning_goal', 'notes'] },
  { table: 'expenses', label: 'Expenses', to: '/finance', title: 'category', sub: 'notes', cols: ['category', 'notes'] },
  { table: 'income', label: 'Income', to: '/finance', title: 'source', sub: 'notes', cols: ['source', 'category', 'notes'] },
]
