import { useEffect, useState } from 'react'
import { emailDeliveryApi } from '../../../lib/api'
import type {
  EmailDeliveryFailure, EmailDeliveryHealth, EmailResendResult,
  EmailResendWaitingResult, EmailVerifyResult,
} from '../../../lib/api'
import './EmailDeliveryPanel.css'

const INVITE_KIND = 'invite'

const MAX_RESEND = 25

const KIND_LABELS: Record<string, string> = {
  invite: 'Interview invite',
  status: 'Status',
  offer: 'Offer',
  other: 'Other',
}

const PROVIDER_LABELS: Record<string, string> = { smtp: 'SMTP', ses: 'Amazon SES' }

const SKIP_REASON_LABELS: Record<string, string> = {
  invalid_log_id: 'unrecognised entry',
  log_not_found: 'entry no longer exists',
  not_failed: 'not a failed email',
  not_an_invite: 'not an invite',
  no_candidate: 'no linked candidate',
  duplicate_candidate: 'duplicate for the same candidate',
  already_delivered_since: 'invite delivered since',
  candidate_not_found: 'candidate no longer exists',
  no_email: 'candidate has no email address',
  interview_already_completed: 'interview already completed',
  interviewed_on_another_platform: 'interview moved to another platform',
  invite_expired: 'invite link expired',
  no_email_provider_configured: 'no email provider configured',
}

const PERMISSION_NOTICE = 'Managing email delivery requires the "email:manage" permission.'

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

function formatWhen(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function skipReasonSummary(result: EmailResendResult): string {
  const counts = new Map<string, number>()
  for (const r of result.results ?? []) {
    if (r.outcome !== 'skipped') continue
    const label = SKIP_REASON_LABELS[r.reason ?? ''] ?? (r.reason ?? 'unknown').replace(/_/g, ' ')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, n]) => `${label} (${n})`).join(', ')
}

function isResendable(f: EmailDeliveryFailure): boolean {
  return f.kind === INVITE_KIND
}

export default function EmailDeliveryPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [health, setHealth] = useState<EmailDeliveryHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [blocked, setBlocked] = useState(false)

  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')
  const [summary, setSummary] = useState<EmailResendResult | null>(null)

  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const [sendingWaiting, setSendingWaiting] = useState(false)
  const [waitingResult, setWaitingResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setRefreshing(true)
    setLoadError('')
    setBlocked(false)
    try {
      const r = await emailDeliveryApi.health()
      setHealth(r.data)
      const stillThere = new Set(r.data.recent_failures.filter(isResendable).map(f => f.log_id))
      setSelected(prev => new Set([...prev].filter(id => stillThere.has(id))))
    } catch (e) {
      if (statusOf(e) === 403) setBlocked(true)
      else setLoadError(errorDetail(e, 'Could not load email delivery status.'))
    }
    setLoading(false)
    setRefreshing(false)
  }

  async function handleTestSend() {
    const to = testTo.trim()
    if (!to) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await emailDeliveryApi.testSend(to)
      const { delivered, status, detail } = r.data
      setTestResult(delivered
        ? { ok: true, text: `Test email delivered to ${to}.` }
        : { ok: false, text: `Not delivered: ${detail || status || 'no detail returned'}` })
    } catch (e) {
      const code = statusOf(e)
      let text: string
      if (code === 429) text = 'Too many test emails in a short time. Wait a minute, then try again.'
      else if (code === 403) text = PERMISSION_NOTICE
      else if (code === 422) text = 'Enter a valid email address.'
      else text = errorDetail(e, 'The test email could not be sent.')
      setTestResult({ ok: false, text })
    }
    setTesting(false)
  }

  async function handleVerify() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const r = await emailDeliveryApi.verify()
      const { ok, detail } = r.data as EmailVerifyResult
      setVerifyResult({ ok: !!ok, detail: detail || '' })
    } catch (e) {
      const code = statusOf(e)
      let detail: string
      if (code === 429) detail = 'Too many checks in a short time. Wait a minute, then try again.'
      else if (code === 403) detail = PERMISSION_NOTICE
      else detail = errorDetail(e, 'The connection could not be checked.')
      setVerifyResult({ ok: false, detail })
    }
    setVerifying(false)
  }

  async function handleSendWaiting() {
    setSendingWaiting(true)
    setWaitingResult(null)
    try {
      const r = await emailDeliveryApi.resendWaiting({ limit: MAX_RESEND })
      const { sent, failed, skipped, remaining } = r.data as EmailResendWaitingResult
      const parts = [`Sent ${sent}`, `failed ${failed}`]
      if (skipped) parts.push(`skipped ${skipped}`)
      if (remaining) parts.push(`${remaining} still waiting`)
      setWaitingResult({ ok: failed === 0, text: `${parts.join(', ')}.` })
      showToast(`Sent ${sent} waiting invite${sent === 1 ? '' : 's'}`)
    } catch (e) {
      const code = statusOf(e)
      setWaitingResult({
        ok: false,
        text: code === 429 ? 'Too many requests in a short time. Wait a minute, then try again.'
          : code === 403 ? PERMISSION_NOTICE
          : errorDetail(e, 'The waiting invites could not be sent.'),
      })
      setSendingWaiting(false)
      return
    }
    setSendingWaiting(false)
    await load()
  }

  async function resend(logIds: string[] | null) {
    setResending(true)
    setResendError('')
    setSummary(null)
    try {
      const r = await emailDeliveryApi.resendFailed({ log_ids: logIds, limit: MAX_RESEND })
      setSummary(r.data)
      setSelected(new Set())
      showToast(`Resent ${r.data.delivered} of ${r.data.attempted} invite emails`)
    } catch (e) {
      const code = statusOf(e)
      setResendError(
        code === 429 ? 'Too many resend requests in a short time. Wait a minute, then try again.'
          : code === 403 ? PERMISSION_NOTICE
          : errorDetail(e, 'The resend could not be completed.'),
      )
      setResending(false)
      return
    }
    setResending(false)
    await load()
  }

  function handleResendSelected() {
    if (selected.size === 0) return
    resend([...selected].slice(0, MAX_RESEND))
  }

  function handleResendAll() {
    if (!confirm(
      `Resend every failed interview invite email (up to ${MAX_RESEND} per run)? ` +
      'Each affected candidate will be emailed their invite again.',
    )) return
    resend(null)
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const failures = health?.recent_failures ?? []
  const eligible = failures.filter(isResendable)
  const allEligibleSelected = eligible.length > 0 && eligible.every(f => selected.has(f.log_id))
  const hasIneligible = failures.length > eligible.length
  const busy = refreshing || resending || sendingWaiting
  const warnings = health?.warnings ?? []
  const waiting = health?.waiting_invites ?? 0
  const skippedWhy = summary ? skipReasonSummary(summary) : ''

  function toggleAll() {
    setSelected(allEligibleSelected ? new Set() : new Set(eligible.map(f => f.log_id)))
  }

  return (
    <>
      <section className="ed-section ps-section card">
        <div className="card-header">
          <span className="card-title">Delivery Status</span>
          {!blocked && (
            <div className="ed-actions">
              {health && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleVerify}
                  disabled={verifying}
                >
                  {verifying ? 'Verifying…' : 'Verify connection'}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          )}
        </div>

        {blocked ? (
          <p className="ed-note">{PERMISSION_NOTICE}</p>
        ) : loading ? (
          <div className="ed-loading">Loading…</div>
        ) : !health ? (
          <div className="ed-error" role="alert">{loadError}</div>
        ) : (
          <div className="ed-status">
            {loadError && <div className="ed-error ed-error-inline" role="alert">{loadError}</div>}

            <div className="ed-status-head">
              <span className={`badge ${health.configured ? 'badge-green' : 'badge-yellow'}`}>
                {health.configured ? 'Configured' : 'Not configured'}
              </span>
              <span className="ed-status-text">
                {health.configured
                  ? 'Outbound email is set up and being delivered.'
                  : 'No email provider is set up.'}
              </span>
            </div>

            {verifyResult && (
              <div
                className={`ed-result ${verifyResult.ok ? 'ed-result-ok' : 'ed-result-bad'}`}
                role="status"
              >
                <strong>{verifyResult.ok ? 'Connection OK' : 'Connection failed'}</strong>
                {verifyResult.detail && <> <span>{verifyResult.detail}</span></>}
              </div>
            )}

            {warnings.length > 0 && (
              <ul className="ed-warnings" aria-label="Warnings">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="ed-warning">{w.message}</li>
                ))}
              </ul>
            )}

            {!health.configured && (
              <p className="ed-explain">
                With no provider, invite, status and offer emails are only written to the server log
                and the email log. They are not delivered to anyone. Set up an email provider in the
                server environment to turn delivery on.
              </p>
            )}

            <dl className="ed-facts">
              <div>
                <dt>Provider</dt>
                <dd>{health.provider ? PROVIDER_LABELS[health.provider] ?? health.provider : 'None'}</dd>
              </div>
              <div>
                <dt>From address</dt>
                <dd>{health.from_address || '-'}</dd>
              </div>
              {health.host && (
                <div>
                  <dt>Host</dt>
                  <dd>{health.host}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </section>

      {!blocked && health && (
        <>
          <section className="ed-section ps-section card">
            <div className="card-header">
              <span className="card-title">Last 7 Days</span>
            </div>
            <div className="ed-counts">
              <div className="ed-count">
                <span className="ed-count-value ed-count-sent">{health.last_7d.sent}</span>
                <span className="ed-count-label">Sent</span>
              </div>
              <div className="ed-count">
                <span className="ed-count-value ed-count-failed">{health.last_7d.failed}</span>
                <span className="ed-count-label">Failed</span>
              </div>
              <div className="ed-count">
                <span className="ed-count-value">{health.last_7d.console_only}</span>
                <span className="ed-count-label">Console only</span>
                <span className="ed-count-hint">Logged, not delivered</span>
              </div>
            </div>
          </section>

          <section className="ed-section ps-section card">
            <div className="card-header">
              <span className="card-title">Waiting Invites</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSendWaiting}
                disabled={busy || waiting === 0}
              >
                {sendingWaiting ? 'Sending…' : 'Send waiting invites'}
              </button>
            </div>
            <div className="ed-waiting">
              <span className="ed-count-value">{waiting}</span>
            </div>
            {waitingResult && (
              <div
                className={`ed-result ${waitingResult.ok ? 'ed-result-ok' : 'ed-result-bad'}`}
                role="status"
              >
                {waitingResult.text}
              </div>
            )}
          </section>

          <section className="ed-section ps-section card">
            <div className="card-header">
              <span className="card-title">Send a Test Email</span>
            </div>
            <form
              className="ed-test"
              onSubmit={e => { e.preventDefault(); handleTestSend() }}
            >
              <label className="ed-field">
                <span className="form-label">Send to</span>
                <input
                  className="form-input" type="email" placeholder="you@company.com"
                  value={testTo} onChange={e => setTestTo(e.target.value)}
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={testing || !testTo.trim()}>
                {testing ? 'Sending…' : 'Send test email'}
              </button>
            </form>
            {testResult && (
              <div
                className={`ed-result ${testResult.ok ? 'ed-result-ok' : 'ed-result-bad'}`}
                role="status"
              >
                {testResult.text}
              </div>
            )}
          </section>

          <section className="ed-section ps-section card">
            <div className="card-header">
              <span className="card-title">Recent Failures</span>
              <div className="ed-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleResendSelected}
                  disabled={busy || selected.size === 0}
                >
                  {resending ? 'Resending…' : `Resend selected${selected.size ? ` (${selected.size})` : ''}`}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleResendAll}
                  disabled={busy || failures.length === 0}
                >
                  Resend all eligible invites
                </button>
              </div>
            </div>

            {summary && (
              <div className="ed-result ed-result-ok ed-summary" role="status">
                Resend complete: {summary.attempted} attempted, {summary.delivered} delivered,{' '}
                {summary.failed} failed, {summary.skipped} skipped.
                {skippedWhy && <div className="ed-summary-detail">Skipped: {skippedWhy}.</div>}
              </div>
            )}
            {resendError && (
              <div className="ed-result ed-result-bad ed-summary" role="alert">{resendError}</div>
            )}

            {failures.length === 0 ? (
              <p className="ed-note">No failed emails to show.</p>
            ) : (
              <>
                <p className="ed-note ed-note-tight">
                  Only candidate interview invites can be resent here; up to {MAX_RESEND} are
                  resent per run.
                  {hasIneligible && ' Other failed emails are listed for reference and cannot be selected.'}
                </p>
                <div className="ed-table-wrap">
                  <table className="ed-table">
                    <thead>
                      <tr>
                        <th className="ed-col-check">
                          <input
                            type="checkbox"
                            aria-label="Select all resendable emails"
                            checked={allEligibleSelected}
                            disabled={eligible.length === 0 || busy}
                            onChange={toggleAll}
                          />
                        </th>
                        <th>To</th>
                        <th>Subject</th>
                        <th>Kind</th>
                        <th>When</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map(f => {
                        const canResend = isResendable(f)
                        return (
                          <tr key={f.log_id} className={canResend ? '' : 'ed-row-locked'}>
                            <td className="ed-col-check">
                              <input
                                type="checkbox"
                                aria-label={`Select email to ${f.to ?? 'unknown recipient'}`}
                                checked={selected.has(f.log_id)}
                                disabled={!canResend || busy}
                                title={canResend ? undefined : 'Only invite emails can be resent here'}
                                onChange={() => toggleRow(f.log_id)}
                              />
                            </td>
                            <td className="ed-cell-to">{f.to || '-'}</td>
                            <td>{f.subject || '-'}</td>
                            <td>
                              <span className={`badge ${canResend ? 'badge-blue' : 'badge-gray'}`}>
                                {kindLabel(f.kind)}
                              </span>
                            </td>
                            <td className="ed-cell-when">{formatWhen(f.created_at)}</td>
                            <td className="ed-cell-error">
                              {f.error || '-'}
                              {f.hint && <div className="ed-cell-hint">{f.hint}</div>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  )
}
