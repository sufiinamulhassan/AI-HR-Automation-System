import { useEffect, useRef, useState } from 'react'
import { applyDemoStages, isDemoSession, setDemoStage } from '../../../lib/demoMode'
import { renderAsync } from 'docx-preview'
import { jobsApi, candidatesApi, resumesApi, scenariosApi } from '../../../lib/api'
import { codingApi, type CodingQuestion } from '../../../lib/codingApi'
import { resumeDownloadUrl } from '../../../lib/config'
import { useAuthStore } from '../../../store/auth.store'
import DeadlineBar from './DeadlineBar'
import OfferModal from './OfferModal'
import CandidateNotesModal from './CandidateNotesModal'
import CandidateTimelineModal from './CandidateTimelineModal'
import AssignCodingModal from './AssignCodingModal'
import ScheduleInterviewModal from './ScheduleInterviewModal'
import CommunicationModal from './CommunicationModal'
import './CandidatePipeline.css'

const STAGES = ['matched', 'shortlisted', 'invited', 'interviewing', 'completed', 'hired', 'rejected']

interface Props {
  job: Record<string, unknown>
  onViewReport: (token: string) => void
  onRefresh: () => void
}


const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const ChartIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
)
const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
  </svg>
)
const DollarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)
const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
)
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)
const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)
const NotesIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
  </svg>
)
const ClockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)
const CodeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
  </svg>
)
const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)
const CommsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
)


interface ResumeModalProps {
  resumeId: string
  candidateName: string
  onClose: () => void
}

function ResumeModal({ resumeId, candidateName, onClose }: ResumeModalProps) {
  const token = useAuthStore(s => s.token)
  const [meta, setMeta]         = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading]   = useState(true)
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null)
  const [blobUrl, setBlobUrl]   = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [renderError, setRenderError] = useState(false)
  const docxHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let createdUrl: string | null = null

    async function init() {
      let metaLocal: Record<string, unknown> = {}
      try {
        const r = await resumesApi.get(resumeId, true)
        metaLocal = r.data as Record<string, unknown>
        setMeta(metaLocal)
      } catch {}

      const fn = ((metaLocal.filename as string) || '').toLowerCase()
      setFilename((metaLocal.filename as string) || '')

      try {
        const res = await fetch(resumeDownloadUrl(resumeId), {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const blob = await res.blob()
        const ct = (res.headers.get('content-type') || blob.type || '').toLowerCase()
        const isDocx = fn.endsWith('.docx')
          || ct.includes('wordprocessingml')
          || ct.includes('officedocument')

        if (isDocx) {
          setDocxBlob(blob)
        } else {
          const viewBlob = ct.includes('pdf')
            ? blob
            : new Blob([await blob.arrayBuffer()], { type: 'application/pdf' })
          createdUrl = URL.createObjectURL(viewBlob)
          setBlobUrl(createdUrl)
        }
      } catch {}

      setLoading(false)
    }

    init()
    return () => { if (createdUrl) URL.revokeObjectURL(createdUrl) }
  }, [resumeId, token])

  useEffect(() => {
    if (loading || !docxBlob || !docxHostRef.current) return
    const host = docxHostRef.current
    host.innerHTML = ''
    let cancelled = false
    renderAsync(docxBlob, host, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
    }).catch(() => { if (!cancelled) setRenderError(true) })
    return () => { cancelled = true }
  }, [loading, docxBlob])

  const cls = ((meta?.classification || {}) as Record<string, unknown>)
  const resumeText = (meta?.text as string) || (meta?.resume_text as string) || (meta?.raw_text as string) || ''

  function handleDownload() {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename || 'resume'
    a.click()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="resume-modal" onClick={e => e.stopPropagation()}>

        <div className="resume-modal-header">
          <div className="resume-modal-title">
            <EyeIcon />
            <span>{candidateName || 'Resume'}</span>
            {filename && <span className="resume-filename">{filename}</span>}
          </div>
          <div className="resume-modal-actions">
            {blobUrl && (
              <>
                <button className="rm-btn rm-btn-download" onClick={handleDownload} title="Download resume">
                  <DownloadIcon /> Download
                </button>
                <a className="rm-btn rm-btn-open" href={blobUrl} target="_blank" rel="noreferrer">
                  <ExternalIcon /> Open
                </a>
              </>
            )}
            <button className="rm-close" onClick={onClose}><CloseIcon /></button>
          </div>
        </div>

        <div className="resume-modal-body">
          {loading ? (
            <div className="resume-modal-loading"><span className="rm-spinner" />Loading resume…</div>
          ) : blobUrl ? (
            <div className="rm-viewer rm-viewer-pdf">
              <iframe src={`${blobUrl}#view=FitH&toolbar=1`} className="resume-iframe" title="Resume preview" />
            </div>
          ) : docxBlob && !renderError ? (
            <div className="rm-viewer rm-docx-host" ref={docxHostRef} />
          ) : resumeText ? (
            <div className="rm-viewer">
              <div className="rm-page">
                <pre className="resume-text-content">{resumeText}</pre>
              </div>
            </div>
          ) : (
            <div className="resume-no-preview">
              <div className="resume-no-preview-icon">📄</div>
              <p>Preview not available. Use Download or Open to view the file.</p>
              {!!cls.job_domain && (
                <div className="resume-meta-grid">
                  {!!cls.job_domain      && <div className="rm-meta-item"><span>Domain</span>{String(cls.job_domain)}</div>}
                  {!!cls.seniority_level && <div className="rm-meta-item"><span>Seniority</span>{String(cls.seniority_level)}</div>}
                  {!!cls.years_of_experience && <div className="rm-meta-item"><span>Experience</span>{String(cls.years_of_experience)} yrs</div>}
                  {!!cls.education       && <div className="rm-meta-item"><span>Education</span>{String(cls.education)}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


export default function CandidatePipeline({ job, onViewReport, onRefresh }: Props) {
  const [pipeline, setPipeline] = useState<Record<string, unknown>[]>([])
  const [requiredSkills, setRequiredSkills] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [minScore, setMinScore] = useState(0.5)
  const [inviteData, setInviteData] = useState<{ resumeId: string; name: string; email: string; currentStage: string } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState('')
  const [resumeModal, setResumeModal] = useState<{ resumeId: string; name: string } | null>(null)
  const [scenarios, setScenarios] = useState<{ scenario_id: string; name: string }[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [questionType, setQuestionType] = useState<'simple' | 'scenario' | 'code'>('simple')
  const [codingQuestions, setCodingQuestions] = useState<CodingQuestion[]>([])
  const [codingQuestionId, setCodingQuestionId] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [offerModalCandidateId, setOfferModalCandidateId] = useState<string | null>(null)
  const [notesModalCandidate, setNotesModalCandidate] = useState<{ id: string; name: string } | null>(null)
  const [timelineModalCandidate, setTimelineModalCandidate] = useState<{ id: string; name: string } | null>(null)
  const currentUser = useAuthStore(s => s.user) as Record<string, string> | null
  const canEditNotes = currentUser?.role === 'admin' || currentUser?.role === 'superadmin'
  const [codingModal, setCodingModal] = useState<{ candidateId: string; candidateName: string } | null>(null)
  const [scheduleModal, setScheduleModal] = useState<{ candidateId: string; name: string } | null>(null)
  const [communicationTarget, setCommunicationTarget] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => { load() }, [job.job_id])

  useEffect(() => {
    scenariosApi.list({ is_active: true })
      .then(r => setScenarios(r.data.scenarios ?? []))
      .catch(() => setScenarios([]))
    codingApi.listQuestions({ limit: 100 })
      .then(r => setCodingQuestions(r.data.questions ?? []))
      .catch(() => setCodingQuestions([]))
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const r = await jobsApi.pipeline(job.job_id as string)
      const list: Record<string, unknown>[] = [...(r.data.pipeline || [])]
      list.sort((a, b) => Number(b.similarity_score || 0) - Number(a.similarity_score || 0))
      setPipeline(applyDemoStages(job.job_id as string, list))
      setRequiredSkills((r.data.required_skills as string[]) || [])
    } catch { setPipeline([]) }
    finally { if (!silent) setLoading(false) }
  }

  function startBusy(key: string) { setBusy(b => ({ ...b, [key]: true })) }
  function endBusy(key: string)   { setBusy(b => { const n = { ...b }; delete n[key]; return n }) }

  async function makeDecision(row: Record<string, unknown>, decision: 'hired' | 'rejected') {
    const resumeId = row.resume_id as string
    const candidateId = row.candidate_id as string | undefined
    startBusy(`${resumeId}-${decision}`)
    try {
      if (candidateId) await candidatesApi.decision(candidateId, decision)
      await jobsApi.updateStage(job.job_id as string, resumeId, decision)
      if (isDemoSession()) setDemoStage(job.job_id as string, resumeId, decision)
      showToast(decision === 'hired' ? '✓ Marked as hired' : '✕ Candidate rejected')
      load(true); onRefresh()
    } catch { showToast('Failed to update - please try again') }
    finally { endBusy(`${resumeId}-${decision}`) }
  }

  async function sendInvite() {
    if (!inviteData) return
    setInviting(true)
    setInviteError('')
    try {
      if (inviteData.currentStage === 'matched') {
        await jobsApi.updateStage(job.job_id as string, inviteData.resumeId, 'shortlisted')
      }
      const r = await candidatesApi.create({
        job_id: job.job_id, name: inviteData.name,
        email: inviteData.email, resume_id: inviteData.resumeId,
        scenario_id: questionType === 'scenario' ? (scenarioId || undefined) : undefined,
      })
      if (questionType === 'code' && codingQuestionId && r.data.candidate_id) {
        try {
          await codingApi.assignQuestion(r.data.candidate_id, codingQuestionId)
        } catch {
          showToast('Invite created, but assigning the coding question failed - assign it from the Code icon')
        }
      }
      const url = window.location.origin + '/interview/' + r.data.secure_token
      navigator.clipboard?.writeText(url).catch(() => {})
      showToast('Interview link created - copied to clipboard')
      alert(`Interview link:\n${url}`)
      setInviteData(null); load(true); onRefresh()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setInviteError(err?.response?.data?.detail || 'Failed to create invite - please try again')
    }
    finally { setInviting(false) }
  }

  async function regenerateToken(resumeId: string, candidateId: string) {
    if (!confirm('This invalidates the candidate\'s current interview link, generates a new one, and resends the invite email. Continue?')) return
    startBusy(`${resumeId}-regen`)
    try {
      const r = await candidatesApi.regenerateToken(candidateId, true)
      const url = window.location.origin + '/interview/' + r.data.secure_token
      navigator.clipboard?.writeText(url).catch(() => {})
      showToast('New interview link generated, sent, and copied to clipboard')
      alert(`Interview link:\n${url}`)
      load(true)
    } catch { showToast('Failed to regenerate token') }
    finally { endBusy(`${resumeId}-regen`) }
  }

  function openInviteModal(row: Record<string, unknown>) {
    const resume = (row.resume || {}) as Record<string, unknown>
    const stage = row.pipeline_stage as string
    const resumeId = row.resume_id as string
    setScenarioId('')
    setQuestionType('simple')
    setCodingQuestionId('')
    setInviteError('')
    setInviteData({
      resumeId,
      name: (resume.candidate_name as string) || '',
      email: (resume.candidate_email as string) || '',
      currentStage: stage,
    })
  }

  function handleChartClick(row: Record<string, unknown>) {
    const resume = (row.resume || {}) as Record<string, unknown>
    const stage = row.pipeline_stage as string
    const secureToken = (resume.secure_token || row.secure_token) as string | undefined
    if (stage === 'completed' && secureToken) {
      onViewReport(secureToken)
    } else {
      showToast('AI report available after interview is completed')
    }
  }

  function handleHire(row: Record<string, unknown>) {
    if (row.pipeline_stage === 'hired') { showToast('Candidate is already hired'); return }
    makeDecision(row, 'hired')
  }

  function handleReject(row: Record<string, unknown>) {
    if (row.pipeline_stage === 'rejected') { showToast('Candidate is already rejected'); return }
    makeDecision(row, 'rejected')
  }

  const byStage = filter === 'all' ? pipeline : pipeline.filter((p: Record<string, unknown>) => p.pipeline_stage === filter)
  const filtered = byStage.filter((p: Record<string, unknown>) => Number(p.similarity_score || 0) >= minScore)
  const hiddenByScore = byStage.length - filtered.length

  if (loading) return <div className="pipeline-loading">Loading pipeline…</div>

  return (
    <div className="pipeline-panel">
      {toast && <div className="pipeline-toast">{toast}</div>}

      <div className="pipeline-header">
        <div className="pipeline-title-row">
          <h3>{job.title as string} - Pipeline ({pipeline.length})</h3>
          <div className="pipeline-deadline">
            <DeadlineBar createdAt={job.created_at as string} deadlineAt={(job.deadline_at as string) ?? null} compact />
          </div>
        </div>
        <div className="pipeline-filters">
          {['all', ...STAGES].map(s => (
            <button key={s} className={`filter-btn${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
              {s} {s !== 'all' && (
                <span className="filter-count">
                  {pipeline.filter((p: Record<string, unknown>) => p.pipeline_stage === s).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="pipeline-score-filter">
          <label htmlFor="min-score-input">Min match score</label>
          <input
            id="min-score-input"
            type="range" min={0} max={1} step={0.05}
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
          />
          <span className="pipeline-score-value">{Math.round(minScore * 100)}%</span>
          {hiddenByScore > 0 && (
            <span className="pipeline-score-hidden" title="Candidates below the minimum score are hidden">
              {hiddenByScore} hidden below cutoff
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="pipeline-empty">No candidates in this stage.</div>
      ) : (
        <div className="pipeline-table-wrap">
          <table className="pipeline-table">
            <thead>
              <tr>
                <th>Candidate</th><th>Stage</th><th>Score</th><th>Skills</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row: Record<string, unknown>, i) => {
                const resume = (row.resume || {}) as Record<string, unknown>
                const cls = (resume.classification || {}) as Record<string, unknown>
                const score = row.similarity_score as number
                const stage = row.pipeline_stage as string
                const candidateName = (resume.candidate_name as string) || '-'
                const resumeId = row.resume_id as string
                const candidateId = row.candidate_id as string | undefined
                const isHireBusy   = !!busy[`${resumeId}-hired`]
                const isRejectBusy = !!busy[`${resumeId}-rejected`]
                const isRegenBusy  = !!busy[`${resumeId}-regen`]

                return (
                  <tr key={i}>
                    <td data-label="Candidate">
                      <div className="cand-name">{candidateName}</div>
                      <div className="cand-meta">{cls.job_domain as string} · {cls.seniority_level as string}</div>
                    </td>
                    <td data-label="Stage"><span className={`stage-badge stage-${stage}`}>{stage}</span></td>
                    <td data-label="Score"><span className="score-val">{score ? (score * 100).toFixed(0) + '%' : '-'}</span></td>
                    <td data-label="Skills">
                      <div className="skills-list">
                        {requiredSkills.length > 0 ? (() => {
                          const candidateSkills = ((cls.skills as string[]) || []).map((s: string) => s.toLowerCase())
                          const matched = requiredSkills.filter(s => candidateSkills.includes(s.toLowerCase())).slice(0, 3)
                          const missing = requiredSkills.filter(s => !candidateSkills.includes(s.toLowerCase())).slice(0, 2)
                          return (
                            <>
                              {matched.map((s: string) => <span key={s} className="skill-tag skill-tag-match">{s}</span>)}
                              {missing.map((s: string) => <span key={s} className="skill-tag skill-tag-miss">{s}</span>)}
                            </>
                          )
                        })() : ((cls.skills as string[]) || []).slice(0, 3).map((s: string) => (
                          <span key={s} className="skill-tag">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Actions">
                      <div className="action-row">
                        <button
                          className="icon-btn icon-btn-eye"
                          title="View Resume"
                          onClick={() => setResumeModal({ resumeId, name: candidateName })}
                        >
                          <EyeIcon />
                        </button>

                        <button
                          className="icon-btn icon-btn-chart"
                          title="View AI Report"
                          onClick={() => handleChartClick(row)}
                        >
                          <ChartIcon />
                        </button>

                        {stage === 'invited' || stage === 'interviewing' ? (
                          <button className="icon-btn icon-btn-sent" title="Invite already sent" disabled>
                            <MailIcon />
                          </button>
                        ) : (
                          <button
                            className="icon-btn icon-btn-mail"
                            title="Send Interview Invite"
                            onClick={() => openInviteModal(row)}
                          >
                            <MailIcon />
                          </button>
                        )}

                        {candidateId && (stage === 'invited' || stage === 'interviewing') && (
                          <button
                            className={`icon-btn icon-btn-regen${isRegenBusy ? ' icon-btn-busy' : ''}`}
                            title="Resend / Regenerate Interview Link"
                            disabled={isRegenBusy}
                            onClick={() => regenerateToken(resumeId, candidateId)}
                          >
                            <RefreshIcon />
                          </button>
                        )}

                        <button
                          className={`icon-btn icon-btn-check${isHireBusy ? ' icon-btn-busy' : ''}`}
                          title="Mark as Hired"
                          disabled={isHireBusy}
                          onClick={() => handleHire(row)}
                        >
                          <CheckIcon />
                        </button>

                        <button
                          className={`icon-btn icon-btn-trash${isRejectBusy ? ' icon-btn-busy' : ''}`}
                          title="Reject Candidate"
                          disabled={isRejectBusy}
                          onClick={() => handleReject(row)}
                        >
                          <TrashIcon />
                        </button>

                        {candidateId && (
                          <button
                            className="icon-btn icon-btn-offer"
                            title="Manage Offers"
                            onClick={() => setOfferModalCandidateId(candidateId)}
                          >
                            <DollarIcon />
                          </button>
                        )}

                        {candidateId && canEditNotes && (
                          <button
                            className="icon-btn icon-btn-notes"
                            title="Recruiter Notes"
                            onClick={() => setNotesModalCandidate({ id: candidateId, name: candidateName })}
                          >
                            <NotesIcon />
                          </button>
                        )}

                        {candidateId && (
                          <button
                            className="icon-btn icon-btn-timeline"
                            title="Cross-Job History"
                            onClick={() => setTimelineModalCandidate({ id: candidateId, name: candidateName })}
                          >
                            <ClockIcon />
                          </button>
                        )}

                        {candidateId && (
                          <button
                            className="icon-btn icon-btn-coding"
                            title="Assign Coding Question"
                            onClick={() => setCodingModal({ candidateId, candidateName })}
                          >
                            <CodeIcon />
                          </button>
                        )}

                        {candidateId && (
                          <button
                            className="icon-btn icon-btn-schedule"
                            title="Schedule Interview"
                            onClick={() => setScheduleModal({ candidateId, name: candidateName })}
                          >
                            <CalendarIcon />
                          </button>
                        )}

                        {candidateId && (
                          <button
                            className="icon-btn icon-btn-comms"
                            title="Communication Center"
                            onClick={() => setCommunicationTarget({ id: candidateId, name: candidateName })}
                          >
                            <CommsIcon />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {inviteData && (
        <div className="modal-overlay" onClick={() => setInviteData(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Send Interview Invite</h2>
              <button className="modal-close" onClick={() => setInviteData(null)}>✕</button>
            </div>
            <div className="invite-form">
              <label>Candidate Name
                <input value={inviteData.name}
                  onChange={e => setInviteData(d => d ? { ...d, name: e.target.value } : d)} />
              </label>
              <label>Candidate Email
                <input type="email" value={inviteData.email}
                  onChange={e => setInviteData(d => d ? { ...d, email: e.target.value } : d)}
                  placeholder="candidate@email.com" />
              </label>
              {!inviteData.email && (
                <div className="invite-form-error">
                  No email on file for this candidate - enter one to send the invite.
                </div>
              )}
              <label>Question Type
                <select value={questionType} onChange={e => setQuestionType(e.target.value as typeof questionType)}>
                  <option value="simple">Simple - based on skills, seniority, resume &amp; JD</option>
                  <option value="scenario">Scenario-based</option>
                  <option value="code">Code-based</option>
                </select>
              </label>
              {questionType === 'scenario' && (
                <label>Scenario
                  <select value={scenarioId} onChange={e => setScenarioId(e.target.value)}>
                    <option value="">- Select a scenario -</option>
                    {scenarios.map(s => (
                      <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {questionType === 'code' && (
                <label>Coding Question
                  <select value={codingQuestionId} onChange={e => setCodingQuestionId(e.target.value)}>
                    <option value="">- Select a question -</option>
                    {codingQuestions.map(q => (
                      <option key={q.question_id} value={q.question_id}>
                        {q.title} · {q.job_domain || 'any domain'} · {q.difficulty}
                      </option>
                    ))}
                  </select>
                  {codingQuestions.length === 0 && (
                    <span className="invite-form-hint">
                      No coding questions yet - add one from the Coding Questions admin page, or
                      assign it later from the Code icon.
                    </span>
                  )}
                </label>
              )}
              {inviteError && <div className="invite-form-error">{inviteError}</div>}
              <div className="form-footer">
                <button className="btn-ghost" onClick={() => setInviteData(null)}>Cancel</button>
                <button className="btn-primary" onClick={sendInvite} disabled={inviting || !inviteData.email}>
                  {inviting ? 'Sending…' : 'Create Interview Link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resumeModal && (
        <ResumeModal
          resumeId={resumeModal.resumeId}
          candidateName={resumeModal.name}
          onClose={() => setResumeModal(null)}
        />
      )}

      {offerModalCandidateId && (
        <OfferModal
          candidateId={offerModalCandidateId}
          onClose={() => setOfferModalCandidateId(null)}
        />
      )}

      {notesModalCandidate && (
        <CandidateNotesModal
          candidateId={notesModalCandidate.id}
          candidateName={notesModalCandidate.name}
          onClose={() => setNotesModalCandidate(null)}
        />
      )}

      {timelineModalCandidate && (
        <CandidateTimelineModal
          candidateId={timelineModalCandidate.id}
          candidateName={timelineModalCandidate.name}
          onClose={() => setTimelineModalCandidate(null)}
        />
      )}

      {codingModal && (
        <AssignCodingModal
          candidateId={codingModal.candidateId}
          candidateName={codingModal.candidateName}
          jobDomain={
            ((job.parsed_criteria as Record<string, unknown> | undefined)?.job_domain as string) ||
            ((job.targeting as Record<string, unknown> | undefined)?.required_domain as string) ||
            undefined
          }
          onClose={() => setCodingModal(null)}
        />
      )}

      {scheduleModal && (
        <ScheduleInterviewModal
          candidateId={scheduleModal.candidateId}
          candidateName={scheduleModal.name}
          onClose={() => setScheduleModal(null)}
        />
      )}

      {communicationTarget && (
        <CommunicationModal
          candidateId={communicationTarget.id}
          candidateName={communicationTarget.name}
          onClose={() => setCommunicationTarget(null)}
        />
      )}
    </div>
  )
}