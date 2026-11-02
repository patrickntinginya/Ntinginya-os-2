import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../layouts/AuthLayout'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { friendlyAuthError } from '../utils/format'
import { tr } from '../i18n'

/** Landing page for the link in the password-reset email. Supabase signs the user in from the link. */
export default function ResetPassword() {
  const { user, loading, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner fullScreen />

  if (!user) {
    return (
      <AuthLayout title={tr('Link expired')} footer={<Link to="/forgot-password" className="font-semibold text-brand-700 dark:text-brand-300">{tr('Request a new link')}</Link>}>
        <p className="text-slate-600 dark:text-slate-300">{tr('This reset link is invalid or has expired.')}</p>
      </AuthLayout>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      await updatePassword(password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={tr('Choose a new password')}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="password" className="label">{tr('New password')}</label>
          <input id="password" type="password" className="input" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm" className="label">{tr('Confirm password')}</label>
          <input id="confirm" type="password" className="input" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">{tr('Save password')}</Button>
      </form>
    </AuthLayout>
  )
}
