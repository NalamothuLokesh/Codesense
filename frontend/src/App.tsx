import { Routes, Route, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useState, useRef, useEffect } from 'react'
import {
  Code2,
  ClipboardList,
  MessageSquare,
  Shield,
  Search,
  LogOut,
  ChevronDown,
  Sparkles,
  AlertCircle,
  Loader2,
  Menu,
  User as UserIcon,
  Bell,
  CreditCard,
  Crown,
} from 'lucide-react'
import ThemeToggle from './components/ThemeToggle'
import CommandPalette from './components/CommandPalette'
import ProtectedRoute from './components/ProtectedRoute'
import NotificationBell from './components/NotificationBell'
import Sidebar from './components/Sidebar'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import HistoryPage from './pages/HistoryPage'
import AdminPage from './pages/AdminPage'
import ReviewPage from './pages/ReviewPage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import NotificationsPage from './pages/NotificationsPage'
import PricingPage from './pages/PricingPage'
import './App.css'

// ── Shared Modern Navbar ──────────────────────────────────────────────────────
function Navbar({
  onOpenPalette,
  onToggleMobileSidebar,
}: {
  onOpenPalette: () => void
  onToggleMobileSidebar: () => void
}) {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [isMac, setIsMac] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/.test(window.navigator.platform))
    }
  }, [])

  const handleLogout = async () => {
    await logout()
    nav('/login')
    setOpen(false)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = user?.name
    ? user.name
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    <header className="navbar">
      <div className="navbar-left">
        {/* Mobile Sidebar Hamburger Toggle */}
        <button
          type="button"
          className="nav-mobile-toggle"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle navigation menu"
        >
          <Menu size={20} />
        </button>

        {/* Brand Emblem */}
        <Link to="/" className="nav-brand">
          <div className="nav-logo-box">
            <Code2 size={20} strokeWidth={2.5} className="nav-logo-icon" />
          </div>
          <div className="nav-brand-text">
            <span className="nav-name">CodeSense</span>
            <span className="nav-badge">AI Review</span>
          </div>
        </Link>

        {/* Command Palette Trigger */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="nav-search-trigger"
          aria-label="Open command palette"
        >
          <Search size={15} className="nav-search-icon" />
          <span className="nav-search-placeholder">
            Search or run commands...
          </span>
          <kbd className="nav-kbd">
            <span>{isMac ? '⌘' : 'Ctrl'}</span>
            <span>K</span>
          </kbd>
        </button>
      </div>

      <div className="navbar-right">
        <Link to="/pricing" className="nav-link">
          <Sparkles size={15} className="text-primary" />
          <span>Plans & Pricing</span>
        </Link>

        {user ? (
          <>
            <Link to="/history" className="nav-link">
              <ClipboardList size={16} />
              <span>History</span>
            </Link>

            <Link to="/history" className="nav-chat-btn">
              <MessageSquare size={15} />
              <span>AI Chat</span>
            </Link>

            {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
              <Link to="/admin" className="nav-link nav-admin-link">
                <Shield size={15} />
                <span>Admin</span>
              </Link>
            )}

            {/* Real Notification Bell */}
            <NotificationBell />

            <ThemeToggle />

            {/* Prominent Navbar Tier Pill */}
            {user.membershipPlan && user.membershipPlan !== 'FREE' && (
              <Link to="/pricing" className={`navbar-plan-pill badge-membership-tier tier-${user.membershipPlan.toLowerCase()}`} title={`You are on the ${user.membershipPlan} plan`}>
                <Crown size={12} />
                <span>{user.membershipPlan}</span>
              </Link>
            )}

            <div className="nav-divider" />

            {/* User Dropdown */}
            <div className="nav-user-menu" ref={menuRef}>
              <button
                type="button"
                className={`nav-avatar-btn ${open ? 'nav-avatar-active' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                title={user.name}
              >
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="nav-avatar-img" />
                ) : (
                  <span className="nav-avatar-text">{initials}</span>
                )}
                <ChevronDown size={14} className={`nav-avatar-chevron ${open ? 'chevron-rotated' : ''}`} />
              </button>

              {open && (
                <div className="nav-user-dropdown animate-fadeIn">
                  <div className="nav-user-info">
                    <div className="nav-user-name">{user.name}</div>
                    <div className="nav-user-email">{user.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {user.role === 'SUPER_ADMIN' ? (
                        <span className="badge-role-superadmin">
                          <Shield size={12} /> Super Admin
                        </span>
                      ) : user.role === 'ADMIN' ? (
                        <span className="badge-role-admin">
                          <Shield size={12} /> Administrator
                        </span>
                      ) : null}

                      {user.membershipPlan === 'ENTERPRISE' ? (
                        <span className="badge-membership-tier tier-enterprise">
                          <Crown size={11} /> Enterprise Plan
                        </span>
                      ) : user.membershipPlan === 'PRO' ? (
                        <span className="badge-membership-tier tier-pro">
                          <Crown size={11} /> Pro Member
                        </span>
                      ) : (
                        <span className="badge-membership-tier tier-free">Free Developer</span>
                      )}
                    </div>
                  </div>
                  <div className="nav-dropdown-divider" />
                  <Link
                    to="/settings/profile"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <UserIcon size={15} />
                    <span>Profile & Security</span>
                  </Link>
                  <Link
                    to="/pricing"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <CreditCard size={15} />
                    <span>Membership & Plans</span>
                  </Link>
                  <Link
                    to="/notifications"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <Bell size={15} />
                    <span>Notifications</span>
                  </Link>
                  <Link
                    to="/history"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <ClipboardList size={15} />
                    <span>Review History</span>
                  </Link>
                  <Link
                    to="/history"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <MessageSquare size={15} />
                    <span>AI Chat</span>
                  </Link>
                  {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
                    <Link
                      to="/admin"
                      className="nav-dropdown-item"
                      onClick={() => setOpen(false)}
                    >
                      <Shield size={15} />
                      <span>Admin Panel</span>
                    </Link>
                  )}
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    className="nav-dropdown-item nav-logout"
                    onClick={handleLogout}
                  >
                    <LogOut size={15} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <ThemeToggle />
            <div className="nav-divider" />
            <Link to="/login" className="btn btn-ghost btn-sm nav-signin-btn">
              Sign In
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm nav-signup-btn">
              Get Started
            </Link>
          </>
        )}
      </div>
    </header>
  )
}

// ── App Shell with Router ─────────────────────────────────────────────────────
export default function App() {
  const { loading, dbReady, refreshUser } = useAuth()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('codesense_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('codesense_sidebar_collapsed', String(next))
      } catch (_) {}
      return next
    })
  }

  // Detect OAuth callback success parameter
  useEffect(() => {
    const authSuccess = searchParams.get('auth')
    if (authSuccess === 'google_success' || authSuccess === 'success') {
      refreshUser()
      // Remove query param cleanly from URL
      searchParams.delete('auth')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, refreshUser, setSearchParams])

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (loading) {
    return (
      <div className="app-loading-screen">
        <div className="app-loading-content">
          <div className="app-loading-spinner-wrap">
            <Loader2 size={32} className="spin text-primary" />
          </div>
          <span className="app-loading-text">Initializing CodeSense…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <Navbar
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleMobileSidebar={() => setMobileSidebarOpen(o => !o)}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {!dbReady && (
        <div className="db-connecting-banner">
          <AlertCircle size={15} className="banner-icon" />
          <span>
            Connecting to database… Sign in and review persistence will be ready in a moment.
          </span>
        </div>
      )}

      <div className="app-layout">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <div className={`app-main-content ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
          <Routes>
            <Route path="/" element={<ReviewPage />} />
            <Route path="/dashboard" element={<ReviewPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/register" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />

            {/* Protected Routes */}
            <Route
              path="/settings/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <NotificationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <HistoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute adminOnly>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat/:reviewId"
              element={
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<ReviewPage />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
