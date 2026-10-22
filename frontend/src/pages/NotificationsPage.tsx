import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCheck,
  Trash2,
  ExternalLink,
  Loader2,
  RefreshCw,
  FolderGit2,
} from 'lucide-react'
import { useAuth } from '../AuthContext'
import type { NotificationItem } from '../components/NotificationBell'

function formatFullDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function timeAgo(dateStr: string) {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diffSec < 60) return 'Just now'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function NotificationsPage() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const fetchNotifications = useCallback(async () => {
    if (!token && !user) return
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch('/api/notifications', {
        credentials: 'include',
        headers,
      })
      const data = await res.json()
      if (data.ok) {
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (_) {
    } finally {
      setLoading(false)
    }
  }, [token, user])

  useEffect(() => {
    if (!user) {
      nav('/login')
      return
    }
    void fetchNotifications()
  }, [user, nav, fetchNotifications])

  const markAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        credentials: 'include',
        headers,
      })
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }

  const markAllAsRead = async () => {
    setActionLoading(true)
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      await fetch('/api/notifications/read-all', {
        method: 'PUT',
        credentials: 'include',
        headers,
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const deleteNotification = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      await fetch(`/api/notifications/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      })
      const deletedItem = notifications.find(n => n.id === id)
      setNotifications(prev => prev.filter(n => n.id !== id))
      if (deletedItem && !deletedItem.read) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (err) {
      console.error('Failed to delete notification:', err)
    }
  }

  const clearAllNotifications = async () => {
    if (!confirm('Are you sure you want to delete all notifications?')) return
    setActionLoading(true)
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      await fetch('/api/notifications', {
        method: 'DELETE',
        credentials: 'include',
        headers,
      })
      setNotifications([])
      setUnreadCount(0)
    } finally {
      setActionLoading(false)
    }
  }

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter(n => !n.read)
    }
    return notifications
  }, [notifications, filter])

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'analysis_completed':
        return <CheckCircle2 size={18} className="notif-page-icon-success" />
      case 'security_alert':
        return <ShieldAlert size={18} className="notif-page-icon-danger" />
      case 'critical_issues':
        return <AlertTriangle size={18} className="notif-page-icon-warning" />
      default:
        return <Info size={18} className="notif-page-icon-info" />
    }
  }

  if (loading) {
    return (
      <main className="main" style={{ paddingTop: 60, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Loader2 size={32} className="spin text-primary" />
          <span style={{ fontSize: '0.9rem', color: 'var(--muted-foreground)' }}>
            Loading notifications…
          </span>
        </div>
      </main>
    )
  }

  return (
    <main className="main" style={{ paddingTop: 32, maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div className="notif-page-header">
        <div>
          <div className="notif-page-title-row">
            <div className="notif-page-icon-box">
              <Bell size={20} />
            </div>
            <h1 className="notif-page-heading">Notifications</h1>
            {unreadCount > 0 && (
              <span className="notif-page-badge">{unreadCount} unread</span>
            )}
          </div>
          <p className="notif-page-subtitle">
            Stay updated with your latest automated repository analysis, security signals, and review results.
          </p>
        </div>

        <div className="notif-page-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setLoading(true)
              void fetchNotifications()
            }}
            title="Refresh notifications"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={markAllAsRead}
              disabled={actionLoading}
            >
              <CheckCheck size={14} />
              <span>Mark all read</span>
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm notif-clear-btn"
              onClick={clearAllNotifications}
              disabled={actionLoading}
            >
              <Trash2 size={14} />
              <span>Clear all</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="notif-page-filter-row">
        <div className="notif-filter-group">
          <button
            type="button"
            className={`notif-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            className={`notif-filter-btn ${filter === 'unread' ? 'active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread ({unreadCount})
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="notif-page-container">
        {filteredNotifications.length === 0 ? (
          <div className="notif-page-empty">
            <div className="notif-empty-icon-wrap">
              <CheckCircle2 size={36} className="notif-empty-icon" />
            </div>
            <h3 className="notif-empty-h">
              {filter === 'unread' ? 'No unread notifications' : "You're all caught up."}
            </h3>
            <p className="notif-empty-sub">
              {filter === 'unread'
                ? 'All your review and analysis alerts have been reviewed.'
                : 'When new code reviews complete or security events are found, you will see alerts here.'}
            </p>
            {filter === 'unread' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setFilter('all')}
                style={{ marginTop: 12 }}
              >
                View all notifications
              </button>
            )}
          </div>
        ) : (
          <div className="notif-card-list">
            {filteredNotifications.map(notif => (
              <div
                key={notif.id}
                className={`notif-card ${!notif.read ? 'notif-card-unread' : ''}`}
              >
                <div className="notif-card-left">
                  <div className="notif-card-icon-wrap">
                    {getIcon(notif.type)}
                  </div>
                  <div className="notif-card-body">
                    <div className="notif-card-title-row">
                      <span className="notif-card-title">{notif.title}</span>
                      {!notif.read && <span className="notif-pill-new">New</span>}
                      {notif.repo && (
                        <span className="notif-pill-repo">
                          <FolderGit2 size={12} />
                          <span>{notif.repo}</span>
                        </span>
                      )}
                    </div>
                    <p className="notif-card-msg">{notif.message}</p>
                    <div className="notif-card-meta">
                      <span>{formatFullDate(notif.created_at)}</span>
                      <span>•</span>
                      <span>{timeAgo(notif.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="notif-card-actions">
                  {notif.link && (
                    <Link to={notif.link} className="btn btn-outline btn-xs notif-open-btn">
                      <span>View</span>
                      <ExternalLink size={12} />
                    </Link>
                  )}
                  {!notif.read && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={(e) => markAsRead(notif.id, e)}
                      title="Mark as read"
                    >
                      <CheckCheck size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs notif-delete-btn"
                    onClick={(e) => deleteNotification(notif.id, e)}
                    title="Delete notification"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
