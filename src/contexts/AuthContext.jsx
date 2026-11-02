import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isNativePlatform } from '../lib/platform'
import { authRedirectUrl, markAuthPending } from '../lib/authRedirect'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile(data ?? null)
      })
    return () => {
      active = false
    }
  }, [userId])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async ({ email, password, fullName }) => {
    if (isNativePlatform()) markAuthPending('signup') // only a link this app asked for is accepted back (see lib/authRedirect.js)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: authRedirectUrl('login') },
    })
    if (error) throw error
    // No session means the project requires email confirmation first.
    return { needsConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    // Android only: try to send queued reminder changes first (bounded wait; never blocks sign-out for long).
    if (isNativePlatform()) await import('../native/runtime').then((m) => m.beforeSignOut()).catch(() => {})
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const resetPassword = useCallback(async (email) => {
    if (isNativePlatform()) markAuthPending('recovery')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl('reset-password'),
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }, [])

  const updateProfile = useCallback(
    async (values) => {
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ user_id: userId, ...values }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error
      setProfile(data)
      return data
    },
    [userId],
  )

  const value = useMemo(
    () => ({
      session, user: session?.user ?? null, profile, loading,
      signIn, signUp, signOut, resetPassword, updatePassword, updateProfile,
    }),
    [session, profile, loading, signIn, signUp, signOut, resetPassword, updatePassword, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
