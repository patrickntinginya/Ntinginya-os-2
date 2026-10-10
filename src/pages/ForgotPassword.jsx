import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../layouts/AuthLayout'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { friendlyAuthError } from '../utils/format'
import { tr } from '../i18n'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await resetPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={tr('Reset your password')}
      subtitle={tr('We will email you a link to choose a new one.')}
      footer={<Link to="/login" className="font-semibold text-brand-700 dark:text-brand-300">{tr('Back to sign in')}</Link>}
    >
      {sent ? (
        <p className="text-slate-600 dark:text-slate-300">
          {tr('If an account exists for')} <strong>{email}</strong>{tr(', a reset link is on its way.')}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="label">{tr('Email')}</label>
            <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          <Button type="submit" loading={busy} className="w-full">{tr('Send reset link')}</Button>
        </form>
      )}
    </AuthLayout>
  )
}
