import { useMemo } from 'react'
import { StickyNote, Pin, Archive, ArchiveRestore } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import ConvertButton from '../components/ConvertButton'
import ItemActions from '../components/ui/ItemActions'
import { formatDate, dateOfTimestamp } from '../utils/date'
import { tr } from '../i18n'

function NoteCard({ note, actions }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-medium">{note.pinned && <Pin size={14} className="text-brand-600" aria-label={tr('Pinned')} />}{note.title}</p>
          {note.content && <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{note.content}</p>}
        </div>
        <ItemActions label={note.title} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {note.category && <Badge tone="info">{note.category}</Badge>}
        {note.tags?.map((t) => <Badge key={t}>#{t}</Badge>)}
        <span className="text-xs text-slate-500 dark:text-slate-400">{tr('Updated')} {formatDate(dateOfTimestamp(note.updated_at))}</span>
      </div>
      <div className="mt-2 flex gap-1">
        <button type="button" onClick={() => actions.update({ pinned: !note.pinned })} className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
          <Pin size={16} aria-hidden="true" /> {note.pinned ? tr('Unpin') : tr('Pin')}
        </button>
        <button type="button" onClick={() => actions.update({ archived: !note.archived })} className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
          {note.archived ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />} {note.archived ? tr('Restore') : tr('Archive')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 border-t border-slate-100 pt-1 dark:border-white/5">
        <ConvertButton kind="note_to_project" source={note} />
        <ConvertButton kind="note_to_task" source={note} />
      </div>
    </Card>
  )
}

export function makeNotesConfig() {
  return {
    table: 'notes',
    title: 'Notes',
    subtitle: 'Private notes only you can see.',
    singular: 'note',
    icon: StickyNote,
    lookups: ['projects'],
    order: [{ column: 'updated_at', ascending: false }],
    fields: (l) => [
      { name: 'title', label: 'Title', required: true },
      { name: 'content', label: 'Content', type: 'textarea', rows: 8 },
      { name: 'category', label: 'Category', half: true },
      { name: 'project_id', label: 'Project', type: 'select', options: l.options.projects || [], half: true },
      { name: 'tags', label: 'Tags', type: 'tags' },
    ],
    defaults: () => ({}),
    empty: { title: 'No notes yet', text: 'Write down anything you want to keep: meeting notes, ideas, references.', action: 'Add a note' },
    search: ['title', 'content', 'category', 'tags'],
    sections: (items) => [
      { key: 'pinned', title: 'Pinned', items: items.filter((n) => n.pinned && !n.archived) },
      { key: 'notes', title: 'Notes', items: items.filter((n) => !n.pinned && !n.archived) },
      { key: 'archived', title: 'Archived', items: items.filter((n) => n.archived) },
    ],
    renderItem: (note, actions) => <NoteCard note={note} actions={actions} />,
  }
}

export default function Notes() {
  const config = useMemo(makeNotesConfig, [])
  return <ResourcePage config={config} />
}
