import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import {
  Code2,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import GoogleButton from '../components/GoogleButton'

export default function SignupPage() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [name,            setName]            = useState('')
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw,          setShowPw]          = useState(false)
  const [showConfirmPw,   setShowConfirmPw]   = useState(false)
  const [error,           setError]           = useState('')
  const [loading,         setLoading]         = useState(false)

  const pwStrength = password.length === 0 ? 0
    : password.length < 6 ? 1
    : password.length < 10 ? 2
    : 3
  const pwLabel = ['', 'Too short', 'Good', 'Strong']
  const pwColor = ['', '#ef4444', '#eab308', '#22c55e']

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Please enter your full name.'); return }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.'); return
    }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify your password confirmation.'); return
    }

    setError(''); setLoading(true)
    try {
      const res = await register(email.trim(), password, name.trim())
      // Seamlessly redirect to the email verification page
      nav(`/verify-email?email=${encodeURIComponent(res.email)}`)
    } catch (err: unknown) {
      setError((err as Error).message || 'Registration failed. Try a different email.')
    } finally { setLoading(false) }
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

        <h1 className="auth-title">Create an account</h1>
        <p className="auth-sub">Start reviewing codebases with AI — free</p>

        {error && (
          <div className="auth-error animate-fadeIn">
            <AlertCircle size={16} className="auth-error-icon" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="auth-form">
          {/* Name */}
          <div className="auth-field">
            <label className="auth-label">Full name</label>
            <div className="auth-inp-wrap">
              <User size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type="text"
                placeholder="Alex Morgan"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoComplete="name"
                autoFocus
              />
            </div>
          </div>

          {/* Email */}
          <div className="auth-field">
            <label className="auth-label">Email address</label>
            <div className="auth-inp-wrap">
              <Mail size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type="email"
                placeholder="alex@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password */}
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-inp-wrap">
              <Lock size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type={showPw ? 'text' : 'password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
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
            {/* Password strength bar */}
            {password.length > 0 && (
              <div className="auth-pw-strength">
                <div className="auth-pw-bar">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="auth-pw-segment"
                      style={{
                        background: pwStrength >= i ? pwColor[pwStrength] : 'var(--border)',
                      }}
                    />
                  ))}
                </div>
                <span style={{ color: pwColor[pwStrength], fontSize: '0.74rem', fontWeight: 600 }}>
                  {pwLabel[pwStrength]}
                </span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="auth-field">
            <label className="auth-label">Confirm password</label>
            <div className="auth-inp-wrap">
              <Lock size={16} className="auth-inp-icon" />
              <input
                className="auth-inp"
                type={showConfirmPw ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowConfirmPw(v => !v)}
                tabIndex={-1}
                aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary auth-btn" type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="spin" /> Creating account…
              </>
            ) : (
              <>
                <span>Create Account</span> <ArrowRight size={16} />
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
          <span>Already have an account?</span>{' '}
          <Link to="/login" className="auth-link-highlight">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
