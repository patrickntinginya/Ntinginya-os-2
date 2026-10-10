import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../layouts/AuthLayout'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { friendlyAuthError } from '../utils/format'
import { tr } from '../i18n'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={tr('Sign in')}
      subtitle={tr('Welcome back.')}
      footer={<>{tr('New here?')} <Link to="/register" className="font-semibold text-brand-700 dark:text-brand-300">{tr('Create an account')}</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        <div>
          <label htmlFor="email" className="label">{tr('Email')}</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">{tr('Password')}</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <Button type="submit" loading={busy} className="w-full">{tr('Sign in')}</Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 dark:text-brand-300">{tr('Forgot your password?')}</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
