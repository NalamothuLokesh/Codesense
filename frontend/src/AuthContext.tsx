import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface NotificationPreferences {
  analysisCompleted: boolean
  criticalIssues: boolean
  securityAlerts: boolean
  emailNotifications: boolean
}

export interface User {
  id: string          // MongoDB ObjectId string
  email: string
  name: string
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'
  membershipPlan?: 'FREE' | 'PRO' | 'ENTERPRISE'
  status?: 'ACTIVE' | 'SUSPENDED'
  emailVerified?: boolean
  authProvider?: 'local' | 'google'
  avatar?: string | null
  bio?: string
  notificationPreferences?: NotificationPreferences
  created_at: string
}

export interface RegisterResult {
  email: string
  resendAvailableIn: number
  expiresIn: number
}

export interface ResendResult {
  resendAvailableIn: number
  expiresIn: number
}

export interface AuthErrorWithDetails extends Error {
  unverified?: boolean
  email?: string
  expired?: boolean
  attemptsExceeded?: boolean
}

interface AuthCtx {
  user: User | null
  token: string | null
  loading: boolean
  dbReady: boolean
  login:             (email: string, password: string) => Promise<void>
  register:          (email: string, password: string, name: string) => Promise<RegisterResult>
  verifyEmail:       (email: string, code: string) => Promise<void>
  resendCode:        (email: string) => Promise<ResendResult>
  logout:            () => Promise<void>
  refreshUser:       () => Promise<void>
  updateProfile:     (data: { name: string; bio?: string; avatar?: string | null }) => Promise<void>
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>
  deleteAccount:     (confirmation: string) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)
// Non-persistent tab-session cache for token (cleared when browser/tab closes)
const SESSION_TOKEN_KEY = 'codesense_session_token'

/**
 * Resilient fetch helper that handles non-JSON responses (e.g. Vercel/Render 502/504 gateway timeout
 * or backend cold start delays) and returns parsed JSON or a human-readable, friendly error.
 */
async function safeApiCall(url: string, init?: RequestInit, retries = 2): Promise<any> {
  let lastError: any = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init)
      const text = await res.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        // Non-JSON response received (HTML error page, Vercel/Render Gateway Timeout, etc.)
        if (res.status === 502 || res.status === 503 || res.status === 504 || /error occurred/i.test(text)) {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          throw new Error('The backend server is waking up from sleep. Please wait a few seconds and try again.')
        }
        throw new Error(`Server returned status ${res.status}. Please check your connection and try again.`)
      }

      // If server returned a 502/503/504 JSON error while spinning up, retry
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
        await new Promise(r => setTimeout(r, 2000))
        continue
      }

      return data
    } catch (err: any) {
      lastError = err
      const msg = err?.message || ''
      if ((msg.includes('waking up') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) && attempt < retries) {
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      throw err
    }
  }
  throw lastError || new Error('Request timed out. Please try again.')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [token,   setToken]   = useState<string | null>(() => sessionStorage.getItem(SESSION_TOKEN_KEY))
  const [loading, setLoading] = useState(true)
  const [dbReady, setDbReady] = useState(false)

  // Remove any legacy persistent localStorage token to ensure browser close logout behavior
  useEffect(() => {
    localStorage.removeItem('codesense_token')
  }, [])

  // Check DB health once on mount
  useEffect(() => {
    safeApiCall('/api/health', undefined, 1)
      .then(d => setDbReady(d?.db === 'connected' || d?.status === 'ok'))
      .catch(() => setDbReady(false))
  }, [])

  const fetchCurrentUser = async () => {
    try {
      const cachedTok = sessionStorage.getItem(SESSION_TOKEN_KEY)
      const headers: Record<string, string> = {}
      if (cachedTok) headers['Authorization'] = `Bearer ${cachedTok}`

      const d = await safeApiCall('/api/auth/me', {
        credentials: 'include', // Sends HttpOnly session cookie
        headers,
      }, 1)

      if (d.ok && d.user) {
        setUser(d.user)
        if (d.token) {
          setToken(d.token)
          sessionStorage.setItem(SESSION_TOKEN_KEY, d.token)
        }
      } else {
        setUser(null)
        setToken(null)
        sessionStorage.removeItem(SESSION_TOKEN_KEY)
      }
    } catch {
      // Network failure — maintain current memory state
    } finally {
      setLoading(false)
    }
  }

  // Restore session on mount via HttpOnly session cookie or sessionStorage
  useEffect(() => {
    fetchCurrentUser()
  }, [])

  const saveAuthSession = (tok: string, u: User) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, tok)
    sessionStorage.removeItem('codesense_job')
    setToken(tok)
    setUser(u)
    setDbReady(true)
  }

  const login = async (email: string, password: string) => {
    const d = await safeApiCall('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    })
    if (!d.ok) {
      const err: AuthErrorWithDetails = new Error(d.error || 'Sign in failed')
      if (d.unverified) {
        err.unverified = true
        err.email = d.email || email.trim().toLowerCase()
      }
      throw err
    }
    saveAuthSession(d.token, d.user)
  }

  const register = async (email: string, password: string, name: string): Promise<RegisterResult> => {
    const d = await safeApiCall('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: name.trim() }),
    })
    if (!d.ok) {
      throw new Error(d.error || 'Registration failed')
    }
    return {
      email: d.email || email.trim().toLowerCase(),
      resendAvailableIn: d.resendAvailableIn ?? 30,
      expiresIn: d.expiresIn ?? 600,
    }
  }

  const verifyEmail = async (email: string, code: string) => {
    const d = await safeApiCall('/api/auth/verify-email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
    })
    if (!d.ok) {
      const err: AuthErrorWithDetails = new Error(d.error || 'Verification failed')
      err.expired = d.expired
      err.attemptsExceeded = d.attemptsExceeded
      throw err
    }
    saveAuthSession(d.token, d.user)
  }

  const resendCode = async (email: string): Promise<ResendResult> => {
    const d = await safeApiCall('/api/auth/resend-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    if (!d.ok) {
      throw new Error(d.error || 'Could not resend code')
    }
    return {
      resendAvailableIn: d.resendAvailableIn ?? 30,
      expiresIn: d.expiresIn ?? 600,
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Invalidate locally regardless of network
    } finally {
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
      sessionStorage.removeItem('codesense_job')
      localStorage.removeItem('codesense_token')
      setToken(null)
      setUser(null)
    }
  }

  const refreshUser = async () => {
    await fetchCurrentUser()
  }

  const updateProfile = async (data: { name: string; bio?: string; avatar?: string | null }) => {
    const cachedTok = sessionStorage.getItem(SESSION_TOKEN_KEY)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cachedTok) headers['Authorization'] = `Bearer ${cachedTok}`

    const d = await safeApiCall('/api/user/profile', {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(data),
    })
    if (!d.ok) {
      throw new Error(d.error || 'Failed to update profile')
    }
    setUser(d.user)
  }

  const updatePreferences = async (notificationPreferences: Partial<NotificationPreferences>) => {
    const cachedTok = sessionStorage.getItem(SESSION_TOKEN_KEY)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cachedTok) headers['Authorization'] = `Bearer ${cachedTok}`

    const d = await safeApiCall('/api/user/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify({ notificationPreferences }),
    })
    if (!d.ok) {
      throw new Error(d.error || 'Failed to update notification preferences')
    }
    setUser(d.user)
  }

  const deleteAccount = async (confirmation: string) => {
    const cachedTok = sessionStorage.getItem(SESSION_TOKEN_KEY)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cachedTok) headers['Authorization'] = `Bearer ${cachedTok}`

    const d = await safeApiCall('/api/user/account', {
      method: 'DELETE',
      credentials: 'include',
      headers,
      body: JSON.stringify({ confirmation }),
    })
    if (!d.ok) {
      throw new Error(d.error || 'Failed to delete account')
    }
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    sessionStorage.removeItem('codesense_job')
    localStorage.removeItem('codesense_token')
    setToken(null)
    setUser(null)
  }

  return (
    <Ctx.Provider value={{
      user,
      token,
      loading,
      dbReady,
      login,
      register,
      verifyEmail,
      resendCode,
      logout,
      refreshUser,
      updateProfile,
      updatePreferences,
      deleteAccount,
    }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

