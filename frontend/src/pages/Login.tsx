import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuthStore } from '../store/auth.store'
import './Login.css'

const HACKATHON_DEMO_TOKEN = 'demo-superadmin-token'
const HACKATHON_DEMO_USER = {
  email: 'demo-superadmin@hirely.ai',
  name: 'Hackathon Evaluator',
  role: 'superadmin',
}

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

  useEffect(() => {
    try {
      if (sessionStorage.getItem('demo-auth-rejected')) {
        sessionStorage.removeItem('demo-auth-rejected')
        setError(
          'Demo sign-in reached the server but was rejected. The API needs ALLOW_DEMO_AUTH=true and HACKATHON_DEMO_MODE=true.'
        )
      }
    } catch {
      void 0
    }
  }, [])

  function handleHackathonDemoSignIn() {
    login(HACKATHON_DEMO_TOKEN, HACKATHON_DEMO_USER)
    navigate('/dashboard')
  }

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
            <button type="button" onClick={handleHackathonDemoSignIn} className="demo-signin-btn">
              <span className="demo-signin-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="m10 17 5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
              </span>
              <span className="demo-signin-text">
                <span className="demo-signin-title">Enter Demo Dashboard</span>
                <span className="demo-signin-sub">Instant Super Admin access, no password</span>
              </span>
            </button>
          </>
        )}

        <Link to="/" className="login-back">Back to home</Link>
      </div>
    </div>
  )
}