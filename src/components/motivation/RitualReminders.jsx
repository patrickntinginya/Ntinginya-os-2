import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import { t } from '../../i18n'
import { db } from '../../services/db'
import { isNativePlatform } from '../../lib/platform'
import { reminderAdapter } from '../../native/runtime'
import { friendlyError } from '../../utils/format'
import { todayISO } from '../../utils/date'

// Each ritual is an ordinary row in `reminders` (so the existing Reminders screen, in-app notifications and the Android
// alarm coordinator all handle it). A marker in `description` tells them apart from the user's own reminders.
export const RITUALS = [
  { id: 'morning', time: '06:30', repeat: 'daily', titleKey: 'ritual.morning' },
  { id: 'night', time: '21:00', repeat: 'daily', titleKey: 'ritual.night' },
  { id: 'planning', time: '07:00', repeat: 'daily', titleKey: 'ritual.planning' },
  { id: 'checkin', time: '18:00', repeat: 'weekly', titleKey: 'ritual.checkin' },
]
export const markerOf = (id) => `life-os:ritual:${id}`
export const findRitual = (rows, id) => rows.find((r) => String(r.description || '').includes(markerOf(id)))

export default function RitualReminders() {
  const adapter = isNativePlatform() ? reminderAdapter : db
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setRows(await adapter.list('reminders', { order: [{ column: 'created_at', ascending: false }], limit: 300 }))
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [adapter])
  useEffect(() => { load() }, [load])

  const toggle = async (ritual) => {
    setBusy(ritual.id)
    setError(null)
    try {
      const existing = findRitual(rows, ritual.id)
      if (existing) await adapter.remove('reminders', existing.id)
      else await adapter.create('reminders', { title: t(ritual.titleKey), description: markerOf(ritual.id), remind_date: todayISO(), remind_time: ritual.time, repeat_option: ritual.repeat, priority: 'medium' })
      await load()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }
  const setTime = async (ritual, time) => {
    const existing = findRitual(rows, ritual.id)
    if (!existing || !time) return
    setBusy(ritual.id)
    try { await adapter.update('reminders', existing.id, { remind_time: time }); await load() } catch (e) { setError(friendlyError(e)) } finally { setBusy(null) }
  }

  return (
    <Card className="p-4">
      <h2 className="font-semibold">{t('ritual.title')}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ritual.intro')}</p>
      {loading ? <p className="mt-3 text-sm" role="status">{t('common.loading')}</p> : (
        <ul className="mt-3 space-y-2">
          {RITUALS.map((r) => {
            const on = findRitual(rows, r.id)
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <button type="button" role="switch" aria-checked={Boolean(on)} disabled={busy === r.id} onClick={() => toggle(r)} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-white/20'} disabled:opacity-50`} aria-label={t(r.titleKey)}>
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${on ? 'left-7' : 'left-1'}`} />
                </button>
                <span className="min-w-0 flex-1 text-sm">{t(r.titleKey)}{r.repeat === 'weekly' ? ` (${t('ritual.weekly')})` : ''}</span>
                {on && <input type="time" className="input !w-32" aria-label={t('ritual.time')} defaultValue={String(on.remind_time || r.time).slice(0, 5)} onBlur={(e) => e.target.value !== String(on.remind_time || '').slice(0, 5) && setTime(r, e.target.value)} />}
              </li>
            )
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('ritual.limits')} <Link to="/notifications" className="font-medium text-brand-700 dark:text-brand-300">{t('ritual.enableLink')}</Link></p>
    </Card>
  )
}
