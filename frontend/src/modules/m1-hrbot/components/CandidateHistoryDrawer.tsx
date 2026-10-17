import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { candidatesApi, interviewApi, offersApi } from '../../../lib/api'
import { ERASED_LABEL } from '../../../lib/erased'
import { useAuthStore } from '../../../store/auth.store'
import './CandidateHistoryDrawer.css'

export type HistoryTab = 'timeline' | 'notes' | 'jobs'

const TABS: { id: HistoryTab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'notes', label: 'Notes & Feedback' },
  { id: 'jobs', label: 'Jobs & Offers' },
]

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

interface TimelineEntry {
  candidate_id?: string
  job_id?: string
  job_title?: string | null
  status?: string
  decision?: string
  invite_type?: string
  created_at?: string
  decided_at?: string
  erased?: boolean
}

interface CandidateRecord {
  erased?: boolean
  email?: string
  recruiter_notes?: string | null
  recruiter_notes_updated_at?: string
}

interface PersonProfile {
  profile_id?: string
  profile_notes?: string | null
  updated_at?: string
}

interface Offer {
  offer_id: string
  job_id?: string
  salary?: string
  joining_date?: string
  status: string
  created_at?: string
}

interface ShareFeedback {
  feedback_id?: string
  reviewer_name?: string | null
  rating?: number | null
  comment?: string
  created_at?: string
}

interface FeedbackEntry {
  key: string
  reviewer: string
  rating: number | null
  comment: string
  createdAt?: string
}

function formatDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString()
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function stageBadge(status?: string): string {
  switch (status) {
    case 'hired': return 'badge-green'
    case 'rejected': return 'badge-red'
    case 'invited':
    case 'interviewing': return 'badge-blue'
    case 'completed': return 'badge-yellow'
    default: return 'badge-gray'
  }
}

function offerBadge(status: string): string {
  switch (status) {
    case 'sent': return 'badge-blue'
    case 'accepted': return 'badge-green'
    case 'declined':
    case 'withdrawn': return 'badge-red'
    case 'draft':
    case 'pending_approval':
    case 'approved': return 'badge-yellow'
    default: return 'badge-gray'
  }
}

const tidy = (s: string) => s.replace(/_/g, ' ')

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

const loadTimeline = (candidateId: string) =>
  candidatesApi.getTimeline(candidateId).then(r => (r.data?.timeline ?? []) as TimelineEntry[])

const loadCandidate = (candidateId: string) =>
  candidatesApi.get(candidateId).then(r => (r.data ?? {}) as CandidateRecord)

const loadProfile = (email?: string): Promise<PersonProfile | null> =>
  email
    ? candidatesApi.getProfileByEmail(email).then(r => (r.data ?? null) as PersonProfile | null).catch(() => null)
    : Promise.resolve(null)

const loadOffers = (candidateId: string) =>
  offersApi.list({ candidate_id: candidateId }).then(r => (r.data?.offers ?? []) as Offer[])

function flattenFeedback(shares: { share_id?: string; feedback?: ShareFeedback[] }[]): FeedbackEntry[] {
  const out: FeedbackEntry[] = []
  for (const share of shares) {
    (share.feedback ?? []).forEach((f, i) => {
      out.push({
        key: f.feedback_id || `${share.share_id ?? 'share'}-${i}`,
        reviewer: f.reviewer_name || 'Anonymous reviewer',
        rating: typeof f.rating === 'number' ? Math.max(0, Math.min(5, Math.round(f.rating))) : null,
        comment: f.comment ?? '',
        createdAt: f.created_at,
      })
    })
  }
  return out.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
}

const ERASED_MESSAGE = "This person's personal data has been erased. Only the fact that they applied remains."

const loadFeedback = (secureToken: string) =>
  interviewApi.shares.list(secureToken).then(r => flattenFeedback(r.data?.shares ?? []))

function distinctJobs(entries: TimelineEntry[]): TimelineEntry[] {
  const byJob = new Map<string, TimelineEntry>()
  entries.forEach((e, i) => {
    const key = e.job_id || e.candidate_id || `entry-${i}`
    const prev = byJob.get(key)
    if (!prev || (e.created_at ?? '') >= (prev.created_at ?? '')) byJob.set(key, e)
  })
  return Array.from(byJob.values()).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Remote<T> {
  status: Status
  data: T | undefined
  error: unknown
  reload: () => void
}

function useRemote<T>(enabled: boolean, load: () => Promise<T>, resetKey: string): Remote<T> {
  const loadRef = useRef(load)
  loadRef.current = load
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ status: Status; data?: T; error?: unknown }>({ status: 'idle' })

  useEffect(() => {
    if (!enabled) return
    let current = true
    setState({ status: 'loading' })
    Promise.resolve()
      .then(() => loadRef.current())
      .then(
        data => { if (current) setState({ status: 'ready', data }) },
        error => { if (current) setState({ status: 'error', error }) },
      )
    return () => { current = false }
  }, [enabled, attempt, resetKey])

  const reload = useCallback(() => setAttempt(a => a + 1), [])
  return { status: state.status, data: state.data, error: state.error, reload }
}

function Loading({ label }: { label: string }) {
  return <div className="chd-status" role="status"><span className="chd-spinner" />{label}</div>
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="chd-error" role="alert">
      <span>{message}</span>
      <button type="button" className="chd-link-btn" onClick={onRetry}>Retry</button>
    </div>
  )
}

function TimelineTab({ remote }: { remote: Remote<TimelineEntry[]> }) {
  if (remote.status === 'error') {
    return <LoadError message="Could not load this person's history." onRetry={remote.reload} />
  }
  if (remote.status !== 'ready') return <Loading label="Loading history…" />

  const entries = remote.data ?? []
  if (entries.length === 0) {
    return <p className="chd-empty">No other applications found for this person (matched by email, phone, or LinkedIn).</p>
  }
  return (
    <>
      <p className="chd-hint">Every other application on file for this person, across all jobs.</p>
      <ul className="chd-timeline">
        {entries.map((t, i) => (
          <li className={`chd-timeline-item${t.erased ? ' chd-erased' : ''}`} key={`${t.candidate_id ?? t.job_id}-${i}`}>
            <span className="chd-timeline-dot" aria-hidden="true" />
            <div className="chd-timeline-body">
              <div className="chd-row-top">
                <span className="chd-row-title">
                  {t.job_title || t.job_id || 'Unknown role'}
                  {t.erased && <span className="chd-tag">{ERASED_LABEL}</span>}
                </span>
                <span className={`badge ${stageBadge(t.status)}`}>{t.status || 'unknown'}</span>
              </div>
              <div className="chd-meta">
                {t.invite_type && <span>{t.invite_type} invite</span>}
                {t.decision && <span>Decision: {t.decision}</span>}
                {t.created_at && <span>Applied {formatDate(t.created_at)}</span>}
                {t.decided_at && <span>Decided {formatDate(t.decided_at)}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

interface NoteEditorProps {
  label: string
  hint: string
  placeholder: string
  initial: string
  initialUpdatedAt?: string
  canEdit: boolean
  save: (text: string) => Promise<string | undefined>
  onDirtyChange: (dirty: boolean) => void
}

function NoteEditor({ label, hint, placeholder, initial, initialUpdatedAt, canEdit, save, onDirtyChange }: NoteEditorProps) {
  const headingId = useId()
  const [text, setText] = useState(initial)
  const [persisted, setPersisted] = useState(initial)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  const dirty = canEdit && text !== persisted
  const report = useRef(onDirtyChange)
  report.current = onDirtyChange
  useEffect(() => {
    report.current(dirty)
    return () => report.current(false)
  }, [dirty])

  async function handleSave() {
    setSaving(true)
    setOutcome(null)
    try {
      const stamp = await save(text)
      setPersisted(text)
      if (stamp) setUpdatedAt(stamp)
      setOutcome({ ok: true, message: 'Notes saved' })
    } catch {
      setOutcome({ ok: false, message: 'Could not save these notes. Your text is still here, try again.' })
    }
    setSaving(false)
  }

  return (
    <section className="chd-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="chd-section-title">{label}</h3>
      <p className="chd-hint">{hint}</p>

      {canEdit ? (
        <>
          <textarea
            className="chd-textarea"
            aria-labelledby={headingId}
            rows={6}
            value={text}
            placeholder={placeholder}
            readOnly={saving}
            onChange={e => { setText(e.target.value); setOutcome(null) }}
          />
          <div className="chd-editor-bar">
            <span className="chd-meta-line">
              {updatedAt ? `Last updated ${formatDateTime(updatedAt)}` : ''}
            </span>
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          </div>
          {outcome && (
            <p className={outcome.ok ? 'chd-outcome' : 'chd-outcome chd-outcome-bad'} role={outcome.ok ? 'status' : 'alert'}>
              {outcome.message}
            </p>
          )}
        </>
      ) : (
        <>
          <p className={persisted ? 'chd-readonly' : 'chd-readonly chd-readonly-empty'}>{persisted || 'No notes yet.'}</p>
          <p className="chd-meta-line">Only admins can edit notes.</p>
        </>
      )}
    </section>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="chd-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

interface NotesTabProps {
  candidateId: string
  isAdmin: boolean
  secureToken?: string
  onDirtyChange: (dirty: boolean) => void
}

function NotesTab({ candidateId, isAdmin, secureToken, onDirtyChange }: NotesTabProps) {
  const candidate = useRemote(true, () => loadCandidate(candidateId), candidateId)
  const erased = candidate.data?.erased === true
  const profile = useRemote(candidate.status === 'ready' && !erased, () => loadProfile(candidate.data?.email), candidateId)
  const canTryFeedback = isAdmin && !!secureToken && !erased
  const feedback = useRemote(canTryFeedback, () => loadFeedback(secureToken as string), secureToken ?? '')

  const dirtyFlags = useRef({ job: false, person: false })
  const reportJob = useCallback((dirty: boolean) => {
    dirtyFlags.current.job = dirty
    onDirtyChange(dirtyFlags.current.job || dirtyFlags.current.person)
  }, [onDirtyChange])
  const reportPerson = useCallback((dirty: boolean) => {
    dirtyFlags.current.person = dirty
    onDirtyChange(dirtyFlags.current.job || dirtyFlags.current.person)
  }, [onDirtyChange])

  const profileData = profile.status === 'ready' ? profile.data : null
  const feedbackBlocked = feedback.status === 'error' && [403, 404].includes(httpStatus(feedback.error) ?? 0)

  return (
    <>
      {candidate.status === 'error' && (
        <LoadError message="Could not load the recruiter notes." onRetry={candidate.reload} />
      )}
      {candidate.status !== 'ready' && candidate.status !== 'error' && <Loading label="Loading notes…" />}
      {erased && <p className="chd-empty">{ERASED_MESSAGE}</p>}
      {candidate.status === 'ready' && !erased && (
        <NoteEditor
          label="Recruiter notes"
          hint="Private to recruiters and admins, never shared with the candidate. Editable at any pipeline stage."
          placeholder="Private notes about this candidate."
          initial={candidate.data?.recruiter_notes ?? ''}
          initialUpdatedAt={candidate.data?.recruiter_notes_updated_at}
          canEdit={isAdmin}
          save={async text => (await candidatesApi.updateNotes(candidateId, text)).data?.updated_at}
          onDirtyChange={reportJob}
        />
      )}

      {profileData?.profile_id && (
        <NoteEditor
          label="Notes about this person"
          hint="Shared across every job this person has applied to, separate from each job's recruiter notes."
          placeholder="Notes about this person that apply to every job."
          initial={profileData.profile_notes ?? ''}
          initialUpdatedAt={profileData.updated_at}
          canEdit={isAdmin}
          save={async text => (await candidatesApi.updateProfileNotes(profileData.profile_id as string, text)).data?.updated_at}
          onDirtyChange={reportPerson}
        />
      )}

      {canTryFeedback && !feedbackBlocked && (
        <section className="chd-section" aria-label="Reviewer feedback">
          <h3 className="chd-section-title">Reviewer feedback</h3>
          {feedback.status === 'error' ? (
            <LoadError message="Could not load reviewer feedback." onRetry={feedback.reload} />
          ) : feedback.status !== 'ready' ? (
            <Loading label="Loading feedback…" />
          ) : (feedback.data ?? []).length === 0 ? (
            <p className="chd-empty chd-empty-tight">No reviewer feedback yet.</p>
          ) : (
            <ul className="chd-feedback">
              {(feedback.data ?? []).map(f => (
                <li key={f.key} className="chd-feedback-item">
                  <div className="chd-row-top">
                    <span className="chd-row-title">{f.reviewer}</span>
                    {f.rating !== null && <Stars rating={f.rating} />}
                  </div>
                  {f.comment && <p className="chd-feedback-comment">{f.comment}</p>}
                  {f.createdAt && <p className="chd-meta-line">{formatDateTime(f.createdAt)}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

interface JobsTabProps {
  candidateId: string
  jobId?: string
  timeline: Remote<TimelineEntry[]>
  onOpenOffers?: () => void
}

function JobsTab({ candidateId, jobId, timeline, onOpenOffers }: JobsTabProps) {
  const offers = useRemote(true, () => loadOffers(candidateId), candidateId)

  const jobs = timeline.status === 'ready' ? distinctJobs(timeline.data ?? []) : []
  const titles = new Map(jobs.filter(j => j.job_id && j.job_title).map(j => [j.job_id, j.job_title] as [string, string]))
  const offerHeading = (o: Offer) =>
    o.job_id && o.job_id === jobId ? 'This job' : (o.job_id && titles.get(o.job_id)) || 'Offer'

  return (
    <>
      <section className="chd-section" aria-label="Other jobs applied to">
        <h3 className="chd-section-title">Other jobs applied to</h3>
        {timeline.status === 'error' ? (
          <LoadError message="Could not load the other jobs." onRetry={timeline.reload} />
        ) : timeline.status !== 'ready' ? (
          <Loading label="Loading jobs…" />
        ) : jobs.length === 0 ? (
          <p className="chd-empty chd-empty-tight">This person has not applied to any other job.</p>
        ) : (
          <ul className="chd-list">
            {jobs.map((j, i) => (
              <li key={`${j.job_id ?? j.candidate_id}-${i}`} className="chd-list-item">
                <div className="chd-row-top">
                  <span className="chd-row-title">
                    {j.job_title || j.job_id || 'Unknown role'}
                    {j.job_id && j.job_id === jobId && <span className="chd-tag">This job</span>}
                  </span>
                  <span className={`badge ${stageBadge(j.status)}`}>{j.status || 'unknown'}</span>
                </div>
                <div className="chd-meta">
                  {j.created_at && <span>Applied {formatDate(j.created_at)}</span>}
                  {j.decision && <span>Decision: {j.decision}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="chd-section" aria-label="Offers">
        <div className="chd-section-head">
          <h3 className="chd-section-title">Offers</h3>
          {onOpenOffers && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenOffers}>Open offers</button>
          )}
        </div>
        {offers.status === 'error' ? (
          <LoadError message="Could not load this candidate's offers." onRetry={offers.reload} />
        ) : offers.status !== 'ready' ? (
          <Loading label="Loading offers…" />
        ) : (offers.data ?? []).length === 0 ? (
          <p className="chd-empty chd-empty-tight">No offers have been made to this candidate.</p>
        ) : (
          <ul className="chd-list">
            {(offers.data ?? []).map(o => (
              <li key={o.offer_id} className="chd-list-item">
                <div className="chd-row-top">
                  <span className="chd-row-title">{offerHeading(o)}</span>
                  <span className={`badge ${offerBadge(o.status)}`}>{tidy(o.status)}</span>
                </div>
                <div className="chd-meta">
                  {o.salary && <span>Salary {o.salary}</span>}
                  {o.joining_date && <span>Joining {formatDate(o.joining_date)}</span>}
                  {o.created_at && <span>Created {formatDate(o.created_at)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

interface Props {
  candidateId: string
  candidateName: string
  initialTab?: HistoryTab
  erased?: boolean
  secureToken?: string
  jobId?: string
  onOpenOffers?: () => void
  onClose: () => void
}

export default function CandidateHistoryDrawer({
  candidateId, candidateName, initialTab = 'timeline', erased = false, secureToken, jobId, onOpenOffers, onClose,
}: Props) {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const baseId = useId()
  const eyebrowId = `${baseId}-eyebrow`
  const titleId = `${baseId}-title`
  const panelRef = useRef<HTMLElement>(null)
  const tabRefs = useRef<Partial<Record<HistoryTab, HTMLButtonElement | null>>>({})
  const pressStartedOn = useRef<EventTarget | null>(null)
  const unsaved = useRef(false)

  const [tab, setTab] = useState<HistoryTab>(initialTab)
  const [visited, setVisited] = useState<ReadonlySet<HistoryTab>>(() => new Set<HistoryTab>([initialTab]))

  const timeline = useRemote(
    !erased && (visited.has('timeline') || visited.has('jobs')),
    () => loadTimeline(candidateId),
    candidateId,
  )

  function selectTab(next: HistoryTab) {
    setTab(next)
    setVisited(v => (v.has(next) ? v : new Set(v).add(next)))
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1
    const target =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1
    if (target < 0) return
    e.preventDefault()
    selectTab(TABS[target].id)
    tabRefs.current[TABS[target].id]?.focus()
  }

  const setUnsaved = useCallback((dirty: boolean) => { unsaved.current = dirty }, [])

  const confirmLeave = useCallback(
    () => !unsaved.current || window.confirm('Discard your unsaved notes?'),
    [],
  )
  const requestClose = useCallback(() => { if (confirmLeave()) onClose() }, [confirmLeave, onClose])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => { opener?.focus?.() }
  }, [])

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  function trapTab(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab' || !panelRef.current) return
    const nodes = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (nodes.length === 0) { e.preventDefault(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  function onBackdropMouseDown(e: MouseEvent<HTMLDivElement>) { pressStartedOn.current = e.target }
  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    const startedHere = pressStartedOn.current === null || pressStartedOn.current === e.currentTarget
    pressStartedOn.current = null
    if (e.target === e.currentTarget && startedHere) requestClose()
  }

  const handoffToOffers = onOpenOffers
    ? () => { if (confirmLeave()) onOpenOffers() }
    : undefined

  return (
    <div
      className="chd-backdrop"
      data-testid="history-backdrop"
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <aside
        ref={panelRef}
        className="chd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${eyebrowId} ${titleId}`}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="chd-header">
          <div className="chd-header-text">
            <p id={eyebrowId} className="chd-eyebrow">Candidate history</p>
            <h2 id={titleId} className="chd-title">{erased ? ERASED_LABEL : candidateName || 'Candidate'}</h2>
          </div>
          <button type="button" className="chd-close" aria-label="Close candidate history" onClick={requestClose}>
            <CloseIcon />
          </button>
        </header>

        {erased ? (
          <div className="chd-body"><p className="chd-empty">{ERASED_MESSAGE}</p></div>
        ) : (<>
        <div className="chd-tabs" role="tablist" aria-label="Candidate history sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={el => { tabRefs.current[t.id] = el }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={visited.has(t.id) ? `${baseId}-panel-${t.id}` : undefined}
              tabIndex={tab === t.id ? 0 : -1}
              className={`chd-tab${tab === t.id ? ' chd-tab-active' : ''}`}
              onClick={() => selectTab(t.id)}
              onKeyDown={e => onTabKeyDown(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="chd-body">
          {visited.has('timeline') && (
            <div role="tabpanel" id={`${baseId}-panel-timeline`} aria-labelledby={`${baseId}-tab-timeline`} className="chd-panel" hidden={tab !== 'timeline'}>
              <TimelineTab remote={timeline} />
            </div>
          )}
          {visited.has('notes') && (
            <div role="tabpanel" id={`${baseId}-panel-notes`} aria-labelledby={`${baseId}-tab-notes`} className="chd-panel" hidden={tab !== 'notes'}>
              <NotesTab
                candidateId={candidateId}
                isAdmin={isAdmin}
                secureToken={secureToken}
                onDirtyChange={setUnsaved}
              />
            </div>
          )}
          {visited.has('jobs') && (
            <div role="tabpanel" id={`${baseId}-panel-jobs`} aria-labelledby={`${baseId}-tab-jobs`} className="chd-panel" hidden={tab !== 'jobs'}>
              <JobsTab candidateId={candidateId} jobId={jobId} timeline={timeline} onOpenOffers={handoffToOffers} />
            </div>
          )}
        </div>
        </>)}
      </aside>
    </div>
  )
}
