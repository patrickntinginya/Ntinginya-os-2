import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { tr } from '../../i18n'

/** Bottom sheet on phones, centered dialog on larger screens. */
export default function Modal({ title, onClose, children }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="premium-modal fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={tr(title)}>
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="premium-modal-panel relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-surface-dark md:max-w-lg md:rounded-3xl">
        <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="mb-1 h-1 w-9 rounded-full bg-brand-400 md:hidden" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{tr(title)}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
