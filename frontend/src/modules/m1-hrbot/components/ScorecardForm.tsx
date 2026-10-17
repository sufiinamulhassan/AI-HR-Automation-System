import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import type {
  CandidateHighlights, DraftSummaryInput, ExternalRatings, ExternalRecommendation, GuideQuestion,
  InterviewerRole, QuestionMark, Scorecard,
} from '../../../lib/api'
import {
  DIMENSIONS, GENERIC_GUIDE_NOTE, INTERVIEWER_ROLES, RATING_LABELS, RATING_SCALE, RECOMMENDATIONS,
  errorDetail, mean, overallOutOf100, storedRating,
} from './externalInterview'
import {
  SCORECARD_LIMITS, clearScorecardDraft, loadScorecardDraft, saveScorecardDraft, type ScorecardDraft,
} from './scorecardDraft'
import './ScorecardForm.css'

export interface QuestionEntry { rating: number | null; notes: string }

export interface ScorecardInitial {
  interviewerName?: string
  interviewerRole?: InterviewerRole | ''
  marks?: Record<string, QuestionEntry>
  ratings?: Partial<ExternalRatings>
  recommendation?: ExternalRecommendation | ''
  summary?: string
  strengths?: string
  concerns?: string
}

export interface ScorecardSubmission {
  interviewer_name?: string
  interviewer_role: InterviewerRole
  questions: QuestionMark[]
  ratings: ExternalRatings
  recommendation: ExternalRecommendation
  summary: string
  strengths?: string
  concerns?: string
}

interface Props {
  variant: 'admin' | 'public'
  questions: GuideQuestion[]
  fallback?: boolean
  highlights?: CandidateHighlights | null
  initial?: ScorecardInitial
  submitLabel: string
  saving?: boolean
  error?: string
  onSubmit: (scorecard: ScorecardSubmission) => void
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
  onDraftSummary?: (input: DraftSummaryInput) => Promise<string>
  footerClassName?: string
  draftKey?: string
  saved?: boolean
}

const MIN_SUMMARY = 20
const MAX_SUMMARY = SCORECARD_LIMITS.summary
const MAX_DETAIL = SCORECARD_LIMITS.detail
const MAX_NOTES = SCORECARD_LIMITS.notes
const MAX_NAME = SCORECARD_LIMITS.name

function draftFrom(initial?: ScorecardInitial): ScorecardDraft {
  return {
    name: initial?.interviewerName ?? '',
    role: initial?.interviewerRole ?? '',
    marks: initial?.marks ?? {},
    ratings: initial?.ratings ?? {},
    recommendation: initial?.recommendation ?? '',
    summary: initial?.summary ?? '',
    strengths: initial?.strengths ?? '',
    concerns: initial?.concerns ?? '',
  }
}

function snapshotOf(d: ScorecardDraft): string {
  return JSON.stringify([
    d.name, d.role, d.ratings, d.recommendation, d.summary, d.strengths, d.concerns,
    Object.entries(d.marks).filter(([, m]) => m.rating !== null || m.notes !== '').sort(([a], [b]) => a.localeCompare(b)),
  ])
}

export function scorecardToInitial(
  sc: Scorecard | null | undefined,
  fallback: { name?: string; role?: InterviewerRole | '' } = {},
): ScorecardInitial {
  const ratings: Partial<ExternalRatings> = {}
  for (const d of DIMENSIONS) {
    const v = storedRating(sc?.ratings, d.key)
    if (v !== undefined) ratings[d.key] = v
  }
  const marks: Record<string, QuestionEntry> = {}
  for (const q of sc?.questions ?? []) marks[q.question_id] = { rating: q.rating ?? null, notes: q.notes ?? '' }
  return {
    interviewerName: sc?.interviewer_name || fallback.name || '',
    interviewerRole: sc?.interviewer_role || fallback.role || '',
    marks,
    ratings,
    recommendation: sc?.recommendation ?? '',
    summary: sc?.summary ?? '',
    strengths: sc?.strengths ?? '',
    concerns: sc?.concerns ?? '',
  }
}

const NO_ENTRY: QuestionEntry = { rating: null, notes: '' }

export default function ScorecardForm({
  variant, questions, fallback, highlights, initial, submitLabel, saving = false, error,
  onSubmit, onCancel, onDirtyChange, onDraftSummary, footerClassName = 'scf-footer', draftKey, saved = false,
}: Props) {
  const uid = useId()
  const isAdmin = variant === 'admin'

  const [base] = useState(() => draftFrom(initial))
  const baseSnapshot = useMemo(() => snapshotOf(base), [base])
  const [restored] = useState<ScorecardDraft | null>(() => {
    if (!draftKey || saved) return null
    const found = loadScorecardDraft(draftKey)
    return found && snapshotOf(found) !== snapshotOf(base) ? found : null
  })
  const start = restored ?? base
  const [draftRestored, setDraftRestored] = useState(restored !== null)

  const [name, setName] = useState(start.name)
  const [role, setRole] = useState<InterviewerRole | ''>(start.role)
  const [marks, setMarks] = useState<Record<string, QuestionEntry>>(start.marks)
  const [picked, setPicked] = useState<Partial<ExternalRatings>>(start.ratings)
  const [recommendation, setRecommendation] = useState<ExternalRecommendation | ''>(start.recommendation)
  const [summary, setSummary] = useState(start.summary)
  const [strengths, setStrengths] = useState(start.strengths)
  const [concerns, setConcerns] = useState(start.concerns)
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')

  const entryOf = (id: string) => marks[id] ?? NO_ENTRY
  function setEntry(id: string, patch: Partial<QuestionEntry>) {
    setMarks(m => ({ ...m, [id]: { ...(m[id] ?? NO_ENTRY), ...patch } }))
  }

  const prefill = useMemo(() => {
    const out: Partial<ExternalRatings> = {}
    for (const d of DIMENSIONS) {
      const rated = questions
        .filter(q => q.dimension === d.key)
        .map(q => marks[q.id]?.rating)
        .filter((r): r is number => typeof r === 'number')
      const m = mean(rated)
      if (m !== null) out[d.key] = Math.min(5, Math.max(1, Math.round(m)))
    }
    return out
  }, [questions, marks])
  const ratings: Partial<ExternalRatings> = { ...prefill, ...picked }
  const ratedCount = DIMENSIONS.filter(d => ratings[d.key] !== undefined).length
  const overall = overallOutOf100(ratings)

  const summaryLength = summary.trim().length
  const nameOk = !isAdmin ? name.trim().length > 0 : true
  const valid = nameOk && role !== '' && ratedCount === DIMENSIONS.length && recommendation !== '' && summaryLength >= MIN_SUMMARY

  const questionMarks = (): QuestionMark[] => questions.map(q => {
    const e = entryOf(q.id)
    const notes = e.notes.trim()
    return { question_id: q.id, rating: e.rating, ...(notes ? { notes } : {}) }
  })
  const hasMarks = questions.some(q => entryOf(q.id).rating !== null) || ratedCount > 0

  const current = useMemo<ScorecardDraft>(
    () => ({ name, role, marks, ratings: picked, recommendation, summary, strengths, concerns }),
    [name, role, marks, picked, recommendation, summary, strengths, concerns],
  )
  const dirty = snapshotOf(current) !== baseSnapshot
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!draftKey) return
    if (saved || snapshotOf(current) === baseSnapshot) clearScorecardDraft(draftKey)
    else saveScorecardDraft(draftKey, current)
  }, [draftKey, saved, current, baseSnapshot])

  function discardDraft() {
    if (!window.confirm('Discard this draft? What you entered will be lost.')) return
    clearScorecardDraft(draftKey)
    setName(base.name)
    setRole(base.role)
    setMarks(base.marks)
    setPicked(base.ratings)
    setRecommendation(base.recommendation)
    setSummary(base.summary)
    setStrengths(base.strengths)
    setConcerns(base.concerns)
    setDraftError('')
    setDraftRestored(false)
  }

  async function draft() {
    if (!onDraftSummary || drafting) return
    if (summary.trim() && !window.confirm('Replace the summary with a new draft?')) return
    setDrafting(true)
    setDraftError('')
    const body: DraftSummaryInput = {
      questions: questionMarks(),
      ratings,
      strengths: strengths.trim() || undefined,
      concerns: concerns.trim() || undefined,
      recommendation: recommendation || undefined,
    }
    try {
      const text = await onDraftSummary(body)
      setSummary(text.slice(0, MAX_SUMMARY))
    } catch (e) {
      setDraftError(errorDetail(e) || 'Could not draft a summary. Please try again')
    } finally {
      setDrafting(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || saving || drafting) return
    onSubmit({
      interviewer_name: name.trim() || undefined,
      interviewer_role: role,
      questions: questionMarks(),
      ratings: ratings as ExternalRatings,
      recommendation,
      summary: summary.trim(),
      strengths: strengths.trim() || undefined,
      concerns: concerns.trim() || undefined,
    })
  }

  const groups: { key: string; label: string; items: GuideQuestion[] }[] = DIMENSIONS
    .map(d => ({ key: d.key as string, label: d.label, items: questions.filter(q => q.dimension === d.key) }))
  const known = new Set<string>(DIMENSIONS.map(d => d.key))
  const rest = questions.filter(q => !known.has(q.dimension))
  if (rest.length) groups.push({ key: 'other', label: 'Other', items: rest })
  const shownGroups = groups.filter(g => g.items.length > 0)

  const hasHighlights = !!highlights && !!(highlights.seniority || highlights.domain || highlights.skills?.length)

  return (
    <form className="scf" onSubmit={submit} noValidate>
      <div className="scf-body">
        {draftRestored && (
          <div className="scf-draft" role="status">
            <span>Draft restored</span>
            <button type="button" className="scf-draft-discard" onClick={discardDraft}>Discard draft</button>
          </div>
        )}

        <div className="scf-identity">
          <div className="scf-field">
            <label className="form-label" htmlFor={`${uid}-name`}>
              {isAdmin ? 'Interviewer name (optional)' : 'Interviewer name'}
            </label>
            <input
              id={`${uid}-name`}
              className="form-input"
              maxLength={MAX_NAME}
              value={name}
              onChange={e => setName(e.target.value)}
              aria-required={!isAdmin}
            />
          </div>
          <div className="scf-field">
            <label className="form-label" htmlFor={`${uid}-role`}>Interviewer role</label>
            <select
              id={`${uid}-role`}
              className="form-input"
              value={role}
              onChange={e => setRole(e.target.value as InterviewerRole | '')}
              aria-required="true"
            >
              <option value="">Select a role</option>
              {INTERVIEWER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>

        {hasHighlights && highlights && (
          <section className="scf-highlights" aria-labelledby={`${uid}-hl`}>
            <h3 id={`${uid}-hl`} className="scf-heading">Candidate highlights</h3>
            <dl className="scf-facts">
              {highlights.seniority && <div><dt>Seniority</dt><dd>{highlights.seniority.replace(/_/g, ' ')}</dd></div>}
              {highlights.domain && <div><dt>Domain</dt><dd>{highlights.domain.replace(/_/g, ' ')}</dd></div>}
            </dl>
            {!!highlights.skills?.length && (
              <ul className="scf-skills" aria-label="Skills">
                {highlights.skills.map(s => <li key={s}>{s}</li>)}
              </ul>
            )}
          </section>
        )}

        {shownGroups.length > 0 && (
          <div className="scf-questions">
            <div className="scf-questions-head">
              <h3 className="scf-heading">Questions</h3>
              <span className="scf-legend">{RATING_SCALE.map(n => `${n} ${RATING_LABELS[n]}`).join(', ')}</span>
            </div>
            {fallback && <p className="scf-note">{GENERIC_GUIDE_NOTE}</p>}

            {shownGroups.map(g => (
              <section className="scf-group" key={g.key} aria-labelledby={`${uid}-g-${g.key}`}>
                <h4 id={`${uid}-g-${g.key}`} className="scf-group-title">{g.label}</h4>
                <ul className="scf-question-list">
                  {g.items.map(q => {
                    const entry = entryOf(q.id)
                    const textId = `${uid}-q-${q.id}`
                    return (
                      <li className="scf-question" key={q.id}>
                        <p id={textId} className="scf-q-text">{q.text}</p>
                        {q.listen_for && <p className="scf-q-hint">Listen for: {q.listen_for}</p>}
                        <div className="scf-scale" role="radiogroup" aria-labelledby={textId}>
                          {RATING_SCALE.map(n => (
                            <label key={n} className={`scf-score${entry.rating === n ? ' on' : ''}`} title={RATING_LABELS[n]}>
                              <input
                                type="radio"
                                name={textId}
                                checked={entry.rating === n}
                                onChange={() => setEntry(q.id, { rating: n })}
                                aria-label={`${n} out of 5`}
                              />
                              <span aria-hidden="true">{n}</span>
                            </label>
                          ))}
                          <label className={`scf-score scf-score-none${entry.rating === null ? ' on' : ''}`}>
                            <input
                              type="radio"
                              name={textId}
                              checked={entry.rating === null}
                              onChange={() => setEntry(q.id, { rating: null })}
                              aria-label="Not asked"
                            />
                            <span aria-hidden="true">Not asked</span>
                          </label>
                        </div>
                        <textarea
                          className="form-input scf-textarea scf-q-notes"
                          rows={2}
                          maxLength={MAX_NOTES}
                          placeholder="Notes"
                          aria-label={`Notes: ${q.text}`}
                          value={entry.notes}
                          onChange={e => setEntry(q.id, { notes: e.target.value })}
                        />
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="scf-ratings">
          <h3 className="scf-heading">Ratings</h3>
          {DIMENSIONS.map(d => {
            const labelId = `${uid}-r-${d.key}`
            const value = ratings[d.key]
            const prefilled = picked[d.key] === undefined && prefill[d.key] !== undefined
            return (
              <div className="scf-rating" key={d.key}>
                <div className="scf-rating-head">
                  <span id={labelId} className="scf-rating-label">{d.label}</span>
                  {prefilled && <span className="scf-prefilled">Prefilled</span>}
                </div>
                <div className="scf-scale" role="radiogroup" aria-labelledby={labelId}>
                  {RATING_SCALE.map(n => (
                    <label key={n} className={`scf-score${value === n ? ' on' : ''}`} title={RATING_LABELS[n]}>
                      <input
                        type="radio"
                        name={labelId}
                        checked={value === n}
                        onChange={() => setPicked(p => ({ ...p, [d.key]: n }))}
                        aria-label={`${d.label}: ${n} out of 5`}
                      />
                      <span aria-hidden="true">{n}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="scf-overall">
            <span>Average</span>
            <strong data-testid="overall-value">{overall === null ? '-' : overall}</strong>
            <span className="scf-overall-of">/ 100</span>
            <span className="scf-overall-count">{ratedCount} of {DIMENSIONS.length} rated</span>
          </div>
        </div>

        <div className="scf-field">
          <label className="form-label" htmlFor={`${uid}-rec`}>Recommendation</label>
          <select
            id={`${uid}-rec`}
            className="form-input"
            value={recommendation}
            onChange={e => setRecommendation(e.target.value as ExternalRecommendation | '')}
            aria-required="true"
          >
            <option value="">Select a recommendation</option>
            {RECOMMENDATIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        <div className="scf-field">
          <div className="scf-label-row">
            <label className="form-label" htmlFor={`${uid}-summary`}>Summary</label>
            {onDraftSummary && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={drafting || !hasMarks}
                title={hasMarks ? undefined : 'Rate a question or an area first'}
                onClick={draft}
              >
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
            )}
          </div>
          <textarea
            id={`${uid}-summary`}
            className="form-input scf-textarea"
            rows={4}
            maxLength={MAX_SUMMARY}
            readOnly={drafting}
            value={summary}
            onChange={e => setSummary(e.target.value)}
            aria-required="true"
            aria-describedby={`${uid}-summary-hint`}
          />
          <div className="scf-hint" id={`${uid}-summary-hint`}>
            <span className={summary !== '' && summaryLength < MIN_SUMMARY ? 'scf-short' : undefined}>
              Required, at least {MIN_SUMMARY} characters
            </span>
            <span>{summary.length} / {MAX_SUMMARY}</span>
          </div>
          {draftError && <div className="scf-error" role="alert">{draftError}</div>}
        </div>

        <div className="scf-field">
          <label className="form-label" htmlFor={`${uid}-strengths`}>Strengths (optional)</label>
          <textarea
            id={`${uid}-strengths`}
            className="form-input scf-textarea"
            rows={2}
            maxLength={MAX_DETAIL}
            value={strengths}
            onChange={e => setStrengths(e.target.value)}
          />
        </div>

        <div className="scf-field">
          <label className="form-label" htmlFor={`${uid}-concerns`}>Concerns (optional)</label>
          <textarea
            id={`${uid}-concerns`}
            className="form-input scf-textarea"
            rows={2}
            maxLength={MAX_DETAIL}
            value={concerns}
            onChange={e => setConcerns(e.target.value)}
          />
        </div>

        {error && <div className="scf-error" role="alert">{error}</div>}
      </div>

      <div className={footerClassName}>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={!valid || saving || drafting}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
