import { useEffect, useState } from 'react'
import { authApi, securityPoliciesApi } from '../../../lib/api'
import './SecurityPoliciesPanel.css'

interface SecurityPolicies {
  password_min_length: number
  password_require_number: boolean
  password_require_symbol: boolean
  max_login_attempts_before_lockout: number
  account_lockout_duration_minutes: number
  session_timeout_minutes: number | null
  updated_at?: string
  updated_by?: string
}

const DEFAULTS: SecurityPolicies = {
  password_min_length: 1,
  password_require_number: false,
  password_require_symbol: false,
  max_login_attempts_before_lockout: 0,
  account_lockout_duration_minutes: 15,
  session_timeout_minutes: null,
}

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

async function myPermissions(): Promise<string[]> {
  const r = await authApi.myPermissions()
  return Array.isArray(r.data?.permissions) ? r.data.permissions : []
}

export default function SecurityPoliciesPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [policies, setPolicies] = useState<SecurityPolicies>(DEFAULTS)
  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [canEdit, setCanEdit] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setBlocked(false)
    setLoadError('')
    const [policy, perms] = await Promise.allSettled([
      securityPoliciesApi.get(),
      myPermissions(),
    ])
    if (policy.status === 'rejected') {
      if (statusOf(policy.reason) === 403) setBlocked(true)
      else setLoadError(errorDetail(policy.reason, 'Could not load the security policies.'))
    } else if (perms.status === 'rejected') {
      setLoadError('Could not load your permissions.')
    } else {
      const data = { ...DEFAULTS, ...policy.value.data }
      setPolicies(data)
      setSessionTimeoutEnabled(data.session_timeout_minutes != null)
      setCanEdit(perms.value.includes('security:manage'))
    }
    setLoading(false)
  }

  function setField<K extends keyof SecurityPolicies>(field: K, value: SecurityPolicies[K]) {
    setPolicies(p => ({ ...p, [field]: value }))
  }

  function validate(): string | null {
    if (!Number.isInteger(policies.password_min_length) || policies.password_min_length < 1)
      return 'Minimum password length must be a whole number of at least 1'
    if (!Number.isInteger(policies.max_login_attempts_before_lockout) || policies.max_login_attempts_before_lockout < 0)
      return 'Max login attempts must be 0 (disabled) or a positive whole number'
    if (!Number.isInteger(policies.account_lockout_duration_minutes) || policies.account_lockout_duration_minutes < 1)
      return 'Lockout duration must be a whole number of at least 1 minute'
    if (sessionTimeoutEnabled) {
      const v = policies.session_timeout_minutes
      if (v == null || !Number.isInteger(v) || v < 1)
        return 'Session timeout must be a whole number of at least 1 minute'
    }
    return null
  }

  async function handleSave() {
    if (!canEdit || loadError) return
    const err = validate()
    if (err) { showToast(err); return }
    setSaving(true)
    try {
      const payload = {
        password_min_length: policies.password_min_length,
        password_require_number: policies.password_require_number,
        password_require_symbol: policies.password_require_symbol,
        max_login_attempts_before_lockout: policies.max_login_attempts_before_lockout,
        account_lockout_duration_minutes: policies.account_lockout_duration_minutes,
        session_timeout_minutes: sessionTimeoutEnabled ? policies.session_timeout_minutes : null,
      }
      const r = await securityPoliciesApi.update(payload)
      const data = { ...DEFAULTS, ...r.data }
      setPolicies(data)
      setSessionTimeoutEnabled(data.session_timeout_minutes != null)
      showToast('Security policies saved')
    } catch (e) {
      showToast(errorDetail(e, 'Failed to save security policies'))
    }
    setSaving(false)
  }

  return (
    <>
      <section className="sp-section ps-section card">
        <div className="card-header">
          <span className="card-title">Security Policies</span>
          {!loading && !blocked && !loadError && !canEdit && (
            <span className="badge badge-gray">Read only</span>
          )}
        </div>
        {blocked ? (
          <p className="sp-note">
            Your role cannot view the security policies.
          </p>
        ) : loading ? (
          <div className="sp-loading">Loading…</div>
        ) : loadError ? (
          <div className="sp-error">
            <span role="alert">{loadError}</span>
            <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
          </div>
        ) : (
          <fieldset className="sp-form" disabled={!canEdit}>

            <div className="sp-group">
              <div className="sp-group-title">Password Policy</div>
              <div className="sp-form-grid">
                <label className="sp-field">
                  <span className="form-label">Minimum Password Length</span>
                  <input
                    className="form-input" type="number" min={1} step={1}
                    value={policies.password_min_length}
                    onChange={e => setField('password_min_length', Number(e.target.value))}
                  />
                </label>
                <label className="sp-checkbox">
                  <input
                    type="checkbox" checked={policies.password_require_number}
                    onChange={e => setField('password_require_number', e.target.checked)}
                  />
                  <span>Require a number</span>
                </label>
                <label className="sp-checkbox">
                  <input
                    type="checkbox" checked={policies.password_require_symbol}
                    onChange={e => setField('password_require_symbol', e.target.checked)}
                  />
                  <span>Require a symbol</span>
                </label>
              </div>
            </div>

            <div className="sp-group">
              <div className="sp-group-title">Account Lockout</div>
              <div className="sp-form-grid">
                <label className="sp-field">
                  <span className="form-label">Max Failed Login Attempts</span>
                  <input
                    className="form-input" type="number" min={0} step={1}
                    value={policies.max_login_attempts_before_lockout}
                    onChange={e => setField('max_login_attempts_before_lockout', Number(e.target.value))}
                  />
                  <span className="sp-hint">0 disables account lockout entirely</span>
                </label>
                <label className="sp-field">
                  <span className="form-label">Lockout Duration (minutes)</span>
                  <input
                    className="form-input" type="number" min={1} step={1}
                    value={policies.account_lockout_duration_minutes}
                    onChange={e => setField('account_lockout_duration_minutes', Number(e.target.value))}
                  />
                  <span className="sp-hint">Only applies once an account is actually locked</span>
                </label>
              </div>
            </div>

            <div className="sp-group">
              <div className="sp-group-title">Session Timeout</div>
              <label className="sp-checkbox">
                <input
                  type="checkbox" checked={sessionTimeoutEnabled}
                  onChange={e => {
                    const enabled = e.target.checked
                    setSessionTimeoutEnabled(enabled)
                    if (enabled && policies.session_timeout_minutes == null) setField('session_timeout_minutes', 60)
                  }}
                />
                <span>Override the platform's default session timeout</span>
              </label>
              {sessionTimeoutEnabled && (
                <label className="sp-field sp-field-indent">
                  <span className="form-label">Session Timeout (minutes)</span>
                  <input
                    className="form-input" type="number" min={1} step={1}
                    value={policies.session_timeout_minutes ?? ''}
                    onChange={e => setField('session_timeout_minutes', Number(e.target.value))}
                  />
                </label>
              )}
              <span className="sp-hint">Left unchecked, logins keep the platform's default token lifetime</span>
            </div>

            {(canEdit || policies.updated_at) && (
              <div className="sp-form-footer">
                {policies.updated_at && (
                  <span className="sp-updated-at">
                    Last saved {new Date(policies.updated_at).toLocaleString()}
                    {policies.updated_by ? ` by ${policies.updated_by}` : ''}
                  </span>
                )}
                {canEdit && (
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                )}
              </div>
            )}
          </fieldset>
        )}
      </section>
    </>
  )
}
