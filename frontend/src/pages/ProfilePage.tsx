import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  User as UserIcon,
  Mail,
  Camera,
  Trash2,
  Check,
  AlertTriangle,
  Bell,
  Save,
  Loader2,
  X,
  CreditCard,
  Zap,
  Sparkles,
  Layers,
  MessageSquare,
  Calendar,
  ArrowUpRight,
  Crown,
} from 'lucide-react'
import { useAuth, type NotificationPreferences } from '../AuthContext'

export default function ProfilePage() {
  const { user, updateProfile, updatePreferences, deleteAccount } = useAuth()
  const nav = useNavigate()

  // Profile fields state
  const [name, setName] = useState(user?.name || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [avatar, setAvatar] = useState<string | null>(user?.avatar || null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null)
  
  // Notification preferences state
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    analysisCompleted: user?.notificationPreferences?.analysisCompleted ?? true,
    criticalIssues: user?.notificationPreferences?.criticalIssues ?? true,
    securityAlerts: user?.notificationPreferences?.securityAlerts ?? true,
    emailNotifications: user?.notificationPreferences?.emailNotifications ?? true,
  })

  // Status & loading states
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [prefsSuccess, setPrefsSuccess] = useState('')
  const [profileError, setProfileError] = useState('')
  const [prefsError, setPrefsError] = useState('')

  // Danger zone modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Membership & Subscription state
  const [subscription, setSubscription] = useState<any>(null)
  const [subSuccess, setSubSuccess] = useState('')
  const [subError, setSubError] = useState('')
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancellingSub, setCancellingSub] = useState(false)

  const loadMembership = async () => {
    try {
      const res = await fetch('/api/membership/current', { credentials: 'include' })
      const data = await res.json()
      if (data.ok) {
        setSubscription(data.subscription)
      }
    } catch {
      // Ignore network failure
    }
  }

  useEffect(() => {
    if (user) {
      loadMembership()
    }
  }, [user])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync state if user updates
  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setBio(user.bio || '')
      setAvatar(user.avatar || null)
      setAvatarPreview(user.avatar || null)
      if (user.notificationPreferences) {
        setPrefs({
          analysisCompleted: user.notificationPreferences.analysisCompleted ?? true,
          criticalIssues: user.notificationPreferences.criticalIssues ?? true,
          securityAlerts: user.notificationPreferences.securityAlerts ?? true,
          emailNotifications: user.notificationPreferences.emailNotifications ?? true,
        })
      }
    }
  }, [user])

  if (!user) {
    return null
  }

  const initials = user.name
    ? user.name
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  // Avatar file upload handler
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setProfileError('Supported formats: JPG, PNG, WEBP')
      return
    }

    // Validate size (< 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setProfileError('Image size must be under 2MB')
      return
    }

    setProfileError('')
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setAvatarPreview(result)
      setAvatar(result)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveAvatar = () => {
    setAvatar(null)
    setAvatarPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Save profile information
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setProfileError('Name cannot be empty')
      return
    }

    setSavingProfile(true)
    setProfileError('')
    setProfileSuccess('')

    try {
      await updateProfile({
        name: name.trim(),
        bio: bio.trim(),
        avatar: avatar,
      })
      setProfileSuccess('Profile updated successfully')
      setTimeout(() => setProfileSuccess(''), 4000)
    } catch (err: any) {
      setProfileError(err.message || 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  // Toggle notification preferences
  const handleTogglePref = async (key: keyof NotificationPreferences) => {
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)
    setSavingPrefs(true)
    setPrefsError('')
    setPrefsSuccess('')

    try {
      await updatePreferences(updated)
      setPrefsSuccess('Preferences saved')
      setTimeout(() => setPrefsSuccess(''), 3000)
    } catch (err: any) {
      setPrefsError(err.message || 'Failed to save preferences')
      // Rollback
      setPrefs(prefs)
    } finally {
      setSavingPrefs(false)
    }
  }

  // Handle account deletion
  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== 'DELETE') return

    setDeletingAccount(true)
    setDeleteError('')

    try {
      await deleteAccount(deleteConfirmationText)
      nav('/login')
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account')
      setDeletingAccount(false)
    }
  }

  return (
    <main className="main" style={{ paddingTop: 32, maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div className="profile-page-header">
        <h1 className="profile-page-title">Account Settings</h1>
        <p className="profile-page-desc">
          Manage your personal details, profile image, notification preferences, and account security.
        </p>
      </div>

      {/* ── Section 1: Profile Information ─────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-card-icon-wrap">
            <UserIcon size={18} />
          </div>
          <div>
            <h2 className="settings-card-title">Profile Information</h2>
            <p className="settings-card-subtitle">
              Your public profile and contact information across CodeSense reviews.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="settings-card-body">
          {profileError && (
            <div className="auth-alert auth-alert-error" style={{ marginBottom: 16 }}>
              <AlertTriangle size={15} />
              <span>{profileError}</span>
            </div>
          )}
          {profileSuccess && (
            <div className="auth-alert auth-alert-success" style={{ marginBottom: 16 }}>
              <Check size={15} />
              <span>{profileSuccess}</span>
            </div>
          )}

          {/* Avatar Upload / Preview */}
          <div className="avatar-upload-section">
            <div className="avatar-preview-wrap">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={user.name}
                  className="profile-avatar-img"
                />
              ) : (
                <div className="profile-avatar-placeholder">
                  {initials}
                </div>
              )}
            </div>

            <div className="avatar-actions-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
              <div className="avatar-btn-row">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera size={14} />
                  <span>{avatarPreview ? 'Change photo' : 'Upload photo'}</span>
                </button>
                {avatarPreview && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-danger"
                    onClick={handleRemoveAvatar}
                  >
                    <Trash2 size={14} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
              <span className="avatar-help-text">
                JPG, PNG or WEBP. Max size 2MB. Square ratio recommended.
              </span>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 20 }}>
            <label className="form-label" htmlFor="profile-name">
              Full Name
            </label>
            <input
              id="profile-name"
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your full name"
              required
              maxLength={100}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="profile-email">
              Email Address
            </label>
            <div className="input-with-icon">
              <Mail size={16} className="input-icon-left" />
              <input
                id="profile-email"
                type="email"
                className="form-input form-input-readonly"
                value={user.email}
                readOnly
                disabled
              />
            </div>
            <span className="form-hint">
              Your authenticated email is linked to your account and cannot be modified directly.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="profile-bio">
              Bio / About
            </label>
            <textarea
              id="profile-bio"
              className="form-textarea"
              rows={3}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Brief bio or role (e.g. Lead Engineer, Security Specialist)..."
              maxLength={500}
            />
            <div className="char-counter">{bio.length} / 500</div>
          </div>

          <div className="settings-card-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={savingProfile}
            >
              {savingProfile ? (
                <>
                  <Loader2 size={14} className="spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Save Profile</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Section 2: Membership & Resource Quotas ────────────────────────── */}
      <div className="settings-card" id="membership" style={{ marginTop: 28 }}>
        <div className="settings-card-header">
          <div className="settings-card-icon-wrap" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
            <CreditCard size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 className="settings-card-title">Membership & Usage Allowances</h2>
                <p className="settings-card-subtitle">
                  Current subscription tier, monthly computing limits, and billing status.
                </p>
              </div>
              <Link to="/pricing" className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
                <span>Compare Plans</span>
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </div>

        <div className="settings-card-body">
          {subError && (
            <div className="auth-alert auth-alert-error" style={{ marginBottom: 16 }}>
              <AlertTriangle size={15} />
              <span>{subError}</span>
            </div>
          )}
          {subSuccess && (
            <div className="auth-alert auth-alert-success" style={{ marginBottom: 16 }}>
              <Check size={15} />
              <span>{subSuccess}</span>
            </div>
          )}

          {/* Current Tier Overview Box */}
          {(() => {
            const currentPlan = subscription?.plan || user.membershipPlan || 'FREE'
            const isEnterprise = currentPlan === 'ENTERPRISE'
            const isPro = currentPlan === 'PRO'
            const isUnlimitedReviews = isEnterprise || (subscription?.reviews?.limit ?? 0) === -1 || (subscription?.reviews?.limit ?? 0) >= 99999
            const isUnlimitedChat = isEnterprise || (subscription?.chat?.limit ?? 0) === -1 || (subscription?.chat?.limit ?? 0) >= 99999

            return (
              <>
                <div className={`membership-overview-banner ${isEnterprise ? 'banner-tier-enterprise' : isPro ? 'banner-tier-pro' : ''}`}>
                  <div className="membership-tier-badge-box">
                    <div className={`membership-plan-icon-circle ${isEnterprise ? 'icon-circle-enterprise' : isPro ? 'icon-circle-pro' : 'icon-circle-free'}`}>
                      {isEnterprise ? <Crown size={26} /> : isPro ? <Zap size={26} /> : <Layers size={26} />}
                    </div>
                    <div>
                      <span className="membership-tier-label">Current Membership</span>
                      <div className="membership-tier-name-row">
                        <h3 className="membership-tier-title">{currentPlan} Tier</h3>
                        <span className={`badge-sub-status status-${(subscription?.status || 'ACTIVE').toLowerCase()}`}>
                          {subscription?.status === 'CANCELLED' ? 'Cancelled (Active until expiry)' : subscription?.status || 'Active'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="membership-meta-items">
                    {subscription?.expiresAt && (
                      <div className="membership-meta-pill">
                        <Calendar size={15} style={{ color: '#6366f1' }} />
                        <span>
                          {subscription.status === 'CANCELLED' ? 'Expires: ' : 'Renews: '}
                          <strong>{new Date(subscription.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</strong>
                        </span>
                      </div>
                    )}
                    {subscription?.billingInterval && currentPlan !== 'FREE' && (
                      <div className="membership-meta-pill">
                        <CreditCard size={15} style={{ color: '#10b981' }} />
                        <span>
                          Billing: <strong>{subscription.billingInterval === 'yearly' ? `Annual (₹${subscription.amount / 100})` : `Monthly (₹${subscription.amount / 100})`}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Quota Usage Meters */}
                <div className="quota-meter-grid" style={{ marginTop: 20 }}>
                  {/* Meter 1: Repository Reviews */}
                  <div className="quota-meter-card">
                    <div className="quota-meter-header">
                      <div className="quota-meter-title-wrap">
                        <Layers size={18} className="text-primary" />
                        <span className="quota-meter-title">Repository Reviews</span>
                      </div>
                      <span className="quota-meter-count">
                        {isUnlimitedReviews ? (
                          <><strong>{subscription?.reviews?.used ?? 0}</strong> analyzed</>
                        ) : (
                          <><strong>{subscription?.reviews?.used ?? 0}</strong> / {subscription?.reviews?.limit ?? 3} used</>
                        )}
                      </span>
                    </div>

                    {isUnlimitedReviews ? (
                      <div className="quota-unlimited-pill">
                        <Sparkles size={16} />
                        <span>Unlimited Quota • Dedicated LLM Workers</span>
                      </div>
                    ) : (
                      <div className="quota-progress-track">
                        <div
                          className="quota-progress-fill"
                          style={{
                            width: `${Math.min(100, subscription?.reviews?.percentage ?? 0)}%`,
                            background:
                              (subscription?.reviews?.percentage ?? 0) >= 90
                                ? 'linear-gradient(90deg, #ef4444, #f87171)'
                                : (subscription?.reviews?.percentage ?? 0) >= 70
                                ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                : 'linear-gradient(90deg, #6366f1, #818cf8)',
                          }}
                        />
                      </div>
                    )}

                    <div className="quota-meter-footer">
                      <span>
                        {isUnlimitedReviews
                          ? 'Zero monthly caps on your enterprise subscription'
                          : `${subscription?.reviews?.remaining ?? 3} reviews remaining this month`}
                      </span>
                      {!isUnlimitedReviews && (
                        <span>{Math.round(subscription?.reviews?.percentage ?? 0)}% used</span>
                      )}
                    </div>
                  </div>

                  {/* Meter 2: AI Codebase Chat */}
                  <div className="quota-meter-card">
                    <div className="quota-meter-header">
                      <div className="quota-meter-title-wrap">
                        <MessageSquare size={18} className="text-primary" />
                        <span className="quota-meter-title">AI Codebase Chat Queries</span>
                      </div>
                      <span className="quota-meter-count">
                        {isUnlimitedChat ? (
                          <><strong>{subscription?.chat?.used ?? 0}</strong> queries</>
                        ) : (
                          <><strong>{subscription?.chat?.used ?? 0}</strong> / {subscription?.chat?.limit ?? 20} used</>
                        )}
                      </span>
                    </div>

                    {isUnlimitedChat ? (
                      <div className="quota-unlimited-pill chat-pill">
                        <Sparkles size={16} />
                        <span>Unlimited Queries • Zero Rate Caps</span>
                      </div>
                    ) : (
                      <div className="quota-progress-track">
                        <div
                          className="quota-progress-fill"
                          style={{
                            width: `${Math.min(100, subscription?.chat?.percentage ?? 0)}%`,
                            background:
                              (subscription?.chat?.percentage ?? 0) >= 90
                                ? 'linear-gradient(90deg, #ef4444, #f87171)'
                                : (subscription?.chat?.percentage ?? 0) >= 70
                                ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                : 'linear-gradient(90deg, #10b981, #34d399)',
                          }}
                        />
                      </div>
                    )}

                    <div className="quota-meter-footer">
                      <span>
                        {isUnlimitedChat
                          ? 'Continuous interactive codebase assistance without limits'
                          : `${subscription?.chat?.remaining ?? 20} queries remaining this month`}
                      </span>
                      {!isUnlimitedChat && (
                        <span>{Math.round(subscription?.chat?.percentage ?? 0)}% used</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )
          })()}

          {/* Action Row */}
          <div className="membership-actions-row" style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link to="/pricing" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              <Sparkles size={14} />
              <span>{subscription?.plan === 'ENTERPRISE' ? 'Manage Plan' : 'Upgrade Plan'}</span>
            </Link>

            {subscription?.plan !== 'FREE' && subscription?.status === 'ACTIVE' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowCancelModal(true)}
              >
                Cancel Subscription
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Notification Preferences ───────────────────────────── */}
      <div className="settings-card" style={{ marginTop: 28 }}>
        <div className="settings-card-header">
          <div className="settings-card-icon-wrap">
            <Bell size={18} />
          </div>
          <div>
            <h2 className="settings-card-title">Notification Preferences</h2>
            <p className="settings-card-subtitle">
              Choose which events and automated alerts you would like to receive.
            </p>
          </div>
        </div>

        <div className="settings-card-body">
          {prefsError && (
            <div className="auth-alert auth-alert-error" style={{ marginBottom: 16 }}>
              <AlertTriangle size={15} />
              <span>{prefsError}</span>
            </div>
          )}
          {prefsSuccess && (
            <div className="auth-alert auth-alert-success" style={{ marginBottom: 16 }}>
              <Check size={15} />
              <span>{prefsSuccess}</span>
            </div>
          )}

          <div className="pref-toggle-list">
            <div className="pref-toggle-item">
              <div className="pref-toggle-info">
                <span className="pref-toggle-title">Analysis Completed</span>
                <span className="pref-toggle-desc">
                  Notify when automated repository code analysis and documentation completes.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.analysisCompleted}
                className={`switch-toggle ${prefs.analysisCompleted ? 'active' : ''}`}
                onClick={() => handleTogglePref('analysisCompleted')}
                disabled={savingPrefs}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="pref-toggle-item">
              <div className="pref-toggle-info">
                <span className="pref-toggle-title">Critical Issues</span>
                <span className="pref-toggle-desc">
                  Immediate alerts when high severity bugs or pipeline failures occur.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.criticalIssues}
                className={`switch-toggle ${prefs.criticalIssues ? 'active' : ''}`}
                onClick={() => handleTogglePref('criticalIssues')}
                disabled={savingPrefs}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="pref-toggle-item">
              <div className="pref-toggle-info">
                <span className="pref-toggle-title">Security Alerts</span>
                <span className="pref-toggle-desc">
                  Signals detected regarding vulnerabilities, leaked secrets, or CWE issues.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.securityAlerts}
                className={`switch-toggle ${prefs.securityAlerts ? 'active' : ''}`}
                onClick={() => handleTogglePref('securityAlerts')}
                disabled={savingPrefs}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="pref-toggle-item">
              <div className="pref-toggle-info">
                <span className="pref-toggle-title">Email Notifications</span>
                <span className="pref-toggle-desc">
                  Send critical notifications and verification notices to your registered email.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.emailNotifications}
                className={`switch-toggle ${prefs.emailNotifications ? 'active' : ''}`}
                onClick={() => handleTogglePref('emailNotifications')}
                disabled={savingPrefs}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Danger Zone / Delete Account ───────────────────────── */}
      <div className="settings-card danger-zone-card" style={{ marginTop: 28 }}>
        <div className="settings-card-header">
          <div className="settings-card-icon-wrap danger-icon-wrap">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className="settings-card-title text-danger">Danger Zone</h2>
            <p className="settings-card-subtitle">
              Irreversible and destructive actions concerning your account and stored data.
            </p>
          </div>
        </div>

        <div className="settings-card-body">
          <div className="danger-zone-content">
            <div>
              <h4 className="danger-zone-item-title">Delete Account</h4>
              <p className="danger-zone-item-desc">
                Permanently delete your CodeSense user account, review history, saved reports, notifications, and associated data. Once deleted, this data cannot be recovered.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                setDeleteConfirmationText('')
                setDeleteError('')
                setShowDeleteModal(true)
              }}
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete Account Confirmation Modal ─────────────────────────────── */}
      {showDeleteModal && (
        <div className="modal-backdrop animate-fadeIn" role="dialog" aria-modal="true">
          <div className="modal-content animate-scaleUp">
            <div className="modal-header">
              <div className="modal-title-row text-danger">
                <AlertTriangle size={20} />
                <h3 className="modal-title">Delete Account Confirmation</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingAccount}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-warning-text">
                This action is <strong>permanent and irreversible</strong>. All of your user profile information, past repository reviews, markdown documentation, notifications, and AI session history will be completely removed.
              </p>

              {deleteError && (
                <div className="auth-alert auth-alert-error" style={{ marginBottom: 14 }}>
                  <AlertTriangle size={15} />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="modal-confirm-input-wrap">
                <label className="form-label" htmlFor="delete-confirm-input">
                  To confirm, type <strong style={{ color: 'var(--destructive)' }}>DELETE</strong> below:
                </label>
                <input
                  id="delete-confirm-input"
                  type="text"
                  className="form-input modal-input"
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirmationText}
                  onChange={e => setDeleteConfirmationText(e.target.value)}
                  autoComplete="off"
                  disabled={deletingAccount}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingAccount}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={deletingAccount || deleteConfirmationText !== 'DELETE'}
                onClick={handleDeleteAccount}
              >
                {deletingAccount ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <span>Permanently Delete Account</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Subscription Confirmation Modal */}
      {showCancelModal && (
        <div className="modal-backdrop animate-fadeIn" onClick={() => setShowCancelModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-wrap modal-icon-warn">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="modal-title">Cancel Subscription</h3>
                <span className="modal-subtitle">Confirm plan cancellation</span>
              </div>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                Are you sure you want to cancel your{' '}
                <strong>{subscription?.plan || 'Pro'}</strong> membership?
              </p>
              <div className="modal-callout">
                <strong>Access Grace Period:</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                  You will keep your full paid benefits and quotas until the end of your billing period (
                  {subscription?.expiresAt
                    ? new Date(subscription.expiresAt).toLocaleDateString()
                    : 'end of billing period'}
                  ). Your saved reviews and documentation will never be deleted.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowCancelModal(false)}
                disabled={cancellingSub}
              >
                Keep Subscription
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={cancellingSub}
                onClick={async () => {
                  try {
                    setCancellingSub(true)
                    const res = await fetch('/api/membership/cancel', {
                      method: 'POST',
                      credentials: 'include',
                    })
                    const d = await res.json()
                    if (d.ok) {
                      setSubSuccess(d.message || 'Subscription cancelled successfully.')
                      setShowCancelModal(false)
                      loadMembership()
                    } else {
                      setSubError(d.error || 'Failed to cancel subscription')
                    }
                  } catch {
                    setSubError('Network error cancelling subscription')
                  } finally {
                    setCancellingSub(false)
                  }
                }}
              >
                {cancellingSub ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    <span>Cancelling…</span>
                  </>
                ) : (
                  <span>Confirm Cancellation</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
