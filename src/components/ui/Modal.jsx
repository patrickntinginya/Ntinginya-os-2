import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { tr } from '../../i18n'

/** Bottom sheet on phones, centered dialog on larger screens. */
export default function Modal({ title, onClose, children }) {
  // Keep the latest onClose without re-running the scroll-lock effect on every parent render.
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
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={tr(title)}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-xl dark:bg-surface-dark md:max-w-lg md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-lg font-semibold">{tr(title)}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}
