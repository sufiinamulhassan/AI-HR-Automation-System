import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from 'react'
import {
  candidatesApi,
  type DraftSummaryInput,
  type ExternalReviewDetail,
  type ExternalReviewInput,
  type ExternalReviewResult,
  type InterviewGuide,
  type Scorecard,
} from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import {
  DIMENSIONS, RATING_SCALE, RECOMMENDATIONS, describeMeetingChange, dimensionLabel, errorDetail, formatWhen,
  roleLabel, storedOverallOutOf100, storedRating,
} from './externalInterview'
import ScorecardForm, { scorecardToInitial, type ScorecardSubmission } from './ScorecardForm'
import { clearScorecardDraft, scorecardDraftKey } from './scorecardDraft'
import { useDialog } from './useDialog'
import './ExternalReviewModal.css'

interface Props {
  candidateId: string
  candidateName: string
  platformLabel?: string | null
  scheduledAt?: string | null
  mode: 'edit' | 'view'
  onClose: () => void
  onSaved?: (result: ExternalReviewResult) => void
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const MAX_DETAIL = 2000
const LOAD_ISSUE = 'Could not load the interview questions.'
const GUIDE_ISSUE = 'Could not prepare the interview questions.'
const SOURCE_LABEL: Record<Scorecard['source'], string> = { hr: 'In app', link: 'Shared link' }

interface EditorProps {
  candidateId: string
  draftKey: string
  dirtyRef: MutableRefObject<boolean>
  onCancel: () => void
  onSaved?: (result: ExternalReviewResult) => void
}

function ScorecardEditor({ candidateId, draftKey, dirtyRef, onCancel, onSaved }: EditorProps) {
  const uid = useId()
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const [attended, setAttended] = useState(true)
  const [note, setNote] = useState('')
  const [formDirty, setFormDirty] = useState(false)
  const [noShowSaving, setNoShowSaving] = useState(false)
  const [noShowError, setNoShowError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [phase, setPhase] = useState<'loading' | 'generating' | 'ready'>('loading')
  const [guide, setGuide] = useState<InterviewGuide | null>(null)
  const [scorecards, setScorecards] = useState<Scorecard[]>([])
  const [issue, setIssue] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let current = true
    const first = attempt === 0
    if (!first) setWorking(true)
    setIssue('')
    ;(async () => {
      let found: InterviewGuide | null = null
      try {
        const r = await candidatesApi.getExternalReview(candidateId)
        if (!current) return
        setScorecards(r.data.scorecards ?? [])
        found = r.data.interview_guide ?? null
      } catch {
        if (!current) return
        setIssue(LOAD_ISSUE); setPhase('ready'); setWorking(false)
        return
      }
      if (!found) {
        if (first) setPhase('generating')
        try {
          found = (await candidatesApi.generateInterviewGuide(candidateId)).data
        } catch (e) {
          if (!current) return
          setIssue(errorDetail(e) || GUIDE_ISSUE)
        }
      }
      if (!current) return
      setGuide(found); setPhase('ready'); setWorking(false)
    })()
    return () => { current = false }
  }, [candidateId, attempt])

  const dirty = formDirty || note !== ''
  useEffect(() => { dirtyRef.current = dirty }, [dirty, dirtyRef])

  async function regenerate() {
    if (working || scorecards.length > 0) return
    if (dirtyRef.current && !confirm('Regenerate the questions? Marks entered for the current questions will be lost.')) return
    setWorking(true)
    setIssue('')
    try {
      setGuide((await candidatesApi.generateInterviewGuide(candidateId, true)).data)
    } catch (e) {
      setIssue(errorDetail(e) || 'Could not regenerate the questions.')
    } finally {
      setWorking(false)
    }
  }

  async function submit(card: ScorecardSubmission) {
    setSaving(true)
    setError('')
    const body: ExternalReviewInput = { attended: true, ...card }
    try {
      const r = await candidatesApi.submitExternalReview(candidateId, body)
      clearScorecardDraft(draftKey)
      onSaved?.(r.data)
    } catch (err) {
      setError(errorDetail(err) || 'Could not save the scorecard. Please try again')
    } finally {
      setSaving(false)
    }
  }

  async function submitNoShow(e: FormEvent) {
    e.preventDefault()
    if (noShowSaving) return
    setNoShowSaving(true)
    setNoShowError('')
    try {
      const r = await candidatesApi.submitExternalReview(candidateId, { attended: false, summary: note.trim() || undefined })
      clearScorecardDraft(draftKey)
      onSaved?.(r.data)
    } catch (err) {
      setNoShowError(errorDetail(err) || 'Could not save the scorecard. Please try again')
    } finally {
      setNoShowSaving(false)
    }
  }

  const draftSummary = useCallback(
    (input: DraftSummaryInput) => candidatesApi.draftReviewSummary(candidateId, input).then(r => r.data.summary),
    [candidateId],
  )

  const linkCards = scorecards.filter(s => s.source === 'link')
  const mine = scorecards.find(s => s.source === 'hr')
  const initial = scorecardToInitial(mine, { name: user?.name || user?.email || '', role: 'hr' })
  const locked = scorecards.length > 0

  return (
    <>
      <div className="erm-body erm-attend">
        <fieldset className="erm-fieldset">
          <legend className="form-label">Did the interview take place?</legend>
          <div className="erm-choices">
            <label className="erm-choice">
              <input type="radio" name={`${uid}-attended`} checked={attended} onChange={() => setAttended(true)} />
              <span>Yes</span>
            </label>
            <label className="erm-choice">
              <input type="radio" name={`${uid}-attended`} checked={!attended} onChange={() => setAttended(false)} />
              <span>The candidate did not attend</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div hidden={!attended}>
        {phase !== 'ready' ? (
          <div className="erm-body">
            <div className="erm-status" role="status">
              {phase === 'generating' ? 'Writing interview questions from the CV and job description…' : 'Loading…'}
            </div>
          </div>
        ) : (
          <>
            <div className="erm-body erm-guide-area">
              <div className="erm-guide-bar">
                <span className="erm-guide-count">
                  {guide ? `${guide.questions.length} interview question${guide.questions.length === 1 ? '' : 's'}` : 'No interview questions'}
                </span>
                {guide && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={working || locked}
                    title={locked ? 'The questions are fixed once a scorecard exists' : undefined}
                    onClick={regenerate}
                  >
                    {working ? 'Working…' : 'Regenerate'}
                  </button>
                )}
              </div>
              {issue && (
                <div className="erm-error" role="alert">
                  <span>{issue}</span>
                  <button type="button" className="erm-link-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button>
                </div>
              )}
              {linkCards.length > 0 && (
                <section className="erm-panel" aria-label="Other interviewers">
                  <h3 className="erm-read-title">Other interviewers ({linkCards.length})</h3>
                  <ul className="erm-panel-list">
                    {linkCards.map(c => {
                      const rec = RECOMMENDATIONS.find(r => r.value === c.recommendation)
                      return (
                        <li key={c.scorecard_id}>
                          <span className="erm-panel-name">{c.interviewer_name || 'Interviewer'}</span>
                          {c.interviewer_role && <span className="erm-panel-role">{roleLabel(c.interviewer_role)}</span>}
                          {rec && <span className={`badge ${rec.tone}`}>{rec.label}</span>}
                          {c.submitted_at && <span className="erm-panel-when">{formatWhen(c.submitted_at)}</span>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </div>
            <ScorecardForm
              variant="admin"
              questions={guide?.questions ?? []}
              fallback={guide?.fallback}
              initial={initial}
              draftKey={draftKey}
              saved={!!mine}
              submitLabel="Submit scorecard"
              saving={saving}
              error={error}
              footerClassName="modal-footer"
              onSubmit={submit}
              onCancel={onCancel}
              onDirtyChange={setFormDirty}
              onDraftSummary={draftSummary}
            />
          </>
        )}
      </div>

      <form hidden={attended} onSubmit={submitNoShow} noValidate>
        <div className="erm-body">
          <p className="erm-callout">
            Recording a no-show does not unlock Hire or Send offer. Afterwards you can change the
            time or link to reschedule, or reject the candidate.
          </p>
          <div className="erm-field">
            <label className="form-label" htmlFor={`${uid}-note`}>Note (optional)</label>
            <textarea
              id={`${uid}-note`}
              className="form-input erm-textarea"
              rows={3}
              maxLength={MAX_DETAIL}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
          {noShowError && <div className="erm-error" role="alert">{noShowError}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={noShowSaving}>
            {noShowSaving ? 'Saving…' : 'Record no-show'}
          </button>
        </div>
      </form>
    </>
  )
}

type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ExternalReviewDetail }

function ScorecardView({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    candidatesApi.getExternalReview(candidateId)
      .then(r => { if (current) setState({ status: 'ready', data: r.data }) })
      .catch(() => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [candidateId, attempt])

  const review = state.status === 'ready' ? state.data.external_review : null
  const scorecards = state.status === 'ready' ? (state.data.scorecards ?? []) : []
  const history = useMemo(() => {
    const entries = state.status === 'ready' ? state.data.external_interview?.history ?? [] : []
    const time = (at: string) => { const t = new Date(at).getTime(); return Number.isNaN(t) ? 0 : t }
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => time(b.entry.at) - time(a.entry.at) || b.index - a.index).map(e => e.entry)
  }, [state])
  const recommendation = RECOMMENDATIONS.find(r => r.value === review?.recommendation)
  const overall = storedOverallOutOf100(review?.overall)
  const rows = DIMENSIONS
    .map(d => ({ ...d, score: storedRating(review?.ratings, d.key) }))
    .filter(d => d.score !== undefined)

  return (
    <>
      <div className="erm-body">
        {state.status === 'loading' && <div className="erm-status" role="status">Loading scorecard…</div>}

        {state.status === 'error' && (
          <div className="erm-error" role="alert">
            <span>Could not load the scorecard.</span>
            <button type="button" className="erm-link-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button>
          </div>
        )}

        {state.status === 'ready' && !review && scorecards.length === 0 && <p className="erm-empty">No scorecard yet</p>}

        {review && review.attended === false && (
          <>
            <p className="erm-callout">The candidate did not attend.</p>
            {review.summary && <ReadBlock title="Note" text={review.summary} />}
          </>
        )}

        {review && review.attended !== false && (
          <>
            <dl className="erm-ratings-view">
              {rows.map(d => (
                <div className="erm-rating-view" key={d.key}>
                  <dt>{d.label}</dt>
                  <dd>
                    <span className="erm-meter" aria-hidden="true">
                      <i style={{ width: `${((d.score ?? 0) / RATING_SCALE.length) * 100}%` }} />
                    </span>
                    <span>{`${d.score} / 5`}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="erm-summary-row">
              <div className="erm-overall">
                <span>Overall</span>
                <strong>{overall === null ? '-' : overall}</strong>
                <span className="erm-overall-of">/ 100</span>
              </div>
              {recommendation && <span className={`badge ${recommendation.tone}`}>{recommendation.label}</span>}
            </div>

            {review.summary && <ReadBlock title="Summary" text={review.summary} />}
            {review.strengths && <ReadBlock title="Strengths" text={review.strengths} />}
            {review.concerns && <ReadBlock title="Concerns" text={review.concerns} />}

            <p className="erm-meta">
              {review.interviewed_at && <>Interview held {formatWhen(review.interviewed_at)}. </>}
              {review.reviewed_by && <>Reviewed by {review.reviewed_by}</>}
              {review.reviewed_at && <>{review.reviewed_by ? ' on ' : 'Reviewed '}{formatWhen(review.reviewed_at)}</>}
            </p>
          </>
        )}

        {scorecards.length > 0 && (
          <section className="erm-cards" aria-label="Scorecards">
            <h3 className="erm-read-title">Scorecards ({scorecards.length})</h3>
            {scorecards.map(c => <ScorecardCard key={c.scorecard_id} card={c} open={scorecards.length === 1} />)}
          </section>
        )}

        {history.length > 0 && (
          <section className="erm-history" aria-label="Meeting changes">
            <h3 className="erm-read-title">Meeting changes ({history.length})</h3>
            <ul className="erm-history-list">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="erm-history-item">
                  <p className="erm-history-head">
                    <span className="erm-history-when">{formatWhen(h.at) || h.at}</span>
                    {h.by && <span className="erm-history-by">{h.by}</span>}
                  </p>
                  <ul className="erm-history-changes">
                    {Object.entries(h.changes ?? {}).map(([field, change]) => (
                      <li key={field}>{describeMeetingChange(field, change)}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </>
  )
}

function ScorecardCard({ card, open }: { card: Scorecard; open: boolean }) {
  const rec = RECOMMENDATIONS.find(r => r.value === card.recommendation)
  const who = [roleLabel(card.interviewer_role), SOURCE_LABEL[card.source]].filter(Boolean).join(' · ')
  const rated = DIMENSIONS
    .map(d => ({ ...d, score: storedRating(card.ratings, d.key) }))
    .filter(d => d.score !== undefined)
  return (
    <details className="erm-card" open={open}>
      <summary className="erm-card-head">
        <span className="erm-card-name">{card.interviewer_name || 'Interviewer'}</span>
        <span className="erm-card-meta">{who}</span>
        {rec && <span className={`badge ${rec.tone}`}>{rec.label}</span>}
      </summary>
      <div className="erm-card-body">
        {rated.length > 0 && (
          <ul className="erm-chips" aria-label="Ratings">
            {rated.map(d => <li key={d.key}>{d.label} {d.score} / 5</li>)}
          </ul>
        )}
        {card.questions.length > 0 && (
          <ul className="erm-qlist" aria-label="Questions">
            {card.questions.map(q => (
              <li key={q.question_id} className="erm-qitem">
                <p className="erm-qtext">{q.text}</p>
                <p className="erm-qmeta">
                  <span>{dimensionLabel(q.dimension)}</span>
                  <strong>{typeof q.rating === 'number' ? `${q.rating} / 5` : 'Not asked'}</strong>
                </p>
                {q.notes && <p className="erm-qnotes">{q.notes}</p>}
              </li>
            ))}
          </ul>
        )}
        {card.summary && <ReadBlock title="Summary" text={card.summary} />}
        {card.strengths && <ReadBlock title="Strengths" text={card.strengths} />}
        {card.concerns && <ReadBlock title="Concerns" text={card.concerns} />}
        {card.submitted_at && <p className="erm-meta">Submitted {formatWhen(card.submitted_at)}</p>}
      </div>
    </details>
  )
}

function ReadBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="erm-read">
      <h3 className="erm-read-title">{title}</h3>
      <p className="erm-read-text">{text}</p>
    </div>
  )
}

export default function ExternalReviewModal({ candidateId, candidateName, platformLabel, scheduledAt, mode, onClose, onSaved }: Props) {
  const titleId = useId()
  const dirtyRef = useRef(false)
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const draftKey = scorecardDraftKey('candidate', candidateId, user?.email)

  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      if (!confirm('Discard this scorecard? What you entered will be lost.')) return
      clearScorecardDraft(draftKey)
    }
    onClose()
  }, [onClose, draftKey])

  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)

  const subtitle = [candidateName, platformLabel, formatWhen(scheduledAt)].filter(Boolean).join(' · ')

  return (
    <div className="modal-overlay" data-testid="review-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box erm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header erm-header">
          <div className="erm-header-text">
            <h2 id={titleId}>{mode === 'edit' ? 'Add scorecard' : 'Scorecard'}</h2>
            {subtitle && <p className="erm-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close scorecard" onClick={requestClose}>
            <CloseIcon />
          </button>
        </div>

        {mode === 'edit'
          ? <ScorecardEditor candidateId={candidateId} draftKey={draftKey} dirtyRef={dirtyRef} onCancel={requestClose} onSaved={onSaved} />
          : <ScorecardView candidateId={candidateId} onClose={onClose} />}
      </div>
    </div>
  )
}
