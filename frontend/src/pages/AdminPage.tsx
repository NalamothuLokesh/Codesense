import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  Shield,
  Users,
  FileText,
  CheckCircle2,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  GitBranch,
  Check,
  AlertTriangle,
  Loader2,
  UserCheck,
  UserX,
  Crown,
  Search,
  ScrollText,
  Clock,
  Lock,
  RefreshCw,
  AlertCircle,
  X,
  FolderGit2,
} from 'lucide-react'

interface UserRow {
  id: string
  email: string
  name: string
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'
  membershipPlan?: 'FREE' | 'PRO' | 'ENTERPRISE'
  status?: 'ACTIVE' | 'SUSPENDED'
  created_at: string
}

interface ReviewRow {
  id: string
  repo: string
  branch: string
  status: string
  elapsed_sec: number | null
  error: string | null
  created_at: string
  finished_at: string | null
  email: string
  name: string
}

interface AuditRow {
  id: string
  action: string
  actor_email: string | null
  actor_role: string | null
  target_email: string | null
  details: Record<string, unknown>
  outcome: 'SUCCESS' | 'FAILURE'
  ip: string | null
  created_at: string
}

interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<void>
}

function fmtDate(d: string) {
  try {
    return new Date(d.endsWith('Z') ? d : d + 'Z').toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return d
  }
}

function fmtTime(s: number | null) {
  if (!s) return '—'
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function parseRepoName(repo: string) {
  if (!repo) return { title: 'Unknown Repository', sub: '' }
  const gh = repo.match(/github\.com\/([^\/]+)\/([^\/\s#?]+)/i)
  if (gh) {
    const owner = gh[1]
    const name = gh[2].replace(/\.git$/i, '')
    return { title: `${owner} / ${name}`, sub: repo }
  }
  const clean = repo.replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || repo
  return { title: name, sub: repo }
}

export default function AdminPage() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState<'users' | 'reviews' | 'audit'>('users')
  const [users, setUsers] = useState<UserRow[]>([])
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'USER' | 'ADMIN' | 'SUPER_ADMIN'>('ALL')
  const [confirmModal, setConfirmModal] = useState<ConfirmState | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [membershipStats, setMembershipStats] = useState<{
    freeCount: number
    proCount: number
    enterpriseCount: number
    totalSubscriptions: number
  } | null>(null)
  const [membershipModal, setMembershipModal] = useState<{
    open: boolean
    user: UserRow | null
    plan: 'FREE' | 'PRO' | 'ENTERPRISE'
    durationMonths: number
    saving: boolean
    error: string
  }>({
    open: false,
    user: null,
    plan: 'FREE',
    durationMonths: 1,
    saving: false,
    error: '',
  })

  const fetchData = async () => {
    if (!token) return
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [uRes, rRes, aRes, mRes] = await Promise.all([
        fetch('/api/admin/users', { headers }).then(r => r.json()),
        fetch('/api/admin/reviews', { headers }).then(r => r.json()),
        fetch('/api/admin/audit-logs', { headers }).then(r => r.json()),
        fetch('/api/admin/membership-stats', { headers }).then(r => r.json()).catch(() => null),
      ])

      if (uRes.ok) setUsers(uRes.users)
      if (rRes.ok) setReviews(rRes.reviews)
      if (aRes.ok) setAuditLogs(aRes.logs)
      if (mRes?.ok && mRes.stats) setMembershipStats(mRes.stats)
    } catch {
      setErrMsg('Failed to load administrative data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) {
      nav('/login')
      return
    }
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      nav('/')
      return
    }
    fetchData()
  }, [user, token, nav])

  const notifySuccess = (text: string) => {
    setMsg(text)
    setErrMsg('')
    setTimeout(() => setMsg(''), 3000)
  }

  const notifyError = (text: string) => {
    setErrMsg(text)
    setMsg('')
    setTimeout(() => setErrMsg(''), 4000)
  }

  // Role promotion / demotion (SUPER_ADMIN only)
  const handleChangeRole = (targetUser: UserRow, newRole: 'USER' | 'ADMIN') => {
    const isPromotion = newRole === 'ADMIN'
    setConfirmModal({
      title: isPromotion ? 'Promote to Administrator' : 'Demote to Regular User',
      description: isPromotion
        ? `Are you sure you want to grant Administrator privileges to ${targetUser.email}? Platform administrators can view operational metrics, inspect registered accounts, and manage users.`
        : `Are you sure you want to demote ${targetUser.email} to Developer (User)? Their administrative access will be revoked immediately.`,
      confirmLabel: isPromotion ? 'Confirm Promotion' : 'Confirm Demotion',
      danger: !isPromotion,
      action: async () => {
        try {
          const res = await fetch(`/api/admin/users/${targetUser.id}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ role: newRole }),
          })
          const data = await res.json()
          if (data.ok) {
            setUsers(prev => prev.map(u => (u.id === targetUser.id ? { ...u, role: newRole } : u)))
            notifySuccess(`Role updated to ${newRole} for ${targetUser.email}`)
            fetchData()
          } else {
            notifyError(data.error || 'Failed to update user role')
          }
        } catch {
          notifyError('Network failure updating user role')
        }
      },
    })
  }

  // Account status change (Suspend / Reactivate)
  const handleToggleStatus = (targetUser: UserRow) => {
    const isSuspending = targetUser.status !== 'SUSPENDED'
    const newStatus = isSuspending ? 'SUSPENDED' : 'ACTIVE'

    setConfirmModal({
      title: isSuspending ? 'Suspend User Account' : 'Reactivate User Account',
      description: isSuspending
        ? `Suspending ${targetUser.email} will immediately invalidate their sessions and block all login and API access.`
        : `Reactivating ${targetUser.email} will allow the user to log in and access their authorized CodeSense workspaces.`,
      confirmLabel: isSuspending ? 'Suspend Account' : 'Reactivate Account',
      danger: isSuspending,
      action: async () => {
        try {
          const res = await fetch(`/api/admin/users/${targetUser.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: newStatus }),
          })
          const data = await res.json()
          if (data.ok) {
            setUsers(prev => prev.map(u => (u.id === targetUser.id ? { ...u, status: newStatus } : u)))
            notifySuccess(`Account ${isSuspending ? 'suspended' : 'reactivated'}: ${targetUser.email}`)
            fetchData()
          } else {
            notifyError(data.error || 'Failed to update account status')
          }
        } catch {
          notifyError('Network error updating account status')
        }
      },
    })
  }

  // Remove user
  const handleRemoveUser = (targetUser: UserRow) => {
    setConfirmModal({
      title: 'Delete User Account',
      description: `Permanently delete account ${targetUser.email} and all associated reviews and notifications? This action cannot be undone.`,
      confirmLabel: 'Permanently Delete',
      danger: true,
      action: async () => {
        try {
          const res = await fetch(`/api/admin/users/${targetUser.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
          const data = await res.json()
          if (data.ok) {
            setUsers(prev => prev.filter(u => u.id !== targetUser.id))
            setReviews(prev => prev.filter(r => r.email !== targetUser.email))
            notifySuccess(`Deleted account ${targetUser.email}`)
            fetchData()
          } else {
            notifyError(data.error || 'Failed to delete user')
          }
        } catch {
          notifyError('Network error deleting user')
        }
      },
    })
  }

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return users.filter(u => {
      const matchRole = roleFilter === 'ALL' || u.role === roleFilter
      const matchQuery =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.status || 'ACTIVE').toLowerCase().includes(q)
      return matchRole && matchQuery
    })
  }, [users, searchQuery, roleFilter])

  if (loading) {
    return (
      <main className="main" style={{ paddingTop: 80, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Loader2 size={32} className="spin text-primary" />
          <span style={{ fontSize: '0.9rem', color: 'var(--muted-foreground)', fontWeight: 500 }}>
            Verifying administrative access & loading metrics…
          </span>
        </div>
      </main>
    )
  }

  const superAdminCount = users.filter(u => u.role === 'SUPER_ADMIN').length
  const adminCount = users.filter(u => u.role === 'ADMIN').length
  const userCount = users.filter(u => u.role === 'USER').length
  const completedReviews = reviews.filter(r => r.status === 'done').length

  return (
    <main className="main" style={{ paddingTop: 40, maxWidth: 1240, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 28,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: isSuperAdmin ? 'rgba(168, 85, 247, 0.15)' : 'var(--destructive-subtle)',
                color: isSuperAdmin ? '#c084fc' : 'var(--destructive)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isSuperAdmin ? <Crown size={19} /> : <Shield size={19} />}
            </div>
            <div>
              <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em', margin: 0 }}>
                {isSuperAdmin ? 'Super Administrator Console' : 'Platform Administration'}
              </h1>
            </div>
          </div>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.88rem', margin: 0 }}>
            Role-Based Access Control · {users.length} accounts · {superAdminCount} Super Admin · {adminCount} Admin · {userCount} Developers
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {msg && (
            <div className="status-bar done animate-fadeIn" style={{ margin: 0, padding: '8px 16px' }}>
              <Check size={16} /> <span>{msg}</span>
            </div>
          )}
          {errMsg && (
            <div className="status-bar error animate-fadeIn" style={{ margin: 0, padding: '8px 16px' }}>
              <AlertTriangle size={16} /> <span>{errMsg}</span>
            </div>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={fetchData}
            title="Refresh administrative data"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Metrics Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 28 }}>
        <div className="card" style={{ padding: '20px 24px', borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Accounts
            </span>
            <Users size={18} className="text-primary" />
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--foreground)' }}>
            {users.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: 4 }}>
            {userCount} developers registered
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Super Admins
            </span>
            <Crown size={18} style={{ color: '#c084fc' }} />
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#c084fc' }}>
            {superAdminCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: 4 }}>
            Highest privilege tier (protected)
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Platform Admins
            </span>
            <Shield size={18} style={{ color: 'var(--destructive)' }} />
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--destructive)' }}>
            {adminCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: 4 }}>
            Trusted operational managers
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Paid Memberships
            </span>
            <Crown size={18} style={{ color: '#eab308' }} />
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--foreground)' }}>
            {(membershipStats?.proCount ?? 0) + (membershipStats?.enterpriseCount ?? 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: 4 }}>
            {membershipStats?.proCount ?? 0} Pro · {membershipStats?.enterpriseCount ?? 0} Enterprise · {membershipStats?.freeCount ?? users.length} Free
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Reviews Executed
            </span>
            <FileText size={18} style={{ color: '#3b82f6' }} />
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--foreground)' }}>
            {reviews.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginTop: 4 }}>
            {completedReviews} successfully finished
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        <button
          className={`tab ${tab === 'users' ? 'tab-on' : ''}`}
          onClick={() => setTab('users')}
        >
          <Users size={15} /> Accounts & RBAC ({users.length})
        </button>
        <button
          className={`tab ${tab === 'reviews' ? 'tab-on' : ''}`}
          onClick={() => setTab('reviews')}
        >
          <FileText size={15} /> Operational Reviews ({reviews.length})
        </button>
        <button
          className={`tab ${tab === 'audit' ? 'tab-on' : ''}`}
          onClick={() => setTab('audit')}
        >
          <ScrollText size={15} /> Security & Audit Log ({auditLogs.length})
        </button>
      </div>

      {/* ── Tab: Accounts & RBAC ────────────────────────────────────────────── */}
      {tab === 'users' && (
        <div className="animate-fadeIn">
          {/* Controls: Search and Role Filter */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ position: 'relative', minWidth: 280, flex: 1, maxWidth: 440 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted-foreground)',
                }}
              />
              <input
                type="text"
                placeholder="Search accounts by email, name, role, status..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                  fontSize: '0.86rem',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', marginRight: 4 }}>Role filter:</span>
              {(['ALL', 'SUPER_ADMIN', 'ADMIN', 'USER'] as const).map(rf => (
                <button
                  key={rf}
                  onClick={() => setRoleFilter(rf)}
                  className={`btn btn-sm ${roleFilter === rf ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: '0.76rem', padding: '4px 10px' }}
                >
                  {rf === 'ALL' ? 'All Roles' : rf === 'SUPER_ADMIN' ? 'Super Admin' : rf === 'ADMIN' ? 'Admin' : 'User'}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>User Profile</th>
                  <th>Assigned Role</th>
                  <th>Membership Tier</th>
                  <th>Account Status</th>
                  <th>Joined Date</th>
                  <th style={{ textAlign: 'right' }}>Administrative Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--muted-foreground)' }}>
                      No accounts found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u, i) => {
                    const isSelf = u.id === user?.id
                    const targetIsSuperAdmin = u.role === 'SUPER_ADMIN'
                    const targetIsAdmin = u.role === 'ADMIN'
                    const isSuspended = u.status === 'SUSPENDED'

                    return (
                      <tr key={u.id}>
                        <td className="table-col-idx">{i + 1}</td>
                        <td>
                          <div className="table-user-cell">
                            <div
                              className={`table-avatar-circle ${
                                u.role === 'SUPER_ADMIN'
                                  ? 'table-avatar-superadmin'
                                  : u.role === 'ADMIN'
                                  ? 'table-avatar-admin'
                                  : 'table-avatar-user'
                              }`}
                            >
                              {u.name ? u.name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <div className="table-user-info">
                              <div className="table-user-name">{u.name || 'Anonymous User'}</div>
                              <div className="table-user-email">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {u.role === 'SUPER_ADMIN' ? (
                            <span className="badge-role-superadmin">
                              <Crown size={11} /> Super Admin
                            </span>
                          ) : u.role === 'ADMIN' ? (
                            <span className="badge-role-admin">
                              <Shield size={11} /> Admin
                            </span>
                          ) : (
                            <span className="badge-role-user">
                              <UserCheck size={11} /> User
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge-membership-tier tier-${(u.membershipPlan || 'FREE').toLowerCase()}`}>
                            {u.membershipPlan || 'FREE'}
                          </span>
                        </td>
                        <td>
                          {isSuspended ? (
                            <span className="table-status-pill status-suspended">
                              <UserX size={11} /> Suspended
                            </span>
                          ) : (
                            <span className="table-status-pill status-active">
                              <CheckCircle2 size={11} /> Active
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--muted-foreground)', fontSize: '0.8rem' }}>
                          {fmtDate(u.created_at)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="table-actions-wrap">
                            {isSelf ? (
                              <span className="table-current-badge">
                                Current Session
                              </span>
                            ) : (
                              <>
                                {/* Role Assignment Button: Restricted to SUPER_ADMIN */}
                                {isSuperAdmin ? (
                                  targetIsSuperAdmin ? (
                                    <span
                                      title="Super Admin privileges are established via secure server-side bootstrap"
                                      style={{
                                        fontSize: '0.74rem',
                                        color: '#c084fc',
                                        fontWeight: 600,
                                        padding: '4px 10px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                      }}
                                    >
                                      <Lock size={12} /> Protected
                                    </span>
                                  ) : (
                                    <button
                                      className={`table-btn ${targetIsAdmin ? 'table-btn-warning' : 'table-btn-outline'}`}
                                      onClick={() => handleChangeRole(u, targetIsAdmin ? 'USER' : 'ADMIN')}
                                      title={targetIsAdmin ? 'Demote Administrator to regular User' : 'Promote User to Administrator'}
                                    >
                                      {targetIsAdmin ? (
                                        <>
                                          <ArrowDownRight size={13} /> Demote to User
                                        </>
                                      ) : (
                                        <>
                                          <ArrowUpRight size={13} className="text-emerald-500" /> Promote to Admin
                                        </>
                                      )}
                                    </button>
                                  )
                                ) : (
                                  <button
                                    className="table-btn table-btn-outline"
                                    disabled
                                    title="Role promotion and assignment is strictly restricted to Super Administrators"
                                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                                  >
                                    <Lock size={12} /> Role Locked
                                  </button>
                                )}

                                {/* Membership Tier Assignment Button */}
                                <button
                                  className="table-btn table-btn-outline"
                                  onClick={() => setMembershipModal({
                                    open: true,
                                    user: u,
                                    plan: u.membershipPlan || 'FREE',
                                    durationMonths: 1,
                                    saving: false,
                                    error: '',
                                  })}
                                  title="Assign or correct user membership plan"
                                >
                                  Plan: <strong>{u.membershipPlan || 'FREE'}</strong>
                                </button>

                                {/* Account Status Toggle (Suspend / Reactivate) */}
                                {(isSuperAdmin || (!targetIsAdmin && !targetIsSuperAdmin)) ? (
                                  targetIsSuperAdmin ? null : (
                                    <button
                                      className={`table-btn ${isSuspended ? 'table-btn-outline' : 'table-btn-danger'}`}
                                      onClick={() => handleToggleStatus(u)}
                                      title={isSuspended ? 'Reactivate account' : 'Suspend account'}
                                    >
                                      {isSuspended ? (
                                        <>
                                          <UserCheck size={12} className="text-emerald-500" /> Reactivate
                                        </>
                                      ) : (
                                        <>
                                          <UserX size={12} /> Suspend
                                        </>
                                      )}
                                    </button>
                                  )
                                ) : null}

                                {/* Delete User Button */}
                                {(isSuperAdmin || (!targetIsAdmin && !targetIsSuperAdmin)) && !targetIsSuperAdmin ? (
                                  <button
                                    className="table-btn table-btn-danger table-btn-icon-only"
                                    onClick={() => handleRemoveUser(u)}
                                    title="Delete account permanently"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Operational Reviews ────────────────────────────────────────── */}
      {tab === 'reviews' && (
        <div className="table-wrap animate-fadeIn">
          <table>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Author</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--muted-foreground)' }}>
                    No reviews executed yet.
                  </td>
                </tr>
              ) : (
                reviews.map((r, i) => {
                  const repo = parseRepoName(r.repo)
                  return (
                    <tr key={r.id}>
                      <td className="table-col-idx">{i + 1}</td>
                      <td>
                        <div className="table-user-cell">
                          <div className="table-avatar-circle table-avatar-user">
                            {r.name ? r.name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div className="table-user-info">
                            <div className="table-user-name">{r.name || 'Anonymous User'}</div>
                            <div className="table-user-email">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="table-repo-cell">
                          <div className="table-repo-icon-wrap">
                            <FolderGit2 size={16} />
                          </div>
                          <div className="table-repo-meta">
                            <div className="table-repo-title" title={r.repo}>
                              {repo.title}
                            </div>
                            <div className="table-repo-url" title={r.repo}>
                              {repo.sub}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="table-branch-badge">
                          <GitBranch size={12} />
                          <span>{r.branch || 'main'}</span>
                        </span>
                      </td>
                      <td>
                        {r.status === 'done' && (
                          <span className="table-status-pill status-done">
                            <Check size={11} strokeWidth={3} /> Done
                          </span>
                        )}
                        {r.status === 'running' && (
                          <span className="table-status-pill status-running">
                            <Loader2 size={11} className="spin" /> Running
                          </span>
                        )}
                        {r.status === 'error' && (
                          <span className="table-status-pill status-error">
                            <AlertTriangle size={11} /> Error
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                        ⏱ {fmtTime(r.elapsed_sec)}
                      </td>
                      <td style={{ color: 'var(--muted-foreground)', fontSize: '0.8rem' }}>
                        {fmtDate(r.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab: Security & Audit Log ───────────────────────────────────────── */}
      {tab === 'audit' && (
        <div className="table-wrap animate-fadeIn">
          <table>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Timestamp</th>
                <th>Security Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Outcome</th>
                <th>Details</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--muted-foreground)' }}>
                    No audit records logged yet. Privileged events will appear here.
                  </td>
                </tr>
              ) : (
                auditLogs.map(l => (
                  <tr key={l.id}>
                    <td style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={12} />
                        {fmtDate(l.created_at)}
                      </span>
                    </td>
                    <td>
                      <code
                        className="inline-code"
                        style={{
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          color: l.action.includes('UNAUTHORIZED') ? '#ef4444' : l.action.includes('BOOTSTRAP') ? '#c084fc' : 'var(--foreground)',
                        }}
                      >
                        {l.action}
                      </code>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{l.actor_email || 'System'}</div>
                      {l.actor_role && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>[{l.actor_role}]</div>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: l.target_email ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
                        {l.target_email || '—'}
                      </span>
                    </td>
                    <td>
                      {l.outcome === 'SUCCESS' ? (
                        <span className="badge-outcome-success">SUCCESS</span>
                      ) : (
                        <span className="badge-outcome-failure">DENIED</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.76rem', color: 'var(--muted-foreground)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {Object.keys(l.details || {}).length > 0 ? JSON.stringify(l.details) : '—'}
                    </td>
                    <td style={{ fontSize: '0.76rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                      {l.ip || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Confirmation Modal ──────────────────────────────────────────────── */}
      {confirmModal && (
        <div
          className="modal-backdrop animate-fadeIn"
          role="dialog"
          aria-modal="true"
          onClick={() => !actionLoading && setConfirmModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="modal-dialog"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: confirmModal.danger ? 'var(--destructive-subtle)' : 'var(--primary-subtle)',
                    color: confirmModal.danger ? 'var(--destructive)' : 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AlertCircle size={18} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  {confirmModal.title}
                </h3>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => !actionLoading && setConfirmModal(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 24 }}>
              {confirmModal.description}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={actionLoading}
                onClick={() => setConfirmModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-sm ${confirmModal.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={actionLoading}
                onClick={async () => {
                  setActionLoading(true)
                  try {
                    await confirmModal.action()
                  } finally {
                    setActionLoading(false)
                    setConfirmModal(null)
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {actionLoading && <Loader2 size={13} className="spin" />}
                <span>{confirmModal.confirmLabel || 'Confirm'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Membership Modal */}
      {membershipModal.open && membershipModal.user && (
        <div className="modal-backdrop animate-fadeIn" onClick={() => setMembershipModal(prev => ({ ...prev, open: false }))}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-icon-wrap" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                <Crown size={20} />
              </div>
              <div>
                <h3 className="modal-title">Manage Membership Tier</h3>
                <span className="modal-subtitle">{membershipModal.user.email}</span>
              </div>
            </div>

            <div className="modal-body">
              {membershipModal.error && (
                <div className="auth-alert auth-alert-error" style={{ marginBottom: 14 }}>
                  <AlertCircle size={15} />
                  <span>{membershipModal.error}</span>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label className="input-label" style={{ marginBottom: 6, display: 'block' }}>Membership Tier</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {(['FREE', 'PRO', 'ENTERPRISE'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`btn btn-sm ${membershipModal.plan === p ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setMembershipModal(prev => ({ ...prev, plan: p }))}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {membershipModal.plan !== 'FREE' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="input-label" style={{ marginBottom: 6, display: 'block' }}>Granted Duration</label>
                  <select
                    className="inp"
                    value={membershipModal.durationMonths}
                    onChange={e => setMembershipModal(prev => ({ ...prev, durationMonths: Number(e.target.value) }))}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}
                  >
                    <option value={1}>1 Month</option>
                    <option value={3}>3 Months</option>
                    <option value={6}>6 Months</option>
                    <option value={12}>12 Months (1 Year)</option>
                  </select>
                </div>
              )}

              <p style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                Note: Changing membership grants compute allowances and feature access. It will NOT alter user account role or platform permissions.
              </p>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={membershipModal.saving}
                onClick={() => setMembershipModal(prev => ({ ...prev, open: false }))}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={membershipModal.saving}
                onClick={async () => {
                  try {
                    setMembershipModal(prev => ({ ...prev, saving: true, error: '' }))
                    const res = await fetch(`/api/admin/users/${membershipModal.user!.id}/membership`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        plan: membershipModal.plan,
                        durationMonths: membershipModal.durationMonths,
                      }),
                    })
                    const data = await res.json()
                    if (data.ok) {
                      notifySuccess(`Updated ${membershipModal.user!.email} to ${membershipModal.plan}`)
                      setMembershipModal(prev => ({ ...prev, open: false }))
                      fetchData()
                    } else {
                      setMembershipModal(prev => ({ ...prev, error: data.error || 'Failed to update membership' }))
                    }
                  } catch {
                    setMembershipModal(prev => ({ ...prev, error: 'Network error updating membership' }))
                  } finally {
                    setMembershipModal(prev => ({ ...prev, saving: false }))
                  }
                }}
              >
                {membershipModal.saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                <span>Save Tier</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
