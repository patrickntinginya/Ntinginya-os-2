import { tr } from '../../i18n'
import { Pencil, Trash2 } from 'lucide-react'

export default function ItemActions({ onEdit, onDelete, label }) {
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" className="icon-btn" onClick={onEdit} aria-label={`${tr('Edit')} ${label}`}>
        <Pencil size={18} />
      </button>
      <button type="button" className="icon-btn hover:!text-red-600" onClick={onDelete} aria-label={`${tr('Delete')} ${label}`}>
        <Trash2 size={18} />
      </button>
    </div>
  )
}
