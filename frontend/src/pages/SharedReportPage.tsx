import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import LegalLinks from '../components/LegalLinks'
import { useBrand } from '../lib/brand'
import { API_V1 } from '../lib/config'
import './SharedReportPage.css'

interface Dimension {
  key: string
  label: string
  score: number
  weight: number
  rationale: string
}

interface ScenarioScore {
  key: string
  label: string
  value: number
}

interface IntegrityEvent {
  event: string
  count: number
}

interface Integrity {
  score: number | null
  assessment: string
  multiplier: number | null
  events: IntegrityEvent[]
}

interface Feedback {
  reviewer_name: string | null
  rating: number | null
  comment: string
  created_at: string
}

interface SharedReport {
  candidate_name: string
  job_title: string
  interview_date: string | null
  evaluation_status: string | null
  overall_score: number | null
  final_score: number | null
  recommendation: string | null
  summary: string
  strengths: string[]
  areas_for_improvement: string[]
  dimensions: Dimension[]
  scenario_scores: ScenarioScore[]
  coding_score: number | null
  coding_quality_score: number | null
  integrity: Integrity
  view_count: number
  feedback: Feedback[]
}

type PageStatus = 'loading' | 'ready' | 'error'
type ErrorKind = 'invalid' | 'expired' | 'generic'

function formatDate(d?: string | null): string {
  if (!d) return '-'
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function StarPicker({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div className="shr-stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`shr-star${value != null && n <= value ? ' shr-star-filled' : ''}`}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const brand = useBrand()
  const [status, setStatus] = useState<PageStatus>('loading')
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic')
  const [report, setReport] = useState<SharedReport | null>(null)

  const [reviewerName, setReviewerName] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`${API_V1}/interview/shared-report/${token}`)
      .then(r => {
        if (r.status === 404) return Promise.reject('invalid')
        if (r.status === 410) return Promise.reject('expired')
        if (!r.ok) return Promise.reject('generic')
        return r.json()
      })
      .then((data: SharedReport) => {
        setReport(data)
        setStatus('ready')
      })
      .catch(err => {
        setErrorKind(err === 'invalid' || err === 'expired' ? err : 'generic')
        setStatus('error')
      })
  }, [token])

  async function handleSubmitFeedback(e: React.FormEvent) {
    e.preventDefault()
    if (!token || submitBusy) return
    if (!comment.trim()) {
      setSubmitError('Please enter a comment before submitting.')
      return
    }
    setSubmitBusy(true)
    setSubmitError('')
    try {
      const r = await fetch(`${API_V1}/interview/shared-report/${token}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewer_name: reviewerName.trim() || null,
          rating,
          comment: comment.trim(),
        }),
      })
      if (r.status === 404) throw new Error('invalid')
      if (r.status === 410) throw new Error('expired')
      if (!r.ok) throw new Error('generic')
      setSubmitted(true)
    } catch (err) {
      if (err instanceof Error && err.message === 'expired') {
        setSubmitError('This share link has expired, so feedback can no longer be recorded.')
      } else {
        setSubmitError('Something went wrong submitting your feedback. Please try again.')
      }
    }
    setSubmitBusy(false)
  }

  return (
    <div className="shr-page">
      <div className="shr-shell">
        <div className="shr-brand">
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
          <div className="shr-card shr-card-center">
            <div className="shr-spinner" />
            <p>Loading report…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="shr-card shr-card-center">
            <div className="shr-icon shr-icon-error">✕</div>
            {errorKind === 'invalid' && (
              <>
                <h2>This link isn&rsquo;t valid</h2>
                <p>This share link doesn&rsquo;t match any report we know about. Please check the link or contact whoever sent it.</p>
              </>
            )}
            {errorKind === 'expired' && (
              <>
                <h2>This link has expired</h2>
                <p>This share link is no longer active. Ask the hiring team to send a new one if you still need access.</p>
              </>
            )}
            {errorKind === 'generic' && (
              <>
                <h2>Something went wrong</h2>
                <p>We couldn&rsquo;t load this report right now. Please try again later.</p>
              </>
            )}
          </div>
        )}

        {status === 'ready' && report && (
          <div className="shr-card">
            <div className="shr-card-header">
              <span className="shr-eyebrow">Interview Report</span>
              <h2>{report.candidate_name}</h2>
              {report.job_title && <p className="shr-subtext">{report.job_title}</p>}
              <div className="shr-meta-row">
                {report.interview_date && <span>Interviewed {formatDate(report.interview_date)}</span>}
                <span>{report.view_count} view{report.view_count === 1 ? '' : 's'}</span>
              </div>
            </div>

            {report.evaluation_status === 'insufficient_transcript' && (
              <div className="shr-warning">
                No answer content was captured for this interview, so the general score
                dimensions could not be derived. Integrity scoring is computed separately
                and remains valid.
              </div>
            )}

            <div className="shr-score-grid">
              {report.overall_score != null && (
                <div className="shr-score-tile">
                  <div className="shr-score-num">{report.overall_score}</div>
                  <div className="shr-score-label">Overall</div>
                </div>
              )}
              {report.final_score != null && (
                <div className="shr-score-tile shr-score-tile-final">
                  <div className="shr-score-num">{report.final_score}</div>
                  <div className="shr-score-label">Final Score</div>
                </div>
              )}
              {report.coding_score != null && (
                <div className="shr-score-tile">
                  <div className="shr-score-num">{report.coding_score}</div>
                  <div className="shr-score-label">Coding (tests)</div>
                </div>
              )}
              {report.coding_quality_score != null && (
                <div className="shr-score-tile">
                  <div className="shr-score-num">{report.coding_quality_score}</div>
                  <div className="shr-score-label">Coding (quality)</div>
                </div>
              )}
              {report.recommendation && (
                <div className={`shr-rec-tile shr-rec-${report.recommendation}`}>
                  <div className="shr-rec-val">{report.recommendation.toUpperCase()}</div>
                  <div className="shr-rec-label">Recommendation</div>
                </div>
              )}
            </div>

            {!!report.dimensions.length && (
              <div className="shr-section">
                <h3>Score Breakdown</h3>
                <div className="shr-dim-list">
                  {report.dimensions.map(d => (
                    <div key={d.key} className="shr-dim-item">
                      <div className="shr-dim-head">
                        <span className="shr-dim-label">{d.label}</span>
                        <span className="shr-dim-score">{d.score}{d.weight != null ? ` · ×${d.weight} weight` : ''}</span>
                      </div>
                      {d.rationale && <p className="shr-dim-rationale">{d.rationale}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!!report.scenario_scores.length && (
              <div className="shr-section">
                <h3>Scenario Scores</h3>
                <div className="shr-score-grid">
                  {report.scenario_scores.map(s => (
                    <div key={s.key} className="shr-score-tile">
                      <div className="shr-score-num">{s.value}</div>
                      <div className="shr-score-label">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.summary && (
              <div className="shr-section">
                <h3>Summary</h3>
                <p className="shr-summary">{report.summary}</p>
              </div>
            )}

            {(!!report.strengths.length || !!report.areas_for_improvement.length) && (
              <div className="shr-lists">
                {!!report.strengths.length && (
                  <div>
                    <h4>Strengths</h4>
                    <ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {!!report.areas_for_improvement.length && (
                  <div>
                    <h4>Areas for Improvement</h4>
                    <ul>{report.areas_for_improvement.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {(report.integrity?.assessment || report.integrity?.score != null || !!report.integrity?.events?.length) && (
              <div className="shr-section shr-integrity">
                <h3>Integrity</h3>
                {report.integrity.score != null && (
                  <p className="shr-integrity-score">
                    Score: <strong>{report.integrity.score}</strong>
                    {report.integrity.multiplier != null && ` (×${report.integrity.multiplier} multiplier)`}
                  </p>
                )}
                {report.integrity.assessment && <p className="shr-integrity-assessment">{report.integrity.assessment}</p>}
                {!!report.integrity.events.length && (
                  <ul className="shr-integrity-events">
                    {report.integrity.events.map(ev => (
                      <li key={ev.event}>{ev.event.replace(/_/g, ' ')} × {ev.count}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!!report.feedback.length && (
              <div className="shr-section">
                <h3>Feedback</h3>
                <div className="shr-feedback-list">
                  {report.feedback.map((f, i) => (
                    <div key={i} className="shr-feedback-item">
                      <div className="shr-feedback-head">
                        <span className="shr-feedback-name">{f.reviewer_name || 'Anonymous reviewer'}</span>
                        {f.rating != null && (
                          <span className="shr-feedback-rating" aria-label={`${f.rating} out of 5 stars`}>
                            {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}
                          </span>
                        )}
                      </div>
                      <p>{f.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="shr-section shr-feedback-form-section">
              <h3>Leave Feedback</h3>
              {submitted ? (
                <p className="shr-feedback-thanks">Thank you. Your feedback has been recorded.</p>
              ) : (
                <form className="shr-feedback-form" onSubmit={handleSubmitFeedback}>
                  <label className="shr-field">
                    <span className="form-label">Your name (optional)</span>
                    <input
                      className="form-input"
                      type="text"
                      value={reviewerName}
                      disabled={submitBusy}
                      onChange={e => setReviewerName(e.target.value)}
                      placeholder="Jane Doe"
                    />
                  </label>
                  <label className="shr-field">
                    <span className="form-label">Rating (optional)</span>
                    <StarPicker value={rating} onChange={setRating} disabled={submitBusy} />
                  </label>
                  <label className="shr-field">
                    <span className="form-label">Comment *</span>
                    <textarea
                      className="form-input"
                      rows={4}
                      value={comment}
                      disabled={submitBusy}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Share your thoughts on this candidate"
                    />
                  </label>
                  {submitError && <div className="shr-feedback-error">{submitError}</div>}
                  <button type="submit" className="btn btn-primary" disabled={submitBusy || !comment.trim()}>
                    {submitBusy ? 'Submitting…' : 'Submit Feedback'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
        <LegalLinks />
      </div>
    </div>
  )
}
