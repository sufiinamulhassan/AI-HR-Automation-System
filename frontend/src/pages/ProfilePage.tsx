import { useEffect, useMemo, useRef, useState } from 'react'
import { authApi, offersApi } from '../lib/api'
import { usePasswordPolicy } from '../lib/passwordPolicy'
import { useAuthStore } from '../store/auth.store'
import AvatarCropDialog from '../components/AvatarCropDialog'
import TwoStepCard from './TwoStepCard'
import './ProfilePage.css'

interface MeResponse {
  email: string
  name: string
  role: string
  otp_required: boolean
  is_active: boolean
  created_at: string
  last_login_at: string
  has_password?: boolean
  otp_enabled?: boolean
  otp_enforced?: boolean
  job_title?: string | null
  timezone?: string | null
  department_id?: string | null
}

const COMMON_TIMEZONES = [
  'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'America/Toronto', 'Asia/Dhaka',
  'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Riyadh',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney', 'Europe/Amsterdam',
  'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Pacific/Auckland',
]

function isTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function timezoneSuggestions(saved: string): string[] {
  let own = ''
  try { own = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { own = '' }
  return Array.from(new Set([own, saved, ...COMMON_TIMEZONES].filter(Boolean)))
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" />
  </svg>
)

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="none" />
  </svg>
)

const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" fill="none" />
  </svg>
)

const CropIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </svg>
)

const SignatureIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17c1.8-3.8 3.6-3.8 5.4 0s3.6 3.8 5.4 0 3.6-3.8 5.4 0" />
    <path d="M3 21h18" />
  </svg>
)

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024
const ALLOWED_SIGNATURE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface SignatureState {
  configured: boolean
  content_type?: string
  uploaded_at?: string
  image_base64?: string
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface AvatarState {
  configured: boolean
  content_type?: string
  uploaded_at?: string
  image_base64?: string
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<MeResponse | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [profileFailed, setProfileFailed] = useState(false)

  const [details, setDetails] = useState({ name: '', job_title: '', timezone: '' })
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [otpSaving, setOtpSaving] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const { hint: passwordHint, minLength: passwordMinLength } = usePasswordPolicy()

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [show, setShow] = useState({ current: false, new: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [pwError, setPwError] = useState('')
  const [toast, setToast] = useState('')
  const [toastErr, setToastErr] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const authUser = useAuthStore(s => s.user) as Record<string, string> | null
  const canManageSignature = authUser?.role === 'admin' || authUser?.role === 'superadmin'
  const [signature, setSignature] = useState<SignatureState>({ configured: false })
  const [sigLoading, setSigLoading] = useState(canManageSignature)
  const [sigUploading, setSigUploading] = useState(false)
  const [sigBlocked, setSigBlocked] = useState(false)
  const sigInputRef = useRef<HTMLInputElement>(null)

  const setAvatarDataUrl = useAuthStore(s => s.setAvatarDataUrl)
  const [avatar, setAvatar] = useState<AvatarState>({ configured: false })
  const [avatarLoading, setAvatarLoading] = useState(true)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarRemoving, setAvatarRemoving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [cropSource, setCropSource] = useState<{ src: string; type: string } | null>(null)
  const [cropError, setCropError] = useState('')

  const strength = getStrength(newPw)

  useEffect(() => { loadProfile() }, [])
  useEffect(() => { loadAvatar() }, [])
  useEffect(() => {
    if (canManageSignature) loadSignature()
    else setSigLoading(false)
  }, [canManageSignature])

  async function loadProfile() {
    setLoadingProfile(true)
    setProfileFailed(false)
    try {
      const r = await authApi.me()
      setProfile(r.data)
      setDetails(detailsOf(r.data))
    } catch {
      setProfileFailed(true)
    }
    setLoadingProfile(false)
  }

  function detailsOf(p: Partial<MeResponse>) {
    return { name: p.name ?? '', job_title: p.job_title ?? '', timezone: p.timezone ?? '' }
  }

  function changedDetails(): { name?: string; job_title?: string; timezone?: string } {
    if (!profile) return {}
    const stored = detailsOf(profile)
    const next = { name: details.name.trim(), job_title: details.job_title.trim(), timezone: details.timezone.trim() }
    const body: { name?: string; job_title?: string; timezone?: string } = {}
    if (next.name !== stored.name) body.name = next.name
    if (next.job_title !== stored.job_title) body.job_title = next.job_title
    if (next.timezone !== stored.timezone) body.timezone = next.timezone
    return body
  }

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault()
    const body = changedDetails()
    if (!profile || timezoneBad || Object.keys(body).length === 0) return
    setDetailsSaving(true)
    setDetailsError('')
    try {
      const r = await authApi.updateMe(body)
      const merged = { ...profile, ...body, ...(r.data && typeof r.data === 'object' ? r.data : {}) } as MeResponse
      setProfile(merged)
      setDetails(detailsOf(merged))
      useAuthStore.setState(s => (s.user ? { user: { ...s.user, name: merged.name } } : {}))
      showToast('Profile saved')
    } catch (err: unknown) {
      setDetailsError(errorMessage(err, 'Failed to save profile'))
    }
    setDetailsSaving(false)
  }

  async function handleOtpToggle(enabled: boolean) {
    setOtpSaving(true)
    setOtpError('')
    try {
      const r = await authApi.setOtp(enabled)
      setProfile(p => p ? {
        ...p,
        otp_enabled: r.data?.otp_enabled ?? enabled,
        otp_enforced: r.data?.otp_enforced ?? p.otp_enforced,
      } : p)
    } catch (err: unknown) {
      setOtpError(errorMessage(err, 'Failed to update OTP'))
    }
    setOtpSaving(false)
  }

  async function loadSignature() {
    setSigLoading(true)
    setSigBlocked(false)
    try {
      const r = await offersApi.getMySignature()
      setSignature(r.data)
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 403) setSigBlocked(true)
      setSignature({ configured: false })
    }
    setSigLoading(false)
  }

  async function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ALLOWED_SIGNATURE_TYPES.includes(file.type)) {
      showToast('Signature image must be a PNG or JPEG file', true)
      return
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      showToast('Signature image is too large (max 2MB)', true)
      return
    }
    setSigUploading(true)
    try {
      await offersApi.uploadSignature(file)
      showToast('Signature uploaded')
      loadSignature()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to upload signature', true)
    }
    setSigUploading(false)
  }

  async function loadAvatar() {
    setAvatarLoading(true)
    try {
      const r = await authApi.getAvatar()
      setAvatar(r.data)
      setAvatarDataUrl(r.data?.configured && r.data?.image_base64
        ? `data:${r.data.content_type || 'image/png'};base64,${r.data.image_base64}`
        : null)
    } catch {
      setAvatar({ configured: false })
      setAvatarDataUrl(null)
    }
    setAvatarLoading(false)
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError('Avatar image must be a PNG or JPEG file')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Avatar image is too large (max 2MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropError('')
        setCropSource({ src: reader.result, type: file.type === 'image/png' ? 'image/png' : 'image/jpeg' })
      }
    }
    reader.onerror = () => setAvatarError('Could not read that photo')
    reader.readAsDataURL(file)
  }

  function openAvatarEditor() {
    if (!avatar.configured || !avatar.image_base64) return
    setAvatarError('')
    setCropError('')
    setCropSource({
      src: `data:${avatar.content_type || 'image/png'};base64,${avatar.image_base64}`,
      type: avatar.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    })
  }

  async function handleAvatarSave(file: File) {
    setCropError('')
    setAvatarUploading(true)
    try {
      await authApi.uploadAvatar(file)
      setCropSource(null)
      showToast('Avatar updated')
      loadAvatar()
    } catch (e: unknown) {
      setCropError(errorMessage(e, 'Failed to upload avatar'))
    }
    setAvatarUploading(false)
  }

  async function handleAvatarRemove() {
    if (!confirm('Remove your profile photo?')) return
    setAvatarRemoving(true)
    setAvatarError('')
    try {
      await authApi.deleteAvatar()
      setAvatar({ configured: false })
      setAvatarDataUrl(null)
      showToast('Avatar removed')
    } catch (e: unknown) {
      setAvatarError(errorMessage(e, 'Failed to remove avatar'))
    }
    setAvatarRemoving(false)
  }

  function showToast(msg: string, err = false) {
    setToast(msg); setToastErr(err)
    setTimeout(() => setToast(''), 3500)
  }

  async function handleSignOutEverywhere() {
    if (!confirm('Sign out of every device? You stay signed in here.')) return
    setSigningOut(true)
    try {
      const r = await authApi.signOutEverywhere()
      const fresh = r?.data?.access_token
      if (typeof fresh === 'string' && fresh) useAuthStore.setState({ token: fresh })
      showToast('Signed out everywhere else')
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Could not sign out everywhere'), true)
    }
    setSigningOut(false)
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { showToast('New passwords do not match', true); return }
    if (passwordMinLength && newPw.length < passwordMinLength) {
      setPwError(`New password must be at least ${passwordMinLength} characters`)
      return
    }
    setSaving(true)
    setPwError('')
    try {
      const r = await authApi.changePassword({ current_password: currentPw, new_password: newPw })
      const fresh = (r?.data as { access_token?: unknown } | undefined)?.access_token
      if (typeof fresh === 'string' && fresh) useAuthStore.setState({ token: fresh })
      showToast('Password changed successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setPwError(typeof detail === 'string' && detail.trim() ? detail : 'Failed to change password')
    }
    setSaving(false)
  }

  const initials = profile?.name ? profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
  const timezones = useMemo(() => timezoneSuggestions(profile?.timezone ?? ''), [profile?.timezone])
  const timezoneBad = details.timezone.trim() !== '' && !isTimezone(details.timezone.trim())
  const detailsDirty = Object.keys(changedDetails()).length > 0
  const hasPassword = profile?.has_password !== false
  const otpEnforced = profile?.otp_enforced === true
  const otpOn = otpEnforced || (profile?.otp_enabled ?? profile?.otp_required ?? false)

  return (
    <div className="profile-page">
      {toast && <div className={`profile-toast${toastErr ? ' profile-toast-err' : ''}`}>{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">My Profile</div>
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
                  {avatar.configured && avatar.image_base64 ? (
                    <img
                      className="profile-avatar-lg profile-avatar-img"
                      src={`data:${avatar.content_type || 'image/png'};base64,${avatar.image_base64}`}
                      alt="Your avatar"
                    />
                  ) : (
                    <div className="profile-avatar-lg">{initials}</div>
                  )}
                  <div className="profile-avatar-meta">
                    <div className="profile-avatar-name">{profile.name}</div>
                    <span className={`um-role-badge ${ROLE_CLASS[profile.role] || ''}`}>
                      {ROLE_LABELS[profile.role] || profile.role}
                    </span>
                  </div>
                  <div className="profile-avatar-actions">
                    <button
                      type="button"
                      className="btn btn-ghost profile-avatar-btn"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading || avatarLoading}
                    >
                      <CameraIcon />
                      {avatarUploading ? 'Uploading…' : avatar.configured ? 'Change Photo' : 'Upload Photo'}
                    </button>
                    {avatar.configured && avatar.image_base64 && (
                      <button
                        type="button"
                        className="btn btn-ghost profile-avatar-btn"
                        onClick={openAvatarEditor}
                        disabled={avatarUploading || avatarLoading}
                      >
                        <CropIcon />
                        Edit Photo
                      </button>
                    )}
                    {avatar.configured && (
                      <button
                        type="button"
                        className="profile-avatar-remove-btn"
                        onClick={handleAvatarRemove}
                        disabled={avatarRemoving}
                      >
                        {avatarRemoving ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      aria-label="Upload avatar photo"
                      hidden
                      onChange={handleAvatarPick}
                    />
                  </div>
                  {avatarError && <div className="profile-inline-err" role="alert">{avatarError}</div>}
                  {cropSource && (
                    <AvatarCropDialog
                      src={cropSource.src}
                      type={cropSource.type}
                      busy={avatarUploading}
                      error={cropError}
                      onSave={handleAvatarSave}
                      onCancel={() => setCropSource(null)}
                    />
                  )}
                </div>

                <form className="profile-details-form" onSubmit={handleSaveDetails}>
                  <div className="profile-details-field">
                    <label className="form-label" htmlFor="profile-name">Full Name</label>
                    <input
                      id="profile-name"
                      className="form-input"
                      value={details.name}
                      onChange={e => { setDetails(d => ({ ...d, name: e.target.value })); setDetailsError('') }}
                      autoComplete="name"
                    />
                  </div>
                  <div className="profile-details-field">
                    <label className="form-label" htmlFor="profile-job-title">Job Title</label>
                    <input
                      id="profile-job-title"
                      className="form-input"
                      value={details.job_title}
                      onChange={e => { setDetails(d => ({ ...d, job_title: e.target.value })); setDetailsError('') }}
                      autoComplete="organization-title"
                    />
                  </div>
                  <div className="profile-details-field">
                    <label className="form-label" htmlFor="profile-timezone">Timezone</label>
                    <input
                      id="profile-timezone"
                      className="form-input"
                      list="profile-timezone-suggestions"
                      value={details.timezone}
                      onChange={e => { setDetails(d => ({ ...d, timezone: e.target.value })); setDetailsError('') }}
                      placeholder="Region/City"
                      aria-invalid={timezoneBad || undefined}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <datalist id="profile-timezone-suggestions">
                      {timezones.map(z => <option key={z} value={z} />)}
                    </datalist>
                    {timezoneBad && <span className="profile-inline-err">Use a timezone name such as Europe/London</span>}
                  </div>
                  {detailsError && <div className="profile-inline-err" role="alert">{detailsError}</div>}
                  <div className="profile-details-actions">
                    <button type="submit" className="btn btn-primary" disabled={detailsSaving || !detailsDirty || timezoneBad}>
                      {detailsSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>

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
                    <span className="profile-info-val profile-otp">
                      <label className="profile-otp-toggle">
                        <input
                          type="checkbox"
                          checked={otpOn}
                          disabled={otpEnforced || otpSaving}
                          onChange={e => handleOtpToggle(e.target.checked)}
                        />
                        <span>{otpOn ? 'On' : 'Off'}</span>
                      </label>
                      {otpEnforced && <span className="profile-field-help">Required by your administrator</span>}
                      {otpError && <span className="profile-inline-err" role="alert">{otpError}</span>}
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
            ) : profileFailed ? (
              <div className="profile-load-error" role="alert">
                <span>Could not load your profile.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={loadProfile}>Retry</button>
              </div>
            ) : null}
          </div>
        </div>

        {hasPassword && (
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
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="pw-form">

              <div className="pw-field">
                <label className="pw-label" htmlFor="pw-current">Current Password</label>
                <div className="pw-input-wrap">
                  <input
                    id="pw-current"
                    className="pw-input"
                    type={show.current ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => { setCurrentPw(e.target.value); setPwError('') }}
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
                <label className="pw-label" htmlFor="pw-new">New Password</label>
                <div className="pw-input-wrap">
                  <input
                    id="pw-new"
                    className="pw-input"
                    type={show.new ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => { setNewPw(e.target.value); setPwError('') }}
                    placeholder="Enter a new password"
                    aria-describedby={passwordHint ? 'pw-new-hint' : undefined}
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="pw-eye" onClick={() => setShow(s => ({ ...s, new: !s.new }))}>
                    {show.new ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {passwordHint && <span className="profile-field-help" id="pw-new-hint">{passwordHint}</span>}
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
                <label className="pw-label" htmlFor="pw-confirm">Confirm New Password</label>
                <div className="pw-input-wrap">
                  <input
                    id="pw-confirm"
                    className={`pw-input${confirmPw && confirmPw !== newPw ? ' pw-input-err' : ''}`}
                    type={show.confirm ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
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

              {pwError && <div className="pw-mismatch" role="alert">{pwError}</div>}

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
        )}

        {profile && hasPassword && <TwoStepCard onToast={showToast} />}

        <div>
          <div className="profile-section-title">
            <LockIcon /> Sessions
          </div>
          <div className="card profile-session-card">
            <div className="profile-session-row">
              <div className="profile-session-title">Active sessions</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleSignOutEverywhere}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out everywhere'}
              </button>
            </div>
          </div>
        </div>

        {canManageSignature && (
          <div>
            <div className="profile-section-title">
              <SignatureIcon /> Offer Letter Signature
            </div>
            <div className="card profile-sig-card">
              <div className="sig-card-header">
                <div className="sig-card-icon-wrap">
                  <SignatureIcon />
                </div>
                <div>
                  <div className="sig-card-title">My E-Signature</div>
                </div>
              </div>

              <div className="sig-card-body">
                {sigBlocked ? (
                  <p className="sig-note">
                    Managing your e-signature requires the "offers:manage_signature" permission.
                  </p>
                ) : sigLoading ? (
                  <div className="profile-placeholder">Loading signature…</div>
                ) : (
                  <>
                    {signature.configured && signature.image_base64 ? (
                      <div className="sig-preview">
                        <img
                          className="sig-preview-img"
                          src={`data:${signature.content_type || 'image/png'};base64,${signature.image_base64}`}
                          alt="Your signature"
                        />
                        {signature.uploaded_at && (
                          <span className="sig-preview-meta">
                            Uploaded {new Date(signature.uploaded_at).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="sig-note">No signature uploaded yet.</p>
                    )}

                    <button
                      type="button"
                      className="btn btn-ghost sig-upload-btn"
                      onClick={() => sigInputRef.current?.click()}
                      disabled={sigUploading}
                    >
                      {sigUploading ? 'Uploading…' : signature.configured ? 'Replace Signature' : 'Upload Signature'}
                    </button>
                    <input
                      ref={sigInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      aria-label="Upload signature image"
                      hidden
                      onChange={handleSignatureUpload}
                    />
                    <span className="sig-hint">PNG or JPEG, up to 2MB.</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
