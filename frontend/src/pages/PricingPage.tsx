import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import {
  Sparkles,
  Check,
  Zap,
  ArrowRight,
  AlertCircle,
  HelpCircle,
  Loader2,
  Layers,
  Building,
  Crown,
  RefreshCw,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Shield,
} from 'lucide-react'

interface PlanLimits {
  reviewsPerMonth: number
  chatQueriesPerMonth: number
  concurrentReviews: number
  maxHistoryRetention: number
}

interface PlanDetail {
  id: string
  name: string
  badge: string
  tagline: string
  priceMonthly: number
  priceYearly: number
  currency: string
  limits: PlanLimits
  features: string[]
}

interface SubscriptionData {
  plan: string
  status: string
  isExemptRole: boolean
  expiresAt: string | null
  billingInterval: string
  reviews: { used: number; limit: number; remaining: number; percentage: number }
  chat: { used: number; limit: number; remaining: number; percentage: number }
}

export default function PricingPage() {
  const { user, refreshUser } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()

  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [_loading, setLoading] = useState(false)
  const [_plans, setPlans] = useState<Record<string, PlanDetail> | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [gatewayConfigured, setGatewayConfigured] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [syncingStatus, setSyncingStatus] = useState(false)
  const [gatewayModal, setGatewayModal] = useState<{ open: boolean; plan: string; message: string }>({
    open: false,
    plan: '',
    message: '',
  })

  // FAQ open/close state
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  // Order verify status (if redirected with order_id)
  const [verifyStatus, setVerifyStatus] = useState<{ status: string; message: string } | null>(null)

  const userId = user?.id
  const userPlan = user?.membershipPlan

  useEffect(() => {
    let active = true
    async function loadPlansAndSub() {
      try {
        const plansRes = await fetch('/api/membership/plans')
        const plansData = await plansRes.json()
        if (active && plansData.ok) {
          setPlans(plansData.plans)
          setGatewayConfigured(Boolean(plansData.gatewayConfigured))
        }

        if (userId) {
          const subRes = await fetch('/api/membership/current', { credentials: 'include' })
          const subData = await subRes.json()
          if (active && subData.ok) {
            setSubscription(subData.subscription)
          }
        }
      } catch (err) {
        console.error('Failed to load membership data', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPlansAndSub()
    return () => { active = false }
  }, [userId, userPlan])

  // Verify return redirect from payment gateway
  useEffect(() => {
    const redirectOrderId =
      searchParams.get('order_id') ||
      searchParams.get('orderId') ||
      searchParams.get('link_id')

    const pendingSessionId = sessionStorage.getItem('codesense_pending_order_id')
    const orderId = redirectOrderId || pendingSessionId

    if (orderId && userId) {
      // Clear pending session key immediately to avoid infinite re-checking
      sessionStorage.removeItem('codesense_pending_order_id')

      setVerifyStatus({ status: 'verifying', message: 'Confirming your payment with Cashfree…' })
      fetch(`/api/membership/verify-order?orderId=${encodeURIComponent(orderId)}`, {
        credentials: 'include',
      })
        .then(r => r.json())
        .then(async d => {
          if (d.ok && d.status === 'PAID') {
            setVerifyStatus({
              status: 'success',
              message: `Payment successful! Your ${d.plan || 'Pro'} membership has been activated with upgraded quotas.`,
            })
            if (refreshUser) await refreshUser()
            const sRes = await fetch('/api/membership/current', { credentials: 'include' })
            const sd = await sRes.json()
            if (sd.ok) setSubscription(sd.subscription)
          } else {
            setVerifyStatus({
              status: 'pending',
              message: d.message || 'Payment is processing. Click "Sync Subscription Status" to check again.',
            })
          }
        })
        .catch(() => {
          setVerifyStatus({
            status: 'error',
            message: 'Unable to verify payment status automatically. Click "Sync Subscription Status" below to retry.',
          })
        })
    }
  }, [searchParams, userId])

  const handleManualSync = async (customOrderId?: string) => {
    try {
      setSyncingStatus(true)
      const pendingId =
        customOrderId ||
        sessionStorage.getItem('codesense_pending_order_id') ||
        searchParams.get('order_id') ||
        searchParams.get('orderId') ||
        searchParams.get('link_id')

      const url = pendingId
        ? `/api/membership/verify-order?orderId=${encodeURIComponent(pendingId)}`
        : '/api/membership/verify-order'

      const res = await fetch(url, { credentials: 'include' })
      const data = await res.json()
      if (data.ok && data.status === 'PAID') {
        sessionStorage.removeItem('codesense_pending_order_id')
        setVerifyStatus({
          status: 'success',
          message: `Your ${data.plan || 'Pro'} membership is verified and active! Quotas refreshed.`,
        })
        if (refreshUser) await refreshUser()
      } else {
        setVerifyStatus({
          status: 'pending',
          message: data.message || 'No paid transaction detected yet. If you recently paid, please wait a few seconds and try again.',
        })
      }
      const sRes = await fetch('/api/membership/current', { credentials: 'include' })
      const sd = await sRes.json()
      if (sd.ok) {
        setSubscription(sd.subscription)
        if (sd.subscription?.plan && sd.subscription.plan !== user?.membershipPlan) {
          if (refreshUser) await refreshUser()
        }
      }
    } catch {
      setVerifyStatus({
        status: 'error',
        message: 'Could not connect to verify payment status.',
      })
    } finally {
      setSyncingStatus(false)
    }
  }

  const currentPlanId = subscription?.plan || user?.membershipPlan || 'FREE'

  const handleSelectPlan = async (planKey: string) => {
    if (!user) {
      nav('/signup?redirect=/pricing')
      return
    }

    if (planKey === 'FREE') {
      return
    }

    if (planKey === currentPlanId && subscription?.status === 'ACTIVE') {
      return
    }

    try {
      setCheckoutLoading(planKey)
      setErrorMsg('')

      const res = await fetch('/api/membership/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          plan: planKey,
          billingInterval,
          returnUrl: `${window.location.origin}/pricing`,
        }),
      })

      const data = await res.json()
      if (data.ok && data.paymentLink) {
        if (data.orderId) {
          sessionStorage.setItem('codesense_pending_order_id', data.orderId)
        }
        // Redirect to Cashfree Hosted Checkout Page
        window.location.href = data.paymentLink
        return
      }

      if (!data.ok) {
        if (data.gatewayConfigured === false) {
          setGatewayModal({
            open: true,
            plan: planKey,
            message:
              data.error ||
              'Payment gateway credentials (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) are not configured in backend/.env. Administrators can assign and test plans directly through the Admin Panel.',
          })
        } else {
          setErrorMsg(data.error || 'Failed to initiate order. Please try again.')
        }
      }
    } catch (err: unknown) {
      setErrorMsg((err as Error).message || 'Network error initiating checkout')
    } finally {
      setCheckoutLoading(null)
    }
  }

  const faqs = [
    {
      q: 'What happens when I exhaust my monthly review quota?',
      a: 'If you reach your monthly quota, existing completed reviews and architectural reports remain fully accessible in your Review History. To run additional repository analyses before the monthly reset, you can upgrade your plan at any time.',
    },
    {
      q: 'Does membership status affect my user role or permissions?',
      a: 'No. CodeSense strictly isolates membership tiers from platform roles. Upgrading to a paid membership provides expanded computing quotas and features, but will never grant administrator privileges. Administrative roles are strictly managed via platform RBAC.',
    },
    {
      q: 'Can I cancel my subscription at any time?',
      a: 'Yes. You can cancel with a single click in your Profile & Security settings. When you cancel, your paid benefits continue without interruption until the end of your current billing period.',
    },
    {
      q: 'Are repository analyses deleted if my membership expires?',
      a: 'No. CodeSense never deletes your previous repository reviews or generated markdown documentation when a plan expires or downgrades.',
    },
    {
      q: 'What payment methods does CodeSense support?',
      a: 'Through our Cashfree payment gateway integration, we accept UPI, major credit/debit cards (Visa, MasterCard, RuPay), NetBanking, and corporate payment methods.',
    },
  ]

  return (
    <main className="pricing-container animate-fadeIn">
      {/* Verify Notification Banner */}
      {verifyStatus && (
        <div
          className={`pricing-verify-banner ${
            verifyStatus.status === 'success'
              ? 'verify-banner-success'
              : verifyStatus.status === 'error'
              ? 'verify-banner-error'
              : 'verify-banner-pending'
          }`}
        >
          <div className="verify-banner-content">
            <Sparkles size={18} />
            <span>{verifyStatus.message}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setVerifyStatus(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <section className="pricing-hero">
        <div className="pricing-eyebrow">
          <Sparkles size={14} className="text-primary" />
          <span>Transparent Developer & Team Pricing</span>
        </div>
        <h1 className="pricing-title">
          Scale your code intelligence with <span className="hero-accent">predictable plans</span>
        </h1>
        <p className="pricing-subtitle">
          From solo developers reviewing open source projects to engineering teams enforcing
          architectural standards across monorepos.
        </p>

        {!gatewayConfigured && (
          <div style={{
            maxWidth: 620,
            margin: '1.25rem auto 0',
            padding: '10px 16px',
            borderRadius: 10,
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: '0.84rem',
            color: 'var(--foreground)',
            textAlign: 'left'
          }}>
            <HelpCircle size={16} style={{ color: '#3b82f6', flexShrink: 0 }} />
            <span>
              <strong>Informational Mode:</strong> Cashfree gateway credentials are not configured on this instance. Plan upgrade actions provide full setup guidance.
            </span>
          </div>
        )}

        {/* Interval Switcher */}
        <div className="billing-interval-wrap">
          <div className="billing-interval-switcher">
            <button
              type="button"
              className={`interval-toggle-btn ${billingInterval === 'monthly' ? 'active' : ''}`}
              onClick={() => setBillingInterval('monthly')}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              className={`interval-toggle-btn ${billingInterval === 'yearly' ? 'active' : ''}`}
              onClick={() => setBillingInterval('yearly')}
            >
              Annual Billing
              <span className="save-badge">Save 20%</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="auth-alert auth-alert-error" style={{ maxWidth: 600, margin: '16px auto 0' }}>
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}
      </section>

      {/* ACTIVE PLAN SHOWCASE BANNER */}
      {user && currentPlanId !== 'FREE' && (
        <div className="active-plan-banner">
          <div className="active-plan-banner-left">
            <div className="active-crown-circle">
              <Crown size={24} />
            </div>
            <div>
              <div className="active-plan-title">
                You are currently on the <span className="highlight-plan">{currentPlanId} Plan</span>
              </div>
              <div className="active-plan-sub">
                {subscription?.expiresAt
                  ? `Active subscription • Next renewal on ${new Date(subscription.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                  : 'Active subscription • Quotas refreshed monthly'}
              </div>
            </div>
          </div>
          <div className="active-plan-banner-right">
            {subscription?.reviews && (
              <div className="active-stat-box">
                <span className="stat-label">Reviews Left</span>
                <span className="stat-val">
                  {subscription.reviews.limit >= 99999
                    ? 'Unlimited'
                    : `${subscription.reviews.remaining}/${subscription.reviews.limit}`}
                </span>
              </div>
            )}
            {subscription?.chat && (
              <div className="active-stat-box">
                <span className="stat-label">AI Chats Left</span>
                <span className="stat-val">
                  {subscription.chat.limit >= 99999
                    ? 'Unlimited'
                    : `${subscription.chat.remaining}/${subscription.chat.limit}`}
                </span>
              </div>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => handleManualSync()}
              disabled={syncingStatus}
              title="Refresh subscription status from Cashfree"
            >
              <RefreshCw size={14} className={syncingStatus ? 'spin' : ''} />
              {syncingStatus ? 'Syncing…' : 'Sync Status'}
            </button>
          </div>
        </div>
      )}

      {user && currentPlanId === 'FREE' && (
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto 2.5rem',
            padding: '12px 20px',
            borderRadius: 14,
            background: 'rgba(99, 102, 241, 0.05)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Crown size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
            <span style={{ fontSize: '0.88rem', color: 'var(--foreground)' }}>
              You are on the <strong>Free Developer Plan</strong>. Already made a payment via Cashfree?
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleManualSync()}
              disabled={syncingStatus}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                color: '#6366f1',
              }}
            >
              <RefreshCw size={14} className={syncingStatus ? 'spin' : ''} />
              {syncingStatus ? 'Verifying with Cashfree…' : 'Sync Subscription Status'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => {
                const manual = window.prompt('Enter your Cashfree Order ID or Link ID to verify:')
                if (manual && manual.trim()) {
                  handleManualSync(manual.trim())
                }
              }}
              title="Enter Cashfree order ID if paid directly"
            >
              Enter Order ID
            </button>
          </div>
        </div>
      )}

      {/* Pricing Cards Grid */}
      <section className="pricing-cards-grid">
        {/* FREE PLAN CARD */}
        <div className={`pricing-card ${currentPlanId === 'FREE' ? 'pricing-card-current' : ''}`}>
          <div className="pricing-card-header">
            <div className="pricing-plan-icon plan-icon-free">
              <Layers size={22} />
            </div>
            <div className="pricing-plan-name">
              <span>Free</span>
              {currentPlanId === 'FREE' && (
                <span className="pricing-current-pill">Current Plan</span>
              )}
            </div>
            <p className="pricing-plan-desc">
              Essential code intelligence for individual developers and small repositories.
            </p>
          </div>

          <div className="pricing-price-wrap">
            <span className="pricing-currency">₹</span>
            <span className="pricing-amount">0</span>
            <span className="pricing-period">/ month</span>
          </div>
          <div className="pricing-annual-sub">Always free, no credit card required</div>

          <ul className="pricing-features-list">
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>3</strong> repository reviews / month</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>20</strong> AI codebase chat queries</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Interactive Mermaid architecture diagrams</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Markdown review document export</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>10 latest reviews retention</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Standard community support</span>
            </li>
          </ul>

          <div className="plan-action-wrap">
            {currentPlanId === 'FREE' ? (
              <button type="button" className="pricing-cta-btn btn-current" disabled>
                <CheckCircle2 size={16} /> Active Plan
              </button>
            ) : (
              <button
                type="button"
                className="pricing-cta-btn btn-outline"
                onClick={() => handleSelectPlan('FREE')}
              >
                Included by Default
              </button>
            )}
          </div>
        </div>

        {/* PRO PLAN CARD (MOST POPULAR) */}
        <div
          className={`pricing-card popular ${
            currentPlanId === 'PRO' ? 'pricing-card-current' : ''
          }`}
        >
          <div className="pricing-badge-popular">
            <Zap size={11} style={{ marginRight: 4, display: 'inline' }} /> Most Popular
          </div>

          <div className="pricing-card-header">
            <div className="pricing-plan-icon plan-icon-pro">
              <Zap size={22} />
            </div>
            <div className="pricing-plan-name">
              <span>Pro</span>
              {currentPlanId === 'PRO' && (
                <span className="pricing-current-pill">Current Plan</span>
              )}
            </div>
            <p className="pricing-plan-desc">
              High-throughput reviews & deep architecture insights for active engineers.
            </p>
          </div>

          <div className="pricing-price-wrap">
            <span className="pricing-currency">₹</span>
            <span className="pricing-amount">
              {billingInterval === 'yearly' ? '399' : '499'}
            </span>
            <span className="pricing-period">/ month</span>
          </div>
          <div className="pricing-annual-sub">
            {billingInterval === 'yearly'
              ? 'Billed ₹4,790 annually (Save 20%)'
              : 'Billed monthly, cancel anytime'}
          </div>

          <ul className="pricing-features-list">
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>50</strong> repository reviews / month</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>500</strong> AI codebase chat queries</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>Unlimited</strong> review history retention</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>3 concurrent</strong> repository analysis jobs</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>High-priority LLM processing queue</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Full printable PDF & SVG diagram exports</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Email notification summaries</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Direct priority email support</span>
            </li>
          </ul>

          <div className="plan-action-wrap">
            {currentPlanId === 'PRO' ? (
              <button type="button" className="pricing-cta-btn btn-current" disabled>
                <CheckCircle2 size={16} /> Active Plan
              </button>
            ) : (
              <button
                type="button"
                className="pricing-cta-btn btn-primary"
                disabled={checkoutLoading === 'PRO'}
                onClick={() => handleSelectPlan('PRO')}
              >
                {checkoutLoading === 'PRO' ? (
                  <>
                    <Loader2 size={16} className="spin" /> Opening Checkout…
                  </>
                ) : (
                  <>
                    Upgrade to Pro <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ENTERPRISE PLAN CARD */}
        <div
          className={`pricing-card ${
            currentPlanId === 'ENTERPRISE' ? 'pricing-card-current' : ''
          }`}
        >
          <div className="pricing-card-header">
            <div className="pricing-plan-icon plan-icon-enterprise">
              <Building size={22} />
            </div>
            <div className="pricing-plan-name">
              <span>Enterprise</span>
              {currentPlanId === 'ENTERPRISE' && (
                <span className="pricing-current-pill">Current Plan</span>
              )}
            </div>
            <p className="pricing-plan-desc">
              Unlimited intelligence, concurrent queues, and centralized administration for teams.
            </p>
          </div>

          <div className="pricing-price-wrap">
            <span className="pricing-currency">₹</span>
            <span className="pricing-amount">
              {billingInterval === 'yearly' ? '1,599' : '1,999'}
            </span>
            <span className="pricing-period">/ month</span>
          </div>
          <div className="pricing-annual-sub">
            {billingInterval === 'yearly'
              ? 'Billed ₹19,190 annually (Save 20%)'
              : 'Billed monthly, cancel anytime'}
          </div>

          <ul className="pricing-features-list">
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>Unlimited (∞)</strong> repository reviews</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>Unlimited (∞)</strong> AI codebase chat</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span><strong>10 concurrent</strong> analysis workers</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Dedicated high-throughput GPU/LLM tier</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Centralized platform RBAC & quota management</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Security & Audit Log streaming access</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>Custom architecture report templating</span>
            </li>
            <li className="pricing-feature-item">
              <Check size={16} className="pricing-feature-icon" />
              <span>24/7 dedicated engineering support & SLA</span>
            </li>
          </ul>

          <div className="plan-action-wrap">
            {currentPlanId === 'ENTERPRISE' ? (
              <button type="button" className="pricing-cta-btn btn-current" disabled>
                <CheckCircle2 size={16} /> Active Plan
              </button>
            ) : (
              <button
                type="button"
                className="pricing-cta-btn btn-outline"
                disabled={checkoutLoading === 'ENTERPRISE'}
                onClick={() => handleSelectPlan('ENTERPRISE')}
              >
                {checkoutLoading === 'ENTERPRISE' ? (
                  <>
                    <Loader2 size={16} className="spin" /> Opening Checkout…
                  </>
                ) : (
                  <>
                    Upgrade to Enterprise <Building size={16} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Feature Comparison Matrix */}
      <section className="pricing-matrix-section">
        <div className="matrix-header">
          <h2 className="matrix-title">Detailed Feature Comparison</h2>
          <p className="matrix-sub">Comprehensive overview of limits, features, and capabilities.</p>
        </div>

        <div className="table-wrap">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="matrix-th-feature">Capability</th>
                <th className="matrix-th-plan">Free</th>
                <th className="matrix-th-plan matrix-th-featured">Pro</th>
                <th className="matrix-th-plan">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              <tr className="matrix-section-row">
                <td colSpan={4}>Usage Allowances</td>
              </tr>
              <tr>
                <td>Repository Reviews / Month</td>
                <td>3 reviews</td>
                <td className="matrix-td-featured"><strong>50 reviews</strong></td>
                <td><strong>Unlimited (∞)</strong></td>
              </tr>
              <tr>
                <td>AI Codebase Chat Questions / Month</td>
                <td>20 queries</td>
                <td className="matrix-td-featured"><strong>500 queries</strong></td>
                <td><strong>Unlimited (∞)</strong></td>
              </tr>
              <tr>
                <td>Concurrent Analysis Jobs</td>
                <td>1 job</td>
                <td className="matrix-td-featured">3 jobs</td>
                <td>10 jobs</td>
              </tr>
              <tr>
                <td>Review History Retention</td>
                <td>10 latest reviews</td>
                <td className="matrix-td-featured">Unlimited</td>
                <td>Unlimited</td>
              </tr>

              <tr className="matrix-section-row">
                <td colSpan={4}>Architecture & Documentation</td>
              </tr>
              <tr>
                <td>Mermaid Architecture Diagrams</td>
                <td>Standard Flow</td>
                <td className="matrix-td-featured">Interactive Multi-chart</td>
                <td>Full Interactive Suite</td>
              </tr>
              <tr>
                <td>Printable PDF & SVG Export</td>
                <td>Basic</td>
                <td className="matrix-td-featured">Full High-Res</td>
                <td>White-labeled / Custom</td>
              </tr>
              <tr>
                <td>Markdown Review Download</td>
                <td><Check size={16} className="text-success" /></td>
                <td className="matrix-td-featured"><Check size={16} className="text-success" /></td>
                <td><Check size={16} className="text-success" /></td>
              </tr>

              <tr className="matrix-section-row">
                <td colSpan={4}>Security & Administration</td>
              </tr>
              <tr>
                <td>Platform RBAC Integration</td>
                <td><Check size={16} className="text-success" /></td>
                <td className="matrix-td-featured"><Check size={16} className="text-success" /></td>
                <td><Check size={16} className="text-success" /></td>
              </tr>
              <tr>
                <td>Security Audit Logs Access</td>
                <td>—</td>
                <td className="matrix-td-featured">—</td>
                <td><Check size={16} className="text-success" /></td>
              </tr>
              <tr>
                <td>Priority Technical Support</td>
                <td>Community</td>
                <td className="matrix-td-featured">Email (24h)</td>
                <td>Dedicated 24/7 SLA</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ Accordion */}
      <section className="pricing-faq-section">
        <div className="faq-header">
          <HelpCircle size={20} className="text-primary" />
          <h2 className="faq-title">Frequently Asked Questions</h2>
        </div>

        <div className="faq-list">
          {faqs.map((f, i) => (
            <div key={i} className="faq-item">
              <button
                type="button"
                className="faq-question-btn"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                aria-expanded={openFaq === i}
              >
                <span>{f.q}</span>
                {openFaq === i ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openFaq === i && (
                <div className="faq-answer animate-fadeIn">
                  <p>{f.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Gateway Pending Configuration Modal */}
      {gatewayModal.open && (
        <div className="modal-backdrop animate-fadeIn" onClick={() => setGatewayModal({ open: false, plan: '', message: '' })}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-wrap modal-icon-warn">
                <Shield size={20} />
              </div>
              <div>
                <h3 className="modal-title">Payment Gateway Notice</h3>
                <span className="modal-subtitle">Cashfree Gateway Configuration Required</span>
              </div>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                {gatewayModal.message}
              </p>
              <div className="modal-callout">
                <strong>For Administrators & Developers:</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                  To activate online checkout, configure <code>CASHFREE_APP_ID</code> and{' '}
                  <code>CASHFREE_SECRET_KEY</code> in <code>backend/.env</code>.
                  To test {gatewayModal.plan} plan features right now, assign the tier in the{' '}
                  <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                    Admin Panel
                  </Link>.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setGatewayModal({ open: false, plan: '', message: '' })}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
