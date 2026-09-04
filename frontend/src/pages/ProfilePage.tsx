import { useEffect, useState } from 'react'
import { authApi } from '../lib/api'
import './ProfilePage.css'

interface MeResponse {
  email: string
  name: string
  role: string
  otp_required: boolean
  is_active: boolean
  created_at: string
  last_login_at: string
}

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'HR Admin',
  standard: 'Recruiter',
}

const ROLE_CLASS: Record<string, string> = {
  superadmin: 'um-role-superadmin',
  admin: 'um-role-admin',
  standard: 'um-role-standard',
}

function getStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { level: 0, label: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { level: 1, label: 'Weak' }
  if (score === 2) return { level: 2, label: 'Fair' }
  return { level: 3, label: 'Strong' }
}

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
)

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

const UserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
)

export default function ProfilePage() {
  const [profile, setProfile] = useState<MeResponse | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [show, setShow] = useState({ current: false, new: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [toastErr, setToastErr] = useState(false)

  const strength = getStrength(newPw)

  useEffect(() => { loadProfile() }, [])

  async function loadProfile() {
    setLoadingProfile(true)
    try {
      const r = await authApi.me()
      setProfile(r.data)
    } catch {}
    setLoadingProfile(false)
  }

  function showToast(msg: string, err = false) {
    setToast(msg); setToastErr(err)
    setTimeout(() => setToast(''), 3500)
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { showToast('New passwords do not match', true); return }
    if (newPw.length < 8) { showToast('New password must be at least 8 characters', true); return }
    setSaving(true)
    try {
      await authApi.changePassword({ current_password: currentPw, new_password: newPw })
      showToast('Password changed successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to change password', true)
    }
    setSaving(false)
  }

  const initials = profile?.name ? profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'

  return (
    <div className="profile-page">
      {toast && <div className={`profile-toast${toastErr ? ' profile-toast-err' : ''}`}>{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">My Profile</div>
          <div className="page-sub">View your account details and manage your password</div>
        </div>
      </div>

      <div className="profile-grid">

        <div>
          <div className="profile-section-title">
            <UserIcon /> Account Information
          </div>
          <div className="card profile-info-card">
            {loadingProfile ? (
              <div className="profile-placeholder">Loading profile…</div>
            ) : profile ? (
              <>
                <div className="profile-avatar-header">
                  <div className="profile-avatar-lg">{initials}</div>
                  <div className="profile-avatar-meta">
                    <div className="profile-avatar-name">{profile.name}</div>
                    <span className={`um-role-badge ${ROLE_CLASS[profile.role] || ''}`}>
                      {ROLE_LABELS[profile.role] || profile.role}
                    </span>
                  </div>
                </div>
                <div className="profile-info-grid">
                  <div className="profile-info-row">
                    <span className="profile-info-key">Email</span>
                    <span className="profile-info-val profile-mono">{profile.email}</span>
                  </div>
                  <div className="profile-info-row">
                    <span className="profile-info-key">Account Status</span>
                    <span className="profile-info-val">
                      <span className={`badge ${profile.is_active ? 'badge-green' : 'badge-red'}`}>
                        {profile.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </div>
                  <div className="profile-info-row">
                    <span className="profile-info-key">OTP Login</span>
                    <span className="profile-info-val">
                      <span className={`badge ${profile.otp_required ? 'badge-blue' : 'badge-gray'}`}>
                        {profile.otp_required ? 'Required' : 'Disabled'}
                      </span>
                    </span>
                  </div>
                  <div className="profile-info-row">
                    <span className="profile-info-key">Member Since</span>
                    <span className="profile-info-val">
                      {profile.created_at
                        ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                        : '-'}
                    </span>
                  </div>
                  <div className="profile-info-row">
                    <span className="profile-info-key">Last Login</span>
                    <span className="profile-info-val">
                      {profile.last_login_at
                        ? new Date(profile.last_login_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="profile-placeholder">Profile unavailable in demo mode - connect a backend to load account details.</div>
            )}
          </div>
        </div>

        <div>
          <div className="profile-section-title">
            <LockIcon /> Security
          </div>
          <div className="card profile-pw-card">
            <div className="pw-card-header">
              <div className="pw-card-icon-wrap">
                <LockIcon />
              </div>
              <div>
                <div className="pw-card-title">Change Password</div>
                <div className="pw-card-sub">Choose a strong, unique password to protect your account.</div>
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="pw-form">

              <div className="pw-field">
                <label className="pw-label">Current Password</label>
                <div className="pw-input-wrap">
                  <input
                    className="pw-input"
                    type={show.current ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Enter your current password"
                    required
                    autoComplete="current-password"
                  />
                  <button type="button" className="pw-eye" onClick={() => setShow(s => ({ ...s, current: !s.current }))}>
                    {show.current ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="pw-field">
                <label className="pw-label">New Password</label>
                <div className="pw-input-wrap">
                  <input
                    className="pw-input"
                    type={show.new ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="Min 8 characters"
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="pw-eye" onClick={() => setShow(s => ({ ...s, new: !s.new }))}>
                    {show.new ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {newPw && (
                  <div className="pw-strength">
                    <div className="pw-strength-bars">
                      <div className={`pw-bar${strength.level >= 1 ? ` pw-bar-${strength.level}` : ''}`} />
                      <div className={`pw-bar${strength.level >= 2 ? ` pw-bar-${strength.level}` : ''}`} />
                      <div className={`pw-bar${strength.level >= 3 ? ` pw-bar-${strength.level}` : ''}`} />
                    </div>
                    <span className={`pw-strength-label pw-sl-${strength.level}`}>{strength.label}</span>
                  </div>
                )}
              </div>

              <div className="pw-field">
                <label className="pw-label">Confirm New Password</label>
                <div className="pw-input-wrap">
                  <input
                    className={`pw-input${confirmPw && confirmPw !== newPw ? ' pw-input-err' : ''}`}
                    type={show.confirm ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Repeat new password"
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="pw-eye" onClick={() => setShow(s => ({ ...s, confirm: !s.confirm }))}>
                    {show.confirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {confirmPw && confirmPw !== newPw && (
                  <span className="pw-mismatch">Passwords do not match</span>
                )}
              </div>

              <button
                className="pw-submit"
                type="submit"
                disabled={saving || !currentPw || !newPw || !confirmPw || newPw !== confirmPw}
              >
                {saving ? (
                  <>
                    <span className="pw-spinner" /> Updating…
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  )
}
