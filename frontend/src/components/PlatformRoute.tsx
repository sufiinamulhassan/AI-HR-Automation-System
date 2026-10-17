import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSessionRefresh } from '../lib/useSessionRefresh'
import { useAuthStore } from '../store/auth.store'

export default function PlatformRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)
  const { ready } = useSessionRefresh()

  if (!token || !user) return <Navigate to="/login" replace />
  if (!ready) {
    return <div role="status" style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>Loading…</div>
  }
  if (user.is_platform_admin !== true) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
