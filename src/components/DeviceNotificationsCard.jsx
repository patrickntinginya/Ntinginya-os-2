import { useState } from 'react'
import Button from './ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

const supported = () => typeof window !== 'undefined' && 'Notification' in window

/**
 * Asks for notification permission and saves the preference.
 * Honest limit: notifications are shown while the app is open or running in the background on your device.
 * A closed app cannot be woken without a push server, which this version does not have.
 */
export default function DeviceNotificationsCard() {
  const { profile, updateProfile } = useAuth()
  const [permission, setPermission] = useState(supported() ? Notification.permission : 'unsupported')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const enabled = Boolean(profile?.notifications_enabled)

  const enable = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') await updateProfile({ notifications_enabled: true })
      else setMessage('Permission was not granted, so device notifications stay off.')
    } catch (e) {
      setMessage(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await updateProfile({ notifications_enabled: false })
    } catch (e) {
      setMessage(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setMessage(null)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      const options = { body: 'If you can see this, device notifications work on this device.', icon: '/pwa-192.png', tag: 'life-os-test' }
      if (reg) await reg.showNotification('Personal Life OS', options)
      else new Notification('Personal Life OS', options)
      setMessage('Test notification requested. If nothing appeared, check your device notification settings.')
    } catch {
      setMessage('Could not show a test notification on this device.')
    }
  }

  if (permission === 'unsupported') {
    return <p className="text-sm text-slate-600 dark:text-slate-300">{tr('This browser does not support device notifications. In-app notifications still work.')}</p>
  }

  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {tr('Status:')} {permission === 'granted' ? (enabled ? 'On' : tr('Allowed by your device, turned off here')) : permission === 'denied' ? tr('Blocked in your browser settings') : tr('Not enabled')}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {tr('Reminders and event alerts are shown while the app is open or running in the background. Closed apps cannot be notified in this version.')}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {permission === 'denied' ? (
          <p className="text-sm text-red-600 dark:text-red-400">{tr('Allow notifications for this site in your browser settings, then reload.')}</p>
        ) : enabled && permission === 'granted' ? (
          <>
            <Button variant="secondary" onClick={test}>{tr('Send a test notification')}</Button>
            <Button variant="ghost" onClick={disable} loading={busy}>{tr('Turn off')}</Button>
          </>
        ) : (
          <Button onClick={enable} loading={busy}>{tr('Turn on device notifications')}</Button>
        )}
      </div>
      {message && <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>}
    </div>
  )
}
