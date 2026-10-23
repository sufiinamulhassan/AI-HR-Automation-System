import { useEffect, useState } from 'react'
import {
  companySettingsApi, type CheckResult, type CompanyMail, type CompanyMailInput, type MailTestResult,
} from '../../../lib/api'
import { errorText, statusOf } from './helpers'
import PlanGate, { PlanBlocked } from './PlanGate'
import SecretField from './SecretField'
import './OrgPanels.css'

const TITLE = 'Company mail'
const SMTP_PORTS = [25, 465, 587, 2525]

export interface MailSource {
  title: string
  load: () => Promise<{ data: CompanyMail }>
  save: (d: CompanyMailInput) => Promise<{ data: CompanyMail }>
  verify: () => Promise<{ data: CheckResult }>
  test: (to: string) => Promise<{ data: MailTestResult }>
  defaultLabel: string
  ownLabel: string
  defaultHint: string
  incompleteHint: string
  completeHint: string
  ownVia: MailTestResult['via']
  ownViaText: string
  defaultViaText: string
  fromNamePlaceholder: string
  fromAddressPlaceholder: string
  replyToPlaceholder: string
}

const COMPANY_SOURCE: MailSource = {
  title: TITLE,
  load: () => companySettingsApi.getMail(),
  save: d => companySettingsApi.updateMail(d),
  verify: () => companySettingsApi.verifyMail(),
  test: to => companySettingsApi.testMail(to),
  defaultLabel: 'The platform',
  ownLabel: 'Your own mail server',
  defaultHint: "Messages go out from the platform's sender. Choose your own server to send from your address.",
  incompleteHint: 'Incomplete. Your own server is used only when the settings are complete.',
  completeHint: 'Complete. Messages go out through your own server from your address, and are not sent another way if it fails.',
  ownVia: 'company',
  ownViaText: 'your mail server',
  defaultViaText: "the platform's sender",
  fromNamePlaceholder: 'Acme Hiring',
  fromAddressPlaceholder: 'hiring@example.com',
  replyToPlaceholder: 'hr@example.com',
}

interface Draft {
  mode: 'platform' | 'smtp'
  from_name: string
  from_address: string
  reply_to: string
  host: string
  port: string
  username: string
  use_tls: boolean
  password: string
  clearPassword: boolean
}

function draftFrom(m: CompanyMail): Draft {
  return {
    mode: m.mode === 'smtp' ? 'smtp' : 'platform',
    from_name: m.from_name ?? '',
    from_address: m.from_address ?? '',
    reply_to: m.reply_to ?? '',
    host: m.host ?? '',
    port: m.port === null || m.port === undefined ? '' : String(m.port),
    username: m.username ?? '',
    use_tls: m.use_tls !== false,
    password: '',
    clearPassword: false,
  }
}

function changesOf(saved: CompanyMail, d: Draft): CompanyMailInput {
  const was = draftFrom(saved)
  const input: CompanyMailInput = {}
  if (d.mode !== was.mode) input.mode = d.mode
  if (d.from_name !== was.from_name) input.from_name = d.from_name.trim()
  if (d.from_address !== was.from_address) input.from_address = d.from_address.trim()
  if (d.reply_to !== was.reply_to) input.reply_to = d.reply_to.trim()
  if (d.host !== was.host) input.host = d.host.trim()
  if (d.port !== was.port) input.port = d.port.trim() === '' ? null : Number(d.port)
  if (d.username !== was.username) input.username = d.username.trim()
  if (d.use_tls !== was.use_tls) input.use_tls = d.use_tls
  if (d.password) input.password = d.password
  else if (d.clearPassword) input.clear_password = true
  return input
}

export function MailForm({ showToast, source = COMPANY_SOURCE }: { showToast: (msg: string) => void; source?: MailSource }) {
  const [mail, setMail] = useState<CompanyMail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [blocked, setBlocked] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [secretRound, setSecretRound] = useState(0)

  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const r = await source.load()
      setMail(r.data)
      setDraft(draftFrom(r.data))
    } catch (e) {
      if (statusOf(e) === 402) setBlocked(errorText(e, 'Your plan does not include a custom mail server.'))
      else setLoadError(errorText(e, 'Could not load the mail settings.'))
    }
    setLoading(false)
  }

  if (blocked) return <PlanBlocked title={source.title} sentence={blocked} />

  const dirty = !!mail && !!draft && Object.keys(changesOf(mail, draft)).length > 0
  const portNumber = draft && draft.port.trim() !== '' ? Number(draft.port) : null
  const portBad = !!draft && draft.mode === 'smtp' && portNumber !== null && !SMTP_PORTS.includes(portNumber)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => (d ? { ...d, [key]: value } : d))
    setSaveError('')
  }

  async function save() {
    if (!mail || !draft || portBad) return
    setSaving(true)
    setSaveError('')
    try {
      const r = await source.save(changesOf(mail, draft))
      setMail(r.data)
      setDraft(draftFrom(r.data))
      setCheck(null)
      setSent(null)
      setSecretRound(n => n + 1)
      showToast('Mail settings saved')
    } catch (e) {
      if (statusOf(e) === 402) setBlocked(errorText(e, 'Your plan does not include a custom mail server.'))
      else setSaveError(errorText(e, 'Could not save the mail settings.'))
    }
    setSaving(false)
  }

  async function verify() {
    setChecking(true)
    setCheck(null)
    try {
      const r = await source.verify()
      setCheck(r.data)
    } catch (e) {
      setCheck({ ok: false, detail: errorText(e, 'Could not check the connection.') })
    }
    setChecking(false)
  }

  async function sendTest() {
    const address = to.trim()
    if (!address) return
    setSending(true)
    setSent(null)
    try {
      const r = await source.test(address)
      const result: MailTestResult = r.data
      const via = result.via === source.ownVia ? source.ownViaText : source.defaultViaText
      setSent(result.delivered
        ? { ok: true, text: `Delivered via ${via}` }
        : { ok: false, text: `Not delivered via ${via}${result.detail ? `: ${result.detail}` : ''}` })
    } catch (e) {
      setSent({
        ok: false,
        text: statusOf(e) === 429 ? errorText(e, 'Too many test emails. Try again in a while.') : errorText(e, 'Could not send the test email.'),
      })
    }
    setSending(false)
  }

  return (
    <section className="org-section">
      <div className="org-card card">
        <div className="card-header">
          <span className="card-title">{source.title}</span>
          {mail && draft?.mode === 'smtp' && (
            <span className={`badge ${mail.complete ? 'badge-green' : 'badge-yellow'}`}>{mail.complete ? 'Complete' : 'Incomplete'}</span>
          )}
        </div>
        {loading ? (
          <div className="org-loading">Loading…</div>
        ) : loadError || !mail || !draft ? (
          <div className="org-error">
            <span role="alert">{loadError || 'Could not load the mail settings.'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
          </div>
        ) : (
          <div className="org-form">
            <div className="org-field">
              <span className="form-label" id="mail-mode-label">Send email through</span>
              <div className="org-segment" role="radiogroup" aria-labelledby="mail-mode-label">
                {([['platform', source.defaultLabel], ['smtp', source.ownLabel]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={draft.mode === value}
                    className={`org-segment-opt${draft.mode === value ? ' org-segment-on' : ''}`}
                    onClick={() => set('mode', value)}
                    disabled={saving}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {draft.mode === 'platform' && (
                <span className="org-hint">{source.defaultHint}</span>
              )}
              {draft.mode === 'smtp' && !mail.complete && (
                <span className="org-hint">{source.incompleteHint}</span>
              )}
              {draft.mode === 'smtp' && mail.complete && (
                <span className="org-hint">{source.completeHint}</span>
              )}
            </div>

            {draft.mode === 'smtp' && (
              <>
                <div className="org-form-grid">
                  <label className="org-field">
                    <span className="form-label">From name</span>
                    <input className="form-input" value={draft.from_name} onChange={e => set('from_name', e.target.value)} placeholder={source.fromNamePlaceholder} />
                  </label>
                  <label className="org-field">
                    <span className="form-label">From address</span>
                    <input className="form-input" type="email" value={draft.from_address} onChange={e => set('from_address', e.target.value)} placeholder={source.fromAddressPlaceholder} />
                  </label>
                  <label className="org-field">
                    <span className="form-label">Reply-to address</span>
                    <input className="form-input" type="email" value={draft.reply_to} onChange={e => set('reply_to', e.target.value)} placeholder={source.replyToPlaceholder} />
                  </label>
                  <label className="org-field">
                    <span className="form-label">Host</span>
                    <input className="form-input" value={draft.host} onChange={e => set('host', e.target.value)} placeholder="smtp.example.com" autoComplete="off" />
                  </label>
                  <div className="org-field">
                    <label className="form-label" htmlFor="mail-port">Port</label>
                    <input id="mail-port" className="form-input org-days-input" inputMode="numeric" value={draft.port} onChange={e => set('port', e.target.value)} placeholder="587" aria-invalid={portBad || undefined} />
                    {portBad
                      ? <span className="org-field-error" role="alert">Use port 25, 465, 587 or 2525.</span>
                      : <span className="org-hint">Port 25, 465, 587 or 2525.</span>}
                  </div>
                  <label className="org-field">
                    <span className="form-label">Username</span>
                    <input className="form-input" value={draft.username} onChange={e => set('username', e.target.value)} autoComplete="off" />
                  </label>
                  <SecretField
                    key={secretRound}
                    noun="Password"
                    saved={mail.has_password}
                    value={draft.password}
                    onChange={v => set('password', v)}
                    removed={draft.clearPassword}
                    onRemovedChange={v => set('clearPassword', v)}
                    disabled={saving}
                  />
                  <label className="org-check org-check-end">
                    <input type="checkbox" checked={draft.use_tls} onChange={e => set('use_tls', e.target.checked)} />
                    <span>Use TLS</span>
                  </label>
                </div>
              </>
            )}

            {saveError && <div className="org-result org-result-bad" role="alert">{saveError}</div>}

            <div className="org-form-footer">
              {mail.updated_at && (
                <span className="org-updated-at">
                  Last saved {new Date(mail.updated_at).toLocaleString()}{mail.updated_by ? ` by ${mail.updated_by}` : ''}
                </span>
              )}
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty || portBad}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>

            <div className="org-group-title">Check the settings</div>
            {dirty && <span className="org-hint">Save your changes before checking them.</span>}
            <div className="org-inline">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void verify()} disabled={dirty || checking}>
                {checking ? 'Checking…' : 'Check connection'}
              </button>
            </div>
            {check && (
              <div className={`org-result ${check.ok ? 'org-result-ok' : 'org-result-bad'}`} role="status">
                {check.ok ? 'Connection works' : 'Connection failed'}{check.detail ? `: ${check.detail}` : ''}
              </div>
            )}

            <form className="org-inline org-test-send" onSubmit={e => { e.preventDefault(); void sendTest() }}>
              <label className="org-field org-grow">
                <span className="form-label">Send a test email to</span>
                <input className="form-input" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="you@example.com" />
              </label>
              <button type="submit" className="btn btn-ghost btn-sm" disabled={dirty || sending || !to.trim()}>
                {sending ? 'Sending…' : 'Send a test email'}
              </button>
            </form>
            {sent && (
              <div className={`org-result ${sent.ok ? 'org-result-ok' : 'org-result-bad'}`} role="status">{sent.text}</div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export default function MailPanel({ showToast }: { showToast: (msg: string) => void }) {
  return (
    <PlanGate flag="custom_smtp" title={TITLE}>
      <MailForm showToast={showToast} />
    </PlanGate>
  )
}
