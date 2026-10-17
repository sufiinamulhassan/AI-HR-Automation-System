import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandLogo from '../../components/BrandLogo'
import LegalLinks from '../../components/LegalLinks'
import { useBrand } from '../../lib/brand'
import { API_V1 } from '../../lib/config'
import RatingForm, { type RatingConfig } from './RatingForm'
import './PublicReviewPage.css'

interface Goal {
  goal_id: string
  owner_id: string
  title: string
  description?: string | null
  due_date?: string | null
  progress_pct: number
  parent_goal_id?: string | null
  status: string
}

interface PublicReview {
  review_id: string
  cycle_id: string
  cycle_name?: string | null
  reviewer_type: 'self' | 'peer' | 'manager' | 'skip_level'
  employee_name?: string | null
  reviewer_name?: string | null
  status: 'pending' | 'submitted'
  ratings: Record<string, number>
  comments?: string | null
  rating_config: RatingConfig
  goals: Goal[] | null
}

type PageStatus = 'loading' | 'ready' | 'error'
type ErrorKind = 'invalid' | 'generic'

async function responseErrorMessage(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json()
    if (typeof body?.detail === 'string' && body.detail.trim()) return body.detail
    if (Array.isArray(body?.detail) && body.detail.length) {
      return body.detail.map((d: unknown) => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d)).join('; ')
    }
  } catch { }
  return fallback
}

function formatDate(d?: string | null): string {
  if (!d) return '-'
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PublicReviewPage() {
  const { token } = useParams<{ token: string }>()
  const brand = useBrand()
  const [status, setStatus] = useState<PageStatus>('loading')
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic')
  const [review, setReview] = useState<PublicReview | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])

  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [goalDrafts, setGoalDrafts] = useState<Record<string, number>>({})
  const [goalBusy, setGoalBusy] = useState<Record<string, boolean>>({})
  const [goalError, setGoalError] = useState<Record<string, string>>({})
  const [goalSaved, setGoalSaved] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!token) return
    fetch(`${API_V1}/performance/public/${token}`)
      .then(r => {
        if (r.status === 404) return Promise.reject('invalid')
        if (!r.ok) return Promise.reject('generic')
        return r.json()
      })
      .then((data: PublicReview) => {
        setReview(data)
        setGoals(data.goals || [])
        setStatus('ready')
      })
      .catch(err => {
        setErrorKind(err === 'invalid' ? 'invalid' : 'generic')
        setStatus('error')
      })
  }, [token])

  useEffect(() => {
    setGoalDrafts(Object.fromEntries(goals.map(g => [g.goal_id, g.progress_pct])))
  }, [goals])

  async function handleSubmit(ratings: Record<string, number>, comments: string) {
    if (!token || submitBusy) return
    setSubmitBusy(true)
    setSubmitError('')
    try {
      const r = await fetch(`${API_V1}/performance/public/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings, comments: comments || undefined }),
      })
      if (r.status === 409) {
        setSubmitError('This review has already been submitted.')
      } else if (!r.ok) {
        setSubmitError(await responseErrorMessage(r, 'Something went wrong submitting your review. Please try again.'))
      } else {
        const updated = await r.json()
        setReview(prev => prev && ({
          ...prev,
          status: updated.status ?? 'submitted',
          ratings: updated.ratings ?? ratings,
          comments: updated.comments ?? comments,
        }))
      }
    } catch {
      setSubmitError('Something went wrong submitting your review. Please try again.')
    }
    setSubmitBusy(false)
  }

  async function handleGoalSave(goalId: string) {
    if (!token) return
    const pct = goalDrafts[goalId]
    setGoalBusy(b => ({ ...b, [goalId]: true }))
    setGoalError(e => ({ ...e, [goalId]: '' }))
    setGoalSaved(s => ({ ...s, [goalId]: false }))
    try {
      const r = await fetch(`${API_V1}/performance/public/${token}/goals/${goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress_pct: pct }),
      })
      if (!r.ok) {
        setGoalError(e => ({ ...e, [goalId]: '' }))
        const msg = await responseErrorMessage(r, 'Failed to update progress.')
        setGoalError(e => ({ ...e, [goalId]: msg }))
      } else {
        const updated: Goal = await r.json()
        setGoals(gs => gs.map(g => g.goal_id === goalId ? updated : g))
        setGoalSaved(s => ({ ...s, [goalId]: true }))
      }
    } catch {
      setGoalError(e => ({ ...e, [goalId]: 'Failed to update progress.' }))
    }
    setGoalBusy(b => ({ ...b, [goalId]: false }))
  }

  return (
    <div className="pr-page">
      <div className="pr-shell">
        <div className="pr-brand">
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
          <div className="pr-card pr-card-center">
            <div className="pr-spinner" />
            <p>Loading your review…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="pr-card pr-card-center">
            <div className="pr-icon pr-icon-error">✕</div>
            {errorKind === 'invalid' ? (
              <>
                <h2>This link isn&rsquo;t valid</h2>
                <p>This review link doesn&rsquo;t match any review we know about. Please check the link or contact HR.</p>
              </>
            ) : (
              <>
                <h2>Something went wrong</h2>
                <p>We couldn&rsquo;t load this review right now. Please try again later.</p>
              </>
            )}
          </div>
        )}

        {status === 'ready' && review && (
          <div className="pr-card">
            <div className="pr-card-header">
              <span className="pr-eyebrow">{review.cycle_name || 'Performance Review'}</span>
              <h2>
                {review.reviewer_type === 'self' && `Self Review: ${review.employee_name || 'You'}`}
                {review.reviewer_type === 'peer' && `Peer Review of ${review.employee_name || 'a colleague'}`}
                {(review.reviewer_type === 'manager' || review.reviewer_type === 'skip_level') &&
                  `Review of ${review.employee_name || 'this employee'}`}
              </h2>
              {review.reviewer_type === 'peer' && review.reviewer_name && (
                <p className="pr-subtext">Signed in as {review.reviewer_name}</p>
              )}
              <span className={`pr-status-badge${review.status === 'submitted' ? ' pr-status-submitted' : ' pr-status-pending'}`}>
                {review.status === 'submitted' ? 'Submitted' : 'Awaiting your response'}
              </span>
            </div>

            <RatingForm
              config={review.rating_config}
              initialRatings={review.ratings}
              initialComments={review.comments}
              readOnly={review.status === 'submitted'}
              submitting={submitBusy}
              error={submitError}
              onSubmit={handleSubmit}
            />

            {review.reviewer_type === 'self' && (
              <div className="pr-goals">
                <h3>Your Goals</h3>
                {goals.length === 0 ? (
                  <p className="pr-goals-empty">No goals have been set for you yet.</p>
                ) : goals.map(g => (
                  <div key={g.goal_id} className="pr-goal-row">
                    <div className="pr-goal-info">
                      <span className="pr-goal-title">{g.title}</span>
                      {g.description && <span className="pr-goal-desc">{g.description}</span>}
                      <span className="pr-goal-meta">Due {formatDate(g.due_date)} · <span className={`badge badge-${g.status === 'completed' ? 'green' : g.status === 'abandoned' ? 'gray' : 'blue'}`}>{g.status}</span></span>
                    </div>
                    <div className="pr-goal-progress">
                      <div className="pr-goal-bar-track">
                        <div className="pr-goal-bar-fill" style={{ width: `${Math.max(0, Math.min(100, g.progress_pct))}%` }} />
                      </div>
                      <div className="pr-goal-progress-controls">
                        <input
                          type="number"
                          className="form-input pr-goal-input"
                          min={0}
                          max={100}
                          aria-label={`Progress for ${g.title}`}
                          value={goalDrafts[g.goal_id] ?? g.progress_pct}
                          onChange={e => {
                            const v = Math.max(0, Math.min(100, Number(e.target.value)))
                            setGoalDrafts(d => ({ ...d, [g.goal_id]: v }))
                            setGoalSaved(s => ({ ...s, [g.goal_id]: false }))
                          }}
                          disabled={goalBusy[g.goal_id]}
                        />
                        <span className="pr-goal-pct-sign">%</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={goalBusy[g.goal_id] || goalDrafts[g.goal_id] === g.progress_pct}
                          onClick={() => handleGoalSave(g.goal_id)}
                        >
                          {goalBusy[g.goal_id] ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      {goalSaved[g.goal_id] && <span className="pr-goal-saved">Saved</span>}
                      {goalError[g.goal_id] && <span className="pr-goal-error">{goalError[g.goal_id]}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <LegalLinks />
      </div>
    </div>
  )
}
