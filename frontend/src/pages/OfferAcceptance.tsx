import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import LegalLinks from '../components/LegalLinks'
import { useBrand } from '../lib/brand'
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
  const brand = useBrand()
  const [status, setStatus]         = useState<Status>('loading')
  const [errorKind, setErrorKind]   = useState<ErrorKind>('generic')
  const [offer, setOffer]           = useState<OfferPublic | null>(null)
  const [showDeclineBox, setShowDeclineBox] = useState(false)
  const [declineReason, setDeclineReason]   = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [typedName, setTypedName] = useState('')
  const [consent, setConsent]     = useState(false)
  const canAccept = typedName.trim().length > 0 && consent

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
    if (!token || actionBusy || !canAccept) return
    setActionBusy(true)
    setActionError('')
    try {
      const r = await fetch(`${API_V1}/offers/public/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typed_name: typedName.trim(), consent: true }),
      })
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
          <BrandLogo>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="7" r="4" stroke="var(--primary)" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BrandLogo>
          {brand.name}
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
            <p>You've accepted this offer. The hiring team will be in touch with next steps.</p>
          </div>
        )}

        {status === 'declined' && (
          <div className="offer-card offer-card-center">
            <div className="offer-icon offer-icon-neutral">i</div>
            <h2>Response Recorded</h2>
            <p>Thank you. You've declined this offer. We appreciate you letting us know.</p>
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
              <>
                <div className="offer-sign-box">
                  <label className="offer-sign-label" htmlFor="typed-name">
                    Type your full name to sign *
                  </label>
                  <input
                    id="typed-name"
                    className="offer-sign-input"
                    type="text"
                    value={typedName}
                    onChange={e => setTypedName(e.target.value)}
                    placeholder="Full legal name"
                    disabled={actionBusy}
                  />
                  <label className="offer-consent-row">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                      disabled={actionBusy}
                    />
                    <span>
                      I have read and agree to the terms of this offer, and I am electronically
                      signing this document.
                    </span>
                  </label>
                </div>

                <div className="offer-actions">
                  <button className="offer-btn offer-btn-decline" onClick={() => setShowDeclineBox(true)} disabled={actionBusy}>
                    Decline
                  </button>
                  <button
                    className="offer-btn offer-btn-accept"
                    onClick={handleAccept}
                    disabled={actionBusy || !canAccept}
                    title={!canAccept ? 'Type your full name and confirm consent to sign' : undefined}
                  >
                    {actionBusy ? 'Submitting…' : 'Accept & Sign'}
                  </button>
                </div>
              </>
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
        <LegalLinks />
      </div>
    </div>
  )
}
