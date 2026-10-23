import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Code2,
  FolderGit2,
  ClipboardList,
  MessageSquare,
  Shield,
  Settings,
  Bell,
  User,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Layers,
  Crown,
  X,
} from 'lucide-react'
import { useAuth } from '../AuthContext'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { user } = useAuth()
  const location = useLocation()
  const pathname = location.pathname

  // State to track expanded parent sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    analysis: true,
    projects: true,
    ai: true,
    settings: true,
    admin: true,
  })

  // Auto-expand parent section matching current route
  useEffect(() => {
    if (pathname === '/' || pathname === '/dashboard' || pathname === '/pricing') {
      setOpenSections(prev => ({ ...prev, analysis: true }))
    } else if (pathname === '/history') {
      setOpenSections(prev => ({ ...prev, projects: true }))
    } else if (pathname.startsWith('/chat')) {
      setOpenSections(prev => ({ ...prev, ai: true }))
    } else if (pathname.startsWith('/settings') || pathname === '/notifications') {
      setOpenSections(prev => ({ ...prev, settings: true }))
    } else if (pathname === '/admin') {
      setOpenSections(prev => ({ ...prev, admin: true }))
    }
  }, [pathname])

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const isAnalysisActive = pathname === '/' || pathname === '/dashboard'
  const isHistoryActive = pathname === '/history'
  const isChatActive = pathname.startsWith('/chat')
  const isProfileActive = pathname === '/settings/profile'
  const isNotifsActive = pathname === '/notifications'
  const isAdminActive = pathname === '/admin'

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${
          mobileOpen ? 'sidebar-mobile-open' : ''
        }`}
        aria-label="Application Sidebar"
        onWheel={(e) => {
          const el = e.currentTarget
          const isDown = e.deltaY > 0
          const isUp = e.deltaY < 0
          const atTop = el.scrollTop <= 0
          const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1
          if ((isDown && atBottom) || (isUp && atTop)) {
            e.stopPropagation()
          }
        }}
      >
        {/* Sidebar Header */}
        <div className="sidebar-header">
          <div className="sidebar-brand-mobile mobile-only">
            <div className="nav-logo-box" style={{ width: 30, height: 30, borderRadius: 8 }}>
              <Code2 size={16} strokeWidth={2.5} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 800, fontSize: '0.94rem', color: 'var(--foreground)', lineHeight: 1.2 }}>CodeSense</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--primary)', fontWeight: 600 }}>AI Review</span>
            </div>
          </div>

          {!collapsed && (
            <span className="sidebar-header-label desktop-only">Menu</span>
          )}

          {/* Desktop collapse toggle */}
          <button
            type="button"
            className="sidebar-collapse-toggle desktop-only"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>

          {/* Mobile close button */}
          {mobileOpen && (
            <button
              type="button"
              className="sidebar-collapse-toggle mobile-only"
              onClick={onCloseMobile}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Sidebar Nav Items */}
        <nav className="sidebar-nav">
          {/* ── Section: Review & Analysis ─────────────────────────────────── */}
          <div className="sidebar-group">
            {!collapsed ? (
              <button
                type="button"
                className={`sidebar-group-header ${isAnalysisActive ? 'group-active' : ''}`}
                onClick={() => toggleSection('analysis')}
                aria-expanded={openSections.analysis}
              >
                <div className="group-title-wrap">
                  <Layers size={14} className="group-icon" />
                  <span className="group-title">Analysis</span>
                </div>
                {openSections.analysis ? (
                  <ChevronDown size={14} className="group-chevron" />
                ) : (
                  <ChevronRight size={14} className="group-chevron" />
                )}
              </button>
            ) : null}

            {(!collapsed ? openSections.analysis : true) && (
              <div className="sidebar-group-children">
                <Link
                  to="/"
                  className={`sidebar-link ${isAnalysisActive ? 'active' : ''}`}
                  onClick={onCloseMobile}
                  title={collapsed ? 'Code Review' : undefined}
                >
                  <Code2 size={16} className="link-icon" />
                  {!collapsed && <span className="link-text">Code Review</span>}
                </Link>

                <Link
                  to="/pricing"
                  className={`sidebar-link ${pathname === '/pricing' ? 'active' : ''}`}
                  onClick={onCloseMobile}
                  title={collapsed ? 'Plans & Pricing' : undefined}
                >
                  <Crown size={16} className="link-icon text-amber-500" />
                  {!collapsed && <span className="link-text">Plans & Pricing</span>}
                </Link>
              </div>
            )}
          </div>

          {/* ── Section: Project Reviews ───────────────────────────────────── */}
          {user && (
            <div className="sidebar-group">
              {!collapsed ? (
                <button
                  type="button"
                  className={`sidebar-group-header ${isHistoryActive ? 'group-active' : ''}`}
                  onClick={() => toggleSection('projects')}
                  aria-expanded={openSections.projects}
                >
                  <div className="group-title-wrap">
                    <FolderGit2 size={14} className="group-icon" />
                    <span className="group-title">Projects</span>
                  </div>
                  {openSections.projects ? (
                    <ChevronDown size={14} className="group-chevron" />
                  ) : (
                    <ChevronRight size={14} className="group-chevron" />
                  )}
                </button>
              ) : null}

              {(!collapsed ? openSections.projects : true) && (
                <div className="sidebar-group-children">
                  <Link
                    to="/history"
                    className={`sidebar-link ${isHistoryActive ? 'active' : ''}`}
                    onClick={onCloseMobile}
                    title={collapsed ? 'Review History' : undefined}
                  >
                    <ClipboardList size={16} className="link-icon" />
                    {!collapsed && <span className="link-text">Review History</span>}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── Section: AI Assistant ──────────────────────────────────────── */}
          {user && (
            <div className="sidebar-group">
              {!collapsed ? (
                <button
                  type="button"
                  className={`sidebar-group-header ${isChatActive ? 'group-active' : ''}`}
                  onClick={() => toggleSection('ai')}
                  aria-expanded={openSections.ai}
                >
                  <div className="group-title-wrap">
                    <Sparkles size={14} className="group-icon text-primary" />
                    <span className="group-title">AI Assistant</span>
                  </div>
                  {openSections.ai ? (
                    <ChevronDown size={14} className="group-chevron" />
                  ) : (
                    <ChevronRight size={14} className="group-chevron" />
                  )}
                </button>
              ) : null}

              {(!collapsed ? openSections.ai : true) && (
                <div className="sidebar-group-children">
                  <Link
                    to="/history"
                    className={`sidebar-link ${isChatActive ? 'active' : ''}`}
                    onClick={onCloseMobile}
                    title={collapsed ? 'AI Codebase Chat' : undefined}
                  >
                    <MessageSquare size={16} className="link-icon" />
                    {!collapsed && <span className="link-text">Codebase Chat</span>}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── Section: Settings & Account ────────────────────────────────── */}
          {user && (
            <div className="sidebar-group">
              {!collapsed ? (
                <button
                  type="button"
                  className={`sidebar-group-header ${
                    isProfileActive || isNotifsActive ? 'group-active' : ''
                  }`}
                  onClick={() => toggleSection('settings')}
                  aria-expanded={openSections.settings}
                >
                  <div className="group-title-wrap">
                    <Settings size={14} className="group-icon" />
                    <span className="group-title">Settings</span>
                  </div>
                  {openSections.settings ? (
                    <ChevronDown size={14} className="group-chevron" />
                  ) : (
                    <ChevronRight size={14} className="group-chevron" />
                  )}
                </button>
              ) : null}

              {(!collapsed ? openSections.settings : true) && (
                <div className="sidebar-group-children">
                  <Link
                    to="/settings/profile"
                    className={`sidebar-link ${isProfileActive ? 'active' : ''}`}
                    onClick={onCloseMobile}
                    title={collapsed ? 'Profile & Preferences' : undefined}
                  >
                    <User size={16} className="link-icon" />
                    {!collapsed && <span className="link-text">Profile & Security</span>}
                  </Link>

                  <Link
                    to="/notifications"
                    className={`sidebar-link ${isNotifsActive ? 'active' : ''}`}
                    onClick={onCloseMobile}
                    title={collapsed ? 'Notifications' : undefined}
                  >
                    <Bell size={16} className="link-icon" />
                    {!collapsed && <span className="link-text">Notifications</span>}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* ── Section: Admin Panel ───────────────────────────────────────── */}
          {user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
            <div className="sidebar-group">
              {!collapsed ? (
                <button
                  type="button"
                  className={`sidebar-group-header ${isAdminActive ? 'group-active' : ''}`}
                  onClick={() => toggleSection('admin')}
                  aria-expanded={openSections.admin}
                >
                  <div className="group-title-wrap">
                    <Shield size={14} className="group-icon text-amber-500" />
                    <span className="group-title">Administration</span>
                  </div>
                  {openSections.admin ? (
                    <ChevronDown size={14} className="group-chevron" />
                  ) : (
                    <ChevronRight size={14} className="group-chevron" />
                  )}
                </button>
              ) : null}

              {(!collapsed ? openSections.admin : true) && (
                <div className="sidebar-group-children">
                  <Link
                    to="/admin"
                    className={`sidebar-link ${isAdminActive ? 'active' : ''}`}
                    onClick={onCloseMobile}
                    title={collapsed ? 'Admin Panel' : undefined}
                  >
                    <Shield size={16} className="link-icon text-amber-500" />
                    {!collapsed && <span className="link-text">Admin Panel</span>}
                  </Link>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Sidebar Footer */}
        {user ? (
          <div className="sidebar-footer">
            <Link
              to="/settings/profile"
              className="sidebar-user-card"
              onClick={onCloseMobile}
              title={user.name}
            >
              <div className="sidebar-user-avatar">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="sidebar-avatar-img"
                  />
                ) : (
                  <span className="sidebar-avatar-initials">{userInitials}</span>
                )}
              </div>
              {!collapsed && (
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name">{user.name}</div>
                  <div className="sidebar-user-role">
                    {user.role === 'SUPER_ADMIN'
                      ? 'Super Admin'
                      : user.role === 'ADMIN'
                      ? 'Administrator'
                      : user.membershipPlan === 'ENTERPRISE'
                      ? 'Enterprise Plan'
                      : user.membershipPlan === 'PRO'
                      ? 'Pro Member'
                      : 'Developer'}
                  </div>
                </div>
              )}
            </Link>
          </div>
        ) : (
          <div className="sidebar-footer mobile-only" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Link
              to="/login"
              className="btn btn-outline btn-sm"
              onClick={onCloseMobile}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              className="btn btn-primary btn-sm"
              onClick={onCloseMobile}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Get Started Free
            </Link>
          </div>
        )}
      </aside>
    </>
  )
}
