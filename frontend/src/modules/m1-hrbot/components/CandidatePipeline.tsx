import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  authApi, jobsApi, candidatesApi, integrationsApi, interviewApi, scenariosApi,
  type EraseResult, type ExternalInterviewInput, type ExternalPlatform, type ExternalStatus, type RejectionReason,
} from '../../../lib/api'
import { codingApi, type CodingQuestion } from '../../../lib/codingApi'
import { applyDemoStages, isDemoSession, setDemoStage } from '../../../lib/demoMode'
import { ERASED_LABEL, failedVectors, isErased } from '../../../lib/erased'
import { useAuthStore } from '../../../store/auth.store'
import DeadlineBar from './DeadlineBar'
import OfferModal from './OfferModal'
import CandidateHistoryDrawer, { type HistoryTab } from './CandidateHistoryDrawer'
import AssignCodingModal from './AssignCodingModal'
import ScheduleInterviewModal from './ScheduleInterviewModal'
import CommunicationModal from './CommunicationModal'
import ExternalReviewModal from './ExternalReviewModal'
import InterviewGuideModal from './InterviewGuideModal'
import ShareInterviewerModal from './ShareInterviewerModal'
import FitSnapshotPanel, { ScoreRing } from './FitSnapshotPanel'
import RejectReasonModal from './RejectReasonModal'
import ResumeViewerModal from './ResumeViewerModal'
import EraseCandidateModal from './EraseCandidateModal'
import RowActionMenu, { type MenuItem } from './RowActionMenu'
import {
  EXTERNAL_STATUS_BADGE, MAX_LOCATION, PLATFORM_OPTIONS, formatWhen, isHttpsUrl, platformName, toLocalInput,
} from './externalInterview'
import { loadInterviewPrefs, nextBusinessDayAtTen, saveInterviewPrefs } from './interviewPrefs'
import './CandidatePipeline.css'

const STAGES = ['matched', 'shortlisted', 'invited', 'interviewing', 'completed', 'hired', 'rejected']
const NEEDS_SCORECARD = 'needs-scorecard'

interface Props {
  job: Record<string, unknown>
  onViewReport: (token: string) => void
  onRefresh: () => void
  focusCandidateId?: string | null
  onFocusHandled?: () => void
}

const FOCUS_HIGHLIGHT_MS = 2600

type PipelineRow = Record<string, unknown>

type ActionId =
  | 'shortlist' | 'invite-now' | 'send-invite' | 'resend-invite' | 'regenerate' | 'reconsider'
  | 'schedule' | 'coding' | 'message' | 'notes' | 'timeline' | 'resume' | 'fit'
  | 'report' | 'hire' | 'reject' | 'offer'
  | 'add-review' | 'view-review' | 'reschedule-external' | 'resend-meeting' | 'copy-meeting-link'
  | 'interview-guide' | 'share-interviewer' | 'erase'

interface StageActions { primary: ActionId; menu: ActionId[] }

interface InviteData {
  resumeId: string
  name: string
  email: string
  currentStage: string
  candidateId?: string
  intent: 'create' | 'reschedule'
}

type InterviewKind = 'ai' | 'external' | 'physical'

type MeetingFields = Pick<
  ExternalInterviewInput,
  'platform' | 'platform_label' | 'join_url' | 'location' | 'create_meeting' | 'scheduled_start_at' | 'duration_minutes' | 'display_timezone'
>

interface ExternalForm {
  platform: ExternalPlatform
  label: string
  when: string
  duration: string
  url: string
  location: string
  createMeeting: boolean
  notes: string
}

const EMPTY_EXTERNAL: ExternalForm = {
  platform: 'zoom', label: '', when: '', duration: '45', url: '', location: '', createMeeting: false, notes: '',
}
const MAX_PLATFORM_LABEL = 40
const MAX_EXTERNAL_NOTES = 1000
const canAutoCreate = (p: ExternalPlatform) => p === 'zoom' || p === 'teams'

function freshExternalForm(userKey: string | undefined): ExternalForm {
  return { ...EMPTY_EXTERNAL, ...loadInterviewPrefs(userKey), when: nextBusinessDayAtTen() }
}

function needsScorecard(row: PipelineRow): boolean {
  return row.interview_mode === 'external'
    && (row.external_status === 'awaiting_review' || row.external_status === 'no_show')
    && row.pipeline_stage !== 'rejected'
}

const STAGE_ACTIONS: Record<string, StageActions> = {
  matched:      { primary: 'shortlist',     menu: ['invite-now', 'reject', 'resume', 'fit'] },
  shortlisted:  { primary: 'send-invite',   menu: ['reject', 'resume', 'fit', 'notes', 'timeline'] },
  invited:      { primary: 'resend-invite', menu: ['regenerate', 'schedule', 'coding', 'message', 'notes', 'timeline', 'resume', 'reject'] },
  interviewing: { primary: 'message',       menu: ['regenerate', 'schedule', 'coding', 'notes', 'timeline', 'resume', 'reject'] },
  completed:    { primary: 'report',        menu: ['hire', 'reject', 'offer', 'coding', 'schedule', 'message', 'notes', 'timeline', 'resume'] },
  hired:        { primary: 'offer',         menu: ['report', 'message', 'notes', 'timeline', 'resume'] },
  rejected:     { primary: 'reconsider',    menu: ['resume', 'notes', 'timeline'] },
}
const UNKNOWN_STAGE_ACTIONS: StageActions = { primary: 'resume', menu: ['fit', 'notes', 'timeline'] }

const EXTERNAL_MEETING_ACTIONS: StageActions = {
  primary: 'add-review',
  menu: ['interview-guide', 'share-interviewer', 'reschedule-external', 'resend-meeting', 'copy-meeting-link', 'message', 'notes', 'timeline', 'resume', 'reject'],
}
const EXTERNAL_NO_SHOW_ACTIONS: StageActions = {
  primary: 'reschedule-external',
  menu: ['add-review', 'reject', 'message', 'notes', 'timeline', 'resume'],
}
const EXTERNAL_STAGE_ACTIONS: Record<string, StageActions> = {
  invited:      EXTERNAL_MEETING_ACTIONS,
  interviewing: EXTERNAL_MEETING_ACTIONS,
  completed:    { primary: 'report', menu: ['view-review', 'hire', 'reject', 'offer', 'message', 'notes', 'timeline', 'resume'] },
  hired:        { primary: 'offer',  menu: ['report', 'view-review', 'message', 'notes', 'timeline', 'resume'] },
}
const AFTER_REVIEW: ActionId[] = ['hire', 'offer', 'view-review', 'report']

const READ_ONLY_ACTIONS: ActionId[] = ['resume', 'fit', 'timeline', 'copy-meeting-link']

function actionsFor(row: PipelineRow): StageActions {
  const stage = row.pipeline_stage as string
  const platformActions = STAGE_ACTIONS[stage] ?? UNKNOWN_STAGE_ACTIONS
  if (row.interview_mode !== 'external') return platformActions

  const meetingStage = stage === 'interviewing' || stage === 'invited'
  const actions = meetingStage && row.external_status === 'no_show'
    ? EXTERNAL_NO_SHOW_ACTIONS
    : EXTERNAL_STAGE_ACTIONS[stage] ?? platformActions
  if (row.review_submitted === true) return actions

  return {
    primary: AFTER_REVIEW.includes(actions.primary) ? 'add-review' : actions.primary,
    menu: actions.menu.filter(id => !AFTER_REVIEW.includes(id)),
  }
}

function externalPlatformName(row: PipelineRow): string {
  const label = row.external_platform_label as string | null | undefined
  if (label) return label
  return platformName(row.external_platform as string | null | undefined)
}

function rowName(row: PipelineRow): string {
  if (isErased(row)) return ERASED_LABEL
  const resume = (row.resume || {}) as Record<string, unknown>
  return (resume.candidate_name as string) || '-'
}

const NO_INVITE = 'No interview invite exists for this candidate yet'
const NO_REPORT = 'No interview report is available yet'
const NO_MEETING_LINK = 'No meeting link is on file for this interview'
const NO_ADDRESS = 'No address is on file for this interview'

const BULK_STAGE_LIMIT = 100

function errorDetail(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail.trim() : ''
}

interface ResolvedAction {
  id: ActionId
  label: string
  run: () => void
  busy?: boolean
  danger?: boolean
  unavailable?: string
}

export default function CandidatePipeline({ job, onViewReport, onRefresh, focusCandidateId, onFocusHandled }: Props) {
  const jobId = job.job_id as string
  const [pipeline, setPipeline] = useState<PipelineRow[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [focused, setFocused] = useState<{ id: string } | null>(null)
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const focusTimer = useRef<ReturnType<typeof setTimeout>>()
  const [requiredSkills, setRequiredSkills] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [minScore, setMinScore] = useState(0.5)
  const [inviteData, setInviteData] = useState<InviteData | null>(null)
  const [inviting, setInviting] = useState(false)
  const [interviewKind, setInterviewKind] = useState<InterviewKind>('ai')
  const [ext, setExt] = useState<ExternalForm>(EMPTY_EXTERNAL)
  const [extLoading, setExtLoading] = useState(false)
  const [setupDone, setSetupDone] = useState<{ candidateId: string; message: string } | null>(null)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [rejectTarget, setRejectTarget] = useState<PipelineRow | null>(null)
  const [meetingProviders, setMeetingProviders] = useState<string[] | null>(null)
  const [reviewTarget, setReviewTarget] = useState<{
    candidateId: string; name: string; mode: 'edit' | 'view'; platformLabel: string; scheduledAt: string | null
  } | null>(null)
  const [guideTarget, setGuideTarget] = useState<{ candidateId: string; name: string } | null>(null)
  const [shareTarget, setShareTarget] = useState<{ candidateId: string; name: string } | null>(null)
  const detailSeq = useRef(0)
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
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string; tab: HistoryTab; secureToken?: string } | null>(null)
  const [codingModal, setCodingModal] = useState<{ candidateId: string; candidateName: string } | null>(null)
  const [scheduleModal, setScheduleModal] = useState<{ candidateId: string; name: string } | null>(null)
  const [communicationTarget, setCommunicationTarget] = useState<{ id: string; name: string } | null>(null)
  const [fitTarget, setFitTarget] = useState<{ resumeId: string; name: string } | null>(null)
  const [eraseTarget, setEraseTarget] = useState<{ candidateId: string; name: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const loadSeq = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const currentUser = useAuthStore(s => s.user) as Record<string, string> | null
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'superadmin'
  const userKey = currentUser?.email
  const canEditNotes = isAdmin

  const [permissions, setPermissions] = useState<string[]>([])
  useEffect(() => {
    if (!isAdmin) { setPermissions([]); return }
    let alive = true
    authApi.myPermissions()
      .then(r => { if (alive) setPermissions(r.data?.permissions ?? []) })
      .catch(() => { if (alive) setPermissions([]) })
    return () => { alive = false }
  }, [isAdmin])
  const canBulkStage = isAdmin && permissions.includes('jobs:bulk_stage')
  const canAiOpinion = isAdmin && permissions.includes('jobs:ai_fit_opinion')
  const canErase = isAdmin && permissions.includes('candidates:erase')

  useEffect(() => {
    setSelected(new Set())
    setFitTarget(null)
    load()
  }, [job.job_id])

  useEffect(() => {
    if (!isAdmin) return
    scenariosApi.list({ is_active: true })
      .then(r => setScenarios(r.data.scenarios ?? []))
      .catch(() => setScenarios([]))
    codingApi.listQuestions({ limit: 100 })
      .then(r => setCodingQuestions(r.data.questions ?? []))
      .catch(() => setCodingQuestions([]))
  }, [isAdmin])

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(focusTimer.current) }, [])

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }

  async function load(silent = false) {
    const seq = ++loadSeq.current
    if (!silent) setLoading(true)
    try {
      const r = await jobsApi.pipeline(jobId)
      if (seq !== loadSeq.current) return
      const list: PipelineRow[] = [...(r.data.pipeline || [])]
      list.sort((a, b) => Number(b.similarity_score || 0) - Number(a.similarity_score || 0))
      setPipeline(applyDemoStages(jobId, list))
      setRequiredSkills((r.data.required_skills as string[]) || [])
    } catch {
      if (seq === loadSeq.current) setPipeline([])
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setLoadedFor(jobId) }
    }
  }

  function startBusy(key: string) { setBusy(b => ({ ...b, [key]: true })) }
  function endBusy(key: string)   { setBusy(b => { const n = { ...b }; delete n[key]; return n }) }

  async function makeDecision(row: PipelineRow, decision: 'hired' | 'rejected', reason?: RejectionReason) {
    const resumeId = row.resume_id as string
    const candidateId = row.candidate_id as string | undefined
    startBusy(`${resumeId}-${decision}`)
    try {
      if (candidateId) {
        if (decision === 'hired') await candidatesApi.decision(candidateId, 'hire')
        else await candidatesApi.decision(candidateId, 'reject', undefined, reason)
      }
      await jobsApi.updateStage(jobId, resumeId, decision)
      if (isDemoSession()) setDemoStage(jobId, resumeId, decision)
      showToast(decision === 'hired' ? '✓ Marked as hired' : '✕ Candidate rejected')
      load(true); onRefresh()
    } catch (e: unknown) {
      showToast(errorDetail(e) || 'Failed to update. Please try again')
    }
    finally { endBusy(`${resumeId}-${decision}`) }
  }

  async function moveStage(row: PipelineRow, stage: string, message: string) {
    const resumeId = row.resume_id as string
    const key = `${resumeId}-${stage}`
    startBusy(key)
    try {
      await jobsApi.updateStage(jobId, resumeId, stage)
      if (isDemoSession()) setDemoStage(jobId, resumeId, stage)
      showToast(message)
      load(true); onRefresh()
    } catch { showToast('Failed to update. Please try again') }
    finally { endBusy(key) }
  }

  async function sendInvite() {
    if (!inviteData) return
    setInviting(true)
    setInviteError('')
    try {
      if (inviteData.currentStage === 'matched') {
        await jobsApi.updateStage(jobId, inviteData.resumeId, 'shortlisted')
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
          showToast('Invite created, but assigning the coding question failed. Assign it from the row menu (Assign coding)')
        }
      }
      const url = window.location.origin + '/interview/' + r.data.secure_token
      navigator.clipboard?.writeText(url).catch(() => {})
      showToast(r.data.email_sent === false
        ? 'Interview link created and copied, but the email could not be sent'
        : 'Interview link created, copied to clipboard')
      alert(`Interview link:\n${url}`)
      closeSetup(); load(true); onRefresh()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setInviteError(err?.response?.data?.detail || 'Failed to create invite. Please try again')
    }
    finally { setInviting(false) }
  }

  async function submitExternal() {
    if (!inviteData || !externalOk) return
    setInviting(true)
    setInviteError('')
    const timing = {
      scheduled_start_at: new Date(ext.when).toISOString(),
      duration_minutes: Number(ext.duration),
      display_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    const meeting: MeetingFields = interviewKind === 'physical'
      ? { platform: 'physical', location: ext.location.trim(), ...timing }
      : {
        platform: ext.platform,
        platform_label: ext.platform === 'other' ? ext.label.trim() : undefined,
        join_url: useCreatedMeeting ? undefined : ext.url.trim(),
        create_meeting: useCreatedMeeting ? true : undefined,
        ...timing,
      }
    try {
      let emailSent: boolean
      let scheduledId: string
      if (inviteData.intent === 'reschedule' && inviteData.candidateId) {
        const r = await candidatesApi.updateExternal(inviteData.candidateId, { ...meeting, notes: ext.notes.trim() })
        emailSent = r.data.email_sent
        scheduledId = inviteData.candidateId
      } else {
        if (inviteData.currentStage === 'matched') {
          await jobsApi.updateStage(jobId, inviteData.resumeId, 'shortlisted')
        }
        const body: ExternalInterviewInput = {
          ...(inviteData.candidateId
            ? { candidate_id: inviteData.candidateId }
            : { job_id: jobId, resume_id: inviteData.resumeId, name: inviteData.name.trim(), email: inviteData.email.trim() }),
          ...meeting,
          notes: ext.notes.trim() || undefined,
        }
        const r = await candidatesApi.scheduleExternal(body)
        emailSent = r.data.email_sent
        scheduledId = r.data.candidate_id || inviteData.candidateId || ''
      }
      saveInterviewPrefs(userKey, { platform: ext.platform, duration: ext.duration, label: ext.label })
      setCalendarError('')
      setSetupDone({
        candidateId: scheduledId,
        message: emailSent
          ? `${interviewKind === 'physical' ? 'Interview details' : 'Meeting details'} sent to ${inviteData.name || 'the candidate'}`
          : 'Saved, but the email could not be sent',
      })
      load(true); onRefresh()
    } catch (e: unknown) {
      setInviteError(errorDetail(e) || 'Failed to set up the interview. Please try again')
    }
    finally { setInviting(false) }
  }

  function closeSetup() {
    setInviteData(null)
    setSetupDone(null)
    setCalendarError('')
  }

  async function addToCalendar() {
    if (!setupDone?.candidateId || calendarBusy) return
    setCalendarBusy(true)
    setCalendarError('')
    try {
      const r = await interviewApi.scheduleIcs(setupDone.candidateId)
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `interview_${setupDone.candidateId.slice(0, 8)}.ics`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setCalendarError(errorDetail(e) || 'Could not download the calendar file. Please try again')
    } finally {
      setCalendarBusy(false)
    }
  }

  async function resendMeeting(resumeId: string, candidateId: string, inPerson = false) {
    const key = `${resumeId}-resend-meeting`
    startBusy(key)
    try {
      const r = await candidatesApi.resendExternal(candidateId)
      showToast(r.data.email_sent
        ? `${inPerson ? 'Interview details' : 'Meeting link'} resent to ${r.data.sent_to}`
        : 'The email could not be sent. Check the address, or ask an admin to check Email Delivery')
    } catch (e: unknown) {
      showToast(errorDetail(e) || (inPerson ? 'Failed to resend the interview details' : 'Failed to resend the meeting link'))
    }
    finally { endBusy(key) }
  }

  function copyText(text: string, doneMessage: string, failMessage: string) {
    const copied = navigator.clipboard?.writeText(text)
    if (!copied) { showToast('Copying is not available in this browser'); return }
    copied.then(() => showToast(doneMessage)).catch(() => showToast(failMessage))
  }

  async function resendInvite(resumeId: string, candidateId: string) {
    const key = `${resumeId}-resend`
    startBusy(key)
    try {
      const r = await candidatesApi.resendInvite(candidateId)
      showToast(`Invite resent to ${r.data.sent_to}`)
    } catch (e: unknown) {
      showToast(errorDetail(e) || 'Failed to resend invite')
    }
    finally { endBusy(key) }
  }

  async function regenerateToken(resumeId: string, candidateId: string) {
    if (!confirm('This invalidates the candidate\'s current interview link, generates a new one, and resends the invite email. Continue?')) return
    startBusy(`${resumeId}-regen`)
    try {
      const r = await candidatesApi.regenerateToken(candidateId, true)
      const url = window.location.origin + '/interview/' + r.data.secure_token
      navigator.clipboard?.writeText(url).catch(() => {})
      showToast(r.data.email_resent === false
        ? 'New interview link generated and copied, but the email could not be sent'
        : 'New interview link generated, sent, and copied to clipboard')
      alert(`Interview link:\n${url}`)
      load(true)
    } catch { showToast('Failed to regenerate token') }
    finally { endBusy(`${resumeId}-regen`) }
  }

  function openInviteModal(row: PipelineRow) {
    const resume = (row.resume || {}) as Record<string, unknown>
    const stage = row.pipeline_stage as string
    const resumeId = row.resume_id as string
    detailSeq.current++
    setScenarioId('')
    setQuestionType('simple')
    setCodingQuestionId('')
    setInviteError('')
    setInterviewKind('ai')
    setExt(freshExternalForm(userKey))
    setExtLoading(false)
    setSetupDone(null)
    setInviteData({
      resumeId,
      name: (resume.candidate_name as string) || '',
      email: (resume.candidate_email as string) || '',
      currentStage: stage,
      candidateId: row.candidate_id as string | undefined,
      intent: 'create',
    })
    loadMeetingProviders()
  }

  function chooseKind(kind: InterviewKind) {
    setInterviewKind(kind)
    setInviteError('')
  }

  function openRescheduleModal(row: PipelineRow) {
    const candidateId = row.candidate_id as string | undefined
    if (!candidateId) return
    const resume = (row.resume || {}) as Record<string, unknown>
    const stored = (row.external_platform as ExternalPlatform | null) ?? 'other'
    const inPerson = stored === 'physical'
    const platform: ExternalPlatform = inPerson ? EMPTY_EXTERNAL.platform : stored
    const seq = ++detailSeq.current
    setInviteError('')
    setInterviewKind(inPerson ? 'physical' : 'external')
    setSetupDone(null)
    setExt({
      ...EMPTY_EXTERNAL,
      platform,
      label: platform === 'other' ? ((row.external_platform_label as string | null) ?? '') : '',
      when: toLocalInput(row.external_scheduled_at as string | null) || nextBusinessDayAtTen(),
      url: inPerson ? '' : ((row.external_join_url as string | null) ?? ''),
      location: inPerson ? ((row.external_location as string | null) ?? '') : '',
    })
    setInviteData({
      resumeId: row.resume_id as string,
      name: (resume.candidate_name as string) || '',
      email: (resume.candidate_email as string) || '',
      currentStage: row.pipeline_stage as string,
      candidateId,
      intent: 'reschedule',
    })
    loadMeetingProviders()
    setExtLoading(true)
    candidatesApi.getExternalReview(candidateId)
      .then(r => {
        if (seq !== detailSeq.current) return
        const current = r.data.external_interview
        setExt(f => ({
          ...f,
          duration: f.duration === EMPTY_EXTERNAL.duration && current.duration_minutes ? String(current.duration_minutes) : f.duration,
          notes: f.notes === '' ? (current.notes ?? '') : f.notes,
          location: f.location === '' ? (current.location ?? '') : f.location,
        }))
      })
      .catch(() => { })
      .finally(() => { if (seq === detailSeq.current) setExtLoading(false) })
  }

  function loadMeetingProviders() {
    if (!isAdmin || meetingProviders !== null) return
    integrationsApi.status()
      .then(r => setMeetingProviders(r.data?.meetings?.configured_providers ?? []))
      .catch(() => setMeetingProviders([]))
  }

  function handleHire(row: PipelineRow) {
    if (row.pipeline_stage === 'hired') { showToast('Candidate is already hired'); return }
    makeDecision(row, 'hired')
  }

  function handleReject(row: PipelineRow) {
    if (row.pipeline_stage === 'rejected') { showToast('Candidate is already rejected'); return }
    setRejectTarget(row)
  }

  function resolveAction(id: ActionId, row: PipelineRow): ResolvedAction {
    const resume = (row.resume || {}) as Record<string, unknown>
    const resumeId = row.resume_id as string
    const candidateId = row.candidate_id as string | undefined
    const secureToken = (resume.secure_token || row.secure_token) as string | undefined
    const name = rowName(row)
    const needsCandidate = candidateId ? undefined : NO_INVITE

    switch (id) {
      case 'shortlist':
        return { id, label: 'Shortlist', busy: !!busy[`${resumeId}-shortlisted`],
          run: () => moveStage(row, 'shortlisted', `${name} shortlisted`) }
      case 'reconsider':
        return { id, label: 'Reconsider', busy: !!busy[`${resumeId}-matched`],
          run: () => moveStage(row, 'matched', `${name} moved back to review`) }
      case 'invite-now':
      case 'send-invite':
        return { id, label: 'Set up interview', run: () => openInviteModal(row) }
      case 'add-review':
      case 'view-review':
        return { id, label: id === 'add-review' ? 'Add scorecard' : 'View scorecard', unavailable: needsCandidate,
          run: () => {
            if (candidateId) setReviewTarget({
              candidateId, name, mode: id === 'add-review' ? 'edit' : 'view',
              platformLabel: externalPlatformName(row), scheduledAt: (row.external_scheduled_at as string | null) ?? null,
            })
          } }
      case 'interview-guide':
        return { id, label: 'Interview guide', unavailable: needsCandidate,
          run: () => { if (candidateId) setGuideTarget({ candidateId, name }) } }
      case 'share-interviewer':
        return { id, label: 'Share with interviewer', unavailable: needsCandidate,
          run: () => { if (candidateId) setShareTarget({ candidateId, name }) } }
      case 'reschedule-external':
        return { id, label: row.external_platform === 'physical' ? 'Change time or place' : 'Change time or link',
          unavailable: needsCandidate, run: () => openRescheduleModal(row) }
      case 'resend-meeting':
        return { id, label: row.external_platform === 'physical' ? 'Resend interview details' : 'Resend meeting link',
          busy: !!busy[`${resumeId}-resend-meeting`], unavailable: needsCandidate,
          run: () => { if (candidateId) resendMeeting(resumeId, candidateId, row.external_platform === 'physical') } }
      case 'copy-meeting-link': {
        if (row.external_platform === 'physical') {
          const place = row.external_location as string | null | undefined
          return { id, label: 'Copy address', unavailable: place ? undefined : NO_ADDRESS,
            run: () => { if (place) copyText(place, 'Address copied', 'Could not copy the address') } }
        }
        const joinUrl = row.external_join_url as string | null | undefined
        return { id, label: 'Copy meeting link', unavailable: joinUrl ? undefined : NO_MEETING_LINK,
          run: () => { if (joinUrl) copyText(joinUrl, 'Meeting link copied', 'Could not copy the link') } }
      }
      case 'resend-invite':
        return { id, label: 'Resend invite', busy: !!busy[`${resumeId}-resend`], unavailable: needsCandidate,
          run: () => { if (candidateId) resendInvite(resumeId, candidateId) } }
      case 'regenerate':
        return { id, label: 'Regenerate link', busy: !!busy[`${resumeId}-regen`], unavailable: needsCandidate,
          run: () => { if (candidateId) regenerateToken(resumeId, candidateId) } }
      case 'schedule':
        return { id, label: 'Schedule', unavailable: needsCandidate,
          run: () => { if (candidateId) setScheduleModal({ candidateId, name }) } }
      case 'coding':
        return { id, label: 'Assign coding', unavailable: needsCandidate,
          run: () => { if (candidateId) setCodingModal({ candidateId, candidateName: name }) } }
      case 'message':
        return { id, label: 'Message', unavailable: needsCandidate,
          run: () => { if (candidateId) setCommunicationTarget({ id: candidateId, name }) } }
      case 'notes':
        return { id, label: 'Notes', unavailable: !canEditNotes ? 'Only admins can edit notes' : needsCandidate,
          run: () => { if (candidateId) setHistoryTarget({ id: candidateId, name, tab: 'notes', secureToken }) } }
      case 'timeline':
        return { id, label: 'Timeline', unavailable: needsCandidate,
          run: () => { if (candidateId) setHistoryTarget({ id: candidateId, name, tab: 'timeline', secureToken }) } }
      case 'offer':
        return { id, label: 'Send offer', unavailable: needsCandidate,
          run: () => { if (candidateId) setOfferModalCandidateId(candidateId) } }
      case 'report':
        return { id, label: 'View report', unavailable: secureToken ? undefined : NO_REPORT,
          run: () => { if (secureToken) onViewReport(secureToken) } }
      case 'hire':
        return { id, label: 'Hire', busy: !!busy[`${resumeId}-hired`], run: () => handleHire(row) }
      case 'reject':
        return { id, label: 'Reject', danger: true, busy: !!busy[`${resumeId}-rejected`], run: () => handleReject(row) }
      case 'resume':
        return { id, label: 'View résumé', run: () => setResumeModal({ resumeId, name }) }
      case 'fit':
        return { id, label: 'Fit snapshot', run: () => setFitTarget({ resumeId, name }) }
      case 'erase':
        return { id, label: 'Erase personal data', danger: true, unavailable: needsCandidate,
          run: () => { if (candidateId) setEraseTarget({ candidateId, name }) } }
    }
  }

  function visibleActionsFor(row: PipelineRow): { primary: ActionId | null; menu: ActionId[] } {
    if (isErased(row)) return { primary: null, menu: [] }
    const actions = actionsFor(row)
    if (isAdmin) {
      return canErase && row.candidate_id ? { primary: actions.primary, menu: [...actions.menu, 'erase'] } : actions
    }
    return {
      primary: READ_ONLY_ACTIONS.includes(actions.primary) ? actions.primary : null,
      menu: actions.menu.filter(id => READ_ONLY_ACTIONS.includes(id)),
    }
  }

  function menuItemsFor(row: PipelineRow, ids: ActionId[]): MenuItem[] {
    return ids
      .map(id => resolveAction(id, row))
      .filter(a => !a.unavailable)
      .map(a => ({ id: a.id, label: a.label, onSelect: a.run, disabled: a.busy, tone: a.danger ? 'danger' as const : undefined }))
  }

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of pipeline) {
      const s = p.pipeline_stage as string
      counts[s] = (counts[s] || 0) + 1
    }
    return counts
  }, [pipeline])

  const awaitingScorecard = useMemo(() => pipeline.filter(needsScorecard).length, [pipeline])

  const { filtered, hiddenByScore } = useMemo(() => {
    const byStage = filter === 'all'
      ? pipeline
      : filter === NEEDS_SCORECARD
        ? pipeline.filter(needsScorecard)
        : pipeline.filter(p => p.pipeline_stage === filter)
    const visible = byStage.filter(p => isErased(p) || p.source === 'career_page' || Number(p.similarity_score || 0) >= minScore)
    return { filtered: visible, hiddenByScore: byStage.length - visible.length }
  }, [pipeline, filter, minScore])

  const inReview = filter === 'matched'
  const canBulk = inReview && canBulkStage
  const reviewIds = useMemo(
    () => (canBulk ? filtered.filter(p => p.pipeline_stage === 'matched').map(p => p.resume_id as string) : []),
    [canBulk, filtered],
  )
  const selectedIds = useMemo(() => reviewIds.filter(id => selected.has(id)), [reviewIds, selected])
  const allSelected = reviewIds.length > 0 && selectedIds.length === reviewIds.length

  function selectFilter(s: string) {
    setFilter(s)
    setSelected(new Set())
  }

  function toggleOne(resumeId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(resumeId)) next.delete(resumeId)
      else next.add(resumeId)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(reviewIds))
  }

  async function bulkMove(stage: 'shortlisted' | 'rejected') {
    const ids = selectedIds
    if (ids.length === 0 || bulkBusy) return
    if (stage === 'rejected' && !confirm(`Reject ${ids.length} selected candidate${ids.length === 1 ? '' : 's'}? They will be moved to the rejected stage.`)) return
    setBulkBusy(true)
    let updated = 0
    let skipped = 0
    let failure: string | null = null
    try {
      for (let i = 0; i < ids.length && failure === null; i += BULK_STAGE_LIMIT) {
        try {
          const r = await jobsApi.bulkUpdateStage(jobId, ids.slice(i, i + BULK_STAGE_LIMIT), stage)
          updated += r.data.updated ?? 0
          skipped += r.data.skipped?.length ?? 0
        } catch (e) {
          failure = errorDetail(e) || 'please try again'
        }
      }
      const counts = `${updated} ${stage === 'shortlisted' ? 'shortlisted' : 'rejected'}, ${skipped} skipped`
      if (failure === null) {
        showToast(counts)
        setSelected(new Set())
      } else {
        showToast(updated + skipped === 0 ? `Bulk update failed: ${failure}` : `Bulk update stopped: ${failure}. ${counts} so far`)
      }
      load(true); onRefresh()
    } finally { setBulkBusy(false) }
  }

  useEffect(() => {
    if (!focusCandidateId || loading || loadedFor !== jobId) return
    const row = pipeline.find(p => p.candidate_id === focusCandidateId)
    if (row) {
      const stage = row.pipeline_stage as string
      setFilter(STAGES.includes(stage) ? stage : 'all')
      if (row.source !== 'career_page' && Number(row.similarity_score || 0) < minScore) setMinScore(0)
      setSelected(new Set())
      setFocused({ id: focusCandidateId })
    }
    onFocusHandled?.()
  }, [focusCandidateId, loading, loadedFor, jobId, pipeline])

  useEffect(() => {
    if (!focused) return
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rowEls.current.get(focused.id)?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    clearTimeout(focusTimer.current)
    focusTimer.current = setTimeout(() => setFocused(null), FOCUS_HIGHLIGHT_MS)
  }, [focused])

  const closeFit = useCallback(() => setFitTarget(null), [])
  const closeReject = useCallback(() => setRejectTarget(null), [])
  const closeReview = useCallback(() => setReviewTarget(null), [])
  const closeGuide = useCallback(() => setGuideTarget(null), [])
  const closeShare = useCallback(() => setShareTarget(null), [])

  const inPerson = interviewKind === 'physical'
  const createOffered = !inPerson && canAutoCreate(ext.platform) && (meetingProviders ?? []).includes(ext.platform)
  const useCreatedMeeting = createOffered && ext.createMeeting
  const whenInFuture = ext.when !== '' && new Date(ext.when).getTime() > Date.now()
  const durationMinutes = Number(ext.duration)
  const durationOk = ext.duration.trim() !== '' && Number.isInteger(durationMinutes) && durationMinutes >= 5 && durationMinutes <= 480
  const labelOk = inPerson || ext.platform !== 'other' || (ext.label.trim().length > 0 && ext.label.trim().length <= MAX_PLATFORM_LABEL)
  const linkOk = inPerson || useCreatedMeeting || isHttpsUrl(ext.url.trim())
  const locationOk = !inPerson || (ext.location.trim().length > 0 && ext.location.trim().length <= MAX_LOCATION)
  const recordLocked = interviewKind !== 'ai' && !!inviteData?.candidateId
  const contactOk = recordLocked || (!!inviteData?.name.trim() && !!inviteData?.email.trim())
  const externalOk = whenInFuture && durationOk && labelOk && linkOk && locationOk && contactOk && !extLoading

  if (loading) return <div className="pipeline-loading">Loading pipeline…</div>

  return (
    <div className="pipeline-panel">
      {toast && <div className="pipeline-toast" role="status">{toast}</div>}

      <div className="pipeline-header">
        <div className="pipeline-title-row">
          <h3>{job.title as string}, Pipeline ({pipeline.length})</h3>
          <div className="pipeline-deadline">
            <DeadlineBar createdAt={job.created_at as string} deadlineAt={(job.deadline_at as string) ?? null} compact />
          </div>
        </div>
        <div className="pipeline-filters">
          {['all', ...STAGES].map(s => (
            <button key={s} type="button" className={`filter-btn${filter === s ? ' active' : ''}`} onClick={() => selectFilter(s)}>
              {s} {s !== 'all' && <span className="filter-count">{stageCounts[s] || 0}</span>}
              {s === 'interviewing' && awaitingScorecard > 0 && (
                <span className="badge badge-yellow filter-attn" role="img" aria-label={`${awaitingScorecard} awaiting a scorecard`}>{awaitingScorecard}</span>
              )}
            </button>
          ))}
          {(awaitingScorecard > 0 || filter === NEEDS_SCORECARD) && (
            <button
              type="button"
              className={`filter-btn filter-chip${filter === NEEDS_SCORECARD ? ' active' : ''}`}
              aria-pressed={filter === NEEDS_SCORECARD}
              onClick={() => selectFilter(filter === NEEDS_SCORECARD ? 'all' : NEEDS_SCORECARD)}
            >
              Needs scorecard <span className="filter-count">{awaitingScorecard}</span>
            </button>
          )}
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

      {inReview && filtered.length > 0 && (
        <div className="review-strip">
          {`Awaiting your review: ${filtered.length} candidate${filtered.length === 1 ? '' : 's'}`}
        </div>
      )}

      {canBulk && selectedIds.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-count">{selectedIds.length} selected</span>
          <div className="bulk-actions">
            <button type="button" className="bulk-btn bulk-btn-primary" disabled={bulkBusy} onClick={() => bulkMove('shortlisted')}>
              Shortlist selected
            </button>
            <button type="button" className="bulk-btn bulk-btn-danger" disabled={bulkBusy} onClick={() => bulkMove('rejected')}>
              Reject selected
            </button>
            <button type="button" className="bulk-btn bulk-btn-ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="pipeline-empty">{filter === NEEDS_SCORECARD ? 'No candidates need a scorecard.' : 'No candidates in this stage.'}</div>
      ) : (
        <div className="pipeline-table-wrap">
          <table className="pipeline-table">
            <thead>
              <tr>
                {canBulk && (
                  <th className="col-select">
                    <input
                      type="checkbox"
                      aria-label="Select all candidates awaiting review"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = selectedIds.length > 0 && !allSelected }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>Candidate</th><th>Stage</th><th>Score</th>
                {isAdmin && <th>Interview score</th>}
                <th>Skills</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const resume = (row.resume || {}) as Record<string, unknown>
                const cls = (resume.classification || {}) as Record<string, unknown>
                const score = row.similarity_score as number | undefined
                const interviewScore = typeof row.final_score === 'number' ? row.final_score : null
                const interviewTone = interviewScore === null ? undefined : interviewScore >= 70 ? 'ok' : interviewScore < 40 ? 'warn' : undefined
                const reportAction = resolveAction('report', row)
                const stage = row.pipeline_stage as string
                const erased = isErased(row)
                const candidateName = rowName(row)
                const resumeId = row.resume_id as string
                const stageActions = visibleActionsFor(row)
                const primary = stageActions.primary ? resolveAction(stageActions.primary, row) : null
                const hasMenu = stageActions.menu.some(id => !resolveAction(id, row).unavailable)
                const isExternal = row.interview_mode === 'external'
                const externalBadge = isExternal ? EXTERNAL_STATUS_BADGE[row.external_status as ExternalStatus] : undefined
                const externalLine = isExternal
                  ? [externalPlatformName(row), formatWhen(row.external_scheduled_at as string | null)].filter(Boolean).join(' · ')
                  : ''

                return (
                  <tr
                    key={resumeId}
                    ref={el => {
                      const id = row.candidate_id as string | undefined
                      if (!id) return
                      if (el) rowEls.current.set(id, el)
                      else rowEls.current.delete(id)
                    }}
                    className={[
                      selected.has(resumeId) && canBulk ? 'row-selected' : '',
                      focused !== null && row.candidate_id === focused.id ? 'row-focus' : '',
                      erased ? 'row-erased' : '',
                    ].filter(Boolean).join(' ') || undefined}
                  >
                    {canBulk && (
                      <td className="col-select" data-label="Select">
                        {stage === 'matched' && !erased && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${candidateName}`}
                            checked={selected.has(resumeId)}
                            onChange={() => toggleOne(resumeId)}
                          />
                        )}
                      </td>
                    )}
                    <td data-label="Candidate">
                      <div className="cand-name">
                        {candidateName}
                        {row.source === 'career_page' && !erased && <span className="cand-source-tag">Career page</span>}
                      </div>
                      {!erased && <div className="cand-meta">{cls.job_domain as string} · {cls.seniority_level as string}</div>}
                      {isExternal && (externalLine || externalBadge) && (
                        <div className="cand-external">
                          {externalLine && <span className="cand-external-when">{externalLine}</span>}
                          {externalBadge && <span className={`badge ${externalBadge.tone}`}>{externalBadge.label}</span>}
                        </div>
                      )}
                    </td>
                    <td data-label="Stage"><span className={`stage-badge stage-${stage}`}>{stage}</span></td>
                    <td data-label="Score">
                      {erased ? '-' : (
                        <button
                          type="button"
                          className="score-ring-btn"
                          aria-label={`Open fit snapshot for ${candidateName}`}
                          onClick={() => setFitTarget({ resumeId, name: candidateName })}
                        >
                          <ScoreRing score={score} />
                        </button>
                      )}
                    </td>
                    {isAdmin && (
                      <td data-label="Interview score">
                        {erased || interviewScore === null ? '-' : reportAction.unavailable ? (
                          <ScoreRing score={interviewScore / 100} unit="" tone={interviewTone} />
                        ) : (
                          <button
                            type="button"
                            className="score-ring-btn"
                            title="Open the interview report"
                            aria-label={`Open the interview report of ${candidateName}, interview score ${interviewScore} out of 100`}
                            onClick={reportAction.run}
                          >
                            <ScoreRing score={interviewScore / 100} unit="" tone={interviewTone} />
                          </button>
                        )}
                      </td>
                    )}
                    <td data-label="Skills">
                      <div className="skills-list">
                        {erased ? '-' : requiredSkills.length > 0 ? (() => {
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
                      {(primary || hasMenu) && (
                        <div className="row-actions">
                          {primary && (
                            <button
                              type="button"
                              className={`row-primary${primary.busy ? ' is-busy' : ''}`}
                              disabled={!!primary.unavailable || primary.busy}
                              title={primary.unavailable}
                              onClick={primary.run}
                            >
                              {primary.label}
                            </button>
                          )}
                          {hasMenu && (
                            <RowActionMenu
                              label={`More actions for ${candidateName}`}
                              getItems={() => menuItemsFor(row, stageActions.menu)}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {inviteData && (
        <div className="modal-overlay" onClick={closeSetup}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-interview-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="setup-interview-title">
                {inviteData.intent === 'reschedule' ? (inPerson ? 'Change time or place' : 'Change time or link') : 'Set up interview'}
              </h2>
              <button className="modal-close" aria-label="Close" onClick={closeSetup}>✕</button>
            </div>
            {setupDone ? (
              <div className="invite-form invite-done">
                <div className="invite-done-message" role="status">{setupDone.message}</div>
                {calendarError && <div className="invite-form-error" role="alert">{calendarError}</div>}
                <div className="form-footer">
                  {setupDone.candidateId && (
                    <button className="btn-ghost" onClick={addToCalendar} disabled={calendarBusy}>
                      {calendarBusy ? 'Preparing…' : 'Add to calendar'}
                    </button>
                  )}
                  <button className="btn-primary" onClick={closeSetup}>Done</button>
                </div>
              </div>
            ) : (
            <div className="invite-form">
              {inviteData.intent === 'create' && (
                <fieldset className="invite-kind">
                  <legend>How will this interview run?</legend>
                  <div className="invite-kind-options">
                    <label className={`invite-kind-option${interviewKind === 'ai' ? ' active' : ''}`}>
                      <input type="radio" name="interview-kind" checked={interviewKind === 'ai'}
                        onChange={() => chooseKind('ai')} />
                      <span>AI interview on our platform</span>
                    </label>
                    <label className={`invite-kind-option${interviewKind === 'external' ? ' active' : ''}`}>
                      <input type="radio" name="interview-kind" checked={interviewKind === 'external'}
                        onChange={() => chooseKind('external')} />
                      <span>Another platform</span>
                    </label>
                    <label className={`invite-kind-option${interviewKind === 'physical' ? ' active' : ''}`}>
                      <input type="radio" name="interview-kind" checked={interviewKind === 'physical'}
                        onChange={() => chooseKind('physical')} />
                      <span>Physical Interview Call</span>
                    </label>
                  </div>
                </fieldset>
              )}
              <label>Candidate Name
                <input value={inviteData.name} disabled={recordLocked}
                  onChange={e => setInviteData(d => d ? { ...d, name: e.target.value } : d)} />
              </label>
              <label>Candidate Email
                <input type="email" value={inviteData.email} disabled={recordLocked}
                  onChange={e => setInviteData(d => d ? { ...d, email: e.target.value } : d)}
                  placeholder="candidate@email.com" />
              </label>
              {recordLocked && (
                <div className="invite-form-hint">
                  The {inPerson ? 'interview' : 'meeting'} details go to the address on the existing candidate record.
                </div>
              )}
              {!recordLocked && !inviteData.email && (
                <div className="invite-form-error">
                  No email on file for this candidate. Enter one to send the {interviewKind === 'ai' ? 'invite' : inPerson ? 'interview details' : 'meeting details'}.
                </div>
              )}

              {interviewKind === 'ai' ? (
                <>
                  <label>Question Type
                    <select value={questionType} onChange={e => setQuestionType(e.target.value as typeof questionType)}>
                      <option value="simple">Simple, based on skills, seniority, resume &amp; JD</option>
                      <option value="scenario">Scenario-based</option>
                      <option value="code">Code-based</option>
                    </select>
                  </label>
                  {questionType === 'scenario' && (
                    <label>Scenario
                      <select value={scenarioId} onChange={e => setScenarioId(e.target.value)}>
                        <option value="">Select a scenario</option>
                        {scenarios.map(s => (
                          <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {questionType === 'code' && (
                    <label>Coding Question
                      <select value={codingQuestionId} onChange={e => setCodingQuestionId(e.target.value)}>
                        <option value="">Select a question</option>
                        {codingQuestions.map(q => (
                          <option key={q.question_id} value={q.question_id}>
                            {q.title} · {q.job_domain || 'any domain'} · {q.difficulty}
                          </option>
                        ))}
                      </select>
                      {codingQuestions.length === 0 && (
                        <span className="invite-form-hint">
                          No coding questions yet, add one from the Coding Questions admin page, or
                          assign it later from the Code icon.
                        </span>
                      )}
                    </label>
                  )}
                </>
              ) : (
                <>
                  {!inPerson && (
                  <>
                  <label>Platform
                    <select
                      value={ext.platform}
                      onChange={e => {
                        const platform = e.target.value as ExternalPlatform
                        setExt(f => ({
                          ...f, platform,
                          createMeeting: f.createMeeting && canAutoCreate(platform) && (meetingProviders ?? []).includes(platform),
                        }))
                      }}
                    >
                      {PLATFORM_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </label>
                  {ext.platform === 'other' && (
                    <label>Platform name
                      <input value={ext.label} maxLength={MAX_PLATFORM_LABEL} placeholder="e.g. Webex"
                        onChange={e => setExt(f => ({ ...f, label: e.target.value }))} />
                    </label>
                  )}
                  </>
                  )}
                  <div className="invite-row">
                    <label>Date and time
                      <input type="datetime-local" value={ext.when} min={toLocalInput(new Date())}
                        onChange={e => setExt(f => ({ ...f, when: e.target.value }))} />
                    </label>
                    <label>Duration (minutes)
                      <input type="number" inputMode="numeric" min={5} max={480} step={1} value={ext.duration}
                        onChange={e => setExt(f => ({ ...f, duration: e.target.value }))} />
                    </label>
                  </div>
                  {ext.when !== '' && !whenInFuture && (
                    <div className="invite-form-error">Pick a date and time in the future.</div>
                  )}
                  {!durationOk && (
                    <div className="invite-form-error">Duration must be between 5 and 480 minutes.</div>
                  )}
                  {inPerson && (
                    <>
                      <label>Address
                        <input value={ext.location} maxLength={MAX_LOCATION} placeholder="Building, street, floor and city"
                          onChange={e => setExt(f => ({ ...f, location: e.target.value }))} />
                      </label>
                      <div className="invite-form-hint invite-form-count">{ext.location.length} / {MAX_LOCATION}</div>
                    </>
                  )}
                  {createOffered && (
                    <label className="invite-check">
                      <input type="checkbox" checked={ext.createMeeting}
                        onChange={e => setExt(f => ({ ...f, createMeeting: e.target.checked }))} />
                      <span>Create the meeting for me</span>
                    </label>
                  )}
                  {!inPerson && !useCreatedMeeting && (
                    <>
                      <label>Meeting link
                        <input type="url" value={ext.url} placeholder="https://"
                          onChange={e => setExt(f => ({ ...f, url: e.target.value }))} />
                      </label>
                      {ext.url.trim() !== '' && !isHttpsUrl(ext.url.trim()) && (
                        <div className="invite-form-error">Enter the full link, starting with https://</div>
                      )}
                    </>
                  )}
                  <label>Notes for the candidate (optional)
                    <textarea rows={3} maxLength={MAX_EXTERNAL_NOTES} value={ext.notes}
                      onChange={e => setExt(f => ({ ...f, notes: e.target.value }))} />
                  </label>
                  <div className="invite-form-hint invite-form-count">{ext.notes.length} / {MAX_EXTERNAL_NOTES}</div>
                  <p className="invite-form-note">
                    {inPerson
                      ? 'The candidate receives the time and address by email. Nothing else is sent.'
                      : 'The candidate receives the link by email. Nothing else is sent.'}
                  </p>
                </>
              )}

              {inviteError && <div className="invite-form-error" role="alert">{inviteError}</div>}
              <div className="form-footer">
                <button className="btn-ghost" onClick={closeSetup}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={interviewKind === 'ai' ? sendInvite : submitExternal}
                  disabled={inviting || (interviewKind === 'ai' ? !inviteData.email : !externalOk)}
                >
                  {inviting
                    ? 'Sending…'
                    : interviewKind === 'ai'
                      ? 'Create Interview Link'
                      : inviteData.intent === 'reschedule'
                        ? 'Save and notify candidate'
                        : inPerson ? 'Send interview call' : 'Send meeting details'}
                </button>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {rejectTarget && (
        <RejectReasonModal
          name={((rejectTarget.resume as Record<string, unknown> | undefined)?.candidate_name as string) || 'this candidate'}
          askReason={!!rejectTarget.candidate_id}
          onCancel={closeReject}
          onConfirm={reason => {
            const row = rejectTarget
            setRejectTarget(null)
            makeDecision(row, 'rejected', reason)
          }}
        />
      )}

      {eraseTarget && (
        <EraseCandidateModal
          candidateId={eraseTarget.candidateId}
          name={eraseTarget.name}
          onClose={() => setEraseTarget(null)}
          onErased={(result: EraseResult) => {
            setEraseTarget(null)
            showToast(failedVectors(result.vectors_failed) > 0
              ? 'Personal data erased. Some search entries could not be removed yet and will be retried'
              : 'Personal data erased')
            load(true); onRefresh()
          }}
        />
      )}

      {resumeModal && (
        <ResumeViewerModal
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

      {historyTarget && (
        <CandidateHistoryDrawer
          candidateId={historyTarget.id}
          candidateName={historyTarget.name}
          initialTab={historyTarget.tab}
          secureToken={historyTarget.secureToken}
          jobId={jobId}
          onOpenOffers={() => { setOfferModalCandidateId(historyTarget.id); setHistoryTarget(null) }}
          onClose={() => setHistoryTarget(null)}
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

      {reviewTarget && (
        <ExternalReviewModal
          key={`${reviewTarget.candidateId}-${reviewTarget.mode}`}
          candidateId={reviewTarget.candidateId}
          candidateName={reviewTarget.name}
          platformLabel={reviewTarget.platformLabel}
          scheduledAt={reviewTarget.scheduledAt}
          mode={reviewTarget.mode}
          onClose={closeReview}
          onSaved={result => {
            setReviewTarget(null)
            showToast(result.stage === 'completed'
              ? `Scorecard saved. Hire and Send offer are now available${result.report_ready === false ? '. The report is still being prepared' : ''}`
              : 'No-show recorded. Reschedule or reject the candidate')
            load(true); onRefresh()
          }}
        />
      )}

      {guideTarget && (
        <InterviewGuideModal
          key={guideTarget.candidateId}
          candidateId={guideTarget.candidateId}
          candidateName={guideTarget.name}
          onClose={closeGuide}
        />
      )}

      {shareTarget && (
        <ShareInterviewerModal
          key={shareTarget.candidateId}
          candidateId={shareTarget.candidateId}
          candidateName={shareTarget.name}
          onClose={closeShare}
        />
      )}

      {fitTarget && (
        <FitSnapshotPanel
          key={fitTarget.resumeId}
          jobId={jobId}
          resumeId={fitTarget.resumeId}
          candidateName={fitTarget.name}
          canRequestOpinion={canAiOpinion}
          onClose={closeFit}
        />
      )}
    </div>
  )
}
