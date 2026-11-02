import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Spinner from './ui/Spinner'

/** Wraps every page of the main app. Logged-out visitors are sent to /login. */
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner fullScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

/** Login / register / forgot-password: signed-in users go straight to the dashboard. */
export function PublicOnlyRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner fullScreen />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
