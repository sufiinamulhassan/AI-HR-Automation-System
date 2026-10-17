import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BrandLogo from '../../components/BrandLogo'
import LegalLinks from '../../components/LegalLinks'
import { useBrand } from '../../lib/brand'
import {
  interviewerScorecardApi,
  type InterviewerScorecardInput,
  type InterviewerScorecardView,
} from '../../lib/api'
import ScorecardForm, {
  scorecardToInitial,
  type ScorecardInitial,
  type ScorecardSubmission,
} from '../../modules/m1-hrbot/components/ScorecardForm'
import { errorDetail, errorStatus, formatWhen } from '../../modules/m1-hrbot/components/externalInterview'
import { clearScorecardDraft, scorecardDraftKey } from '../../modules/m1-hrbot/components/scorecardDraft'
import './InterviewerScorecardPage.css'

type Phase =
  | { kind: 'loading' }
  | { kind: 'problem'; reason: 'invalid' | 'inactive' | 'generic'; detail: string }
  | { kind: 'form' }
  | { kind: 'saved' }
  | { kind: 'locked'; detail: string }

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const CrossIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

function submissionToInitial(card: ScorecardSubmission): ScorecardInitial {
  const marks: NonNullable<ScorecardInitial['marks']> = {}
  for (const q of card.questions) marks[q.question_id] = { rating: q.rating ?? null, notes: q.notes ?? '' }
  return {
    interviewerName: card.interviewer_name ?? '',
    interviewerRole: card.interviewer_role,
    marks,
    ratings: card.ratings,
    recommendation: card.recommendation,
    summary: card.summary,
    strengths: card.strengths ?? '',
    concerns: card.concerns ?? '',
  }
}

export default function InterviewerScorecardPage() {
  const { token } = useParams<{ token: string }>()
  const brand = useBrand()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [view, setView] = useState<InterviewerScorecardView | null>(null)
  const [initial, setInitial] = useState<ScorecardInitial>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!token) return
    let current = true
    setPhase({ kind: 'loading' })
    interviewerScorecardApi.get(token)
      .then(r => {
        if (!current) return
        const data = r.data
        setView(data)
        setInitial(scorecardToInitial(data.scorecard, { name: data.interviewer_name ?? '', role: data.interviewer_role ?? '' }))
        setSubmitted(!!data.scorecard)
        setPhase(data.locked ? { kind: 'locked', detail: data.locked_reason ?? '' } : { kind: 'form' })
      })
      .catch(e => {
        if (!current) return
        const status = errorStatus(e)
        setPhase({
          kind: 'problem',
          reason: status === 404 ? 'invalid' : status === 410 ? 'inactive' : 'generic',
          detail: errorDetail(e),
        })
      })
    return () => { current = false }
  }, [token, attempt])

  const save = useCallback(async (card: ScorecardSubmission) => {
    if (!token || saving) return
    setSaving(true)
    setError('')
    const body: InterviewerScorecardInput = {
      interviewer_name: (card.interviewer_name ?? '').trim(),
      interviewer_role: card.interviewer_role,
      questions: card.questions,
      ratings: card.ratings,
      recommendation: card.recommendation,
      summary: card.summary,
      strengths: card.strengths,
      concerns: card.concerns,
    }
    try {
      await interviewerScorecardApi.save(token, body)
      clearScorecardDraft(scorecardDraftKey('link', token))
      setInitial(submissionToInitial(card))
      setSubmitted(true)
      setPhase({ kind: 'saved' })
    } catch (e) {
      const status = errorStatus(e)
      const detail = errorDetail(e)
      if (status === 423) setPhase({ kind: 'locked', detail })
      else if (status === 404) setPhase({ kind: 'problem', reason: 'invalid', detail })
      else if (status === 410) setPhase({ kind: 'problem', reason: 'inactive', detail })
      else if (status === 429) setError(detail || 'Too many attempts. Wait a moment and try again')
      else setError(detail || 'Could not save the scorecard. Please try again')
    } finally {
      setSaving(false)
    }
  }, [token, saving])

  const when = view ? formatWhen(view.scheduled_start_at) : ''
  const expires = view ? formatWhen(view.expires_at) : ''

  return (
    <div className="isp-page">
      <div className="isp-shell">
        <div className="isp-brand">
          <BrandLogo>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="9" cy="7" r="4" stroke="var(--primary)" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BrandLogo>
          {brand.name}
        </div>

        {phase.kind === 'loading' && (
          <div className="isp-card isp-card-center" role="status">
            <div className="isp-spinner" />
            <p>Loading scorecard…</p>
          </div>
        )}

        {phase.kind === 'problem' && (
          <div className="isp-card isp-card-center">
            <div className="isp-icon isp-icon-error"><CrossIcon /></div>
            {phase.reason === 'invalid' && (
              <>
                <h2>This link isn&rsquo;t valid</h2>
                <p>{phase.detail || 'Check the link or contact whoever sent it.'}</p>
              </>
            )}
            {phase.reason === 'inactive' && (
              <>
                <h2>This link is no longer active</h2>
                <p>{phase.detail || 'Ask the hiring team for a new link.'}</p>
              </>
            )}
            {phase.reason === 'generic' && (
              <>
                <h2>Something went wrong</h2>
                <p>{phase.detail || 'We could not load this scorecard right now.'}</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(a => a + 1)}>Try again</button>
              </>
            )}
          </div>
        )}

        {view && (phase.kind === 'form' || phase.kind === 'saved' || phase.kind === 'locked') && (
          <div className="isp-card">
            <div className="isp-card-header">
              <span className="isp-eyebrow">Interviewer scorecard</span>
              <h2>{view.candidate_name}</h2>
              {view.job_title && <p className="isp-subtext">{view.job_title}</p>}
              <div className="isp-meta-row">
                {view.platform_label && <span>{view.platform_label}</span>}
                {when && <span>{when}</span>}
                {expires && <span>Link expires {expires}</span>}
              </div>
            </div>

            {phase.kind === 'locked' && (
              <div className="isp-locked" role="status">
                <h3>This scorecard is locked</h3>
                <p>{phase.detail || 'It can no longer be edited.'}</p>
              </div>
            )}

            {phase.kind === 'saved' && (
              <div className="isp-saved" role="status">
                <span className="isp-icon isp-icon-ok"><CheckIcon /></span>
                <h3 className="isp-saved-title">Scorecard submitted</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setPhase({ kind: 'form' }) }}>
                  Edit scorecard
                </button>
              </div>
            )}

            {phase.kind === 'form' && (
              <ScorecardForm
                variant="public"
                questions={view.guide?.questions ?? []}
                fallback={view.guide?.fallback}
                highlights={view.candidate_highlights}
                initial={initial}
                draftKey={token ? scorecardDraftKey('link', token) : undefined}
                saved={submitted}
                submitLabel={submitted ? 'Update scorecard' : 'Submit scorecard'}
                saving={saving}
                error={error}
                footerClassName="isp-footer"
                onSubmit={save}
              />
            )}
          </div>
        )}
        <LegalLinks />
      </div>
    </div>
  )
}
