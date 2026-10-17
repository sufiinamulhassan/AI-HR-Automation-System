import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { candidatesApi, type InterviewerLink, type InterviewerRole } from '../../../lib/api'
import { INTERVIEWER_ROLES, errorDetail, formatWhen, roleLabel } from './externalInterview'
import { useDialog } from './useDialog'
import './ShareInterviewerModal.css'

interface Props {
  candidateId: string
  candidateName: string
  onClose: () => void
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const MIN_DAYS = 1
const MAX_DAYS = 30
const MAX_NAME = 120

interface NewLink { url: string; expires_at: string }

type Status = { label: 'Submitted' | 'Pending' | 'Revoked' | 'Expired'; tone: string }

function statusOf(link: InterviewerLink): Status {
  if (link.revoked) return { label: 'Revoked', tone: 'badge-gray' }
  if (link.submitted) return { label: 'Submitted', tone: 'badge-green' }
  if (link.expires_at && Date.parse(link.expires_at) <= Date.now()) return { label: 'Expired', tone: 'badge-yellow' }
  return { label: 'Pending', tone: 'badge-blue' }
}

export default function ShareInterviewerModal({ candidateId, candidateName, onClose }: Props) {
  const titleId = useId()
  const uid = useId()
  const [name, setName] = useState('')
  const [role, setRole] = useState<InterviewerRole>('engineer')
  const [days, setDays] = useState('7')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [created, setCreated] = useState<NewLink | null>(null)
  const [copied, setCopied] = useState(false)
  const everCopied = useRef(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>()

  const [links, setLinks] = useState<InterviewerLink[] | null>(null)
  const [listError, setListError] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState('')

  const requestClose = useCallback(() => {
    if (created && !everCopied.current && !confirm('This link will not be shown again. Close without copying it?')) return
    onClose()
  }, [created, onClose])
  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)

  const loadLinks = useCallback(() => {
    setListError('')
    candidatesApi.listInterviewerLinks(candidateId)
      .then(r => setLinks(Array.isArray(r.data) ? r.data : []))
      .catch(() => setListError('Could not load the existing links.'))
  }, [candidateId])
  useEffect(() => { loadLinks() }, [loadLinks])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const dayCount = Number(days)
  const daysOk = days.trim() !== '' && Number.isInteger(dayCount) && dayCount >= MIN_DAYS && dayCount <= MAX_DAYS

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!daysOk || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const r = await candidatesApi.createInterviewerLink(candidateId, {
        interviewer_name: name.trim() || undefined,
        interviewer_role: role,
        expires_in_days: dayCount,
      })
      const url = r.data.token ? `${window.location.origin}/interviewer/${r.data.token}` : r.data.url
      setCreated({ url, expires_at: r.data.expires_at })
      setCopied(false)
      everCopied.current = false
      loadLinks()
    } catch (err) {
      setCreateError(errorDetail(err) || 'Could not create the link. Please try again')
    } finally {
      setCreating(false)
    }
  }

  function copy() {
    if (!created) return
    const clipboard = navigator.clipboard
    if (!clipboard) { setCreateError('Copying is not available in this browser'); return }
    clipboard.writeText(created.url)
      .then(() => {
        everCopied.current = true
        setCopied(true)
        clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => setCreateError('Could not copy the link'))
  }

  async function revoke(linkId: string) {
    if (revokingId) return
    setRevokingId(linkId)
    setRevokeError('')
    try {
      await candidatesApi.revokeInterviewerLink(candidateId, linkId)
      setLinks(ls => ls ? ls.map(l => (l.link_id === linkId ? { ...l, revoked: true } : l)) : ls)
    } catch (err) {
      setRevokeError(errorDetail(err) || 'Could not revoke the link. Please try again')
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="modal-overlay" data-testid="share-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box sim-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header sim-header">
          <h2 id={titleId}>Share with interviewer, {candidateName}</h2>
          <button type="button" className="modal-close" aria-label="Close share" onClick={requestClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="sim-body">
          <form className="sim-create" onSubmit={create} noValidate>
            <div className="sim-row">
              <div className="sim-field">
                <label className="form-label" htmlFor={`${uid}-name`}>Interviewer name (optional)</label>
                <input
                  id={`${uid}-name`}
                  className="form-input"
                  maxLength={MAX_NAME}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="sim-field">
                <label className="form-label" htmlFor={`${uid}-role`}>Interviewer role</label>
                <select
                  id={`${uid}-role`}
                  className="form-input"
                  value={role}
                  onChange={e => setRole(e.target.value as InterviewerRole)}
                >
                  {INTERVIEWER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="sim-field sim-days">
                <label className="form-label" htmlFor={`${uid}-days`}>Expires in (days)</label>
                <input
                  id={`${uid}-days`}
                  className="form-input"
                  type="number"
                  inputMode="numeric"
                  min={MIN_DAYS}
                  max={MAX_DAYS}
                  step={1}
                  value={days}
                  onChange={e => setDays(e.target.value)}
                />
              </div>
            </div>
            {!daysOk && <div className="sim-hint-error">Enter a whole number from {MIN_DAYS} to {MAX_DAYS}.</div>}
            <div className="sim-create-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!daysOk || creating}>
                {creating ? 'Creating…' : 'Create link'}
              </button>
            </div>
            {createError && <div className="sim-error" role="alert">{createError}</div>}
          </form>

          {created && (
            <div className="sim-new" role="group" aria-label="New link">
              <div className="sim-new-notice">This link will not be shown again. Copy it now.</div>
              <div className="sim-new-row">
                <input
                  className="form-input sim-new-input"
                  readOnly
                  value={created.url}
                  aria-label="Interviewer link"
                  onFocus={e => e.currentTarget.select()}
                />
                <button type="button" className="btn btn-primary btn-sm sim-copy" onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              {formatWhen(created.expires_at) && <div className="sim-new-expiry">Expires {formatWhen(created.expires_at)}</div>}
            </div>
          )}

          <div className="sim-list">
            <h3 className="sim-list-title">Links</h3>
            {listError && (
              <div className="sim-error" role="alert">
                <span>{listError}</span>
                <button type="button" className="sim-link-btn" onClick={loadLinks}>Retry</button>
              </div>
            )}
            {revokeError && <div className="sim-error" role="alert">{revokeError}</div>}
            {links === null && !listError && <p className="sim-empty" role="status">Loading…</p>}
            {links !== null && links.length === 0 && <p className="sim-empty">No links yet</p>}
            {links?.map(link => {
              const status = statusOf(link)
              const canRevoke = status.label === 'Pending' || status.label === 'Submitted'
              return (
                <div className="sim-item" key={link.link_id}>
                  <div className="sim-item-top">
                    <span className="sim-item-name">{link.interviewer_name || 'Interviewer'}</span>
                    {link.interviewer_role && <span className="sim-item-role">{roleLabel(link.interviewer_role)}</span>}
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                    {canRevoke && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm sim-revoke"
                        disabled={revokingId === link.link_id}
                        aria-label={`Revoke link for ${link.interviewer_name || 'interviewer'}`}
                        onClick={() => revoke(link.link_id)}
                      >
                        {revokingId === link.link_id ? 'Revoking…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                  <div className="sim-item-meta">
                    <span>Created {formatWhen(link.created_at) || '-'}</span>
                    <span>Expires {formatWhen(link.expires_at) || '-'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={requestClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
