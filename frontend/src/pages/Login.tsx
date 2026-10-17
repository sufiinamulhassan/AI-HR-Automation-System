import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, oidcLoginUrl, ssoApi, type OidcConfig } from '../lib/api'
import { useBrand } from '../lib/brand'
import { landingPathFor } from '../lib/landing'
import { API_V1 } from '../lib/config'
import { useAuthStore, type SessionUser } from '../store/auth.store'
import AuthShell from './AuthShell'
import './Login.css'

const GOOGLE_SSO_URL = `${API_V1}/sso/google/login`

const DEMO_CLIENT_TOKEN = 'demo-superadmin-token'
const DEMO_CLIENT_USER: SessionUser = {
  email: 'demo-superadmin@hirely.ai',
  name: 'Hackathon Evaluator',
  role: 'superadmin',
}

const DEMO_PLATFORM_TOKEN = 'demo-platform-token'
const DEMO_PLATFORM_USER: SessionUser = {
  email: 'demo-superadmin@hirely.ai',
  name: 'Platform Owner',
  role: 'superadmin',
  is_platform_admin: true,
  workspace_kind: 'platform',
}

const BLOCKED_MESSAGES: Record<string, string> = {
  suspended: 'This workspace is suspended. Contact your administrator.',
  trial: "This workspace's trial has ended. Ask your administrator to subscribe.",
  subscription: "This workspace's subscription has ended. Ask your administrator to renew.",
}

const RESET_NOTICE: Record<string, string> = {
  '1': 'Your password has been updated. Sign in with the new one.',
  invite: 'Your password is set. Sign in to get started.',
}

type OtpMethod = 'email' | 'totp'

const OTP_MAX_LENGTH = 11

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)
  const brand = useBrand()
  const [params] = useSearchParams()
  const blocked = BLOCKED_MESSAGES[params.get('blocked') ?? ''] ?? (params.get('suspended') === '1' ? BLOCKED_MESSAGES.suspended : '')
  const resetNotice = RESET_NOTICE[params.get('reset') ?? '']
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpMethod, setOtpMethod] = useState<OtpMethod>('email')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recovery, setRecovery] = useState<{ left: number; to: string } | null>(null)

  const company = (params.get('company') ?? '').trim() || brand.companySlug
  const [sso, setSso] = useState<OidcConfig | null>(null)
  const [adminSignIn, setAdminSignIn] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem('demo-auth-rejected')) {
        sessionStorage.removeItem('demo-auth-rejected')
        setError(
          'Demo sign-in reached the server but was rejected. The API needs ALLOW_DEMO_AUTH=true and HACKATHON_DEMO_MODE=true, and the platform demo also needs DEBUG=true.'
        )
      }
    } catch {
      void 0
    }
  }, [])

  useEffect(() => {
    setSso(null)
    setAdminSignIn(false)
    if (!company) return
    let current = true
    ssoApi.oidcConfig(company)
      .then(r => { if (current) setSso(r.data?.enabled ? r.data : null) })
      .catch(() => { if (current) setSso(null) })
    return () => { current = false }
  }, [company])

  const ssoName = (sso?.name || brand.companyName).trim()
  const enforced = !!sso && sso.enforce === true
  const showForm = !enforced || adminSignIn

  function handleClientDemoSignIn() {
    login(DEMO_CLIENT_TOKEN, DEMO_CLIENT_USER)
    navigate(landingPathFor(DEMO_CLIENT_USER))
  }

  function handlePlatformDemoSignIn() {
    login(DEMO_PLATFORM_TOKEN, DEMO_PLATFORM_USER)
    navigate(landingPathFor(DEMO_PLATFORM_USER))
  }

  function finish(token: string, user: SessionUser) {
    login(token, user)
    navigate(landingPathFor(user))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (otpRequired) {
        const code = otp.replace(/\s+/g, '')
        const r = await authApi.verifyOtp(email, code)
        const user = r.data.user ?? { email }
        const left = r.data.recovery_codes_left
        if (typeof left === 'number') {
          login(r.data.access_token, user)
          setRecovery({ left, to: landingPathFor(user) })
        } else {
          finish(r.data.access_token, user)
        }
      } else {
        const r = await authApi.login(email, password)
        if (r.data.otp_required) {
          setOtpMethod(r.data.method === 'totp' ? 'totp' : 'email')
          setOtp('')
          setOtpRequired(true)
        } else {
          finish(r.data.access_token, r.data.user ?? { email })
        }
      }
    } catch (e: unknown) {
      const apiErr = e as { response?: { data?: { detail?: unknown } } }
      const detail = apiErr?.response?.data?.detail
      const message = typeof detail === 'string' && detail.trim() ? detail : ''
      if (otpRequired) {
        setError(message || (otpMethod === 'totp' ? 'That code did not work. Try again.' : 'Invalid OTP code. Please try again.'))
      } else {
        setError(message || 'Login failed. Check your credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  function backToLogin() {
    setOtpRequired(false)
    setOtp('')
    setError('')
  }

  if (recovery) {
    return (
      <AuthShell>
        <h1 className="login-title">You are signed in</h1>
        <div className="login-notice" role="status">
          {recovery.left === 0
            ? 'You used a recovery code. No recovery codes remain. Make new ones in your profile.'
            : `You used a recovery code. ${recovery.left} ${recovery.left === 1 ? 'code remains' : 'codes remain'}.`}
        </div>
        <button type="button" className="lf-submit lf-continue" onClick={() => navigate(recovery.to)}>Continue</button>
      </AuthShell>
    )
  }

  const demoButtons = (
    <div className="demo-signin-group">
      <button type="button" onClick={handleClientDemoSignIn} className="demo-signin-btn">
        Enter Client Demo
      </button>
      <button type="button" onClick={handlePlatformDemoSignIn} className="demo-signin-btn">
        Enter Platform Demo
      </button>
    </div>
  )

  const ssoButton = sso && (
    <a href={oidcLoginUrl(company)} className="sso-oidc-btn">
      {ssoName ? `Sign in with ${ssoName} single sign-on` : 'Sign in with single sign-on'}
    </a>
  )

  const title = !otpRequired ? 'Welcome back' : otpMethod === 'totp' ? 'Two-step verification' : 'Check your email'

  return (
    <AuthShell>
      <h1 className="login-title">{title}</h1>
      {!otpRequired && <p className="login-sub">Sign in to access your workspace.</p>}
      {otpRequired && otpMethod === 'email' && <p className="login-sub">Enter the 6-digit code we sent you.</p>}

      {blocked && <div className="login-error" role="alert">{blocked}</div>}
      {resetNotice && <div className="login-notice" role="status">{resetNotice}</div>}
      {error && <div className="login-error">{error}</div>}

      {!otpRequired && enforced && (
        <div className="sso-section sso-company">
          {ssoButton}
          <button
            type="button"
            className="lf-back-link sso-admin-toggle"
            aria-expanded={adminSignIn}
            onClick={() => setAdminSignIn(v => !v)}
          >
            Administrator sign-in
          </button>
        </div>
      )}

      {!otpRequired && enforced && (
        <div className="sso-section">
          <div className="or-divider">
            <span className="or-divider-line" />
            <span className="or-divider-label">or</span>
            <span className="or-divider-line" />
          </div>
          {demoButtons}
        </div>
      )}

      {(showForm || otpRequired) && (
        <form onSubmit={handleSubmit} className="login-form">
          {!otpRequired ? (
            <>
              <div className="lf-field">
                <label className="lf-label" htmlFor="login-email">Email address</label>
                <input id="login-email" className="lf-input" type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" required autoFocus={!enforced} />
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor="login-password">Password</label>
                <div className="lf-input-wrap">
                  <input id="login-password" className="lf-input" type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Your password" required />
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
                <Link to="/forgot-password" className="lf-forgot">Forgot your password?</Link>
              </div>
            </>
          ) : otpMethod === 'totp' ? (
            <div className="lf-field">
              <label className="lf-label" htmlFor="login-otp">Authenticator code</label>
              <input id="login-otp" className="lf-input" type="text" value={otp}
                onChange={e => setOtp(e.target.value)}
                maxLength={OTP_MAX_LENGTH} placeholder="123456" required autoFocus
                autoComplete="one-time-code" spellCheck={false} aria-describedby="login-otp-help" />
              <span className="lf-help" id="login-otp-help">
                Lost your device? Use a recovery code (xxxxx-xxxxx) in this box.
              </span>
            </div>
          ) : (
            <div className="lf-field">
              <label className="lf-label" htmlFor="login-otp">One-time code</label>
              <input id="login-otp" className="lf-input" type="text" value={otp}
                onChange={e => setOtp(e.target.value)}
                maxLength={6} placeholder="123456" required autoFocus />
            </div>
          )}
          <button type="submit" className="lf-submit" disabled={loading}>
            {loading ? 'Signing in' : otpRequired ? 'Verify code' : 'Sign in'}
          </button>
          {otpRequired && (
            <button type="button" className="lf-back-link" onClick={backToLogin}>
              Back to login
            </button>
          )}
        </form>
      )}

      {!otpRequired && !enforced && (
        <div className="sso-section">
          <div className="or-divider">
            <span className="or-divider-line" />
            <span className="or-divider-label">or</span>
            <span className="or-divider-line" />
          </div>
          {ssoButton}
          <a href={GOOGLE_SSO_URL} className="sso-google-btn">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
              <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09Z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
            </svg>
            Sign in with Google
          </a>
          {demoButtons}
        </div>
      )}
    </AuthShell>
  )
}
