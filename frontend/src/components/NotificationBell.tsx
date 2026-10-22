import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCheck,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { useAuth } from '../AuthContext'

export interface NotificationItem {
  id: string
  title: string
  message: string
  type: 'analysis_completed' | 'critical_issues' | 'security_alert' | 'system'
  read: boolean
  link: string | null
  repo: string | null
  reviewId: string | null
  created_at: string
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

export default function NotificationBell() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
    } catch {
      // Ignore network errors on background poll
    }
  }, [token, user])

  // Initial fetch and periodic poll every 30s
  useEffect(() => {
    if (user) {
      void fetchNotifications()
      const interval = setInterval(fetchNotifications, 30000)
      return () => clearInterval(interval)
    }
  }, [user, fetchNotifications])

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

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
    setLoading(true)
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
      setLoading(false)
    }
  }

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.read) {
      await markAsRead(notif.id)
    }
    setOpen(false)
    if (notif.link) {
      nav(notif.link)
    } else if (notif.reviewId) {
      nav(`/?reviewId=${notif.reviewId}`)
    }
  }

  if (!user) return null

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'analysis_completed':
        return <CheckCircle2 size={16} className="notif-icon-success" />
      case 'security_alert':
        return <ShieldAlert size={16} className="notif-icon-danger" />
      case 'critical_issues':
        return <AlertTriangle size={16} className="notif-icon-warning" />
      default:
        return <Info size={16} className="notif-icon-info" />
    }
  }

  const ariaLabel = unreadCount > 0
    ? `Notifications, ${unreadCount} unread`
    : 'Notifications'

  return (
    <div className="notification-bell-container" ref={menuRef}>
      <button
        type="button"
        className={`notification-bell-btn ${open ? 'active' : ''}`}
        onClick={() => {
          setOpen(prev => !prev)
          if (!open) void fetchNotifications()
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={ariaLabel}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown animate-fadeIn" role="region" aria-label="Notifications popover">
          <div className="notif-dropdown-header">
            <div className="notif-header-title">
              <span className="notif-title-text">Notifications</span>
              {unreadCount > 0 && (
                <span className="notif-unread-tag">{unreadCount} new</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="notif-mark-all-btn"
                onClick={markAllAsRead}
                disabled={loading}
              >
                {loading ? <Loader2 size={12} className="spin" /> : <CheckCheck size={12} />}
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="notif-dropdown-body">
            {notifications.length === 0 ? (
              <div className="notif-empty-state">
                <div className="notif-empty-icon-wrap">
                  <CheckCircle2 size={24} className="notif-empty-icon" />
                </div>
                <div className="notif-empty-title">You're all caught up.</div>
                <div className="notif-empty-desc">
                  No new notifications at this time.
                </div>
              </div>
            ) : (
              <ul className="notif-list">
                {notifications.slice(0, 8).map(notif => (
                  <li
                    key={notif.id}
                    className={`notif-item ${!notif.read ? 'notif-item-unread' : ''}`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <div className="notif-item-icon">
                      {getIcon(notif.type)}
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-header">
                        <span className="notif-item-title">{notif.title}</span>
                        <span className="notif-item-time">{timeAgo(notif.created_at)}</span>
                      </div>
                      <p className="notif-item-msg">{notif.message}</p>
                      {notif.repo && (
                        <div className="notif-item-meta">
                          <span className="notif-repo-badge">{notif.repo}</span>
                        </div>
                      )}
                    </div>
                    {!notif.read && (
                      <button
                        type="button"
                        className="notif-read-dot-btn"
                        title="Mark as read"
                        onClick={(e) => markAsRead(notif.id, e)}
                        aria-label="Mark notification as read"
                      >
                        <span className="notif-unread-dot" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="notif-dropdown-footer">
            <Link
              to="/notifications"
              className="notif-view-all-link"
              onClick={() => setOpen(false)}
            >
              <span>View all notifications</span>
              <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
