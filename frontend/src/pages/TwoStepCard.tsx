import { useEffect, useState, type FormEvent } from 'react'
import { authApi, type TotpSetup, type TotpStatus } from '../lib/api'
import './TwoStepCard.css'

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" />
  </svg>
)

function apiMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d)).join('; ')
  }
  return fallback
}

const stripSpaces = (value: string) => value.replace(/\s+/g, '')
const isSixDigits = (value: string) => /^\d{6}$/.test(stripSpaces(value))

const isAuthenticatorLink = (uri: string) => /^otpauth:\/\//i.test(uri)

function saveAsFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type Panel = 'none' | 'setup' | 'regenerate' | 'disable'

export default function TwoStepCard({ onToast }: { onToast: (message: string, isError?: boolean) => void }) {
  const [status, setStatus] = useState<TotpStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [panel, setPanel] = useState<Panel>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setLoadFailed(false)
    try {
      const r = await authApi.totpStatus()
      setStatus(r.data)
    } catch {
      setLoadFailed(true)
    }
    setLoading(false)
  }

  function closePanel() {
    setPanel('none')
    setSetup(null)
    setCode('')
    setPassword('')
    setError('')
  }

  function showCodes(list: string[]) {
    closePanel()
    setCodes(list)
    setSaved(false)
  }

  async function startSetup() {
    setBusy(true)
    setError('')
    try {
      const r = await authApi.totpSetup()
      setSetup(r.data)
      setCode('')
      setPanel('setup')
    } catch (e) {
      setError(apiMessage(e, 'Could not start the setup.'))
      if ((e as { response?: { status?: number } })?.response?.status === 409) void load()
    }
    setBusy(false)
  }

  async function enable(e: FormEvent) {
    e.preventDefault()
    if (!isSixDigits(code) || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await authApi.totpEnable(stripSpaces(code))
      setStatus(s => ({ ...(s ?? {}), enabled: true, pending: false, recovery_codes_remaining: r.data.recovery_codes.length }))
      showCodes(r.data.recovery_codes)
      onToast('Two-step verification is on')
    } catch (err) {
      setError(apiMessage(err, 'That code did not work. Check your app and try again.'))
    }
    setBusy(false)
  }

  async function regenerate(e: FormEvent) {
    e.preventDefault()
    if (!isSixDigits(code) || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await authApi.totpRecoveryCodes(stripSpaces(code))
      setStatus(s => ({ ...(s ?? { enabled: true }), recovery_codes_remaining: r.data.recovery_codes.length }))
      showCodes(r.data.recovery_codes)
      onToast('New recovery codes made. The old ones no longer work')
    } catch (err) {
      setError(apiMessage(err, 'That code did not work. Check your app and try again.'))
    }
    setBusy(false)
  }

  async function disable(e: FormEvent) {
    e.preventDefault()
    if (!password || stripSpaces(code).length < 6 || busy) return
    setBusy(true)
    setError('')
    try {
      await authApi.totpDisable(password, stripSpaces(code))
      setStatus({ enabled: false, pending: false, recovery_codes_remaining: 0 })
      closePanel()
      onToast('Two-step verification is off')
    } catch (err) {
      setError(apiMessage(err, 'The password or the code is wrong.'))
    }
    setBusy(false)
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      onToast(`${what} copied`)
    } catch {
      onToast('Could not copy. Select the text and copy it by hand.', true)
    }
  }

  const enabled = status?.enabled === true

  if (codes) {
    const text = codes.join('\n')
    return (
      <div>
        <div className="profile-section-title"><LockIcon /> Two-step verification</div>
        <div className="card ts-card">
          <div className="ts-head"><div className="ts-title">Recovery codes</div></div>
          <div className="ts-body" role="group" aria-label="Recovery codes">
            <div className="ts-warning" role="alert">
              Save these codes now. They are shown once and cannot be read again. Each one works a single time if you lose your device.
            </div>
            <ul className="ts-codes">
              {codes.map(c => <li key={c} className="ts-code">{c}</li>)}
            </ul>
            <div className="ts-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(text, 'Recovery codes')}>Copy all</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveAsFile('recovery-codes.txt', `${text}\n`)}>
                Download as .txt
              </button>
            </div>
            <label className="ts-check">
              <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
              <span>I have saved these codes</span>
            </label>
            <div className="ts-row">
              <button type="button" className="btn btn-primary btn-sm" disabled={!saved} onClick={() => { setCodes(null); setSaved(false) }}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="profile-section-title"><LockIcon /> Two-step verification</div>
      <div className="card ts-card">
        <div className="ts-head">
          <div className="ts-title">Authenticator app</div>
          {status && <span className={`badge ${enabled ? 'badge-green' : 'badge-gray'}`}>{enabled ? 'On' : 'Off'}</span>}
        </div>

        <div className="ts-body">
          {loading ? (
            <div className="ts-muted">Loading…</div>
          ) : loadFailed || !status ? (
            <div className="ts-error-row" role="alert">
              <span>Could not load the status.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
            </div>
          ) : (
            <>
              {enabled && typeof status.recovery_codes_remaining === 'number' && (
                <div className="ts-muted">
                  {status.recovery_codes_remaining} recovery {status.recovery_codes_remaining === 1 ? 'code' : 'codes'} left
                </div>
              )}

              {panel === 'none' && (
                <div className="ts-row">
                  {!enabled && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void startSetup()} disabled={busy}>
                      {busy ? 'Starting…' : 'Set up'}
                    </button>
                  )}
                  {enabled && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setCode(''); setPanel('regenerate') }}>
                        Regenerate recovery codes
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => { setError(''); setCode(''); setPassword(''); setPanel('disable') }}>
                        Turn off
                      </button>
                    </>
                  )}
                </div>
              )}

              {panel === 'setup' && setup && (
                <form className="ts-form" onSubmit={enable}>
                  <div className="ts-field">
                    <label className="pw-label" htmlFor="ts-secret">Setup key</label>
                    <div className="ts-secret-row">
                      <input id="ts-secret" className="pw-input ts-mono" readOnly value={setup.secret} onFocus={e => e.currentTarget.select()} />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(setup.secret, 'Setup key')}>Copy</button>
                    </div>
                    {isAuthenticatorLink(setup.otpauth_uri) && (
                      <a className="ts-link" href={setup.otpauth_uri}>Open in authenticator app</a>
                    )}
                  </div>
                  <div className="ts-field">
                    <label className="pw-label" htmlFor="ts-code">Code from the app</label>
                    <input id="ts-code" className="pw-input ts-mono" inputMode="numeric" autoComplete="one-time-code"
                      maxLength={7} placeholder="123456" value={code} onChange={e => { setCode(e.target.value); setError('') }} />
                    <span className="profile-field-help">Add the key to your app, then enter the 6-digit code it shows.</span>
                  </div>
                  {error && <div className="pw-mismatch" role="alert">{error}</div>}
                  <div className="ts-row">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !isSixDigits(code)}>
                      {busy ? 'Checking…' : 'Turn on'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={closePanel} disabled={busy}>Cancel</button>
                  </div>
                </form>
              )}

              {panel === 'regenerate' && (
                <form className="ts-form" onSubmit={regenerate}>
                  <div className="ts-field">
                    <label className="pw-label" htmlFor="ts-regen-code">Code from the app</label>
                    <input id="ts-regen-code" className="pw-input ts-mono" inputMode="numeric" autoComplete="one-time-code"
                      maxLength={7} placeholder="123456" value={code} onChange={e => { setCode(e.target.value); setError('') }} />
                    <span className="profile-field-help">Making new recovery codes stops the old ones from working.</span>
                  </div>
                  {error && <div className="pw-mismatch" role="alert">{error}</div>}
                  <div className="ts-row">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !isSixDigits(code)}>
                      {busy ? 'Working…' : 'Make new codes'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={closePanel} disabled={busy}>Cancel</button>
                  </div>
                </form>
              )}

              {panel === 'disable' && (
                <form className="ts-form" onSubmit={disable}>
                  <div className="ts-field">
                    <label className="pw-label" htmlFor="ts-off-password">Password</label>
                    <input id="ts-off-password" className="pw-input" type="password" autoComplete="current-password"
                      value={password} onChange={e => { setPassword(e.target.value); setError('') }} />
                  </div>
                  <div className="ts-field">
                    <label className="pw-label" htmlFor="ts-off-code">Code from the app</label>
                    <input id="ts-off-code" className="pw-input ts-mono" autoComplete="one-time-code"
                      maxLength={11} placeholder="123456" value={code} onChange={e => { setCode(e.target.value); setError('') }} />
                    <span className="profile-field-help">A recovery code works here too.</span>
                  </div>
                  {error && <div className="pw-mismatch" role="alert">{error}</div>}
                  <div className="ts-row">
                    <button type="submit" className="btn btn-danger btn-sm" disabled={busy || !password || stripSpaces(code).length < 6}>
                      {busy ? 'Turning off…' : 'Turn off'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={closePanel} disabled={busy}>Cancel</button>
                  </div>
                </form>
              )}

              {panel === 'none' && error && <div className="pw-mismatch" role="alert">{error}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
