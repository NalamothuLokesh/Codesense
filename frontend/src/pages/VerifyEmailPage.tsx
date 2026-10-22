import { useState, useRef, useEffect, type FormEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth, type AuthErrorWithDetails } from '../AuthContext'
import {
  Code2,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Clock,
  ArrowLeft,
} from 'lucide-react'

// Helper to partially mask email for privacy (e.g. lo****@gmail.com)
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email
  const [user, domain] = email.split('@')
  if (user.length <= 2) {
    return `${user}***@${domain}`
  }
  const visible = user.slice(0, 2)
  return `${visible}${'*'.repeat(Math.min(user.length - 2, 5))}@${domain}`
}

export default function VerifyEmailPage() {
  const { verifyEmail, resendCode } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()

  // Retrieve email from URL search params or fallback
  const emailParam = searchParams.get('email') || ''
  const [email] = useState(emailParam)

  // 6 digit PIN input states
  const [pin, setPin] = useState<string[]>(['', '', '', '', '', ''])
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // 10 minute expiration countdown (600 seconds)
  const [expiresSeconds, setExpiresSeconds] = useState(600)
  // 30 second resend cooldown
  const [resendCooldown, setResendCooldown] = useState(30)

  // Auto-focus first input on mount
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus()
    }
  }, [])

  // Expiration timer countdown
  useEffect(() => {
    if (expiresSeconds <= 0) return
    const timer = setInterval(() => {
      setExpiresSeconds(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresSeconds])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Format seconds to MM:SS
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  // Handle single digit input
  const handleDigitChange = (index: number, val: string) => {
    // Only accept numeric digit
    const cleaned = val.replace(/\D/g, '')
    if (!cleaned) {
      const next = [...pin]
      next[index] = ''
      setPin(next)
      return
    }

    const digit = cleaned.slice(-1)
    const next = [...pin]
    next[index] = digit
    setPin(next)
    setError('')

    // Move to next input box
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  // Handle Backspace and arrow keys
  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!pin[index] && index > 0) {
        const next = [...pin]
        next[index - 1] = ''
        setPin(next)
        inputRefs.current[index - 1]?.focus()
      } else {
        const next = [...pin]
        next[index] = ''
        setPin(next)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  // Handle full 6-digit paste
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').trim()
    const digits = text.replace(/\D/g, '').slice(0, 6).split('')
    if (digits.length === 0) return

    const next = [...pin]
    digits.forEach((d, i) => {
      if (i < 6) next[i] = d
    })
    setPin(next)
    setError('')

    const focusIdx = Math.min(digits.length, 5)
    inputRefs.current[focusIdx]?.focus()

    // If a full 6-digit code was pasted, automatically trigger verification
    if (digits.length === 6) {
      handleVerify(digits.join(''))
    }
  }

  const handleVerify = async (codeToVerify?: string) => {
    const code = codeToVerify || pin.join('')
    if (code.length !== 6) {
      setError('Please enter the full 6-digit verification code.')
      return
    }
    if (!email) {
      setError('No email address provided for verification. Please register again.')
      return
    }
    if (expiresSeconds <= 0) {
      setError('Your verification code has expired. Please request a new code.')
      return
    }

    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      await verifyEmail(email, code)
      setSuccessMsg('Email verified successfully! Redirecting to dashboard…')
      setTimeout(() => {
        nav('/')
      }, 1000)
    } catch (err: unknown) {
      const authErr = err as AuthErrorWithDetails
      if (authErr.expired) {
        setExpiresSeconds(0)
        setError('This verification code has expired. Request a new code.')
      } else if (authErr.attemptsExceeded) {
        setError('Too many failed attempts. This code has been invalidated. Please request a new code.')
      } else {
        setError(authErr.message || 'Verification failed. Please check your code and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    handleVerify()
  }

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return
    if (!email) {
      setError('No email address found. Please register again.')
      return
    }

    setResending(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await resendCode(email)
      setPin(['', '', '', '', '', ''])
      setExpiresSeconds(res.expiresIn || 600)
      setResendCooldown(res.resendAvailableIn || 30)
      setSuccessMsg('A new verification code has been sent to your email.')
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus()
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Unable to send a new code. Please try again.')
    } finally {
      setResending(false)
    }
  }

  const isExpired = expiresSeconds <= 0

  return (
    <div className="auth-page">
      <div className="auth-bg-glow" />

      <div className="auth-card animate-fadeIn">
        {/* Brand Header */}
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <Code2 size={22} strokeWidth={2.5} />
          </div>
          <span className="auth-brand-name">CodeSense</span>
        </div>

        <h1 className="auth-title">Verify your email</h1>
        
        <p className="auth-sub">
          We&apos;ve sent a 6-digit verification code to:
          <br />
          <strong className="verify-email-display">{maskEmail(email) || 'your email'}</strong>
        </p>

        {/* Error Alert */}
        {error && (
          <div className="auth-error animate-fadeIn">
            <AlertCircle size={16} className="auth-error-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="auth-success animate-fadeIn">
            <CheckCircle2 size={16} className="auth-success-icon" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Expired Warning Banner */}
        {isExpired && (
          <div className="auth-warning animate-fadeIn">
            <Clock size={16} className="auth-warning-icon" />
            <span>Your verification code has expired. Request a new code below.</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          {/* 6-Digit PIN Boxes */}
          <div className="pin-group">
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                disabled={loading || isExpired}
                onChange={e => handleDigitChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                onPaste={handlePaste}
                className={`pin-box ${digit ? 'pin-filled' : ''} ${isExpired ? 'pin-disabled' : ''}`}
                autoComplete="one-time-code"
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>

          {/* Expiration Timer Indicator */}
          <div className="otp-expiry-indicator">
            <Clock size={14} className={isExpired ? 'text-destructive' : 'text-primary'} />
            {isExpired ? (
              <span className="text-destructive font-medium">Code expired</span>
            ) : (
              <span>
                Code expires in <strong>{formatTime(expiresSeconds)}</strong>
              </span>
            )}
          </div>

          {/* Verify Button */}
          <button
            className="btn btn-primary auth-btn"
            type="submit"
            disabled={loading || pin.join('').length !== 6 || isExpired}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spin" /> Verifying…
              </>
            ) : (
              <>
                <span>Verify Email</span> <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Resend Code Section */}
        <div className="otp-resend-section">
          <p className="otp-resend-text">Didn&apos;t receive the code?</p>
          {resendCooldown > 0 ? (
            <span className="otp-cooldown-text">
              Resend code in <strong>{resendCooldown}s</strong>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm otp-resend-btn"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? (
                <>
                  <Loader2 size={14} className="spin" /> Sending…
                </>
              ) : (
                <>
                  <RefreshCw size={14} /> Send new code
                </>
              )}
            </button>
          )}
        </div>

        <div className="auth-divider">
          <span>or</span>
        </div>

        {/* Back to sign in / register */}
        <Link to="/signup" className="btn btn-ghost auth-btn-secondary back-to-auth">
          <ArrowLeft size={15} /> Back to registration
        </Link>
      </div>
    </div>
  )
}
