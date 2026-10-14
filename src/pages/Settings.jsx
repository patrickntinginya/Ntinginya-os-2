import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Moon, Sun, Download, LogOut } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { exportAllData } from '../services/db'
import { getAiStatus, testAiConnection } from '../services/aiClient'
import { supabase } from '../lib/supabase'
import { friendlyAuthError, friendlyError } from '../utils/format'
import { tr } from '../i18n'
import { isNativePlatform } from '../lib/platform'

function Section({ title, description, children }) {
  return (
    <Card as="section" className="p-5" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  )
}

const Message = ({ ok, children }) =>
  children ? (
    <p role={ok ? 'status' : 'alert'} className={`mt-3 text-sm ${ok ? 'text-brand-700 dark:text-brand-300' : 'text-red-600 dark:text-red-400'}`}>{children}</p>
  ) : null

function ProfileSection() {
  const { profile, user, updateProfile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({})

  useEffect(() => {
    setFullName(profile?.full_name || user?.user_metadata?.full_name || '')
  }, [profile, user])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg({})
    try {
      await updateProfile({ full_name: fullName.trim() || null })
      setMsg({ ok: 'Profile saved.' })
    } catch (err) {
      setMsg({ error: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Profile')}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="full-name" className="label">{tr('Name')}</label>
          <input id="full-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <p className="label">{tr('Currency')}</p>
          <p className="min-h-[48px] rounded-xl bg-slate-100 px-3.5 py-3 text-base dark:bg-white/5">{tr('Tanzanian Shilling (TSh)')}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tr('All money in the app is recorded and shown in TSh.')}</p>
        </div>
        <Button type="submit" loading={busy}>{tr('Save profile')}</Button>
        <Message ok>{msg.ok}</Message>
        <Message>{msg.error}</Message>
      </form>
    </Section>
  )
}

function AccountSection() {
  const { user, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({})

  const save = async (e) => {
    e.preventDefault()
    setMsg({})
    if (password.length < 8) return setMsg({ error: 'Use at least 8 characters for your password.' })
    if (password !== confirm) return setMsg({ error: 'The two passwords do not match.' })
    setBusy(true)
    try {
      await updatePassword(password)
      setPassword('')
      setConfirm('')
      setMsg({ ok: 'Password changed.' })
    } catch (err) {
      setMsg({ error: friendlyAuthError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Account')}>
      <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Signed in as')}</p>
      <p className="font-medium">{user?.email}</p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <div>
          <label htmlFor="new-password" className="label">{tr('New password')}</label>
          <input id="new-password" type="password" className="input" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="label">{tr('Confirm new password')}</label>
          <input id="confirm-password" type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!password}>{tr('Change password')}</Button>
        <Message ok>{msg.ok}</Message>
        <Message>{msg.error}</Message>
      </form>
    </Section>
  )
}

function NotificationsSection() {
  const { profile, updateProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const enabled = Boolean(profile?.notifications_enabled)

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      await updateProfile({ notifications_enabled: !enabled })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Notifications')} description={tr('Reminders are saved today. Push notifications are not delivered yet; this saves your preference for when they are.')}>
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium" id="notif-label">{tr('Reminder notifications')}</span>
        <button
          type="button" role="switch" aria-checked={enabled} aria-labelledby="notif-label"
          onClick={toggle} disabled={busy}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-white/20'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      <Message>{error}</Message>
    </Section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]
  return (
    <Section title={tr('Appearance')}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tr('Theme')}>
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value} type="button" role="radio" aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium ${
              theme === value
                ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/20 dark:text-brand-100'
                : 'border-slate-300 dark:border-white/15'
            }`}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </Section>
  )
}

function DataSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await exportAllData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `life-os-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Data')} description={tr('Download everything you have saved as a JSON file.')}>
      <Button variant="secondary" onClick={download} loading={busy}>
        <Download size={18} aria-hidden="true" /> {tr('Export my data')}
      </Button>
      <Message>{error}</Message>
    </Section>
  )
}

function LogoutSection() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const logout = async () => {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Logout')}>
      <Button variant="danger" onClick={logout} loading={busy} className="w-full sm:w-auto">
        <LogOut size={18} aria-hidden="true" /> {tr('Log out')}
      </Button>
      <Message>{error}</Message>
    </Section>
  )
}

const AI_STATUS_TEXT = {
  ready: 'Configured',
  disabled: 'Off on the server (AI_PROVIDER=none)',
  not_configured: 'Not configured',
  unsupported: 'This provider is not supported by this version.',
}

function AiSection() {
  const { profile, updateProfile } = useAuth()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [test, setTest] = useState(null) // null | 'busy' | { ok, message }
  const enabled = profile?.ai_enabled !== false

  useEffect(() => {
    getAiStatus().then(setStatus)
  }, [])

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      await updateProfile({ ai_enabled: !enabled })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    setTest('busy')
    setTest(await testAiConnection())
  }

  const statusText = !status
    ? tr('Checking...')
    : !status.reachable
      ? tr('The AI service could not be reached (start with "vercel dev" locally).')
      : test && test !== 'busy'
        ? (test.ok ? tr('Connected') : `${tr('Error')}: ${test.message}`)
        : tr(AI_STATUS_TEXT[status.status] || 'Unknown')
  const row = 'flex justify-between gap-3'
  const dt = 'shrink-0 text-slate-500 dark:text-slate-400'

  return (
    <Section title={tr('AI settings')} description={tr('The app works fully without AI. Dashboard, planner, reviews, insights and finance tools use rules and your real data.')}>
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium" id="ai-enabled-label">{tr('Use AI features')}</span>
        <button
          type="button" role="switch" aria-checked={enabled} aria-labelledby="ai-enabled-label" onClick={toggle} disabled={busy}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-white/20'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${enabled ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className={row}><dt className={dt}>{tr('Provider')}</dt><dd className="font-medium capitalize">{status?.provider || '-'}</dd></div>
        <div className={row}><dt className={dt}>{tr('Model')}</dt><dd className="break-all text-right font-medium">{status?.model || '-'}</dd></div>
        <div className={row}><dt className={dt}>{tr('Daily limit')}</dt><dd className="font-medium">{status?.dailyLimit ? tr('{n} AI messages per day', { n: status.dailyLimit }) : '-'}</dd></div>
        <div className={row}>
          <dt className={dt}>{tr('Status')}</dt>
          <dd role="status" className="text-right font-medium">{statusText}</dd>
        </div>
      </dl>
      {status?.status === 'not_configured' && status.missing && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{tr('The server is missing the setting {name}. See the setup guide.', { name: status.missing })}</p>
      )}
      {status?.configured && enabled && (
        <Button variant="secondary" className="mt-4" onClick={runTest} loading={test === 'busy'}>{tr('Test connection')}</Button>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tr('The API key lives only on the server and is never shown here.')}</p>
      <Message>{error}</Message>
    </Section>
  )
}

function PrivacySection() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const remove = async (e) => {
    e.preventDefault()
    if (text !== 'DELETE') return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('delete_my_account')
      if (rpcError) throw rpcError
      if (isNativePlatform()) await import('../native/runtime').then((m) => m.purgeLocalUserData(user?.id)).catch(() => {})
      await supabase.auth.signOut().catch(() => {})
      navigate('/login', { replace: true })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Section title={tr('Privacy and account deletion')}>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>{tr('Your data is private to your account (enforced by the database, not just the app).')}</li>
        <li>{tr('When you use AI, a short summary of your own data (not your whole database) is sent to the AI provider the server is set to use.')}</li>
        <li>{tr('Export your data any time in the Data section above.')}</li>
      </ul>
      <form onSubmit={remove} className="mt-5 space-y-3 rounded-xl border border-red-200 p-4 dark:border-red-500/30">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">{tr('Delete my account')}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{tr('This permanently deletes your account and every record in it. It cannot be undone. Export your data first.')}</p>
        <div>
          <label htmlFor="delete-confirm" className="label">{tr('Type DELETE to confirm')}</label>
          <input id="delete-confirm" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </div>
        <Button type="submit" variant="danger" loading={busy} disabled={text !== 'DELETE'}>{tr('Delete account permanently')}</Button>
        <Message>{error}</Message>
      </form>
    </Section>
  )
}

export default function Settings() {
  return (
    <div>
      <PageHeader title={tr('Settings')} />
      <div className="space-y-4">
        <ProfileSection />
        <AccountSection />
        <NotificationsSection />
        <AiSection />
        <AppearanceSection />
        <DataSection />
        <PrivacySection />
        <LogoutSection />
      </div>
    </div>
  )
}
