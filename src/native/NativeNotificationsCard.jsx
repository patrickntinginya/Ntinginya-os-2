import { useCallback, useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'
import { getCoordinator, getNotifier } from './runtime'

/** Device-notification controls for the Android app (the browser version stays in DeviceNotificationsCard). */
export default function NativeNotificationsCard() {
  const { profile, updateProfile } = useAuth()
  const [permission, setPermission] = useState('unknown')
  const [exact, setExact] = useState('unknown')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const enabled = Boolean(profile?.notifications_enabled)

  const refresh = useCallback(async () => {
    try {
      const n = await getNotifier()
      setPermission(await n.permission())
      setExact(await n.exactAlarmState())
    } catch {
      setPermission('unsupported')
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const enable = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const n = await getNotifier()
      const result = permission === 'granted' ? 'granted' : await n.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        await updateProfile({ notifications_enabled: true })
        await (await getCoordinator()).run({ enabled: true })
        setExact(await n.exactAlarmState())
      } else {
        setMessage(tr('Permission was not granted, so device notifications stay off.'))
      }
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
      await (await getCoordinator()).run({ enabled: false })
    } catch (e) {
      setMessage(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setMessage(null)
    try {
      const result = await (await getNotifier()).scheduleTest(5)
      setMessage(result.ok ? tr('A test notification will appear in about 5 seconds. Close the app to test it while closed.') : tr('Permission was not granted, so device notifications stay off.'))
    } catch {
      setMessage(tr('Could not show a test notification on this device.'))
    }
  }

  if (permission === 'unsupported') return <p className="text-sm text-slate-600 dark:text-slate-300">{tr('This device does not support device notifications. In-app notifications still work.')}</p>

  const status = permission === 'granted' ? (enabled ? tr('On') : tr('Allowed by your device, turned off here')) : permission === 'denied' ? tr('Blocked in Android settings') : tr('Not enabled')
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{tr('Status:')} {status}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {tr('Reminders are scheduled on this phone as Android notifications. Some phones delay or stop background alarms to save battery; if reminders arrive late, check the battery settings for this app.')}
      </p>
      {enabled && permission === 'granted' && exact === 'denied' && (
        <div className="mt-3">
          <p className="text-sm text-amber-700 dark:text-amber-300">{tr('Exact times are not allowed, so reminders may arrive a few minutes late.')}</p>
          <Button variant="secondary" className="mt-2" onClick={async () => { await (await getNotifier()).openExactAlarmSettings(); setTimeout(refresh, 1500) }}>{tr('Allow exact times')}</Button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {permission === 'denied' ? (
          <p className="text-sm text-red-600 dark:text-red-400">{tr('Allow notifications for Personal Life OS in Android Settings, then come back here.')}</p>
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
