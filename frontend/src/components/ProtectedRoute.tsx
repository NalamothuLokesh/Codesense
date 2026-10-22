import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children: ReactNode
  adminOnly?: boolean
  superAdminOnly?: boolean
}

export default function ProtectedRoute({
  children,
  adminOnly = false,
  superAdminOnly = false,
}: ProtectedRouteProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="app-loading-screen">
        <div className="app-loading-content">
          <div className="app-loading-spinner-wrap">
            <Loader2 size={32} className="spin text-primary" />
          </div>
          <span className="app-loading-text">Verifying session…</span>
        </div>
      </div>
    )
  }

  if (!user) {
    // Redirect unauthenticated users to login with state preserving return location
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (superAdminOnly && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/" replace />
  }

  if (adminOnly && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
