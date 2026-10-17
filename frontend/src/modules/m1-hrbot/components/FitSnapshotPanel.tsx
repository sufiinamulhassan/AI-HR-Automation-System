import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { jobsApi, type PipelineAiOpinion, type PipelineFit } from '../../../lib/api'
import './FitSnapshotPanel.css'

const SKILLS_ALIGNED_AT = 0.6
const MAX_SKILL_SEGMENTS = 12

type SignalState = 'aligned' | 'not-aligned' | 'unknown'

const STATE_LABEL: Record<SignalState, string> = {
  'aligned': 'Aligned',
  'not-aligned': 'Not aligned',
  'unknown': 'Unknown',
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const toPct = (ratio: number | null | undefined): number | null =>
  typeof ratio === 'number' && Number.isFinite(ratio) ? Math.max(0, Math.min(100, Math.round(ratio * 100))) : null

const tidy = (s: string | null | undefined): string => (s ? s.replace(/_/g, ' ') : '')

function boolState(aligned: boolean | null | undefined): SignalState {
  return aligned === true ? 'aligned' : aligned === false ? 'not-aligned' : 'unknown'
}

interface ScoreRingProps {
  score: number | null | undefined
  size?: 'sm' | 'lg'
  tone?: 'ok' | 'warn'
  unit?: string
}

export function ScoreRing({ score, size = 'sm', tone, unit = '%' }: ScoreRingProps) {
  const pct = toPct(score)
  return (
    <span
      className={`score-ring score-ring-${size}${tone ? ` score-ring-${tone}` : ''}`}
      style={{ '--ring-pct': pct ?? 0 } as CSSProperties}
    >
      <span className="score-ring-inner">{pct === null ? '–' : `${pct}${unit}`}</span>
    </span>
  )
}

function SegmentBar({ total, filled, state }: { total: number; filled: number; state: SignalState }) {
  return (
    <div className={`fit-seg fit-seg-${state}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
    </div>
  )
}

interface SignalRowProps {
  name: string
  state: SignalState
  bar: { total: number; filled: number }
  detail: string
}

function SignalRow({ name, state, bar, detail }: SignalRowProps) {
  return (
    <li className="fit-signal">
      <div className="fit-signal-head">
        <span className="fit-signal-name">{name}</span>
        <span className={`fit-state fit-state-${state}`}>{STATE_LABEL[state]}</span>
      </div>
      <SegmentBar total={bar.total} filled={bar.filled} state={state} />
      <p className="fit-signal-detail">{detail}</p>
    </li>
  )
}

function ChipGroup({ title, items, chipClass }: { title: string; items: string[]; chipClass: string }) {
  return (
    <div className="fit-chip-group">
      <h4 className="fit-group-title">{title} <span className="fit-group-count">{items.length}</span></h4>
      {items.length > 0 ? (
        <div className="fit-chips">
          {items.map(s => <span key={s} className={`skill-tag ${chipClass}`}>{s}</span>)}
        </div>
      ) : (
        <p className="fit-none">None</p>
      )}
    </div>
  )
}

function BulletList({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <div className="fit-opinion-block">
      <h4 className="fit-group-title">{title}</h4>
      <Tag className="fit-opinion-list">{items.map((t, i) => <li key={i}>{t}</li>)}</Tag>
    </div>
  )
}

function opinionErrorMessage(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response
  const detail = typeof res?.data?.detail === 'string' ? res.data.detail.trim() : ''
  if (detail && (res?.status === 502 || res?.status === 403 || res?.status === 404)) return detail
  if (res?.status === 502) return 'AI second opinion unavailable. Please try again shortly.'
  if (res?.status === 403) return 'You do not have permission to request an AI take.'
  return 'Could not get an AI take. Check your connection and try again.'
}

interface Props {
  jobId: string
  resumeId: string
  candidateName: string
  canRequestOpinion: boolean
  onClose: () => void
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function FitSnapshotPanel({ jobId, resumeId, candidateName, canRequestOpinion, onClose }: Props) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const pressStartedOn = useRef<EventTarget | null>(null)
  const alive = useRef(true)

  const [fit, setFit] = useState<PipelineFit | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [opinion, setOpinion] = useState<PipelineAiOpinion | null>(null)
  const [opinionBusy, setOpinionBusy] = useState(false)
  const [opinionError, setOpinionError] = useState('')

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    let current = true
    setLoading(true)
    setLoadError(false)
    jobsApi.pipelineFit(jobId, resumeId)
      .then(r => { if (current) setFit(r.data) })
      .catch(() => { if (current) setLoadError(true) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [jobId, resumeId, attempt])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => { opener?.focus?.() }
  }, [])

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trapTab = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const nodes = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (nodes.length === 0) { e.preventDefault(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }, [])

  function onBackdropMouseDown(e: MouseEvent<HTMLDivElement>) { pressStartedOn.current = e.target }
  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    const startedHere = pressStartedOn.current === null || pressStartedOn.current === e.currentTarget
    pressStartedOn.current = null
    if (e.target === e.currentTarget && startedHere) onClose()
  }

  async function requestOpinion() {
    setOpinionBusy(true)
    setOpinionError('')
    try {
      const r = await jobsApi.pipelineAiOpinion(jobId, resumeId)
      if (alive.current) setOpinion(r.data)
    } catch (e) {
      if (alive.current) setOpinionError(opinionErrorMessage(e))
    } finally {
      if (alive.current) setOpinionBusy(false)
    }
  }

  const name = fit?.candidate_name || candidateName
  const scorePct = toPct(fit?.score)
  const linePct = toPct(fit?.threshold)
  const matched = fit?.skills?.matched ?? []
  const missing = fit?.skills?.missing ?? []
  const extra = fit?.skills?.extra ?? []
  const requiredCount = matched.length + missing.length
  const coverage = fit?.skills?.coverage
  const skillsState: SignalState = requiredCount === 0 || typeof coverage !== 'number'
    ? 'unknown'
    : coverage >= SKILLS_ALIGNED_AT ? 'aligned' : 'not-aligned'
  const skillSegments = Math.min(requiredCount, MAX_SKILL_SEGMENTS)
  const skillsFilled = typeof coverage === 'number' ? Math.round(coverage * skillSegments) : 0

  const seniority = fit?.seniority
  const domain = fit?.domain
  const seniorityState = boolState(seniority?.aligned)
  const domainState = boolState(domain?.aligned)
  const seniorityRequired = (seniority?.required ?? []).map(tidy)

  return (
    <div
      className="fit-backdrop"
      data-testid="fit-backdrop"
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <aside
        ref={panelRef}
        className="fit-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="fit-header">
          <div className="fit-header-text">
            <h2 id={titleId} className="fit-title">Fit Snapshot</h2>
            <p className="fit-subtitle">{name}</p>
          </div>
          <button type="button" className="fit-close" aria-label="Close fit snapshot" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="fit-body">
          {loading && (
            <div className="fit-status" role="status"><span className="fit-spinner" />Loading fit snapshot…</div>
          )}

          {!loading && loadError && (
            <div className="fit-inline-error" role="alert">
              <span>Could not load the fit snapshot for this candidate.</span>
              <button type="button" className="fit-link-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button>
            </div>
          )}

          {!loading && !loadError && fit && (
            <>
              <section className="fit-hero">
                <ScoreRing score={fit.score} size="lg" tone={fit.above_threshold ? 'ok' : 'warn'} />
                <p className="fit-headline">{fit.headline}</p>
              </section>

              <section className="fit-section">
                <h3 className="fit-section-title">Score</h3>
                <div
                  className={`fit-meter${fit.above_threshold ? ' fit-meter-ok' : ' fit-meter-warn'}`}
                  role="meter"
                  aria-label="Match score"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={scorePct ?? 0}
                  aria-valuetext={`${scorePct ?? 0}%, ${fit.above_threshold ? 'above' : 'below'} the match threshold`}
                >
                  <div className="fit-meter-fill" style={{ width: `${scorePct ?? 0}%` }} />
                  {linePct !== null && (
                    <span className="fit-meter-marker" data-testid="threshold-marker" style={{ left: `${linePct}%` }} />
                  )}
                </div>
                <div className="fit-meter-legend">
                  <span>Score <b>{scorePct ?? '–'}%</b></span>
                  <span className="fit-meter-line"><span className="fit-meter-line-key" aria-hidden="true" />Match threshold <b>{linePct ?? '–'}%</b></span>
                </div>
                <p className="fit-breakdown">
                  {toPct(fit.semantic_part) ?? '–'} points from semantic match, {toPct(fit.skills_boost) ?? '–'} from the skills boost
                </p>
              </section>

              <section className="fit-section">
                <h3 className="fit-section-title">Signals</h3>
                <ul className="fit-signals">
                  <SignalRow
                    name="Skills coverage"
                    state={skillsState}
                    bar={{ total: skillSegments || 3, filled: skillsFilled }}
                    detail={requiredCount === 0
                      ? 'This role lists no required skills.'
                      : `${matched.length} of ${requiredCount} required skills covered (${toPct(coverage) ?? 0}%)`}
                  />
                  <SignalRow
                    name="Seniority"
                    state={seniorityState}
                    bar={{ total: 3, filled: seniorityState === 'unknown' ? 0 : 3 }}
                    detail={`Candidate: ${tidy(seniority?.candidate) || 'not stated'}. Role: ${seniorityRequired.join(', ') || 'not stated'}.`}
                  />
                  <SignalRow
                    name="Domain"
                    state={domainState}
                    bar={{ total: 3, filled: domainState === 'unknown' ? 0 : 3 }}
                    detail={`Candidate: ${tidy(domain?.candidate) || 'not stated'}. Role: ${tidy(domain?.required) || 'not stated'}.`}
                  />
                </ul>
              </section>

              <section className="fit-section">
                <h3 className="fit-section-title">Skills</h3>
                <ChipGroup title="Covered" items={matched} chipClass="skill-tag-match" />
                <ChipGroup title="Gaps" items={missing} chipClass="skill-tag-miss" />
                <ChipGroup title="Also has" items={extra} chipClass="" />
              </section>

              <section className="fit-section">
                <h3 className="fit-section-title">AI take</h3>
                {canRequestOpinion ? (
                  <button
                    type="button"
                    className="fit-ai-btn"
                    onClick={requestOpinion}
                    disabled={opinionBusy}
                    aria-busy={opinionBusy}
                  >
                    {opinionBusy
                      ? <><span className="fit-spinner fit-spinner-light" />Reading the profile…</>
                      : opinionError ? 'Try again' : opinion ? 'Refresh AI take' : 'Get an AI take'}
                  </button>
                ) : (
                  <p className="fit-none">AI takes are not enabled for your role.</p>
                )}

                <div aria-live="polite">
                  {opinionError && <div className="fit-inline-error" role="alert">{opinionError}</div>}
                  {opinion && (
                    <div className="fit-opinion">
                      <p className="fit-opinion-summary">{opinion.summary}</p>
                      <BulletList title="Strengths" items={opinion.strengths ?? []} />
                      <BulletList title="Concerns" items={opinion.concerns ?? []} />
                      <BulletList title="Suggested questions" items={opinion.follow_up_questions ?? []} ordered />
                      {opinion.model && <p className="fit-opinion-model">Generated by {opinion.model}</p>}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
