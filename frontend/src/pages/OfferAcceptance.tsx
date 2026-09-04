import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_V1 } from '../lib/config'
import './OfferAcceptance.css'

interface OfferPublic {
  job_title: string
  company_name: string
  salary: string
  benefits?: string
  joining_date?: string
  status: string
}

type Status = 'loading' | 'ready' | 'accepted' | 'declined' | 'error'
type ErrorKind = 'invalid' | 'inactive' | 'generic'

export default function OfferAcceptance() {
  const { token } = useParams<{ token: string }>()
  const [status, setStatus]         = useState<Status>('loading')
  const [errorKind, setErrorKind]   = useState<ErrorKind>('generic')
  const [offer, setOffer]           = useState<OfferPublic | null>(null)
  const [showDeclineBox, setShowDeclineBox] = useState(false)
  const [declineReason, setDeclineReason]   = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`${API_V1}/offers/public/${token}`)
      .then(r => {
        if (r.status === 404) return Promise.reject('invalid')
        if (r.status === 410) return Promise.reject('inactive')
        if (!r.ok) return Promise.reject('generic')
        return r.json()
      })
      .then(data => {
        setOffer(data)
        setStatus('ready')
      })
      .catch(err => {
        setErrorKind(err === 'invalid' || err === 'inactive' ? err : 'generic')
        setStatus('error')
      })
  }, [token])

  async function handleAccept() {
    if (!token || actionBusy) return
    setActionBusy(true)
    setActionError('')
    try {
      const r = await fetch(`${API_V1}/offers/public/${token}/accept`, { method: 'POST' })
      if (!r.ok) throw new Error()
      setStatus('accepted')
    } catch {
      setActionError('Something went wrong recording your response. Please try again.')
    }
    setActionBusy(false)
  }

  async function handleDecline() {
    if (!token || actionBusy) return
    setActionBusy(true)
    setActionError('')
    try {
      const r = await fetch(`${API_V1}/offers/public/${token}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() || undefined }),
      })
      if (!r.ok) throw new Error()
      setStatus('declined')
    } catch {
      setActionError('Something went wrong recording your response. Please try again.')
    }
    setActionBusy(false)
  }

  function formatDate(d?: string) {
    if (!d) return '-'
    const parsed = new Date(d)
    if (isNaN(parsed.getTime())) return d
    return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  return (
    <div className="offer-page">
      <div className="offer-shell">
        <div className="offer-brand">
          <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 14C22.2091 14 24 12.2091 24 10C24 7.79086 22.2091 6 20 6C17.7909 6 16 7.79086 16 10C16 12.2091 17.7909 14 20 14Z" fill="#4778f3" />
            <path d="M20 16C14.4772 16 10 20.4772 10 26C10 31.5228 14.4772 36 20 36C25.5228 36 30 31.5228 30 26C30 24 29.2 22.2 27.8 20.8L25.8 22.8C26.5 23.7 27 24.8 27 26C27 29.866 23.866 33 20 33C16.134 33 13 29.866 13 26C13 22.134 16.134 19 20 19C21.2 19 22.3 19.3 23.2 19.9L25.2 17.9C23.7 16.7 21.9 16 20 16Z" fill="#4778f3" />
          </svg>
          Hirely.ai
        </div>

        {status === 'loading' && (
          <div className="offer-card offer-card-center">
            <div className="offer-spinner" />
            <p>Loading your offer…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="offer-card offer-card-center">
            <div className="offer-icon offer-icon-error">✕</div>
            {errorKind === 'invalid' && (
              <>
                <h2>Invalid Link</h2>
                <p>This offer link doesn't match any active offer. Please check the link or contact the hiring team.</p>
              </>
            )}
            {errorKind === 'inactive' && (
              <>
                <h2>Offer No Longer Active</h2>
                <p>This offer has already been responded to, or is no longer available for response.</p>
              </>
            )}
            {errorKind === 'generic' && (
              <>
                <h2>Link Not Available</h2>
                <p>This offer link is no longer active. Please contact the hiring team if you believe this is a mistake.</p>
              </>
            )}
          </div>
        )}

        {status === 'accepted' && (
          <div className="offer-card offer-card-center">
            <div className="offer-icon offer-icon-success">✓</div>
            <h2>Offer Accepted</h2>
            <p>You've accepted this offer - the hiring team will be in touch with next steps.</p>
          </div>
        )}

        {status === 'declined' && (
          <div className="offer-card offer-card-center">
            <div className="offer-icon offer-icon-neutral">i</div>
            <h2>Response Recorded</h2>
            <p>Thank you - you've declined this offer. We appreciate you letting us know.</p>
          </div>
        )}

        {status === 'ready' && offer && (
          <div className="offer-card">
            <div className="offer-card-header">
              <span className="badge-sent">Offer Letter</span>
              <h2>{offer.job_title}</h2>
              <p className="offer-company">{offer.company_name}</p>
            </div>

            <div className="offer-details">
              <div className="offer-detail-row">
                <span className="offer-detail-label">Job Title</span>
                <span className="offer-detail-value">{offer.job_title}</span>
              </div>
              <div className="offer-detail-row">
                <span className="offer-detail-label">Company</span>
                <span className="offer-detail-value">{offer.company_name}</span>
              </div>
              <div className="offer-detail-row">
                <span className="offer-detail-label">Salary</span>
                <span className="offer-detail-value">{offer.salary}</span>
              </div>
              <div className="offer-detail-row">
                <span className="offer-detail-label">Benefits</span>
                <span className="offer-detail-value">{offer.benefits || '-'}</span>
              </div>
              <div className="offer-detail-row">
                <span className="offer-detail-label">Joining Date</span>
                <span className="offer-detail-value">{formatDate(offer.joining_date)}</span>
              </div>
            </div>

            {actionError && <div className="offer-action-error">{actionError}</div>}

            {!showDeclineBox ? (
              <div className="offer-actions">
                <button className="offer-btn offer-btn-decline" onClick={() => setShowDeclineBox(true)} disabled={actionBusy}>
                  Decline
                </button>
                <button className="offer-btn offer-btn-accept" onClick={handleAccept} disabled={actionBusy}>
                  {actionBusy ? 'Submitting…' : 'Accept Offer'}
                </button>
              </div>
            ) : (
              <div className="offer-decline-box">
                <label className="offer-decline-label" htmlFor="decline-reason">
                  Reason for declining (optional)
                </label>
                <textarea
                  id="decline-reason"
                  className="offer-decline-textarea"
                  rows={3}
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Let us know why, if you'd like…"
                />
                <div className="offer-actions">
                  <button
                    className="offer-btn offer-btn-ghost"
                    onClick={() => { setShowDeclineBox(false); setDeclineReason('') }}
                    disabled={actionBusy}
                  >
                    Back
                  </button>
                  <button className="offer-btn offer-btn-decline-confirm" onClick={handleDecline} disabled={actionBusy}>
                    {actionBusy ? 'Submitting…' : 'Confirm Decline'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
