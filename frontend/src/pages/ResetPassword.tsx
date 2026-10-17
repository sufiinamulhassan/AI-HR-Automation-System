import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../lib/api'
import AuthShell from './AuthShell'
import './Login.css'

const BAD_LINK = 'This link is invalid or has expired.'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const invite = params.get('invite') === '1'

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const title = invite ? 'Welcome' : 'Reset your password'
  const action = invite ? 'Set your password' : 'Update password'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      navigate(invite ? '/login?reset=invite' : '/login?reset=1', { replace: true })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' && detail.trim() ? detail : 'Could not set the password. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="login-title">{title}</h1>
        <div className="login-error" role="alert">{BAD_LINK}</div>
        <div className="auth-links">
          <Link to="/forgot-password" className="lf-forgot">Request a new link</Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="login-title">{title}</h1>

      {error && <div className="login-error" role="alert">{error}</div>}

      <form onSubmit={handleSubmit} className="login-form">
        <div className="lf-field">
          <label className="lf-label" htmlFor="reset-password">New password</label>
          <div className="lf-input-wrap">
            <input id="reset-password" className="lf-input" type={showPassword ? 'text' : 'password'} value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              autoComplete="new-password" required autoFocus />
            <button
              type="button"
              className="lf-toggle-pw"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.86 21.86 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.9 21.9 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="reset-confirm">Confirm password</label>
          <input id="reset-confirm" className="lf-input" type={showPassword ? 'text' : 'password'} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError('') }}
            autoComplete="new-password" required />
        </div>
        <button type="submit" className="lf-submit" disabled={loading}>
          {loading ? 'Saving' : action}
        </button>
      </form>

      <div className="auth-links">
        {error && <Link to="/forgot-password" className="lf-forgot">Request a new link</Link>}
        <Link to="/login" className="lf-forgot">Back to sign in</Link>
      </div>
    </AuthShell>
  )
}
