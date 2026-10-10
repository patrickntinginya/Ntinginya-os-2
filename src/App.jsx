import { Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute'
import ConfigMissing from './components/ConfigMissing'
import AppLayout from './layouts/AppLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Today from './pages/Today'
import Planner from './pages/Planner'
import Tasks from './pages/Tasks'
import Schedule from './pages/Schedule'
import Finance from './pages/Finance'
import Goals from './pages/Goals'
import Projects from './pages/Projects'
import Brainstorm from './pages/Brainstorm'
import Knowledge from './pages/Knowledge'
import Notes from './pages/Notes'
import Habits from './pages/Habits'
import Reminders from './pages/Reminders'
import Notifications from './pages/Notifications'
import Insights from './pages/Insights'
import Reviews from './pages/Reviews'
import AiAssistant from './pages/AiAssistant'
import SearchPage from './pages/SearchPage'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />

  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Route>

        {/* Reached from the emailed link; Supabase signs the user in, so it is not public-only. */}
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/today" element={<Today />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/brainstorm" element={<Brainstorm />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/habits" element={<Habits />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/reviews" element={<Navigate to="/reviews/daily" replace />} />
            <Route path="/reviews/:kind" element={<Reviews />} />
            <Route path="/ai" element={<AiAssistant />} />
            <Route path="/ai-assistant" element={<Navigate to="/ai" replace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  )
}
