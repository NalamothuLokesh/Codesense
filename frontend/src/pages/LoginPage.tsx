import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth, type AuthErrorWithDetails } from '../AuthContext'
import {
  Code2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import GoogleButton from '../components/GoogleButton'

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [error,        setError]        = useState('')
  const [infoMsg,      setInfoMsg]      = useState('')
  const [loading,      setLoading]      = useState(false)

  // Check URL query parameters for OAuth errors or verification notices
  useEffect(() => {
    const errorParam = searchParams.get('error')
    const verifiedParam = searchParams.get('verified')
    const emailParam = searchParams.get('email')

    if (errorParam) {
      setError(errorParam)
    }
    if (verifiedParam) {
      setInfoMsg('Email verified successfully! You can now sign in with your credentials.')
    }
    if (emailParam) {
      setEmail(emailParam)
    }
  }, [searchParams])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfoMsg('')
    setLoading(true)

    try {
      await login(email.trim(), password)
      nav('/')
    } catch (err: unknown) {
      const authErr = err as AuthErrorWithDetails
      setError(authErr.message || 'Email or password is incorrect.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-glow" />

      <div className="auth-card animate-fadeIn">
        {/* Brand Emblem */}
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <Code2 size={22} strokeWidth={2.5} />
          </div>
          <span className="auth-brand-name">CodeSense</span>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to your account to review repositories</p>

        {/* Success / Info Alert */}
        {infoMsg && (
          <div className="auth-success animate-fadeIn">
            <CheckCircle2 size={16} className="auth-success-icon" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="auth-error animate-fadeIn">
            <AlertCircle size={16} className="auth-error-icon" />
            <div className="auth-error-body">
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="auth-form">
          {/* Email */}
          <div className="auth-field">
            <label className="auth-label">Email</label>
            <div className="auth-inp-wrap">
              <Mail size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          {/* Password */}
          <div className="auth-field">
            <div className="auth-field-header">
              <label className="auth-label">Password</label>
              <span
                className="auth-forgot-link"
                title="Contact your administrator to reset credentials or re-verify"
              >
                Forgot password?
              </span>
            </div>
            <div className="auth-inp-wrap">
              <Lock size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type={showPw ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary auth-btn" type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="spin" /> Signing in…
              </>
            ) : (
              <>
                <span>Sign In</span> <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        {/* Continue with Google */}
        <div className="auth-oauth-wrap">
          <GoogleButton label="Continue with Google" onError={msg => setError(msg)} />
        </div>

        <div className="auth-footer-prompt">
          <span>Don&apos;t have an account?</span>{' '}
          <Link to="/signup" className="auth-link-highlight">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  )
}
