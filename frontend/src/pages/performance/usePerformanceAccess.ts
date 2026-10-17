import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import { authApi } from '../../lib/api'

export interface PerformanceAccess {
  loading: boolean
  isAdmin: boolean
  canRead: boolean
  canReview: boolean
  canManage: boolean
  hasAnyAccess: boolean
}

export function usePerformanceAccess(): PerformanceAccess {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [state, setState] = useState<{ permissions: string[]; loading: boolean }>(
    { permissions: [], loading: Boolean(user) },
  )

  useEffect(() => {
    if (!user) {
      setState({ permissions: [], loading: false })
      return
    }
    let alive = true
    setState(s => ({ ...s, loading: true }))
    authApi.myPermissions()
      .then(r => { if (alive) setState({ permissions: r.data?.permissions ?? [], loading: false }) })
      .catch(() => { if (alive) setState({ permissions: [], loading: false }) })
    return () => { alive = false }
  }, [user?.email])

  const canRead = state.permissions.includes('performance:read')
  const canReview = state.permissions.includes('performance:review')

  return {
    loading: state.loading,
    isAdmin,
    canRead,
    canReview,
    canManage: isAdmin,
    hasAnyAccess: canRead || canReview,
  }
}
