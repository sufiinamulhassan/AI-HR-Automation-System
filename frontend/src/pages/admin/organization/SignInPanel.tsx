import { useEffect, useState } from 'react'
import { companySettingsApi, type CheckResult, type CompanySso, type CompanySsoInput } from '../../../lib/api'
import { errorText, statusOf } from './helpers'
import PlanGate, { PlanBlocked } from './PlanGate'
import SecretField from './SecretField'
import './OrgPanels.css'

const TITLE = 'Single sign-on'

interface Draft {
  enabled: boolean
  issuer: string
  client_id: string
  client_secret: string
  scopes: string
  enforce: boolean
}

function draftFrom(s: CompanySso): Draft {
  return {
    enabled: s.enabled === true,
    issuer: s.issuer ?? '',
    client_id: s.client_id ?? '',
    client_secret: '',
    scopes: s.scopes ?? '',
    enforce: s.enforce === true,
  }
}

function changesOf(saved: CompanySso, d: Draft): CompanySsoInput {
  const was = draftFrom(saved)
  const input: CompanySsoInput = {}
  if (d.enabled !== was.enabled) input.enabled = d.enabled
  if (d.issuer.trim() !== was.issuer) input.issuer = d.issuer.trim()
  if (d.client_id.trim() !== was.client_id) input.client_id = d.client_id.trim()
  if (d.scopes.trim() !== was.scopes) input.scopes = d.scopes.trim()
  if (d.enforce !== was.enforce) input.enforce = d.enforce
  if (d.client_secret) input.client_secret = d.client_secret
  return input
}

function SsoForm({ showToast }: { showToast: (msg: string) => void }) {
  const [sso, setSso] = useState<CompanySso | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [blocked, setBlocked] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [secretRound, setSecretRound] = useState(0)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<CheckResult | null>(null)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const r = await companySettingsApi.getSso()
      setSso(r.data)
      setDraft(draftFrom(r.data))
    } catch (e) {
      if (statusOf(e) === 402) setBlocked(errorText(e, 'Your plan does not include single sign-on.'))
      else setLoadError(errorText(e, 'Could not load the sign-in settings.'))
    }
    setLoading(false)
  }

  if (blocked) return <PlanBlocked title={TITLE} sentence={blocked} />

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => (d ? { ...d, [key]: value } : d))
    setSaveError('')
  }

  const changes = sso && draft ? changesOf(sso, draft) : {}
  const dirty = Object.keys(changes).length > 0
  const needsSecret = !!sso && !!draft && (changes.issuer !== undefined || changes.client_id !== undefined) && !draft.client_secret

  async function save() {
    if (!sso || !draft || needsSecret) return
    setSaving(true)
    setSaveError('')
    try {
      const r = await companySettingsApi.updateSso(changes)
      setSso(r.data)
      setDraft(draftFrom(r.data))
      setTested(null)
      setSecretRound(n => n + 1)
      showToast('Sign-in settings saved')
    } catch (e) {
      if (statusOf(e) === 402) setBlocked(errorText(e, 'Your plan does not include single sign-on.'))
      else setSaveError(errorText(e, 'Could not save the sign-in settings.'))
    }
    setSaving(false)
  }

  async function test() {
    setTesting(true)
    setTested(null)
    try {
      const r = await companySettingsApi.testSso(draft?.issuer.trim() || undefined)
      setTested(r.data)
    } catch (e) {
      setTested({ ok: false, detail: errorText(e, 'Could not run the test.') })
    }
    setTesting(false)
  }

  async function copyRedirect() {
    if (!sso) return
    try {
      await navigator.clipboard.writeText(sso.redirect_uri)
      showToast('Redirect address copied')
    } catch {
      showToast('Could not copy. Select the address and copy it by hand.')
    }
  }

  return (
    <section className="org-section">
      <div className="org-card card">
        <div className="card-header">
          <span className="card-title">{TITLE}</span>
          {sso && <span className={`badge ${sso.enabled ? 'badge-green' : 'badge-gray'}`}>{sso.enabled ? 'On' : 'Off'}</span>}
        </div>
        {loading ? (
          <div className="org-loading">Loading…</div>
        ) : loadError || !sso || !draft ? (
          <div className="org-error">
            <span role="alert">{loadError || 'Could not load the sign-in settings.'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
          </div>
        ) : (
          <div className="org-form">
            <div className="org-form-grid">
              <label className="org-check org-field-wide">
                <input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} />
                <span>Enable single sign-on</span>
              </label>
              <label className="org-field">
                <span className="form-label">Issuer</span>
                <input className="form-input" type="url" value={draft.issuer} onChange={e => set('issuer', e.target.value)} placeholder="https://login.example.com" autoComplete="off" />
              </label>
              <label className="org-field">
                <span className="form-label">Client ID</span>
                <input className="form-input" value={draft.client_id} onChange={e => set('client_id', e.target.value)} autoComplete="off" />
              </label>
              <SecretField
                key={secretRound}
                noun="Client secret"
                saved={sso.has_client_secret}
                value={draft.client_secret}
                onChange={v => set('client_secret', v)}
                removed={false}
                onRemovedChange={() => {}}
                help="Kept safe on the server and never shown again."
                disabled={saving}
              />
              <label className="org-field">
                <span className="form-label">Scopes</span>
                <input className="form-input" value={draft.scopes} onChange={e => set('scopes', e.target.value)} placeholder="openid email profile" autoComplete="off" />
              </label>
              {needsSecret && (
                <span className="org-field-error org-field-wide" role="alert">
                  Enter the client secret again when you change the issuer or the client ID.
                </span>
              )}
              <div className="org-field org-field-wide">
                <label className="org-check">
                  <input type="checkbox" checked={draft.enforce} onChange={e => set('enforce', e.target.checked)} />
                  <span>Require single sign-on</span>
                </label>
                <span className="org-hint">
                  When on, everyone in your company must sign in with single sign-on, and password sign-in and password
                  reset emails are refused. Super Admins can still use their password.
                </span>
              </div>
            </div>

            <div className="org-group-title">Register with your provider</div>
            <div className="org-field">
              <label className="form-label" htmlFor="sso-redirect">Redirect URI to register with your provider</label>
              <div className="org-readonly-box">
                <input id="sso-redirect" className="form-input" readOnly value={sso.redirect_uri} onFocus={e => e.currentTarget.select()} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyRedirect()}>Copy</button>
              </div>
            </div>

            <div className="org-field">
              <span className="form-label">Email domains</span>
              {sso.sso_domains.length === 0 ? (
                <span className="org-hint">None yet. Domains are assigned by the platform.</span>
              ) : (
                <>
                  <ul className="org-chips" aria-label="Email domains">
                    {sso.sso_domains.map(d => <li key={d} className="org-chip">{d}</li>)}
                  </ul>
                  <span className="org-hint">Assigned by the platform. People with these email domains can be created on first sign-in.</span>
                </>
              )}
            </div>

            {saveError && <div className="org-result org-result-bad" role="alert">{saveError}</div>}

            <div className="org-form-footer">
              <div className="org-inline">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void test()} disabled={testing}>
                  {testing ? 'Testing…' : 'Test'}
                </button>
                {tested && (
                  <span className={`org-result ${tested.ok ? 'org-result-ok' : 'org-result-bad'}`} role="status">
                    {tested.ok ? 'Works' : 'Failed'}{tested.detail ? `: ${tested.detail}` : ''}
                  </span>
                )}
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty || needsSecret}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default function SignInPanel({ showToast }: { showToast: (msg: string) => void }) {
  return (
    <PlanGate flag="oidc_sso" title={TITLE}>
      <SsoForm showToast={showToast} />
    </PlanGate>
  )
}
