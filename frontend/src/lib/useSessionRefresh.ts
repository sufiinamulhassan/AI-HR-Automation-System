import { useEffect, useState } from 'react'
import { authApi } from './api'
import { useAuthStore } from '../store/auth.store'

export function useSessionRefresh(): { ready: boolean } {
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)
  const stale = !!token && !!user && user.company_id === undefined && user.is_platform_admin === undefined
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (!stale) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await authApi.me()
        const current = useAuthStore.getState()
        if (!cancelled && current.token === token && r.data) {
          useAuthStore.setState({ user: { ...current.user, ...r.data } })
        }
      } catch {
      } finally {
        if (!cancelled) setSettled(true)
      }
    })()
    return () => { cancelled = true }
  }, [stale, token])

  return { ready: !stale || settled }
}
