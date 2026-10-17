import { useEffect, useState } from 'react'
import { interviewApi } from '../../../lib/api'
import './ShareReportPanel.css'

interface Props {
  token: string
  onClose: () => void
}

interface ShareFeedback {
  feedback_id?: string
  reviewer_name: string | null
  rating: number | null
  comment: string
  created_at: string
}

interface ShareRow {
  share_id: string
  candidate_id: string
  job_id: string | null
  created_by: string | null
  created_at: string
  expires_at: string | null
  revoked: boolean
  revoked_at: string | null
  revoked_by: string | null
  expired: boolean
  active: boolean
  view_count: number
  last_viewed_at: string | null
  feedback: ShareFeedback[]
}

interface NewShare {
  share_url: string
  expires_at: string
}

function formatDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function shareStatus(row: ShareRow): { label: string; cls: string } {
  if (row.revoked) return { label: 'Revoked', cls: 'badge-gray' }
  if (row.expired) return { label: 'Expired', cls: 'badge-yellow' }
  return { label: 'Active', cls: 'badge-green' }
}

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <button type="button" className="btn btn-primary btn-sm srp-copy-btn" onClick={copy}>
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}

export default function ShareReportPanel({ token, onClose }: Props) {
  const [shares, setShares] = useState<ShareRow[] | null>(null)
  const [listError, setListError] = useState('')

  const [expiresInDays, setExpiresInDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [newShare, setNewShare] = useState<NewShare | null>(null)

  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState('')

  function loadShares() {
    setListError('')
    interviewApi.shares.list(token)
      .then(r => setShares(r.data?.shares ?? []))
      .catch(() => setListError("Couldn't load existing share links."))
  }

  useEffect(() => { loadShares() }, [token])

  async function handleCreate() {
    if (creating) return
    setCreating(true)
    setCreateError('')
    try {
      const r = await interviewApi.shares.create(token, expiresInDays || null)
      setNewShare({ share_url: r.data.share_url, expires_at: r.data.expires_at })
      loadShares()
    } catch (err) {
      setCreateError(errorDetail(err, "Couldn't create a share link. Please try again."))
    }
    setCreating(false)
  }

  async function handleRevoke(shareId: string) {
    if (revokingId) return
    setRevokingId(shareId)
    setRevokeError('')
    try {
      const r = await interviewApi.shares.revoke(shareId)
      setShares(rows => rows ? rows.map(row => (row.share_id === shareId ? r.data : row)) : rows)
    } catch {
      setRevokeError("Couldn't revoke this share link. Please try again.")
    }
    setRevokingId(null)
  }

  return (
    <div className="srp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="srp-card">
        <div className="srp-header">
          <h3>Share Report</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="srp-body">
          <div className="srp-create">
            <p className="srp-create-hint">
              Create a link a reviewer with no platform account, e.g. a hiring manager, can
              open without logging in. It shows a reduced report only: no résumé, transcript or
              audio.
            </p>
            <div className="srp-create-row">
              <label className="srp-expiry-label">
                Expires in
                <input
                  type="number"
                  className="form-input srp-expiry-input"
                  min={1}
                  max={30}
                  value={expiresInDays}
                  disabled={creating}
                  onChange={e => setExpiresInDays(Number(e.target.value))}
                  aria-label="Expires in days"
                />
                days
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={creating}
                onClick={handleCreate}
              >
                {creating ? 'Creating…' : 'Create Share Link'}
              </button>
            </div>
            {createError && <div className="srp-error">{createError}</div>}

            {newShare && (
              <div className="srp-new-link">
                <div className="srp-new-link-notice">
                  This link won&rsquo;t be shown again: copy it now.
                </div>
                <div className="srp-new-link-row">
                  <input
                    className="form-input srp-new-link-input"
                    readOnly
                    value={newShare.share_url}
                    aria-label="New share link"
                    onFocus={e => e.currentTarget.select()}
                  />
                  <CopyLinkButton text={newShare.share_url} />
                </div>
                <div className="srp-new-link-expiry">Expires {formatDate(newShare.expires_at)}</div>
              </div>
            )}
          </div>

          <div className="srp-list">
            <h4 className="srp-list-title">Existing Share Links</h4>
            {listError && <div className="srp-error">{listError}</div>}
            {revokeError && <div className="srp-error">{revokeError}</div>}
            {shares === null && !listError && <p className="srp-empty">Loading…</p>}
            {shares !== null && shares.length === 0 && (
              <p className="srp-empty">No share links have been created for this candidate yet.</p>
            )}
            {shares?.map(row => {
              const status = shareStatus(row)
              return (
                <div key={row.share_id} className="srp-row">
                  <div className="srp-row-top">
                    <span className={`badge ${status.cls}`}>{status.label}</span>
                    <span className="srp-row-created">
                      Created {formatDate(row.created_at)}{row.created_by ? ` by ${row.created_by}` : ''}
                    </span>
                    {row.active && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm srp-revoke-btn"
                        disabled={revokingId === row.share_id}
                        onClick={() => handleRevoke(row.share_id)}
                      >
                        {revokingId === row.share_id ? 'Revoking…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                  <div className="srp-row-meta">
                    <span>Expires {formatDate(row.expires_at)}</span>
                    <span>{row.view_count} view{row.view_count === 1 ? '' : 's'}</span>
                    {row.last_viewed_at && <span>Last viewed {formatDate(row.last_viewed_at)}</span>}
                    {row.revoked && row.revoked_at && (
                      <span>Revoked {formatDate(row.revoked_at)}{row.revoked_by ? ` by ${row.revoked_by}` : ''}</span>
                    )}
                  </div>
                  {!!row.feedback.length && (
                    <div className="srp-feedback">
                      {row.feedback.map((f, i) => (
                        <div key={f.feedback_id || i} className="srp-feedback-item">
                          <div className="srp-feedback-head">
                            <span className="srp-feedback-name">{f.reviewer_name || 'Anonymous reviewer'}</span>
                            {f.rating != null && (
                              <span className="srp-feedback-rating" aria-label={`${f.rating} out of 5 stars`}>
                                {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}
                              </span>
                            )}
                            <span className="srp-feedback-date">{formatDate(f.created_at)}</span>
                          </div>
                          <p className="srp-feedback-comment">{f.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
