import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuthStore } from '../store/auth.store'

export default function SsoCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)
  const [error, setError] = useState('')

  useEffect(() => {
    const rawToken = searchParams.get('token')
    if (!rawToken) {
      setError('No SSO token was returned. Please try signing in again.')
      return
    }
    const token: string = rawToken

    login(token, {})

    let cancelled = false
    async function establishSession() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await authApi.me()
          if (cancelled) return
          login(token, r.data)
          navigate('/dashboard', { replace: true })
          return
        } catch {
          if (attempt < 2) await new Promise(res => setTimeout(res, 500 * (attempt + 1)))
        }
      }
      if (cancelled) return
      useAuthStore.getState().logout()
      setError('Signed in, but we could not load your account details. Please try signing in again.')
    }
    establishSession()
    return () => { cancelled = true }
  }, [searchParams, login, navigate])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', gap: '1rem', fontFamily: 'var(--font, sans-serif)', textAlign: 'center', padding: '1.5rem',
    }}>
      {error ? (
        <>
          <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '1rem' }}>Sign-in failed</div>
          <p style={{ color: '#64748b', fontSize: '.875rem', maxWidth: 360 }}>{error}</p>
          <a href="/login" style={{ color: '#4778f3', fontWeight: 600, fontSize: '.85rem' }}>Back to login</a>
        </>
      ) : (
        <>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid rgba(71, 120, 243,.25)', borderTopColor: '#4778f3',
            animation: 'sso-spin 0.8s linear infinite',
          }} />
          <p style={{ color: '#64748b', fontSize: '.875rem' }}>Signing you in…</p>
          <style>{`@keyframes sso-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </>
      )}
    </div>
  )
}
