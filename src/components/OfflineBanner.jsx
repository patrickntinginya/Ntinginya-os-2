import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { tr } from '../i18n'

/** Shown when the browser reports no connection. The app shell is cached by the service worker; your data is not. */
export default function OfflineBanner() {
  const { t } = useI18n()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return (
    <p role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
      <WifiOff size={16} aria-hidden="true" /> {tr('You are offline. The app opens, but your data needs a connection, so changes will not save until you are back online.')}
    </p>
  )
}
