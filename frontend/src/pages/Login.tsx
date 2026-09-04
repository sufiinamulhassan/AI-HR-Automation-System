import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { API_V1 } from '../lib/config'
import { useAuthStore } from '../store/auth.store'
import './Login.css'

const GOOGLE_SSO_URL = `${API_V1}/sso/google/login`

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (otpRequired) {
        const r = await authApi.verifyOtp(email, otp)
        login(r.data.access_token, r.data.user ?? { email })
        navigate('/dashboard')
      } else {
        const r = await authApi.login(email, password)
        if (r.data.otp_required) {
          setOtpRequired(true)
        } else {
          login(r.data.access_token, r.data.user ?? { email })
          navigate('/dashboard')
        }
      }
    } catch (e: unknown) {
      const apiErr = e as { response?: { data?: { detail?: string } } }
      if (otpRequired) {
        setError(apiErr?.response?.data?.detail || 'Invalid OTP code. Please try again.')
      } else {
        setError(apiErr?.response?.data?.detail || 'Login failed. Check your credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div aria-hidden="true" className="login-grid" />

      <div className="login-card">
        <span aria-hidden="true" className="login-corner login-corner-tl" />
        <span aria-hidden="true" className="login-corner login-corner-tr" />
        <span aria-hidden="true" className="login-corner login-corner-bl" />
        <span aria-hidden="true" className="login-corner login-corner-br" />

        <Link to="/" className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="login-brand-text">
            <span className="login-brand-name">Hirely.ai</span>
          </span>
        </Link>

        <h1 className="login-title">{otpRequired ? 'Check your email' : 'Welcome back'}</h1>
        <p className="login-sub">
          {otpRequired ? 'Enter the 6-digit code we sent you.' : 'Sign in to access the dashboard.'}
        </p>

        {error && <div className="login-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          {!otpRequired ? (
            <>
              <div className="lf-field">
                <label className="lf-label" htmlFor="login-email">Email address</label>
                <input
                  id="login-email"
                  className="lf-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor="login-password">Password</label>
                <div className="lf-input-wrap">
                  <input
                    id="login-password"
                    className="lf-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
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
            </>
          ) : (
            <div className="lf-field">
              <label className="lf-label" htmlFor="login-otp">One-time code</label>
              <input
                id="login-otp"
                className="lf-input lf-input-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                maxLength={6}
                placeholder="123456"
                autoComplete="one-time-code"
                required
                autoFocus
              />
            </div>
          )}

          <button type="submit" className="lf-submit" disabled={loading}>
            {loading ? 'Signing in…' : otpRequired ? 'Verify code' : 'Sign in'}
          </button>

          {otpRequired && (
            <button type="button" className="lf-back-link" onClick={() => setOtpRequired(false)}>
              Back to login
            </button>
          )}
        </form>

        {!otpRequired && (
          <>
            <div className="or-divider">
              <span className="or-divider-line" />
              <span className="or-divider-label">or</span>
              <span className="or-divider-line" />
            </div>
            <a href={GOOGLE_SSO_URL} className="sso-google-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09Z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
              </svg>
              Sign in with Google
            </a>
          </>
        )}

        <Link to="/" className="login-back">Back to home</Link>
      </div>
    </div>
  )
}
