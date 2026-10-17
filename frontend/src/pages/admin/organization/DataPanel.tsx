import { useEffect, useId, useState } from 'react'
import { candidatesApi, companySettingsApi, type CompanyRetention, type EraseByEmailResult } from '../../../lib/api'
import TypedConfirmDialog from '../../../components/TypedConfirmDialog'
import { eraseSummary, failedVectors } from '../../../lib/erased'
import { errorText, fmtDay, statusOf } from './helpers'
import './OrgPanels.css'

const MIN_DAYS = 30
const MAX_DAYS = 36500
const DEFAULT_DAYS = '365'
const MIN_REASON = 3
const MAX_REASON = 500
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Period {
  forever: boolean
  days: string
}

const periodOf = (days: number | null | undefined): Period =>
  days === null || days === undefined ? { forever: true, days: DEFAULT_DAYS } : { forever: false, days: String(days) }

const daysOf = (p: Period): number | null => (p.forever ? null : p.days.trim() === '' ? Number.NaN : Number(p.days))

function periodError(p: Period): string {
  if (p.forever) return ''
  const n = daysOf(p)
  if (n === null || !Number.isInteger(n) || n < MIN_DAYS) return `Use a whole number of days, ${MIN_DAYS} or more.`
  if (n > MAX_DAYS) return `Use at most ${MAX_DAYS.toLocaleString()} days.`
  return ''
}

function PeriodField({ label, period, onChange, error, disabled }: {
  label: string
  period: Period
  onChange: (p: Period) => void
  error: string
  disabled: boolean
}) {
  const id = useId()
  return (
    <div className="org-field">
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="org-retention-row">
        <input
          id={id}
          className="form-input org-days-input"
          inputMode="numeric"
          value={period.forever ? '' : period.days}
          placeholder={period.forever ? 'For ever' : DEFAULT_DAYS}
          disabled={disabled || period.forever}
          aria-invalid={!!error || undefined}
          onChange={e => onChange({ ...period, days: e.target.value })}
        />
        <label className="org-check">
          <input
            type="checkbox"
            checked={period.forever}
            disabled={disabled}
            onChange={e => onChange({ forever: e.target.checked, days: period.days || DEFAULT_DAYS })}
          />
          <span>Keep for ever</span>
        </label>
      </div>
      {error
        ? <span className="org-field-error" role="alert">{error}</span>
        : <span className="org-hint">Counted from the last activity. The minimum is {MIN_DAYS} days.</span>}
    </div>
  )
}

function RetentionCard({ showToast }: { showToast: (msg: string) => void }) {
  const [saved, setSaved] = useState<CompanyRetention | null>(null)
  const [candidate, setCandidate] = useState<Period>({ forever: true, days: DEFAULT_DAYS })
  const [resume, setResume] = useState<Period>({ forever: true, days: DEFAULT_DAYS })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [shown, setShown] = useState(false)

  useEffect(() => { void load() }, [])

  function adopt(r: CompanyRetention) {
    setSaved(r)
    setCandidate(periodOf(r.candidate_days))
    setResume(periodOf(r.resume_days))
  }

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      adopt((await companySettingsApi.getRetention()).data)
    } catch (e) {
      setLoadError(errorText(e, 'Could not load the retention settings.'))
    }
    setLoading(false)
  }

  const candidateError = shown ? periodError(candidate) : ''
  const resumeError = shown ? periodError(resume) : ''

  const changes: { candidate_days?: number | null; resume_days?: number | null } = {}
  if (saved) {
    if (daysOf(candidate) !== (saved.candidate_days ?? null)) changes.candidate_days = daysOf(candidate)
    if (daysOf(resume) !== (saved.resume_days ?? null)) changes.resume_days = daysOf(resume)
  }
  const dirty = Object.keys(changes).length > 0

  async function save() {
    setShown(true)
    if (periodError(candidate) || periodError(resume)) return
    setSaving(true)
    setSaveError('')
    try {
      adopt((await companySettingsApi.updateRetention(changes)).data)
      setShown(false)
      showToast('Retention saved')
    } catch (e) {
      setSaveError(errorText(e, 'Could not save the retention settings.'))
    }
    setSaving(false)
  }

  const purge = saved?.last_purge

  return (
    <section className="org-section">
      <div className="org-card card">
        <div className="card-header"><span className="card-title">Retention</span></div>
        {loading ? (
          <div className="org-loading">Loading…</div>
        ) : loadError || !saved ? (
          <div className="org-error">
            <span role="alert">{loadError || 'Could not load the retention settings.'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
          </div>
        ) : (
          <div className="org-form">
            <div className="org-form-grid">
              <PeriodField label="Erase candidates after (days)" period={candidate} onChange={setCandidate} error={candidateError} disabled={saving} />
              <PeriodField label="Erase résumés with no candidate after (days)" period={resume} onChange={setResume} error={resumeError} disabled={saving} />
            </div>
            {saveError && <div className="org-result org-result-bad" role="alert">{saveError}</div>}
            <div className="org-form-footer">
              <span className="org-updated-at">
                {purge
                  ? `Last purge ${fmtDay(purge.at)}: ${purge.candidates_erased} candidates and ${purge.resumes_erased} résumés erased`
                  : 'No purge has run yet'}
              </span>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function EraseByEmailCard() {
  const reasonId = useId()
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [includeEmployment, setIncludeEmployment] = useState(false)
  const [employmentAsked, setEmploymentAsked] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<EraseByEmailResult | null>(null)

  const address = email.trim()
  const trimmed = reason.trim()
  const ready = EMAIL_RE.test(address) && trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON

  async function erase() {
    setBusy(true)
    setDialogError('')
    try {
      const r = await candidatesApi.eraseByEmail({
        email: address,
        reason: trimmed,
        ...(employmentAsked && includeEmployment ? { include_employment: true } : {}),
      })
      setResult(r.data)
      setNotice('')
      setConfirming(false)
      setEmail('')
      setReason('')
      setIncludeEmployment(false)
      setEmploymentAsked(false)
    } catch (e) {
      if (statusOf(e) === 409) {
        setEmploymentAsked(true)
        setNotice(errorText(e, 'This person has an employee record or an accepted offer.'))
        setConfirming(false)
      } else {
        setDialogError(errorText(e, 'Could not erase this person. Try again.'))
      }
    }
    setBusy(false)
  }

  return (
    <section className="org-section">
      <div className="org-card card">
        <div className="card-header"><span className="card-title">Erase a person by email</span></div>
        <div className="org-form">
          <div className="org-form-grid">
            <label className="org-field">
              <span className="form-label">Email address</span>
              <input
                className="form-input" type="email" value={email} autoComplete="off"
                onChange={e => { setEmail(e.target.value); setResult(null) }} placeholder="person@example.com"
              />
            </label>
            <div className="org-field org-field-wide">
              <label className="form-label" htmlFor={reasonId}>Reason</label>
              <textarea
                id={reasonId} className="form-input" rows={2} maxLength={MAX_REASON} value={reason}
                onChange={e => { setReason(e.target.value); setResult(null) }}
              />
              <span className="org-hint">{MIN_REASON} to {MAX_REASON} characters. Kept on the audit record. {trimmed.length} / {MAX_REASON}</span>
            </div>
          </div>
          {employmentAsked && (
            <label className="org-check">
              <input type="checkbox" checked={includeEmployment} onChange={e => setIncludeEmployment(e.target.checked)} />
              <span>Also erase their offer and employee records</span>
            </label>
          )}
          {notice && <div className="org-result org-result-bad" role="alert">{notice}</div>}
          {result && (
            <div className="org-erase-result" role="status">
              {result.matched === 0 ? (
                <strong>No candidate has that email address.</strong>
              ) : (
                <>
                  <strong>
                    Erased {result.matched} {result.matched === 1 ? 'candidate record' : 'candidate records'}.
                  </strong>
                  {eraseSummary(result.counts) && <span>{eraseSummary(result.counts)}</span>}
                  {failedVectors(result.vectors_failed) > 0 && (
                    <span>Some search entries could not be removed yet. Erasing again, or the next retention run, retries them.</span>
                  )}
                </>
              )}
            </div>
          )}
          <div className="org-form-footer">
            <span className="org-updated-at" />
            <button type="button" className="btn btn-danger" onClick={() => { setDialogError(''); setConfirming(true) }} disabled={!ready}>
              Erase
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <TypedConfirmDialog
          title={`Erase ${address}?`}
          confirmWord="ERASE"
          confirmLabel="Erase everything"
          busy={busy}
          error={dialogError}
          onConfirm={() => void erase()}
          onCancel={() => setConfirming(false)}
        >
          <p className="org-erase-warning">
            This removes every personal detail held under this email address, in every job: résumés, interviews, notes and
            messages. It cannot be undone.
          </p>
        </TypedConfirmDialog>
      )}
    </section>
  )
}

export default function DataPanel({ showToast }: { showToast: (msg: string) => void }) {
  return (
    <>
      <RetentionCard showToast={showToast} />
      <EraseByEmailCard />
    </>
  )
}
