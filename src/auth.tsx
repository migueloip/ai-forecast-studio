import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getCurrentUser, login as loginRequest, logout as logoutRequest, register as registerRequest, type User } from './api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string, turnstileToken: string) => Promise<User>
  register: (fullName: string, email: string, password: string, turnstileToken: string) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
let sessionBootstrap: ReturnType<typeof getCurrentUser> | null = null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    sessionBootstrap ??= getCurrentUser()
    sessionBootstrap
      .then(({ user: current }) => { if (active) setUser(current) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async login(email, password, turnstileToken) {
      const result = await loginRequest(email, password, turnstileToken)
      setUser(result.user)
      return result.user
    },
    async register(fullName, email, password, turnstileToken) {
      const result = await registerRequest(fullName, email, password, turnstileToken)
      setUser(result.user)
      return result.user
    },
    async logout() {
      await logoutRequest()
      setUser(null)
    },
  }), [loading, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Context hooks intentionally live beside the provider so the session contract has one owner.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="route-loader"><span className="spinner" /> Preparing your workspace...</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
