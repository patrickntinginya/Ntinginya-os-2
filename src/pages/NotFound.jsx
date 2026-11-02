import { Link } from 'react-router-dom'
import { tr } from '../i18n'

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-sm flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-brand-600">404</p>
      <p className="mt-2 text-lg font-semibold">{tr('Page not found')}</p>
      <Link to="/dashboard" className="btn btn-primary mt-5">{tr('Go to dashboard')}</Link>
    </div>
  )
}
