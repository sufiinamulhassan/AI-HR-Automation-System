import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import AuthShell from './AuthShell'
import './Login.css'

const GENERIC_CONFIRMATION = 'If that address has an account, we have sent a link.'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await authApi.forgotPassword(email.trim())
      setConfirmation(r.data?.message || GENERIC_CONFIRMATION)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setError(status === 429 ? 'Too many requests. Try again later.' : 'Could not send the link. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="login-title">Forgot your password?</h1>

      {confirmation ? (
        <>
          <div className="login-notice" role="status">{confirmation}</div>
          <div className="auth-links">
            <Link to="/login" className="lf-forgot">Back to sign in</Link>
          </div>
        </>
      ) : (
        <>
          {error && <div className="login-error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit} className="login-form">
            <div className="lf-field">
              <label className="lf-label" htmlFor="forgot-email">Email address</label>
              <input id="forgot-email" className="lf-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com" required autoFocus />
            </div>
            <button type="submit" className="lf-submit" disabled={loading}>
              {loading ? 'Sending' : 'Send reset link'}
            </button>
          </form>
          <div className="auth-links">
            <Link to="/login" className="lf-forgot">Back to sign in</Link>
          </div>
        </>
      )}
    </AuthShell>
  )
}
