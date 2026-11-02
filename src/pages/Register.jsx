import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../layouts/AuthLayout'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { friendlyAuthError } from '../utils/format'
import { tr } from '../i18n'

export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      const { needsConfirmation } = await signUp({ email: email.trim(), password, fullName: fullName.trim() })
      if (needsConfirmation) {
        setConfirmSent(true)
        setBusy(false)
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  if (confirmSent) {
    return (
      <AuthLayout title={tr('Check your email')} footer={<Link to="/login" className="font-semibold text-brand-700 dark:text-brand-300">{tr('Back to sign in')}</Link>}>
        <p className="text-slate-600 dark:text-slate-300">
          {tr('We sent a confirmation link to')} <strong>{email}</strong>{tr('. Open it, then sign in.')}
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={tr('Create your account')}
      subtitle={tr('Your data stays private to you.')}
      footer={<>{tr('Already have an account?')} <Link to="/login" className="font-semibold text-brand-700 dark:text-brand-300">{tr('Sign in')}</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="name" className="label">{tr('Your name')}</label>
          <input id="name" className="input" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="email" className="label">{tr('Email')}</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">{tr('Password')}</label>
          <input id="password" type="password" className="input" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm" className="label">{tr('Confirm password')}</label>
          <input id="confirm" type="password" className="input" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">{tr('Create account')}</Button>
      </form>
    </AuthLayout>
  )
}
