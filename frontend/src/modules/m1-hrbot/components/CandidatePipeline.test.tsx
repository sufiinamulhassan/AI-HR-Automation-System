import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pipelineTsx from './CandidatePipeline.tsx?raw'
import pipelineCss from './CandidatePipeline.css?raw'
import panelTsx from './FitSnapshotPanel.tsx?raw'
import panelCss from './FitSnapshotPanel.css?raw'
import menuTsx from './RowActionMenu.tsx?raw'
import menuCss from './RowActionMenu.css?raw'
import reviewTsx from './ExternalReviewModal.tsx?raw'
import reviewCss from './ExternalReviewModal.css?raw'
import formTsx from './ScorecardForm.tsx?raw'
import formCss from './ScorecardForm.css?raw'
import guideTsx from './InterviewGuideModal.tsx?raw'
import guideCss from './InterviewGuideModal.css?raw'
import shareTsx from './ShareInterviewerModal.tsx?raw'
import shareCss from './ShareInterviewerModal.css?raw'
import { formatWhen, toLocalInput } from './externalInterview'

vi.setConfig({ testTimeout: 30_000 })

const api = vi.hoisted(() => ({
  myPermissions: vi.fn(),
  pipeline: vi.fn(),
  updateStage: vi.fn(),
  pipelineFit: vi.fn(),
  pipelineAiOpinion: vi.fn(),
  bulkUpdateStage: vi.fn(),
  resendInvite: vi.fn(),
  regenerateToken: vi.fn(),
  decision: vi.fn(),
  create: vi.fn(),
  scheduleExternal: vi.fn(),
  updateExternal: vi.fn(),
  resendExternal: vi.fn(),
  getExternalReview: vi.fn(),
  integrationsStatus: vi.fn(),
  resumeGet: vi.fn(),
  scenariosList: vi.fn(),
  listQuestions: vi.fn(),
  assignQuestion: vi.fn(),
  scheduleIcs: vi.fn(),
  erase: vi.fn(),
}))

vi.mock('../../../lib/api', () => ({
  authApi: { myPermissions: api.myPermissions },
  interviewApi: { scheduleIcs: api.scheduleIcs },
  jobsApi: {
    pipeline: api.pipeline,
    updateStage: api.updateStage,
    pipelineFit: api.pipelineFit,
    pipelineAiOpinion: api.pipelineAiOpinion,
    bulkUpdateStage: api.bulkUpdateStage,
  },
  candidatesApi: {
    resendInvite: api.resendInvite,
    regenerateToken: api.regenerateToken,
    decision: api.decision,
    create: api.create,
    scheduleExternal: api.scheduleExternal,
    updateExternal: api.updateExternal,
    resendExternal: api.resendExternal,
    getExternalReview: api.getExternalReview,
    erase: api.erase,
  },
  integrationsApi: { status: api.integrationsStatus },
  resumesApi: { get: api.resumeGet },
  scenariosApi: { list: api.scenariosList },
}))
vi.mock('../../../lib/codingApi', () => ({
  codingApi: { listQuestions: api.listQuestions, assignQuestion: api.assignQuestion },
}))
vi.mock('docx-preview', () => ({ renderAsync: vi.fn().mockResolvedValue(undefined) }))

vi.mock('./OfferModal', () => ({
  default: (p: { candidateId: string }) => <div data-testid="offer-modal">{p.candidateId}</div>,
}))
vi.mock('./CandidateHistoryDrawer', () => ({
  default: (p: { candidateId: string; candidateName: string; initialTab: string; secureToken?: string; jobId?: string; onOpenOffers?: () => void; onClose: () => void }) => (
    <div data-testid="history-drawer">
      {p.candidateId}|{p.candidateName}|{p.initialTab}|{p.secureToken ?? 'no-token'}|{p.jobId}
      <button type="button" onClick={p.onOpenOffers}>mock open offers</button>
      <button type="button" onClick={p.onClose}>mock close drawer</button>
    </div>
  ),
}))
vi.mock('./AssignCodingModal', () => ({
  default: (p: { candidateId: string; candidateName: string }) => <div data-testid="coding-modal">{p.candidateId}|{p.candidateName}</div>,
}))
vi.mock('./ScheduleInterviewModal', () => ({
  default: (p: { candidateId: string; candidateName: string }) => <div data-testid="schedule-modal">{p.candidateId}|{p.candidateName}</div>,
}))
vi.mock('./CommunicationModal', () => ({
  default: (p: { candidateId: string; candidateName: string }) => <div data-testid="comms-modal">{p.candidateId}|{p.candidateName}</div>,
}))
vi.mock('./InterviewGuideModal', () => ({
  default: (p: { candidateId: string; candidateName: string; onClose: () => void }) => (
    <div data-testid="guide-modal">
      {p.candidateId}|{p.candidateName}
      <button type="button" onClick={p.onClose}>mock close guide</button>
    </div>
  ),
}))
vi.mock('./ShareInterviewerModal', () => ({
  default: (p: { candidateId: string; candidateName: string; onClose: () => void }) => (
    <div data-testid="share-modal">
      {p.candidateId}|{p.candidateName}
      <button type="button" onClick={p.onClose}>mock close share</button>
    </div>
  ),
}))
vi.mock('./ExternalReviewModal', () => ({
  default: (p: { candidateId: string; candidateName: string; mode: string; platformLabel?: string; scheduledAt?: string | null; onClose: () => void; onSaved: (r: { stage: string; report_ready?: boolean }) => void }) => (
    <div data-testid="review-modal">
      {p.candidateId}|{p.candidateName}|{p.mode}|{p.platformLabel}|{p.scheduledAt ?? 'no-time'}
      <button type="button" onClick={() => p.onSaved({ stage: 'completed' })}>mock save review</button>
      <button type="button" onClick={() => p.onSaved({ stage: 'completed', report_ready: false })}>mock save review without report</button>
      <button type="button" onClick={() => p.onSaved({ stage: 'interviewing' })}>mock save no-show</button>
      <button type="button" onClick={p.onClose}>mock close review</button>
    </div>
  ),
}))

const { default: CandidatePipeline } = await import('./CandidatePipeline')
const { useAuthStore } = await import('../../../store/auth.store')

const JOB = { job_id: 'job_1', title: 'Backend Engineer', created_at: '2026-01-01T00:00:00Z', deadline_at: null }
const ADMIN = { role: 'admin', email: 'admin@x.com', name: 'Admin' }
const ALL_PERMISSIONS = ['jobs:bulk_stage', 'jobs:ai_fit_opinion']

const FIT = {
  resume_id: 'r1',
  candidate_name: 'Ada Lovelace',
  score: 0.82,
  semantic_part: 0.62,
  skills_boost: 0.2,
  threshold: 0.7,
  above_threshold: true,
  skills: { matched: ['Python', 'Django'], missing: ['Kubernetes'], extra: ['Rust', 'Go'], coverage: 0.6667 },
  seniority: { candidate: 'senior', required: ['mid', 'senior'], aligned: true },
  domain: { candidate: 'software_engineering', required: 'data_science', aligned: false },
  headline: '82% match, meets the 70% match threshold; covers 2 of 3 required skills.',
}

const OPINION = {
  summary: 'Strong backend profile with one infrastructure gap.',
  strengths: ['Deep Python and Django experience', 'Senior level fits the role'],
  concerns: ['No Kubernetes exposure on the profile'],
  follow_up_questions: ['How have you deployed Django services before?', 'What would you do to ramp up on Kubernetes?'],
  model: 'gpt-test',
}

type Row = Record<string, unknown>

function makeRow(id: string, name: string, stage: string, over: Row = {}): Row {
  return {
    resume_id: id,
    pipeline_stage: stage,
    similarity_score: 0.82,
    candidate_id: `cand_${id}`,
    secure_token: `tok_${id}`,
    interview_mode: 'platform',
    external_status: null,
    external_platform: null,
    external_platform_label: null,
    external_scheduled_at: null,
    external_join_url: null,
    review_submitted: false,
    resume: {
      candidate_name: name,
      candidate_email: `${id}@x.com`,
      classification: { job_domain: 'software_engineering', seniority_level: 'senior', skills: ['Python', 'Django'] },
    },
    ...over,
  }
}

const onViewReport = vi.fn()
const onRefresh = vi.fn()

async function renderPipeline(rows: Row[]) {
  api.pipeline.mockResolvedValue({ data: { pipeline: rows, required_skills: ['Python', 'Kubernetes'] } })
  render(<CandidatePipeline job={JOB} onViewReport={onViewReport} onRefresh={onRefresh} />)
  await screen.findByText(`${JOB.title}, Pipeline (${rows.length})`)
  return userEvent.setup()
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const actionsOf = (name: string) => rowOf(name).querySelector('td[data-label="Actions"]') as HTMLElement
const moreOf = (name: string) => screen.getByRole('button', { name: `More actions for ${name}` })
const labels = (els: HTMLElement[]) => els.map(e => e.textContent)

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(moreOf(name))
  return screen.getByRole('menu')
}
async function pick(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  await user.click(within(await openMenu(user, name)).getByRole('menuitem', { name: item }))
}
async function flush() {
  await act(async () => { await Promise.resolve() })
}

const REJECT_TITLE = 'Reject Ada Lovelace?'
async function rejectWith(user: ReturnType<typeof userEvent.setup>, reasonLabel: string) {
  const dialog = await screen.findByRole('dialog', { name: REJECT_TITLE })
  await user.selectOptions(within(dialog).getByLabelText('Reason'), reasonLabel)
  await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  onViewReport.mockReset()
  onRefresh.mockReset()
  api.myPermissions.mockResolvedValue({ data: { permissions: ALL_PERMISSIONS } })
  api.scenariosList.mockResolvedValue({ data: { scenarios: [] } })
  api.listQuestions.mockResolvedValue({ data: { questions: [] } })
  api.resumeGet.mockResolvedValue({ data: {} })
  api.updateStage.mockResolvedValue({ data: {} })
  api.decision.mockResolvedValue({ data: {} })
  api.integrationsStatus.mockResolvedValue({ data: { meetings: { configured_providers: ['zoom'] } } })
  api.getExternalReview.mockResolvedValue({ data: { external_interview: { platform: 'zoom', duration_minutes: 45, notes: null }, external_review: null } })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no file in tests')))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  window.localStorage.clear()
  useAuthStore.setState({ token: 'tok', user: ADMIN })
})

const STAGE_CASES: [string, string, string[]][] = [
  ['matched', 'Shortlist', ['Set up interview', 'Reject', 'View résumé', 'Fit snapshot']],
  ['shortlisted', 'Set up interview', ['Reject', 'View résumé', 'Fit snapshot', 'Notes', 'Timeline']],
  ['invited', 'Resend invite', ['Regenerate link', 'Schedule', 'Assign coding', 'Message', 'Notes', 'Timeline', 'View résumé', 'Reject']],
  ['interviewing', 'Message', ['Regenerate link', 'Schedule', 'Assign coding', 'Notes', 'Timeline', 'View résumé', 'Reject']],
  ['completed', 'View report', ['Hire', 'Reject', 'Send offer', 'Assign coding', 'Schedule', 'Message', 'Notes', 'Timeline', 'View résumé']],
  ['hired', 'Send offer', ['View report', 'Message', 'Notes', 'Timeline', 'View résumé']],
  ['rejected', 'Reconsider', ['View résumé', 'Notes', 'Timeline']],
]

describe('stage-aware row actions', () => {
  it.each(STAGE_CASES)('%s: one primary button "%s" and a menu of the remaining actions', async (stage, primary, menu) => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', stage)])

    const buttons = within(actionsOf('Ada Lovelace')).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent(primary)
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toHaveAccessibleName('More actions for Ada Lovelace')

    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem'))).toEqual(menu)
  })

  it('omits candidate-scoped items from the menu, and disables a candidate-scoped primary, when the row has no candidate_id', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited', { candidate_id: undefined })])

    const primary = within(actionsOf('Ada Lovelace')).getAllByRole('button')[0]
    expect(primary).toHaveTextContent('Resend invite')
    expect(primary).toBeDisabled()
    expect(primary).toHaveAttribute('title', 'No interview invite exists for this candidate yet')

    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem'))).toEqual(['View résumé', 'Reject'])
  })

  it('omits Send offer, Assign coding, Schedule, Message, Notes and Timeline on a completed row without candidate_id', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { candidate_id: undefined })])
    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem'))).toEqual(['Hire', 'Reject', 'View résumé'])
  })

  it('omits View report, and disables it as the primary, when the row has no secure_token', async () => {
    const user = await renderPipeline([
      makeRow('r1', 'Ada Lovelace', 'completed', { secure_token: undefined }),
      makeRow('r2', 'Grace Hopper', 'hired', { secure_token: undefined, similarity_score: 0.7 }),
    ])

    const primary = within(actionsOf('Ada Lovelace')).getAllByRole('button')[0]
    expect(primary).toHaveTextContent('View report')
    expect(primary).toBeDisabled()

    expect(labels(within(await openMenu(user, 'Grace Hopper')).getAllByRole('menuitem')))
      .toEqual(['Message', 'Notes', 'Timeline', 'View résumé'])
  })

  it('reads the interview token from the résumé document when the row itself has none', async () => {
    const row = makeRow('r1', 'Ada Lovelace', 'completed', { secure_token: undefined })
    ;(row.resume as Row).secure_token = 'tok_from_resume'
    const user = await renderPipeline([row])
    await user.click(within(actionsOf('Ada Lovelace')).getAllByRole('button')[0])
    expect(onViewReport).toHaveBeenCalledWith('tok_from_resume')
  })

  it('keeps notes admin-only: a non-admin menu has no Notes item, and keeps the read-only ones', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem')))
      .toEqual(['View résumé', 'Fit snapshot', 'Timeline'])
  })

  it('gives a stage it does not know a usable row', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'on_hold')])
    expect(within(actionsOf('Ada Lovelace')).getAllByRole('button')[0]).toHaveTextContent('View résumé')
    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem')))
      .toEqual(['Fit snapshot', 'Notes', 'Timeline'])
  })

  it('has no always-visible icon buttons any more: three buttons per row at most', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    expect(within(rowOf('Ada Lovelace')).getAllByRole('button')).toHaveLength(3)
  })
})

describe('row action wiring', () => {
  it('Shortlist moves the candidate to shortlisted, toasts and reloads', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Shortlist' }))

    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'shortlisted')
    expect(await screen.findByText('Ada Lovelace shortlisted')).toBeInTheDocument()
    await waitFor(() => expect(api.pipeline).toHaveBeenCalledTimes(2))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('Reconsider moves a rejected candidate back to matched', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Reconsider' }))
    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'matched')
    expect(await screen.findByText('Ada Lovelace moved back to review')).toBeInTheDocument()
  })

  it('shows a failure toast when a stage change is refused', async () => {
    api.updateStage.mockRejectedValue(new Error('403'))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Shortlist' }))
    expect(await screen.findByText('Failed to update. Please try again')).toBeInTheDocument()
  })

  it('Resend invite re-sends with the current link and does not regenerate it', async () => {
    api.resendInvite.mockResolvedValue({ data: { sent_to: 'r1@x.com' } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Resend invite' }))

    expect(api.resendInvite).toHaveBeenCalledWith('cand_r1')
    expect(api.regenerateToken).not.toHaveBeenCalled()
    expect(await screen.findByText('Invite resent to r1@x.com')).toBeInTheDocument()
  })

  it('surfaces the server detail when resending is refused', async () => {
    api.resendInvite.mockRejectedValue({ response: { data: { detail: 'No email on file for this candidate' } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Resend invite' }))
    expect(await screen.findByText('No email on file for this candidate')).toBeInTheDocument()
  })

  it('surfaces the server detail when the invite email could not be sent (502)', async () => {
    api.resendInvite.mockRejectedValue({
      response: { status: 502, data: { detail: 'The invite email could not be sent. Check the mail settings.' } },
    })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Resend invite' }))

    expect(await screen.findByText('The invite email could not be sent. Check the mail settings.')).toBeInTheDocument()
    expect(screen.queryByText(/^Invite resent to/)).not.toBeInTheDocument()
  })

  it('falls back to a plain message when resending fails without a detail', async () => {
    api.resendInvite.mockRejectedValue({ response: { status: 502, data: {} } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Resend invite' }))

    expect(await screen.findByText('Failed to resend invite')).toBeInTheDocument()
  })

  it('Regenerate link confirms first, then issues a new link and emails it', async () => {
    api.regenerateToken.mockResolvedValue({ data: { secure_token: 'tok_new' } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await pick(user, 'Ada Lovelace', 'Regenerate link')

    expect(window.confirm).toHaveBeenCalled()
    expect(api.regenerateToken).toHaveBeenCalledWith('cand_r1', true)
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('/interview/tok_new')))
  })

  it('Regenerate link does not say the email was sent when it was not', async () => {
    api.regenerateToken.mockResolvedValue({ data: { secure_token: 'tok_new', email_resent: false } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await pick(user, 'Ada Lovelace', 'Regenerate link')

    expect(await screen.findByText('New interview link generated and copied, but the email could not be sent')).toBeInTheDocument()
    expect(screen.queryByText('New interview link generated, sent, and copied to clipboard')).not.toBeInTheDocument()
  })

  it('Regenerate link does nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await pick(user, 'Ada Lovelace', 'Regenerate link')
    expect(api.regenerateToken).not.toHaveBeenCalled()
  })

  it.each([['matched'], ['shortlisted']])('%s: Set up interview opens the form for that candidate', async stage => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', stage)])
    if (stage === 'matched') await pick(user, 'Ada Lovelace', 'Set up interview')
    else await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Set up interview' }))

    expect(await screen.findByRole('dialog', { name: 'Set up interview' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByDisplayValue('r1@x.com')).toBeInTheDocument()
  })

  it('View report (primary, completed) opens the report for that candidate token', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'View report' }))
    expect(onViewReport).toHaveBeenCalledWith('tok_r1')
  })

  it('Hire records the hire decision on the candidate and moves the stage', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Hire')

    expect(api.decision).toHaveBeenCalledWith('cand_r1', 'hire')
    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'hired')
    expect(await screen.findByText('✓ Marked as hired')).toBeInTheDocument()
  })

  it('Reject records the reject decision, with the reason chosen, on the candidate and moves the stage', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    await pick(user, 'Ada Lovelace', 'Reject')
    await rejectWith(user, 'Salary')

    expect(api.decision).toHaveBeenCalledWith('cand_r1', 'reject', undefined, 'salary')
    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'rejected')
    expect(await screen.findByText('✕ Candidate rejected')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: REJECT_TITLE })).not.toBeInTheDocument()
  })

  it('Reject asks first, with a required reason, and changes nothing until it is answered', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Reject')

    const dialog = await screen.findByRole('dialog', { name: REJECT_TITLE })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const reason = within(dialog).getByLabelText('Reason')
    expect(reason).toHaveValue('')
    expect(within(reason).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Select a reason', 'Not a fit', 'Salary', 'Withdrew', 'No show', 'Position filled', 'Other'])
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(api.decision).not.toHaveBeenCalled()
    expect(api.updateStage).not.toHaveBeenCalled()

    await user.selectOptions(reason, 'Withdrew')
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it.each([
    ['Not a fit', 'not_a_fit'],
    ['Salary', 'salary'],
    ['Withdrew', 'withdrew'],
    ['No show', 'no_show'],
    ['Position filled', 'position_filled'],
    ['Other', 'other'],
  ])('sends the reason "%s" as %s', async (label, value) => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Reject')
    await rejectWith(user, label)
    expect(api.decision).toHaveBeenCalledTimes(1)
    expect(api.decision).toHaveBeenCalledWith('cand_r1', 'reject', undefined, value)
  })

  it.each([
    ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('button', { name: 'Cancel' })) }],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => { await user.keyboard('{Escape}') }],
    ['a backdrop click', async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByTestId('reject-backdrop')) }],
  ])('%s leaves the candidate as they were', async (_how, dismiss) => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Reject')
    await user.selectOptions(await screen.findByLabelText('Reason'), 'Salary')
    await dismiss(user)

    expect(screen.queryByRole('dialog', { name: REJECT_TITLE })).not.toBeInTheDocument()
    expect(api.decision).not.toHaveBeenCalled()
    expect(api.updateStage).not.toHaveBeenCalled()
  })

  it('asks for the reason afresh each time', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Reject')
    await user.selectOptions(await screen.findByLabelText('Reason'), 'Salary')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await pick(user, 'Ada Lovelace', 'Reject')
    expect(await screen.findByLabelText('Reason')).toHaveValue('')
  })

  it('Reject on a matched row (no candidate yet) has nowhere to keep a reason, so it only confirms, then moves the stage', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched', { candidate_id: undefined })])
    await pick(user, 'Ada Lovelace', 'Reject')

    const dialog = await screen.findByRole('dialog', { name: REJECT_TITLE })
    expect(within(dialog).queryByLabelText('Reason')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))

    expect(api.decision).not.toHaveBeenCalled()
    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'rejected')
  })

  it('a failed rejection says so in a toast and leaves the dialog closed', async () => {
    api.decision.mockRejectedValue({ response: { status: 500, data: { detail: 'Could not reject.' } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Reject')
    await rejectWith(user, 'Other')
    expect(await screen.findByText('Could not reject.')).toBeInTheDocument()
    expect(api.updateStage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: REJECT_TITLE })).not.toBeInTheDocument()
  })

  it.each([
    ['completed', 'Send offer', 'offer-modal', 'cand_r1'],
    ['invited', 'Assign coding', 'coding-modal', 'cand_r1|Ada Lovelace'],
    ['invited', 'Schedule', 'schedule-modal', 'cand_r1|Ada Lovelace'],
    ['invited', 'Message', 'comms-modal', 'cand_r1|Ada Lovelace'],
    ['invited', 'Notes', 'history-drawer', 'cand_r1|Ada Lovelace|notes|tok_r1|job_1'],
    ['invited', 'Timeline', 'history-drawer', 'cand_r1|Ada Lovelace|timeline|tok_r1|job_1'],
  ])('%s row: menu item "%s" opens its modal for the right candidate', async (stage, item, testId, content) => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', stage)])
    await pick(user, 'Ada Lovelace', item)
    expect(screen.getByTestId(testId)).toHaveTextContent(content)
  })

  it('Notes and Timeline both open the history drawer, on their own tab, and pass the résumé token when the row has none', async () => {
    const row = makeRow('r1', 'Ada Lovelace', 'invited', { secure_token: undefined })
    ;(row.resume as Row).secure_token = 'tok_from_resume'
    const user = await renderPipeline([row])

    await pick(user, 'Ada Lovelace', 'Notes')
    expect(screen.getByTestId('history-drawer')).toHaveTextContent('cand_r1|Ada Lovelace|notes|tok_from_resume|job_1')

    await user.click(screen.getByRole('button', { name: 'mock close drawer' }))
    expect(screen.queryByTestId('history-drawer')).not.toBeInTheDocument()

    await pick(user, 'Ada Lovelace', 'Timeline')
    expect(screen.getByTestId('history-drawer')).toHaveTextContent('cand_r1|Ada Lovelace|timeline|tok_from_resume|job_1')
  })

  it('the drawer hands off to the offers modal for the same candidate and closes itself', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Timeline')

    await user.click(screen.getByRole('button', { name: 'mock open offers' }))

    expect(screen.queryByTestId('history-drawer')).not.toBeInTheDocument()
    expect(screen.getByTestId('offer-modal')).toHaveTextContent('cand_r1')
  })

  it('the primary actions that open a modal do so (Message on interviewing, Send offer on hired)', async () => {
    const user = await renderPipeline([
      makeRow('r1', 'Ada Lovelace', 'interviewing'),
      makeRow('r2', 'Grace Hopper', 'hired', { similarity_score: 0.7 }),
    ])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Message' }))
    expect(screen.getByTestId('comms-modal')).toHaveTextContent('cand_r1|Ada Lovelace')

    await user.click(within(actionsOf('Grace Hopper')).getByRole('button', { name: 'Send offer' }))
    expect(screen.getByTestId('offer-modal')).toHaveTextContent('cand_r2')
  })

  it('View résumé opens the preview for that résumé', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await pick(user, 'Ada Lovelace', 'View résumé')
    expect(api.resumeGet).toHaveBeenCalledWith('r1', true)
    expect(await screen.findByText(/Preview not available/)).toBeInTheDocument()
  })
})

describe('fit snapshot', () => {
  it('shows the score as a ring button with an accessible name, and fetches nothing until it is used', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    const ring = screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' })
    expect(within(ring).getByText('82%')).toBeInTheDocument()
    expect(api.pipelineFit).not.toHaveBeenCalled()
  })

  it('opens a right-side slide-over from the ring with the chip groups, signals and threshold marker', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])

    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))

    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    expect(api.pipelineFit).toHaveBeenCalledWith('job_1', 'r1')
    expect(within(dialog).getByText(FIT.headline)).toBeInTheDocument()
    expect(dialog).toHaveClass('fit-panel')

    expect(within(dialog).getByText('Match threshold')).toBeInTheDocument()
    expect(within(dialog).getByTestId('threshold-marker').style.left).toBe('70%')

    const skillsRow = within(dialog).getByText('Skills coverage').closest('li') as HTMLElement
    const seniorityRow = within(dialog).getByText('Seniority').closest('li') as HTMLElement
    const domainRow = within(dialog).getByText('Domain').closest('li') as HTMLElement
    expect(within(skillsRow).getByText('Aligned')).toBeInTheDocument()
    expect(within(seniorityRow).getByText('Aligned')).toBeInTheDocument()
    expect(within(domainRow).getByText('Not aligned')).toBeInTheDocument()

    const chips = (name: RegExp) => {
      const group = within(dialog).getByRole('heading', { name }).closest('.fit-chip-group') as HTMLElement
      return Array.from(group.querySelectorAll('.skill-tag')).map(e => e.textContent)
    }
    expect(chips(/^Covered/)).toEqual(['Python', 'Django'])
    expect(chips(/^Gaps/)).toEqual(['Kubernetes'])
    expect(chips(/^Also has/)).toEqual(['Rust', 'Go'])
  })

  it('opens from the Fit snapshot menu item too', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    await pick(user, 'Ada Lovelace', 'Fit snapshot')
    expect(await screen.findByRole('dialog', { name: 'Fit Snapshot' })).toBeInTheDocument()
    expect(api.pipelineFit).toHaveBeenCalledWith('job_1', 'r1')
  })

  it('closes on Escape and on a backdrop click', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    const ring = screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' })

    await user.click(ring)
    await screen.findByText(FIT.headline)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ring).toHaveFocus()

    await user.click(ring)
    await screen.findByText(FIT.headline)
    await user.click(screen.getByTestId('fit-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('AI take: shows a loading state, then the summary, strengths, concerns and suggested questions', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    let resolveOpinion!: (v: unknown) => void
    api.pipelineAiOpinion.mockReturnValue(new Promise(res => { resolveOpinion = res }))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    await within(dialog).findByText(FIT.headline)

    await user.click(await within(dialog).findByRole('button', { name: 'Get an AI take' }))

    expect(api.pipelineAiOpinion).toHaveBeenCalledWith('job_1', 'r1')
    const busy = within(dialog).getByRole('button', { name: /Reading the profile/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    await act(async () => { resolveOpinion({ data: OPINION }) })

    expect(await within(dialog).findByText(OPINION.summary)).toBeInTheDocument()
    for (const s of OPINION.strengths) expect(within(dialog).getByText(s)).toBeInTheDocument()
    for (const c of OPINION.concerns) expect(within(dialog).getByText(c)).toBeInTheDocument()
    for (const q of OPINION.follow_up_questions) expect(within(dialog).getByText(q)).toBeInTheDocument()
    expect(within(dialog).getByText('Strengths')).toBeInTheDocument()
    expect(within(dialog).getByText('Concerns')).toBeInTheDocument()
    expect(within(dialog).getByText('Suggested questions')).toBeInTheDocument()
    expect(within(dialog).getByText('Generated by gpt-test')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Refresh AI take' })).toBeEnabled()
  })

  it('AI take: a 502 shows the server message inline and leaves the panel working', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const detail = 'AI second opinion unavailable: the model request failed or timed out. Please try again shortly.'
    api.pipelineAiOpinion.mockRejectedValueOnce({ response: { status: 502, data: { detail } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    await within(dialog).findByText(FIT.headline)

    await user.click(await within(dialog).findByRole('button', { name: 'Get an AI take' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(detail)
    expect(within(dialog).getByText(FIT.headline)).toBeInTheDocument()
    expect(within(dialog).getByTestId('threshold-marker')).toBeInTheDocument()

    api.pipelineAiOpinion.mockResolvedValueOnce({ data: OPINION })
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByText(OPINION.summary)).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('AI take: not offered when the caller lacks jobs:ai_fit_opinion', async () => {
    api.myPermissions.mockResolvedValue({ data: { permissions: ['jobs:bulk_stage'] } })
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()

    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    await within(dialog).findByText(FIT.headline)
    expect(within(dialog).queryByRole('button', { name: /AI take/ })).not.toBeInTheDocument()
  })

  it('AI take: not offered to a non-admin, whatever the permission list says', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    await within(dialog).findByText(FIT.headline)
    expect(within(dialog).queryByRole('button', { name: /AI take/ })).not.toBeInTheDocument()
    expect(api.myPermissions).not.toHaveBeenCalled()
  })

  it('shows an inline error inside the panel when the fit cannot be loaded', async () => {
    api.pipelineFit.mockRejectedValue({ response: { status: 404 } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the fit snapshot')
    expect(screen.getByText('Ada Lovelace', { selector: '.cand-name' })).toBeInTheDocument()
  })
})

function reviewRows() {
  return [
    makeRow('r1', 'Ada Lovelace', 'matched', { similarity_score: 0.9 }),
    makeRow('r2', 'Grace Hopper', 'matched', { similarity_score: 0.8 }),
    makeRow('r3', 'Alan Turing', 'matched', { similarity_score: 0.7 }),
    makeRow('r4', 'Edsger Dijkstra', 'shortlisted', { similarity_score: 0.6 }),
  ]
}
const filterTab = (name: RegExp) => screen.getByRole('button', { name })

describe('review queue and bulk actions', () => {
  it('shows no selection controls outside the matched filter, even with matched rows on screen', async () => {
    const user = await renderPipeline(reviewRows())
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText(/Awaiting your review/)).not.toBeInTheDocument()

    await user.click(filterTab(/^shortlisted/))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText(/Awaiting your review/)).not.toBeInTheDocument()
  })

  it('on the matched filter shows the review strip, a select-all and one checkbox per row', async () => {
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))

    expect(screen.getByText('Awaiting your review: 3 candidates')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Select all candidates awaiting review' })).toBeInTheDocument()
    for (const n of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']) {
      expect(screen.getByRole('checkbox', { name: `Select ${n}` })).not.toBeChecked()
    }
    expect(screen.queryByRole('checkbox', { name: 'Select Edsger Dijkstra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('uses the singular for one candidate', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(filterTab(/^matched/))
    expect(screen.getByText('Awaiting your review: 1 candidate')).toBeInTheDocument()
  })

  it('Shortlist selected sends exactly the ticked ids to bulk-stage, then toasts the counts and reloads', async () => {
    api.bulkUpdateStage.mockResolvedValue({ data: { updated: 1, skipped: ['r3'] } })
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))

    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Alan Turing' }))

    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()

    await user.click(within(bar).getByRole('button', { name: 'Shortlist selected' }))

    expect(api.bulkUpdateStage).toHaveBeenCalledTimes(1)
    expect(api.bulkUpdateStage).toHaveBeenCalledWith('job_1', ['r1', 'r3'], 'shortlisted')
    expect(await screen.findByText('1 shortlisted, 1 skipped')).toBeInTheDocument()
    await waitFor(() => expect(api.pipeline).toHaveBeenCalledTimes(2))
    expect(onRefresh).toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('select-all ticks every visible row and the count follows', async () => {
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))

    const all = await screen.findByRole('checkbox', { name: 'Select all candidates awaiting review' })
    await user.click(all)
    expect(all).toBeChecked()
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(all).not.toBeChecked()
    expect((all as HTMLInputElement).indeterminate).toBe(true)

    await user.click(all)
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await user.click(all)
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('Clear empties the selection without calling the API', async () => {
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).not.toBeChecked()
    expect(api.bulkUpdateStage).not.toHaveBeenCalled()
  })

  it('Reject selected asks for confirmation first, and sends nothing when declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Grace Hopper' }))

    await user.click(screen.getByRole('button', { name: 'Reject selected' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Reject 1 selected candidate'))
    expect(api.bulkUpdateStage).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('Reject selected sends the stage once confirmed', async () => {
    api.bulkUpdateStage.mockResolvedValue({ data: { updated: 2, skipped: [] } })
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select all candidates awaiting review' }))

    await user.click(screen.getByRole('button', { name: 'Reject selected' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Reject 3 selected candidates'))
    expect(api.bulkUpdateStage).toHaveBeenCalledWith('job_1', ['r1', 'r2', 'r3'], 'rejected')
    expect(await screen.findByText('2 rejected, 0 skipped')).toBeInTheDocument()
  })

  it('never sends rows hidden by the score cutoff', async () => {
    api.bulkUpdateStage.mockResolvedValue({ data: { updated: 2, skipped: [] } })
    const rows = [...reviewRows(), makeRow('r5', 'Low Scorer', 'matched', { similarity_score: 0.2 })]
    const user = await renderPipeline(rows)
    await user.click(filterTab(/^matched/))

    expect(screen.getByText('Awaiting your review: 3 candidates')).toBeInTheDocument()
    expect(screen.queryByText('Low Scorer')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all candidates awaiting review' }))
    await user.click(screen.getByRole('button', { name: 'Shortlist selected' }))
    expect(api.bulkUpdateStage).toHaveBeenCalledWith('job_1', ['r1', 'r2', 'r3'], 'shortlisted')
  })

  it('clears the selection when the filter changes', async () => {
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(filterTab(/^all/))
    await user.click(filterTab(/^matched/))
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).not.toBeChecked()
  })

  it('splits a selection one over the endpoint cap into calls of 100 and 1 ids and adds the counts up', async () => {
    api.bulkUpdateStage.mockImplementation((_job: string, ids: string[]) =>
      Promise.resolve({ data: { updated: ids.length - 1, skipped: ['gone'] } }))
    const rows = Array.from({ length: 101 }, (_, i) => makeRow(`r${i}`, `Person ${String(i).padStart(3, '0')}`, 'matched', { similarity_score: 0.99 - i / 1000 }))
    const user = await renderPipeline(rows)
    await user.click(screen.getByText('matched', { selector: '.filter-btn' }))

    await user.click(await screen.findByLabelText('Select all candidates awaiting review'))
    expect(screen.getByText('101 selected')).toBeInTheDocument()
    await user.click(screen.getByText('Shortlist selected'))

    await waitFor(() => expect(api.bulkUpdateStage).toHaveBeenCalledTimes(2))
    expect(api.bulkUpdateStage.mock.calls.map(c => (c[1] as string[]).length)).toEqual([100, 1])
    const sent = api.bulkUpdateStage.mock.calls.flatMap(c => c[1] as string[])
    expect(new Set(sent).size).toBe(101)
    expect(api.bulkUpdateStage.mock.calls.every(c => (c[1] as string[]).length > 0)).toBe(true)
    expect(await screen.findByText('99 shortlisted, 2 skipped')).toBeInTheDocument()
  }, 30000)

  it('stops at the first refused chunk, reports the server detail, and keeps the rest selected', async () => {
    api.bulkUpdateStage
      .mockResolvedValueOnce({ data: { updated: 100, skipped: [] } })
      .mockRejectedValueOnce({ response: { status: 403, data: { detail: 'Missing required permission: jobs:bulk_stage' } } })
    const rows = Array.from({ length: 101 }, (_, i) => makeRow(`r${i}`, `Person ${String(i).padStart(3, '0')}`, 'matched', { similarity_score: 0.99 - i / 1000 }))
    const user = await renderPipeline(rows)
    await user.click(screen.getByText('matched', { selector: '.filter-btn' }))
    await user.click(await screen.findByLabelText('Select all candidates awaiting review'))
    await user.click(screen.getByText('Shortlist selected'))

    expect(await screen.findByText('Bulk update stopped: Missing required permission: jobs:bulk_stage. 100 shortlisted, 0 skipped so far')).toBeInTheDocument()
    expect(api.bulkUpdateStage).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument()
  }, 30000)

  it('shows the server detail when the very first call is refused', async () => {
    api.bulkUpdateStage.mockRejectedValue({ response: { status: 403, data: { detail: 'Missing required permission: jobs:bulk_stage' } } })
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Shortlist selected' }))

    expect(await screen.findByText('Bulk update failed: Missing required permission: jobs:bulk_stage')).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    api.bulkUpdateStage.mockRejectedValue(new Error('Network Error'))
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Shortlist selected' }))
    expect(await screen.findByText('Bulk update failed: please try again')).toBeInTheDocument()
  })

  it('offers no selection controls to an admin whose role lacks jobs:bulk_stage, but still shows the strip', async () => {
    api.myPermissions.mockResolvedValue({ data: { permissions: ['jobs:ai_fit_opinion'] } })
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()

    expect(screen.getByText('Awaiting your review: 3 candidates')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('offers no selection controls to a non-admin', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    const user = await renderPipeline(reviewRows())
    await user.click(filterTab(/^matched/))
    await flush()

    expect(screen.getByText('Awaiting your review: 3 candidates')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(api.myPermissions).not.toHaveBeenCalled()
  })
})

const MEETING_URL = 'https://zoom.us/j/123456789'
const SCHEDULED_AT = '2026-10-20T10:00:00Z'
const PAST_AT = '2020-01-01T10:00:00Z'

function externalRow(id: string, name: string, stage: string, over: Row = {}): Row {
  return makeRow(id, name, stage, {
    interview_mode: 'external',
    external_status: 'scheduled',
    external_platform: 'zoom',
    external_platform_label: 'Zoom',
    external_scheduled_at: SCHEDULED_AT,
    external_join_url: MEETING_URL,
    review_submitted: false,
    ...over,
  })
}

const DEFAULT_MENU = ['Interview guide', 'Share with interviewer', 'Change time or link', 'Resend meeting link', 'Copy meeting link', 'Message', 'Notes', 'Timeline', 'View résumé', 'Reject']
const primaryLabel = (name: string) => within(actionsOf(name)).getAllByRole('button')[0].textContent
async function menuLabels(user: ReturnType<typeof userEvent.setup>, name: string) {
  return labels(within(await openMenu(user, name)).getAllByRole('menuitem'))
}

describe('row actions for an interview on another platform', () => {
  it.each([
    ['scheduled'],
    ['awaiting_review'],
  ])('interviewing (%s): primary "Add scorecard", the interview guide and sharing first in the menu, and no AI-interview or post-interview actions', async status => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: status })])
    expect(primaryLabel('Ada Lovelace')).toBe('Add scorecard')
    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).toEqual(DEFAULT_MENU)
    for (const gone of ['Hire', 'Send offer', 'Regenerate link', 'Assign coding', 'Schedule', 'Resend invite', 'View report', 'View scorecard']) {
      expect(menu).not.toContain(gone)
    }
  })

  it('invited: the same set, because the meeting is arranged and nothing has been filed', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'invited')])
    expect(primaryLabel('Ada Lovelace')).toBe('Add scorecard')
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(DEFAULT_MENU)
  })

  it.each([['interviewing'], ['invited']])(
    'no-show (%s): primary becomes "Change time or link" and Add scorecard stays in the menu so a mistaken no-show can be corrected',
    async stage => {
      const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', stage, { external_status: 'no_show' })])
      expect(primaryLabel('Ada Lovelace')).toBe('Change time or link')
      const menu = await menuLabels(user, 'Ada Lovelace')
      expect(menu).toEqual(['Add scorecard', 'Reject', 'Message', 'Notes', 'Timeline', 'View résumé'])
      expect(menu).not.toContain('Hire')
      expect(menu).not.toContain('Send offer')
    },
  )

  it('correcting a no-show: Add scorecard in the menu opens the scorecard form for that candidate', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'no_show' })])
    await pick(user, 'Ada Lovelace', 'Add scorecard')

    expect(screen.getByTestId('review-modal')).toHaveTextContent('cand_r1|Ada Lovelace|edit|Zoom|' + SCHEDULED_AT)
  })

  it('correcting a no-show with a scorecard that sets the attendance right unlocks the review-gated actions', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'no_show' })])
    await pick(user, 'Ada Lovelace', 'Add scorecard')
    api.pipeline.mockResolvedValue({ data: { pipeline: [externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true })], required_skills: [] } })
    await user.click(screen.getByRole('button', { name: 'mock save review' }))

    await waitFor(() => expect(primaryLabel('Ada Lovelace')).toBe('View report'))
    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).toContain('Hire')
    expect(menu).toContain('Send offer')
  })

  it('completed with a scorecard: primary "View report", View scorecard first in the menu, Hire and Send offer in it', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true })])
    expect(primaryLabel('Ada Lovelace')).toBe('View report')
    expect(await menuLabels(user, 'Ada Lovelace'))
      .toEqual(['View scorecard', 'Hire', 'Reject', 'Send offer', 'Message', 'Notes', 'Timeline', 'View résumé'])
  })

  it('hired with a scorecard: primary "Send offer", View report and View scorecard sit in the menu', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'hired', { external_status: 'reviewed', review_submitted: true })])
    expect(primaryLabel('Ada Lovelace')).toBe('Send offer')
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(['View report', 'View scorecard', 'Message', 'Notes', 'Timeline', 'View résumé'])
  })

  it('offers the guide and sharing only before the scorecard: never after it, never on a platform row', async () => {
    const user = await renderPipeline([
      externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true }),
      externalRow('r2', 'Grace Hopper', 'hired', { external_status: 'reviewed', review_submitted: true, similarity_score: 0.8 }),
      makeRow('r3', 'Alan Turing', 'invited', { similarity_score: 0.7 }),
    ])
    for (const name of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']) {
      const menu = await menuLabels(user, name)
      expect(menu).not.toContain('Interview guide')
      expect(menu).not.toContain('Share with interviewer')
      await user.keyboard('{Escape}')
    }
  })

  it('leaves the guide and sharing out of a row that has no candidate record', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { candidate_id: undefined })])
    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).not.toContain('Interview guide')
    expect(menu).not.toContain('Share with interviewer')
  })

  it('Interview guide opens the guide for that candidate', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Interview guide')
    expect(screen.getByTestId('guide-modal')).toHaveTextContent('cand_r1|Ada Lovelace')
    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'mock close guide' }))
    expect(screen.queryByTestId('guide-modal')).not.toBeInTheDocument()
  })

  it('Share with interviewer opens the link manager for that candidate', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'invited')])
    await pick(user, 'Ada Lovelace', 'Share with interviewer')
    expect(screen.getByTestId('share-modal')).toHaveTextContent('cand_r1|Ada Lovelace')
    expect(screen.queryByTestId('guide-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'mock close share' }))
    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument()
  })

  it('View report (primary, after the scorecard) opens the interview report with the row\'s secure token', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true })])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'View report' }))
    expect(onViewReport).toHaveBeenCalledWith('tok_r1')
    expect(screen.queryByTestId('review-modal')).not.toBeInTheDocument()
  })

  it('View report is disabled on the row, with the reason, when it has no secure token', async () => {
    await renderPipeline([externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true, secure_token: undefined })])
    const primary = within(actionsOf('Ada Lovelace')).getAllByRole('button')[0]
    expect(primary).toHaveTextContent('View report')
    expect(primary).toBeDisabled()
    expect(primary).toHaveAttribute('title', 'No interview report is available yet')
  })

  it('View report is in the menu of a hired candidate too', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'hired', { external_status: 'reviewed', review_submitted: true })])
    await pick(user, 'Ada Lovelace', 'View report')
    expect(onViewReport).toHaveBeenCalledWith('tok_r1')
  })

  it('never offers Hire or Send offer while review_submitted is false, whatever the stage', async () => {
    const user = await renderPipeline([
      externalRow('r1', 'Ada Lovelace', 'completed'),
      externalRow('r2', 'Grace Hopper', 'hired', { similarity_score: 0.8 }),
      externalRow('r3', 'Alan Turing', 'invited', { similarity_score: 0.7 }),
    ])
    for (const name of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']) {
      expect(primaryLabel(name)).toBe('Add scorecard')
      const menu = await menuLabels(user, name)
      expect(menu).not.toContain('Hire')
      expect(menu).not.toContain('Send offer')
      expect(menu).not.toContain('View scorecard')
      expect(menu).not.toContain('View report')
      await user.keyboard('{Escape}')
    }
  })

  it('treats a missing review_submitted as not reviewed', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'completed', { review_submitted: undefined })])
    expect(primaryLabel('Ada Lovelace')).toBe('Add scorecard')
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Hire')
  })

  it('Hire and Send offer appear once the scorecard is saved and the pipeline reloads', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'awaiting_review' })])
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Hire')
    await user.keyboard('{Escape}')

    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Add scorecard' }))
    expect(screen.getByTestId('review-modal')).toHaveTextContent('cand_r1|Ada Lovelace|edit|Zoom|' + SCHEDULED_AT)

    api.pipeline.mockResolvedValue({ data: { pipeline: [externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true })], required_skills: [] } })
    await user.click(screen.getByRole('button', { name: 'mock save review' }))

    expect(await screen.findByText('Scorecard saved. Hire and Send offer are now available')).toBeInTheDocument()
    expect(screen.queryByTestId('review-modal')).not.toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalled()
    await waitFor(() => expect(primaryLabel('Ada Lovelace')).toBe('View report'))
    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).toContain('Hire')
    expect(menu).toContain('Send offer')
  })

  it('says the report is still being prepared when the scorecard saved without one', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'awaiting_review' })])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Add scorecard' }))
    await user.click(screen.getByRole('button', { name: 'mock save review without report' }))
    expect(await screen.findByText('Scorecard saved. Hire and Send offer are now available. The report is still being prepared')).toBeInTheDocument()
  })

  it('a saved no-show reloads the pipeline and says nothing was unlocked', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'awaiting_review' })])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Add scorecard' }))
    api.pipeline.mockResolvedValue({ data: { pipeline: [externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'no_show' })], required_skills: [] } })
    await user.click(screen.getByRole('button', { name: 'mock save no-show' }))

    expect(await screen.findByText('No-show recorded. Reschedule or reject the candidate')).toBeInTheDocument()
    await waitFor(() => expect(primaryLabel('Ada Lovelace')).toBe('Change time or link'))
  })

  it('View scorecard (menu) opens the stored scorecards read-only for that candidate', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true })])
    await pick(user, 'Ada Lovelace', 'View scorecard')
    expect(screen.getByTestId('review-modal')).toHaveTextContent('cand_r1|Ada Lovelace|view|Zoom|' + SCHEDULED_AT)
  })

  it('View scorecard is also in the menu of a hired candidate', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'hired', { external_status: 'reviewed', review_submitted: true })])
    await pick(user, 'Ada Lovelace', 'View scorecard')
    expect(screen.getByTestId('review-modal')).toHaveTextContent('cand_r1|Ada Lovelace|view')
  })

  it('platform rows keep today\'s mapping, Resend invite included, and show no external controls', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    expect(primaryLabel('Ada Lovelace')).toBe('Resend invite')
    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).toEqual(['Regenerate link', 'Schedule', 'Assign coding', 'Message', 'Notes', 'Timeline', 'View résumé', 'Reject'])
    expect(rowOf('Ada Lovelace').querySelector('.cand-external')).toBeNull()
  })

  it('a completed platform row keeps Hire and Send offer without any review', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(expect.arrayContaining(['Hire', 'Send offer']))
  })
})

describe('external interview status line', () => {
  const STATUS_CASES: [string, string][] = [
    ['scheduled', 'Scheduled'],
    ['awaiting_review', 'Awaiting review'],
    ['no_show', 'No-show'],
    ['reviewed', 'Reviewed'],
  ]

  it.each(STATUS_CASES)('%s shows the platform, the local time and a "%s" badge', async (status, badge) => {
    await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: status })])
    const line = rowOf('Ada Lovelace').querySelector('.cand-external') as HTMLElement
    expect(line).toHaveTextContent(`Zoom · ${formatWhen(SCHEDULED_AT)}`.replace(/\s+/g, ' '))
    expect(within(line).getByText(badge)).toHaveClass('badge')
  })

  it('uses the server\'s custom label for another platform', async () => {
    await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_platform: 'other', external_platform_label: 'Webex' })])
    expect(rowOf('Ada Lovelace').querySelector('.cand-external')).toHaveTextContent(/^Webex · /)
  })

  it('a platform row shows no status line', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited')])
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument()
    expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
  })
})

describe('external meeting row actions', () => {
  it('Resend meeting link calls the endpoint and toasts the address', async () => {
    api.resendExternal.mockResolvedValue({ data: { email_sent: true, sent_to: 'r1@x.com' } })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Resend meeting link')
    expect(api.resendExternal).toHaveBeenCalledWith('cand_r1')
    expect(await screen.findByText('Meeting link resent to r1@x.com')).toBeInTheDocument()
  })

  it('says so when the resend email could not be sent', async () => {
    api.resendExternal.mockResolvedValue({ data: { email_sent: false, sent_to: 'r1@x.com' } })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Resend meeting link')
    expect(await screen.findByText('The email could not be sent. Check the address, or ask an admin to check Email Delivery')).toBeInTheDocument()
  })

  it('surfaces the server detail when the resend is refused', async () => {
    api.resendExternal.mockRejectedValue({ response: { status: 409, data: { detail: 'No meeting is set up for this candidate' } } })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Resend meeting link')
    expect(await screen.findByText('No meeting is set up for this candidate')).toBeInTheDocument()
  })

  it('Copy meeting link puts the join URL on the clipboard', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Copy meeting link')
    expect(await screen.findByText('Meeting link copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(MEETING_URL)
  })

  it('leaves Copy meeting link out when no link is on file', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_join_url: null })])
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Copy meeting link')
  })
})

describe('Hire and the review gate', () => {
  it('shows the server detail in the toast when Hire is refused with a 409', async () => {
    api.decision.mockRejectedValue({ response: { status: 409, data: { detail: 'Add the interview review first.' } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Hire')

    expect(await screen.findByText('Add the interview review first.')).toBeInTheDocument()
    expect(api.updateStage).not.toHaveBeenCalled()
    expect(screen.queryByText('Failed to update. Please try again')).not.toBeInTheDocument()
  })

  it('keeps the generic toast when a failed decision carries no detail', async () => {
    api.decision.mockRejectedValue(new Error('Network Error'))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed')])
    await pick(user, 'Ada Lovelace', 'Hire')
    expect(await screen.findByText('Failed to update. Please try again')).toBeInTheDocument()
  })
})

const futureLocal = (days = 2) => toLocalInput(new Date(Date.now() + days * 86_400_000))

async function openSetup(user: ReturnType<typeof userEvent.setup>, name = 'Ada Lovelace') {
  await user.click(within(actionsOf(name)).getByRole('button', { name: 'Set up interview' }))
  return screen.findByRole('dialog', { name: 'Set up interview' })
}
async function chooseAnotherPlatform(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('radio', { name: 'Another platform' }))
}
async function fillMeeting(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, when = futureLocal()) {
  await user.type(within(dialog).getByLabelText('Meeting link'), MEETING_URL)
  fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: when } })
}
const submitButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Send meeting details' })

describe('Set up interview: choosing how it runs', () => {
  it('defaults to the AI interview with its question-type controls and none of the meeting fields', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('How will this interview run?')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'AI interview on our platform' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Another platform' })).not.toBeChecked()
    expect(within(dialog).getByLabelText('Question Type')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create Interview Link' })).toBeEnabled()
    for (const absent of ['Platform', 'Date and time', 'Duration (minutes)', 'Meeting link', 'Notes for the candidate (optional)']) {
      expect(within(dialog).queryByLabelText(absent)).not.toBeInTheDocument()
    }
  })

  it('Another platform swaps the question-type controls for the meeting fields and the plain-language line', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)

    expect(within(dialog).queryByLabelText('Question Type')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Create Interview Link' })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
    expect(within(dialog).getAllByRole('option').map(o => o.textContent)).toEqual(['Zoom', 'Google Meet', 'Microsoft Teams', 'Other'])
    expect(within(dialog).getByLabelText('Date and time')).toHaveAttribute('type', 'datetime-local')
    expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(45)
    expect(within(dialog).getByLabelText('Meeting link')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Notes for the candidate (optional)')).toBeInTheDocument()
    expect(within(dialog).getByText('The candidate receives the link by email. Nothing else is sent.')).toBeInTheDocument()
    expect(submitButton(dialog)).toBeDisabled()

    await user.click(within(dialog).getByRole('radio', { name: 'AI interview on our platform' }))
    expect(within(dialog).getByLabelText('Question Type')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Meeting link')).not.toBeInTheDocument()
  })

  it('asks for a name only when the platform is Other', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).queryByLabelText('Platform name')).not.toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'other')
    await fillMeeting(user, dialog)
    expect(within(dialog).getByLabelText('Platform name')).toBeInTheDocument()
    expect(submitButton(dialog)).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Platform name'), 'Webex')
    expect(submitButton(dialog)).toBeEnabled()

    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'meet')
    expect(within(dialog).queryByLabelText('Platform name')).not.toBeInTheDocument()
  })

  it('offers "Create the meeting for me" only for a configured zoom or teams, and it replaces the link', async () => {
    api.integrationsStatus.mockResolvedValue({ data: { meetings: { configured_providers: ['zoom'] } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)

    await within(dialog).findByLabelText('Create the meeting for me')
    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'meet')
    expect(within(dialog).queryByLabelText('Create the meeting for me')).not.toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'teams')
    expect(within(dialog).queryByLabelText('Create the meeting for me')).not.toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'other')
    expect(within(dialog).queryByLabelText('Create the meeting for me')).not.toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'zoom')
    expect(within(dialog).getByLabelText('Create the meeting for me')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal() } })
    expect(submitButton(dialog)).toBeDisabled()

    await user.click(within(dialog).getByLabelText('Create the meeting for me'))
    expect(within(dialog).queryByLabelText('Meeting link')).not.toBeInTheDocument()
    expect(submitButton(dialog)).toBeEnabled()
  })

  it('offers no meeting creation at all when no provider is configured', async () => {
    api.integrationsStatus.mockResolvedValue({ data: { meetings: { configured_providers: [] } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await waitFor(() => expect(api.integrationsStatus).toHaveBeenCalled())
    await flush()
    expect(within(dialog).queryByLabelText('Create the meeting for me')).not.toBeInTheDocument()
  })

  it('does not ask for the meeting providers when the caller is not an admin, who cannot open the form at all', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    expect(within(actionsOf('Ada Lovelace')).queryByRole('button', { name: 'Set up interview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Set up interview' })).not.toBeInTheDocument()
    expect(api.integrationsStatus).not.toHaveBeenCalled()
  })

  it('keeps Submit disabled until the time is in the future, the duration is 5 to 480 and the link is https', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    const link = within(dialog).getByLabelText('Meeting link')
    const when = within(dialog).getByLabelText('Date and time')
    const duration = within(dialog).getByLabelText('Duration (minutes)')

    await user.type(link, 'http://zoom.us/j/1')
    expect(within(dialog).getByText('Enter the full link, starting with https://')).toBeInTheDocument()
    fireEvent.change(when, { target: { value: futureLocal() } })
    expect(submitButton(dialog)).toBeDisabled()

    await user.clear(link)
    await user.type(link, MEETING_URL)
    expect(submitButton(dialog)).toBeEnabled()

    fireEvent.change(when, { target: { value: '2020-01-01T10:00' } })
    expect(within(dialog).getByText('Pick a date and time in the future.')).toBeInTheDocument()
    expect(submitButton(dialog)).toBeDisabled()
    fireEvent.change(when, { target: { value: futureLocal() } })
    expect(submitButton(dialog)).toBeEnabled()

    for (const bad of ['4', '481', '']) {
      await user.clear(duration)
      if (bad) await user.type(duration, bad)
      expect(submitButton(dialog)).toBeDisabled()
    }
    await user.clear(duration)
    await user.type(duration, '30')
    expect(submitButton(dialog)).toBeEnabled()
  })
})

describe('Set up interview: sending the meeting details', () => {
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

  it('an existing candidate record is sent as candidate_id, with the time converted to ISO and the zone', async () => {
    const when = futureLocal(3)
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: true } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog, when)
    await user.type(within(dialog).getByLabelText('Notes for the candidate (optional)'), 'Join five minutes early')
    await user.click(submitButton(dialog))

    expect(api.scheduleExternal).toHaveBeenCalledTimes(1)
    expect(api.scheduleExternal.mock.calls[0][0]).toEqual({
      candidate_id: 'cand_r1',
      platform: 'zoom',
      join_url: MEETING_URL,
      scheduled_start_at: new Date(when).toISOString(),
      duration_minutes: 45,
      notes: 'Join five minutes early',
      display_timezone: TZ,
    })
    expect(api.create).not.toHaveBeenCalled()
    expect(api.updateStage).not.toHaveBeenCalled()
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Meeting details sent to Ada Lovelace')
    expect(within(dialog).queryByLabelText('Meeting link')).not.toBeInTheDocument()
    await waitFor(() => expect(api.pipeline).toHaveBeenCalledTimes(2))
    expect(onRefresh).toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Set up interview' })).not.toBeInTheDocument()
  })

  it('a row with no candidate record is created from job_id, resume_id, name and email', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_new', interview_mode: 'external', external_interview: {}, email_sent: true } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted', { candidate_id: undefined })])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await user.clear(within(dialog).getByLabelText('Candidate Email'))
    await user.type(within(dialog).getByLabelText('Candidate Email'), '  ada@new.com ')
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))

    const body = api.scheduleExternal.mock.calls[0][0]
    expect(body).toMatchObject({ job_id: 'job_1', resume_id: 'r1', name: 'Ada Lovelace', email: 'ada@new.com', platform: 'zoom', join_url: MEETING_URL })
    expect(body).not.toHaveProperty('candidate_id')
    expect(body.notes).toBeUndefined()
  })

  it('locks the name and email when the row already has a candidate record, and unlocks them for AI mode', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    expect(within(dialog).getByLabelText('Candidate Name')).toBeEnabled()
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Candidate Name')).toBeDisabled()
    expect(within(dialog).getByLabelText('Candidate Email')).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: 'AI interview on our platform' }))
    expect(within(dialog).getByLabelText('Candidate Email')).toBeEnabled()
  })

  it('needs a name and an email when the candidate has to be created', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted', { candidate_id: undefined })])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog)
    expect(submitButton(dialog)).toBeEnabled()
    await user.clear(within(dialog).getByLabelText('Candidate Email'))
    expect(within(dialog).getByText('No email on file for this candidate. Enter one to send the meeting details.')).toBeInTheDocument()
    expect(submitButton(dialog)).toBeDisabled()
  })

  it('shortlists a matched candidate first, then sets up the meeting', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: true } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await pick(user, 'Ada Lovelace', 'Set up interview')
    const dialog = await screen.findByRole('dialog', { name: 'Set up interview' })
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))

    await waitFor(() => expect(api.scheduleExternal).toHaveBeenCalled())
    expect(api.updateStage).toHaveBeenCalledWith('job_1', 'r1', 'shortlisted')
    expect(api.updateStage.mock.invocationCallOrder[0]).toBeLessThan(api.scheduleExternal.mock.invocationCallOrder[0])
  })

  it('sends create_meeting instead of a link when "Create the meeting for me" is ticked', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: true } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await user.click(await within(dialog).findByLabelText('Create the meeting for me'))
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal() } })
    await user.click(submitButton(dialog))

    const body = api.scheduleExternal.mock.calls[0][0]
    expect(body).toMatchObject({ platform: 'zoom', create_meeting: true })
    expect(body.join_url).toBeUndefined()
  })

  it('sends the custom platform name for Other', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: true } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'other')
    await user.type(within(dialog).getByLabelText('Platform name'), ' Webex ')
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))
    expect(api.scheduleExternal.mock.calls[0][0]).toMatchObject({ platform: 'other', platform_label: 'Webex' })
  })

  it('says the email could not be sent when the meeting saved but the mail failed', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: false } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved, but the email could not be sent')
    expect(within(dialog).getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument()
  })

  it.each([
    [409, 'This candidate has already been invited to this job.'],
    [422, 'That link does not look like a Zoom link.'],
    [502, 'Zoom could not create the meeting. Try again shortly.'],
  ])('keeps the form open and shows the server detail for a %s', async (status, detail) => {
    api.scheduleExternal.mockRejectedValue({ response: { status, data: { detail } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('dialog', { name: 'Set up interview' })).toBeInTheDocument()
    expect(submitButton(dialog)).toBeEnabled()
    expect(api.pipeline).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    api.scheduleExternal.mockRejectedValue(new Error('Network Error'))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await fillMeeting(user, dialog)
    await user.click(submitButton(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Failed to set up the interview. Please try again')
  })

  it('the AI path is unchanged: Create Interview Link calls POST /candidates and shows the link', async () => {
    api.create.mockResolvedValue({ data: { candidate_id: 'cand_new', secure_token: 'tok_new' } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create Interview Link' }))

    expect(api.create).toHaveBeenCalledWith({
      job_id: 'job_1', name: 'Ada Lovelace', email: 'r1@x.com', resume_id: 'r1', scenario_id: undefined,
    })
    expect(api.scheduleExternal).not.toHaveBeenCalled()
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('/interview/tok_new')))
    expect(await screen.findByText('Interview link created, copied to clipboard')).toBeInTheDocument()
  })

  it('says so when the invite was created but its email could not be sent', async () => {
    api.create.mockResolvedValue({ data: { candidate_id: 'cand_new', secure_token: 'tok_new', email_sent: false } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create Interview Link' }))

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('/interview/tok_new')))
    expect(await screen.findByText('Interview link created and copied, but the email could not be sent')).toBeInTheDocument()
    expect(screen.queryByText('Interview link created, copied to clipboard')).not.toBeInTheDocument()
  })
})

describe('Change time or link', () => {
  it('opens the external form filled from the row, with the duration and notes fetched from the server', async () => {
    api.getExternalReview.mockResolvedValue({
      data: { external_interview: { platform: 'zoom', duration_minutes: 30, notes: 'Bring a laptop' }, external_review: null },
    })
    const when = futureLocal(4)
    const iso = new Date(when).toISOString()
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: iso })])
    await pick(user, 'Ada Lovelace', 'Change time or link')

    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    expect(api.getExternalReview).toHaveBeenCalledWith('cand_r1')
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
    expect(within(dialog).getByLabelText('Meeting link')).toHaveValue(MEETING_URL)
    expect(within(dialog).getByLabelText('Date and time')).toHaveValue(when)
    await waitFor(() => expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(30))
    expect(within(dialog).getByLabelText('Notes for the candidate (optional)')).toHaveValue('Bring a laptop')
    expect(within(dialog).getByLabelText('Candidate Name')).toBeDisabled()
  })

  it('saves with PATCH, tells the candidate, and reloads', async () => {
    api.updateExternal.mockResolvedValue({ data: { external_interview: {}, email_sent: true } })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: PAST_AT })])
    await pick(user, 'Ada Lovelace', 'Change time or link')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })

    const save = within(dialog).getByRole('button', { name: 'Save and notify candidate' })
    await waitFor(() => expect(save).toBeDisabled())
    expect(within(dialog).getByText('Pick a date and time in the future.')).toBeInTheDocument()

    const when = futureLocal(5)
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: when } })
    const link = within(dialog).getByLabelText('Meeting link')
    await user.clear(link)
    await user.type(link, 'https://zoom.us/j/987654321')
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    expect(api.updateExternal).toHaveBeenCalledWith('cand_r1', expect.objectContaining({
      platform: 'zoom',
      join_url: 'https://zoom.us/j/987654321',
      scheduled_start_at: new Date(when).toISOString(),
      duration_minutes: 45,
    }))
    expect(api.scheduleExternal).not.toHaveBeenCalled()
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Meeting details sent to Ada Lovelace')
    await waitFor(() => expect(api.pipeline).toHaveBeenCalledTimes(2))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Change time or link' })).not.toBeInTheDocument()
  })

  it('is the primary action for a no-show and prefills Other with its custom name', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', {
      external_status: 'no_show', external_platform: 'other', external_platform_label: 'Webex',
    })])
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Change time or link' }))

    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('other')
    expect(within(dialog).getByLabelText('Platform name')).toHaveValue('Webex')
  })

  it('shows the server detail when the change is refused', async () => {
    api.updateExternal.mockRejectedValue({ response: { status: 422, data: { detail: 'That link does not look like a Zoom link.' } } })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Change time or link')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal() } })
    const save = within(dialog).getByRole('button', { name: 'Save and notify candidate' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That link does not look like a Zoom link.')
  })
})

function quickMeeting(dialog: HTMLElement, when = futureLocal()) {
  fireEvent.change(within(dialog).getByLabelText('Meeting link'), { target: { value: MEETING_URL } })
  fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: when } })
}
const SCHEDULED_OK = { data: { candidate_id: 'cand_r1', interview_mode: 'external', external_interview: {}, email_sent: true } }
const PREFS_KEY = 'hr-bot.interview-setup:admin@x.com'

describe('Set up interview: the default time', () => {
  afterEach(() => { vi.useRealTimers() })

  it.each([
    ['Monday', new Date(2026, 9, 5, 15, 30), '2026-10-06T10:00'],
    ['Thursday morning', new Date(2026, 9, 8, 7, 0), '2026-10-09T10:00'],
    ['Friday', new Date(2026, 9, 9, 17, 0), '2026-10-12T10:00'],
    ['Saturday', new Date(2026, 9, 10, 12, 0), '2026-10-12T10:00'],
    ['Sunday', new Date(2026, 9, 11, 12, 0), '2026-10-12T10:00'],
  ])('on a %s the time starts at 10:00 on the next business day', async (_day, now, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Date and time')).toHaveValue(expected)
    fireEvent.change(within(dialog).getByLabelText('Meeting link'), { target: { value: MEETING_URL } })
    expect(submitButton(dialog)).toBeEnabled()
  })

  it('can still be changed, and a new form starts at the default again', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    const original = (within(dialog).getByLabelText('Date and time') as HTMLInputElement).value
    expect(original).toMatch(/T10:00$/)

    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal(9) } })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    const again = await openSetup(user)
    await chooseAnotherPlatform(user, again)
    expect(within(again).getByLabelText('Date and time')).toHaveValue(original)
  })

  it('leaves the time of a meeting being changed alone, even when it has passed', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: PAST_AT })])
    await pick(user, 'Ada Lovelace', 'Change time or link')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    expect(within(dialog).getByLabelText('Date and time')).toHaveValue(toLocalInput(PAST_AT))
  })

  it('gives a meeting being changed that has no time the default one', async () => {
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: null })])
    await pick(user, 'Ada Lovelace', 'Change time or link')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    expect((within(dialog).getByLabelText('Date and time') as HTMLInputElement).value).toMatch(/T10:00$/)
  })
})

describe('Set up interview: remembered values', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const rows = () => [makeRow('r1', 'Ada Lovelace', 'shortlisted'), makeRow('r2', 'Grace Hopper', 'shortlisted', { candidate_id: 'cand_r2' })]

  it('starts the next form with the platform, the platform name and the length last used', async () => {
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline(rows())
    const first = await openSetup(user)
    await chooseAnotherPlatform(user, first)
    await user.selectOptions(within(first).getByLabelText('Platform'), 'other')
    fireEvent.change(within(first).getByLabelText('Platform name'), { target: { value: 'Webex' } })
    fireEvent.change(within(first).getByLabelText('Duration (minutes)'), { target: { value: '30' } })
    quickMeeting(first)
    await user.click(submitButton(first))
    await user.click(await within(first).findByRole('button', { name: 'Done' }))

    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null')).toEqual({ platform: 'other', duration: '30', label: 'Webex' })

    const second = await openSetup(user, 'Grace Hopper')
    await chooseAnotherPlatform(user, second)
    expect(within(second).getByLabelText('Platform')).toHaveValue('other')
    expect(within(second).getByLabelText('Platform name')).toHaveValue('Webex')
    expect(within(second).getByLabelText('Duration (minutes)')).toHaveValue(30)
  })

  it('keeps the platform name for later when the next meeting is on another platform', async () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ platform: 'other', duration: '30', label: 'Webex' }))
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline(rows())
    const first = await openSetup(user)
    await chooseAnotherPlatform(user, first)
    await user.selectOptions(within(first).getByLabelText('Platform'), 'zoom')
    quickMeeting(first)
    await user.click(submitButton(first))
    await user.click(await within(first).findByRole('button', { name: 'Done' }))

    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null')).toEqual({ platform: 'zoom', duration: '30', label: 'Webex' })
  })

  it('remembers nothing for the AI interview or for a meeting that could not be saved', async () => {
    api.scheduleExternal.mockRejectedValue({ response: { status: 422, data: { detail: 'That link does not look like a Zoom link.' } } })
    const user = await renderPipeline(rows())
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    await user.selectOptions(within(dialog).getByLabelText('Platform'), 'meet')
    quickMeeting(dialog)
    await user.click(submitButton(dialog))
    await within(dialog).findByRole('alert')
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull()
  })

  it('is kept apart for each person who signs in', async () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ platform: 'teams', duration: '60', label: '' }))
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'other@x.com', name: 'Other' } })
    const user = await renderPipeline(rows())
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
    expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(45)
  })

  it('uses what this person last used when they open the form', async () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ platform: 'teams', duration: '60', label: '' }))
    const user = await renderPipeline(rows())
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('teams')
    expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(60)
  })

  it.each([
    ['an unknown platform and an impossible length', { platform: 'skype', duration: '9999', label: 'x'.repeat(60) }],
    ['values of the wrong kind', { platform: 5, duration: 45, label: ['Webex'] }],
    ['text that is not JSON', 'not json at all'],
    ['an empty object', {}],
  ])('ignores %s in storage and uses the usual defaults', async (_what, stored) => {
    window.localStorage.setItem(PREFS_KEY, typeof stored === 'string' ? stored : JSON.stringify(stored))
    const user = await renderPipeline(rows())
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
    expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(45)
  })

  it('works when storage cannot be read or written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage is blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage is blocked') })
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline(rows())
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
    quickMeeting(dialog)
    await user.click(submitButton(dialog))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Meeting details sent to Ada Lovelace')
  })
})

describe('Set up interview: Add to calendar', () => {
  let downloads: string[]
  let blobs: Blob[]
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

  beforeEach(() => {
    downloads = []
    blobs = []
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:ics' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
  })
  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.restoreAllMocks()
  })

  async function scheduleAda(user: ReturnType<typeof userEvent.setup>, response: unknown = SCHEDULED_OK) {
    api.scheduleExternal.mockResolvedValue(response)
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    quickMeeting(dialog)
    await user.click(submitButton(dialog))
    await within(dialog).findByRole('status')
    return dialog
  }

  it('is offered once the meeting is saved, next to Done, and not before', async () => {
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
    quickMeeting(dialog)
    await user.click(submitButton(dialog))

    expect(await within(dialog).findByRole('button', { name: 'Add to calendar' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('downloads the calendar file for that candidate through the authenticated request', async () => {
    api.scheduleIcs.mockResolvedValue({ data: new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' }) })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await scheduleAda(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to calendar' }))

    await waitFor(() => expect(downloads).toEqual(['interview_cand_r1.ics']))
    expect(api.scheduleIcs).toHaveBeenCalledWith('cand_r1')
    expect(blobs).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ics')
    expect(within(dialog).getByRole('button', { name: 'Add to calendar' })).toBeEnabled()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Meeting details sent to Ada Lovelace')
  })

  it('disables the button while the file is prepared', async () => {
    let resolve!: (v: unknown) => void
    api.scheduleIcs.mockReturnValue(new Promise(res => { resolve = res }))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await scheduleAda(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to calendar' }))
    expect(within(dialog).getByRole('button', { name: 'Preparing…' })).toBeDisabled()
    resolve({ data: new Blob(['x']) })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add to calendar' })).toBeEnabled())
  })

  it('says so inline when the file cannot be fetched, and offers it again', async () => {
    api.scheduleIcs.mockRejectedValue(new Error('Network Error'))
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await scheduleAda(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to calendar' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not download the calendar file. Please try again')
    expect(downloads).toEqual([])
    expect(within(dialog).getByRole('button', { name: 'Add to calendar' })).toBeEnabled()
  })

  it('is offered after Change time or link too, for the same candidate', async () => {
    api.updateExternal.mockResolvedValue({ data: { external_interview: {}, email_sent: true } })
    api.scheduleIcs.mockResolvedValue({ data: new Blob(['x']) })
    const user = await renderPipeline([externalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: PAST_AT })])
    await pick(user, 'Ada Lovelace', 'Change time or link')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or link' })
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal(5) } })
    const save = within(dialog).getByRole('button', { name: 'Save and notify candidate' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await user.click(await within(dialog).findByRole('button', { name: 'Add to calendar' }))
    await waitFor(() => expect(api.scheduleIcs).toHaveBeenCalledWith('cand_r1'))
  })

  it('the close icon puts the dialog away, and the next one starts clean', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted'), makeRow('r2', 'Grace Hopper', 'shortlisted')])
    const dialog = await scheduleAda(user)
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Set up interview' })).not.toBeInTheDocument()

    const next = await openSetup(user, 'Grace Hopper')
    expect(within(next).queryByRole('status')).not.toBeInTheDocument()
    expect(within(next).getByRole('radio', { name: 'AI interview on our platform' })).toBeChecked()
  })

  it('is not part of the AI interview: its dialog closes on success as before', async () => {
    api.create.mockResolvedValue({ data: { candidate_id: 'cand_new', secure_token: 'tok_new' } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create Interview Link' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set up interview' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
  })
})

describe('rows waiting on a scorecard', () => {
  const waiting = () => [
    externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'awaiting_review' }),
    externalRow('r2', 'Grace Hopper', 'interviewing', { external_status: 'no_show' }),
    externalRow('r3', 'Linus Torvalds', 'interviewing', { external_status: 'scheduled' }),
    makeRow('r4', 'Alan Turing', 'interviewing'),
    externalRow('r5', 'Ken Thompson', 'completed', { external_status: 'reviewed', review_submitted: true }),
  ]
  const tab = (name: RegExp) => screen.getByRole('button', { name })
  const shown = () => within(document.querySelector('.pipeline-table tbody') as HTMLElement).getAllByRole('row').map(r => r.querySelector('.cand-name')?.textContent)

  it('puts a small count on the Interviewing tab: external interviews that are over or missed, and only those', async () => {
    await renderPipeline(waiting())
    const interviewing = tab(/^interviewing/)
    expect(within(interviewing).getByRole('img', { name: '2 awaiting a scorecard' })).toHaveTextContent('2')
    expect(within(interviewing).getByText('4')).toHaveClass('filter-count')
    for (const other of [/^all/, /^matched/, /^completed/, /^hired/]) {
      expect(within(tab(other)).queryByRole('img')).not.toBeInTheDocument()
    }
  })

  it('shows neither the count nor the chip when nothing is waiting', async () => {
    await renderPipeline([
      externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'scheduled' }),
      makeRow('r2', 'Grace Hopper', 'interviewing'),
    ])
    expect(screen.queryByRole('img', { name: /awaiting a scorecard/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Needs scorecard/ })).not.toBeInTheDocument()
  })

  it('does not count a rejected candidate, who no longer needs one', async () => {
    await renderPipeline([
      externalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'awaiting_review' }),
      externalRow('r2', 'Rita Rejected', 'rejected', { external_status: 'awaiting_review' }),
    ])
    expect(screen.getByRole('img', { name: '1 awaiting a scorecard' })).toBeInTheDocument()
  })

  it('has a Needs scorecard chip with the count that lists only those rows, and a second click returns to all', async () => {
    const user = await renderPipeline(waiting())
    expect(shown()).toHaveLength(5)
    const chip = tab(/^Needs scorecard/)
    expect(chip).toHaveTextContent('2')
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await user.click(chip)
    expect(shown().sort()).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveClass('active')

    await user.click(chip)
    expect(shown()).toHaveLength(5)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists those rows whichever stage they sit in', async () => {
    const user = await renderPipeline([
      externalRow('r1', 'Ada Lovelace', 'invited', { external_status: 'awaiting_review' }),
      externalRow('r2', 'Grace Hopper', 'interviewing', { external_status: 'no_show' }),
    ])
    await user.click(tab(/^Needs scorecard/))
    expect(shown().sort()).toEqual(['Ada Lovelace', 'Grace Hopper'])
  })

  it('leaves the chip when a stage tab is chosen, and the rows keep their usual actions', async () => {
    const user = await renderPipeline(waiting())
    await user.click(tab(/^Needs scorecard/))
    expect(primaryLabel('Ada Lovelace')).toBe('Add scorecard')
    expect(primaryLabel('Grace Hopper')).toBe('Change time or link')

    await user.click(tab(/^completed/))
    expect(shown()).toEqual(['Ken Thompson'])
    expect(tab(/^Needs scorecard/)).toHaveAttribute('aria-pressed', 'false')
  })

  it('says so when the chip is on and nothing is waiting any more, and keeps the chip to leave by', async () => {
    const user = await renderPipeline(waiting())
    await user.click(tab(/^Needs scorecard/))

    api.pipeline.mockResolvedValue({ data: { pipeline: [
      externalRow('r1', 'Ada Lovelace', 'completed', { external_status: 'reviewed', review_submitted: true }),
      externalRow('r2', 'Grace Hopper', 'completed', { external_status: 'reviewed', review_submitted: true }),
    ], required_skills: [] } })
    await user.click(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Add scorecard' }))
    await user.click(await screen.findByRole('button', { name: 'mock save review' }))

    expect(await screen.findByText('No candidates need a scorecard.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /awaiting a scorecard/ })).not.toBeInTheDocument()
    const chip = tab(/^Needs scorecard/)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await user.click(chip)
    expect(shown()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Needs scorecard/ })).not.toBeInTheDocument()
  })

  it('clears the selection of the review queue when the chip is chosen', async () => {
    const user = await renderPipeline([...waiting(), makeRow('r6', 'Zed Matched', 'matched')])
    await user.click(tab(/^matched/))
    await user.click(screen.getByRole('checkbox', { name: 'Select Zed Matched' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    await user.click(tab(/^Needs scorecard/))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    await user.click(tab(/^matched/))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Zed Matched' })).not.toBeChecked()
  })
})

describe('a link to a candidate', () => {
  let scroll: ReturnType<typeof vi.spyOn>
  const win = window as unknown as { matchMedia?: unknown }
  const tabs = () => Array.from(document.querySelectorAll('.pipeline-filters .filter-btn')) as HTMLElement[]
  const activeTab = () => tabs().find(t => t.classList.contains('active'))?.textContent ?? ''
  const shown = () => Array.from(document.querySelectorAll('.pipeline-table tbody .cand-name')).map(n => n.textContent)
  const focusedRows = () => Array.from(document.querySelectorAll('tr.row-focus'))
  const rows = () => [
    makeRow('r1', 'Ada Lovelace', 'matched'),
    makeRow('r2', 'Grace Hopper', 'completed'),
    makeRow('r3', 'Linus Torvalds', 'interviewing'),
  ]

  function renderFocused(pipelineRows: Row[], focusCandidateId: string | null, onFocusHandled = vi.fn()) {
    api.pipeline.mockResolvedValue({ data: { pipeline: pipelineRows, required_skills: [] } })
    const element = (focus: string | null, handled = onFocusHandled, job = JOB) => (
      <CandidatePipeline job={job} onViewReport={onViewReport} onRefresh={onRefresh} focusCandidateId={focus} onFocusHandled={handled} />
    )
    const view = render(element(focusCandidateId))
    return { ...view, onFocusHandled, element }
  }

  beforeEach(() => {
    scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete win.matchMedia
  })

  it('opens the stage tab that holds the candidate, so only that stage is listed', async () => {
    renderFocused(rows(), 'cand_r2')
    await waitFor(() => expect(activeTab()).toMatch(/^completed/))
    expect(shown()).toEqual(['Grace Hopper'])
  })

  it('scrolls the row to the middle of the view and marks it', async () => {
    renderFocused(rows(), 'cand_r3')
    await waitFor(() => expect(focusedRows()).toHaveLength(1))
    expect(focusedRows()[0].querySelector('.cand-name')?.textContent).toBe('Linus Torvalds')
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(focusedRows()[0])
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('scrolls without the animation for a person who asked their system for less motion', async () => {
    win.matchMedia = vi.fn().mockReturnValue({ matches: true })
    renderFocused(rows(), 'cand_r3')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    expect(win.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(focusedRows()).toHaveLength(1)
  })

  it('uses the smooth scroll when the system asks for nothing in particular', async () => {
    win.matchMedia = vi.fn().mockReturnValue({ matches: false })
    renderFocused(rows(), 'cand_r3')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('takes the mark off again after a moment', async () => {
    renderFocused(rows(), 'cand_r3')
    await waitFor(() => expect(focusedRows()).toHaveLength(1))
    await waitFor(() => expect(focusedRows()).toHaveLength(0), { timeout: 8000 })
    expect(activeTab()).toMatch(/^interviewing/)
  })

  it('tells the page it has dealt with the link, once', async () => {
    const { onFocusHandled } = renderFocused(rows(), 'cand_r2')
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    await flush()
    expect(onFocusHandled).toHaveBeenCalledTimes(1)
  })

  it('does nothing, and says nothing, for a candidate who is not in the pipeline', async () => {
    const { onFocusHandled } = renderFocused(rows(), 'cand_nobody')
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(activeTab()).toMatch(/^all/)
    expect(shown()).toHaveLength(3)
    expect(focusedRows()).toHaveLength(0)
    expect(scroll).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('No candidates in this stage.')).not.toBeInTheDocument()
  })

  it('does nothing when no candidate was asked for', async () => {
    const { onFocusHandled } = renderFocused(rows(), null)
    await screen.findByText(`${JOB.title}, Pipeline (3)`)
    await flush()
    expect(onFocusHandled).not.toHaveBeenCalled()
    expect(scroll).not.toHaveBeenCalled()
    expect(activeTab()).toMatch(/^all/)
  })

  it('waits for the rows to arrive before deciding the candidate is missing', async () => {
    let resolve!: (v: unknown) => void
    api.pipeline.mockReturnValue(new Promise(res => { resolve = res }))
    const onFocusHandled = vi.fn()
    render(<CandidatePipeline job={JOB} onViewReport={onViewReport} onRefresh={onRefresh} focusCandidateId="cand_r2" onFocusHandled={onFocusHandled} />)
    await flush()
    expect(onFocusHandled).not.toHaveBeenCalled()

    resolve({ data: { pipeline: rows(), required_skills: [] } })
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(focusedRows()).toHaveLength(1)
  })

  it('still finishes when the pipeline cannot be loaded', async () => {
    api.pipeline.mockRejectedValue(new Error('503'))
    const onFocusHandled = vi.fn()
    render(<CandidatePipeline job={JOB} onViewReport={onViewReport} onRefresh={onRefresh} focusCandidateId="cand_r2" onFocusHandled={onFocusHandled} />)
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(focusedRows()).toHaveLength(0)
  })

  it('does not take the rows of the job it came from for the rows of the job it was sent to', async () => {
    const jobB = { ...JOB, job_id: 'job_2', title: 'Data Analyst' }
    let resolveB!: (v: unknown) => void
    api.pipeline.mockImplementation((id: string) => id === 'job_1'
      ? Promise.resolve({ data: { pipeline: [makeRow('a1', 'Ada Lovelace', 'matched')], required_skills: [] } })
      : new Promise(res => { resolveB = res }))
    const onFocusHandled = vi.fn()
    const view = render(<CandidatePipeline job={JOB} onViewReport={onViewReport} onRefresh={onRefresh} onFocusHandled={onFocusHandled} />)
    await screen.findByText(`${JOB.title}, Pipeline (1)`)

    view.rerender(<CandidatePipeline job={jobB} onViewReport={onViewReport} onRefresh={onRefresh} focusCandidateId="cand_b1" onFocusHandled={onFocusHandled} />)
    await flush()
    expect(onFocusHandled).not.toHaveBeenCalled()

    resolveB({ data: { pipeline: [makeRow('b1', 'Grace Hopper', 'shortlisted')], required_skills: [] } })
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(focusedRows()).toHaveLength(1)
    expect(focusedRows()[0].querySelector('.cand-name')?.textContent).toBe('Grace Hopper')
    expect(activeTab()).toMatch(/^shortlisted/)
  })

  it('lowers the score cutoff for a weak match, which it would otherwise hide', async () => {
    renderFocused([makeRow('r1', 'Ada Lovelace', 'matched', { similarity_score: 0.2 })], 'cand_r1')
    await waitFor(() => expect(focusedRows()).toHaveLength(1))
    expect(screen.getByLabelText('Min match score')).toHaveValue('0')
    expect(shown()).toEqual(['Ada Lovelace'])
  })

  it('leaves the score cutoff alone for a strong match', async () => {
    renderFocused(rows(), 'cand_r2')
    await waitFor(() => expect(focusedRows()).toHaveLength(1))
    expect(screen.getByLabelText('Min match score')).toHaveValue('0.5')
  })

  it('shows all candidates for a stage this page has no tab for', async () => {
    renderFocused([makeRow('r1', 'Ada Lovelace', 'onboarding'), makeRow('r2', 'Grace Hopper', 'completed')], 'cand_r1')
    await waitFor(() => expect(focusedRows()).toHaveLength(1))
    expect(activeTab()).toMatch(/^all/)
    expect(shown()).toHaveLength(2)
  })

  it('follows a second link on the same open pipeline', async () => {
    const { rerender, element, onFocusHandled } = renderFocused(rows(), 'cand_r2')
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(activeTab()).toMatch(/^completed/)

    rerender(element(null))
    rerender(element('cand_r3'))
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(2))
    expect(activeTab()).toMatch(/^interviewing/)
    expect(focusedRows()[0].querySelector('.cand-name')?.textContent).toBe('Linus Torvalds')
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('marks and scrolls to the same candidate again for a second link to them', async () => {
    const { rerender, element, onFocusHandled } = renderFocused(rows(), 'cand_r3')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    rerender(element(null))
    rerender(element('cand_r3'))
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2))
    expect(onFocusHandled).toHaveBeenCalledTimes(2)
    expect(focusedRows()).toHaveLength(1)
  })

  it('copes with rows that have no candidate record yet', async () => {
    const { onFocusHandled } = renderFocused([makeRow('r1', 'Ada Lovelace', 'matched', { candidate_id: undefined }), ...rows().slice(1)], 'cand_r3')
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(shown()).toEqual(['Linus Torvalds'])
  })

  it('clears the selection made in the review queue, which the new tab would not show', async () => {
    const user = userEvent.setup()
    const { rerender, element, onFocusHandled } = renderFocused([makeRow('r1', 'Ada Lovelace', 'matched'), makeRow('r2', 'Grace Hopper', 'completed')], null)
    await screen.findByText(`${JOB.title}, Pipeline (2)`)
    await user.click(screen.getByRole('button', { name: /^matched/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    rerender(element('cand_r2'))
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^matched/ }))
    expect(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' })).not.toBeChecked()
  })
})

describe('a non-admin caller sees only the read-only row actions', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'User' } })
  })

  const served = (row: Row): Row => ({ ...row, secure_token: undefined })

  it.each([
    ['matched', ['View résumé', 'Fit snapshot']],
    ['shortlisted', ['View résumé', 'Fit snapshot', 'Timeline']],
    ['invited', ['Timeline', 'View résumé']],
    ['interviewing', ['Timeline', 'View résumé']],
    ['completed', ['Timeline', 'View résumé']],
    ['hired', ['Timeline', 'View résumé']],
    ['rejected', ['View résumé', 'Timeline']],
  ] as [string, string[]][])('%s: no primary button, and a menu of the read-only items alone', async (stage, menu) => {
    const user = await renderPipeline([served(makeRow('r1', 'Ada Lovelace', stage))])

    const buttons = within(actionsOf('Ada Lovelace')).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName('More actions for Ada Lovelace')
    expect(labels(within(await openMenu(user, 'Ada Lovelace')).getAllByRole('menuitem'))).toEqual(menu)
  })

  it.each([
    ['interviewing', { external_status: 'scheduled' }, ['Copy meeting link', 'Timeline', 'View résumé']],
    ['invited', { external_status: 'awaiting_review' }, ['Copy meeting link', 'Timeline', 'View résumé']],
    ['interviewing', { external_status: 'no_show' }, ['Timeline', 'View résumé']],
    ['completed', { external_status: 'reviewed', review_submitted: true }, ['Timeline', 'View résumé']],
    ['hired', { external_status: 'reviewed', review_submitted: true }, ['Timeline', 'View résumé']],
  ] as [string, Row, string[]][])('another platform, %s (%j): the scorecard, guide, sharing and meeting changes are all gone', async (stage, over, menu) => {
    const user = await renderPipeline([served(externalRow('r1', 'Ada Lovelace', stage, over))])
    expect(within(actionsOf('Ada Lovelace')).getAllByRole('button')).toHaveLength(1)
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(menu)
  })

  it('offers no write action by name, on any stage, in the row or its menu', async () => {
    const stages = ['matched', 'shortlisted', 'invited', 'interviewing', 'completed', 'hired', 'rejected']
    const user = await renderPipeline(stages.map((stage, i) => served(makeRow(`r${i}`, `Candidate ${stage}`, stage))))

    const readOnly = ['View résumé', 'Fit snapshot', 'Timeline', 'Copy meeting link']
    for (const stage of stages) {
      for (const label of await menuLabels(user, `Candidate ${stage}`)) expect(readOnly).toContain(label)
      await user.keyboard('{Escape}')
    }
    for (const write of ['Shortlist', 'Reconsider', 'Set up interview', 'Resend invite', 'Message', 'View report', 'Send offer', 'Add scorecard', 'Change time or link']) {
      expect(screen.queryByRole('button', { name: write })).not.toBeInTheDocument()
    }
  })

  it('leaves a row with a candidate record missing to what needs none', async () => {
    const user = await renderPipeline([served(makeRow('r1', 'Ada Lovelace', 'rejected', { candidate_id: undefined }))])
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(['View résumé'])
  })

  it('still opens the timeline and the fit snapshot', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    const user = await renderPipeline([served(makeRow('r1', 'Ada Lovelace', 'shortlisted'))])

    await pick(user, 'Ada Lovelace', 'Timeline')
    expect(screen.getByTestId('history-drawer')).toHaveTextContent('cand_r1|Ada Lovelace|timeline|no-token|job_1')
    await user.click(screen.getByRole('button', { name: 'mock close drawer' }))

    await pick(user, 'Ada Lovelace', 'Fit snapshot')
    expect(await screen.findByRole('dialog', { name: 'Fit Snapshot' })).toBeInTheDocument()
    expect(api.pipelineFit).toHaveBeenCalledWith('job_1', 'r1')
  })

  it('still opens the résumé', async () => {
    const user = await renderPipeline([served(makeRow('r1', 'Ada Lovelace', 'matched'))])
    await pick(user, 'Ada Lovelace', 'View résumé')
    await waitFor(() => expect(api.resumeGet).toHaveBeenCalledWith('r1', true))
  })

  it('can still copy the meeting link of an interview on another platform', async () => {
    const user = await renderPipeline([served(externalRow('r1', 'Ada Lovelace', 'interviewing'))])
    await pick(user, 'Ada Lovelace', 'Copy meeting link')
    expect(await screen.findByText('Meeting link copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(MEETING_URL)
  })

  it('does not ask for the lists the Set up interview form needs, or for the permission list', async () => {
    await renderPipeline([served(makeRow('r1', 'Ada Lovelace', 'matched'))])
    await flush()
    expect(api.scenariosList).not.toHaveBeenCalled()
    expect(api.listQuestions).not.toHaveBeenCalled()
    expect(api.myPermissions).not.toHaveBeenCalled()
  })

  it('gives an admin the same lists, and every action, on the same rows', async () => {
    useAuthStore.setState({ token: 'tok', user: ADMIN })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await waitFor(() => expect(api.listQuestions).toHaveBeenCalled())
    expect(api.scenariosList).toHaveBeenCalled()
    expect(within(actionsOf('Ada Lovelace')).getByRole('button', { name: 'Shortlist' })).toBeEnabled()
    expect(await menuLabels(user, 'Ada Lovelace')).toEqual(['Set up interview', 'Reject', 'View résumé', 'Fit snapshot'])
  })
})

describe('copy', () => {
  const banned = /\bwh[y]\b/i

  it('uses the banned word nowhere in the pipeline, snapshot or menu sources and styles', () => {
    const sources: Record<string, string> = {
      'CandidatePipeline.tsx': pipelineTsx,
      'CandidatePipeline.css': pipelineCss,
      'FitSnapshotPanel.tsx': panelTsx,
      'FitSnapshotPanel.css': panelCss,
      'RowActionMenu.tsx': menuTsx,
      'RowActionMenu.css': menuCss,
      'ExternalReviewModal.tsx': reviewTsx,
      'ExternalReviewModal.css': reviewCss,
      'ScorecardForm.tsx': formTsx,
      'ScorecardForm.css': formCss,
      'InterviewGuideModal.tsx': guideTsx,
      'InterviewGuideModal.css': guideCss,
      'ShareInterviewerModal.tsx': shareTsx,
      'ShareInterviewerModal.css': shareCss,
    }
    for (const [name, text] of Object.entries(sources)) {
      expect(text.match(banned), `${name} contains the banned word`).toBeNull()
    }
  })

  it('renders none of it in the open snapshot with an AI take on screen', async () => {
    api.pipelineFit.mockResolvedValue({ data: FIT })
    api.pipelineAiOpinion.mockResolvedValue({ data: OPINION })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(screen.getByRole('button', { name: 'Open fit snapshot for Ada Lovelace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Fit Snapshot' })
    await user.click(await within(dialog).findByRole('button', { name: 'Get an AI take' }))
    await within(dialog).findByText(OPINION.summary)

    expect(document.body.textContent ?? '').not.toMatch(banned)
    expect(document.body.innerHTML).not.toMatch(banned)
  })
})

describe('erasing a person (Super Admin)', () => {
  const SUPER = { role: 'superadmin', email: 'root@x.com', name: 'Root' }
  const WITH_ERASE = [...ALL_PERMISSIONS, 'candidates:erase']
  const ERASED = { candidate_id: 'cand_r1', erased: true, already_erased: false, counts: { resumes: 1 }, vectors_failed: 0 }

  async function openErase(user: ReturnType<typeof userEvent.setup>) {
    await pick(user, 'Ada Lovelace', 'Erase personal data')
    return screen.findByRole('dialog', { name: 'Erase personal data of Ada Lovelace?' })
  }

  beforeEach(() => {
    api.myPermissions.mockResolvedValue({ data: { permissions: WITH_ERASE } })
    api.erase.mockResolvedValue({ data: ERASED })
    useAuthStore.setState({ token: 'tok', user: SUPER })
  })

  it('puts the action last in the row menu, in the danger style, for someone holding candidates:erase', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await waitFor(async () => {
      await user.click(moreOf('Ada Lovelace'))
      expect(screen.getByRole('menuitem', { name: 'Erase personal data' })).toBeInTheDocument()
    })
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items[items.length - 1]).toHaveTextContent('Erase personal data')
  })

  it('is not offered without the permission, even to an administrator', async () => {
    api.myPermissions.mockResolvedValue({ data: { permissions: ALL_PERMISSIONS } })
    useAuthStore.setState({ token: 'tok', user: ADMIN })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Erase personal data')
  })

  it('is not offered for a row with no candidate record yet', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched', { candidate_id: undefined })])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Erase personal data')
  })

  it('asks for a reason and for ERASE to be typed before it erases, and sends nothing before then', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    const erase = within(dialog).getByRole('button', { name: 'Erase personal data' })

    expect(erase).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked to be forgotten')
    expect(erase).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'erase')
    expect(erase).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('Type ERASE to confirm'))
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    expect(erase).toBeEnabled()
    expect(api.erase).not.toHaveBeenCalled()
  })

  it('wants a reason of at least three characters', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    await user.type(within(dialog).getByLabelText('Reason'), 'ab')
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    expect(within(dialog).getByRole('button', { name: 'Erase personal data' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), 'c')
    expect(within(dialog).getByRole('button', { name: 'Erase personal data' })).toBeEnabled()
  })

  it('erases with the reason, closes, toasts and reloads the pipeline', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    await user.type(within(dialog).getByLabelText('Reason'), '  Asked to be forgotten  ')
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    await user.click(within(dialog).getByRole('button', { name: 'Erase personal data' }))

    await waitFor(() => expect(api.erase).toHaveBeenCalledWith('cand_r1', { reason: 'Asked to be forgotten' }))
    expect(await screen.findByText('Personal data erased')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Erase personal data of Ada Lovelace?' })).not.toBeInTheDocument()
    expect(api.pipeline).toHaveBeenCalledTimes(2)
    expect(onRefresh).toHaveBeenCalled()
  })

  it('warns when some search entries could not be removed yet', async () => {
    api.erase.mockResolvedValue({ data: { ...ERASED, vectors_failed: 2 } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked to be forgotten')
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    await user.click(within(dialog).getByRole('button', { name: 'Erase personal data' }))
    expect(await screen.findByText(/could not be removed yet and will be retried/)).toBeInTheDocument()
  })

  it('after a 409 shows the sentence and the employment choice, and retries with it ticked', async () => {
    const sentence = 'This person has an accepted offer or an employee record. Confirm that employment records may be erased as well to continue.'
    api.erase.mockRejectedValueOnce({ response: { status: 409, data: { detail: sentence } } }).mockResolvedValueOnce({ data: ERASED })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'hired')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    expect(within(dialog).queryByLabelText('Also erase their offer and employee records')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked to be forgotten')
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    await user.click(within(dialog).getByRole('button', { name: 'Erase personal data' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence)
    const box = within(dialog).getByLabelText('Also erase their offer and employee records')
    expect(box).not.toBeChecked()
    expect(api.erase).toHaveBeenLastCalledWith('cand_r1', { reason: 'Asked to be forgotten' })

    await user.click(box)
    await user.click(within(dialog).getByRole('button', { name: 'Erase personal data' }))
    await waitFor(() => expect(api.erase).toHaveBeenLastCalledWith('cand_r1', { reason: 'Asked to be forgotten', include_employment: true }))
    expect(await screen.findByText('Personal data erased')).toBeInTheDocument()
  })

  it('keeps the dialog open with the server sentence for any other refusal', async () => {
    api.erase.mockRejectedValue({ response: { status: 403, data: { detail: 'You do not have permission to do this' } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const dialog = await openErase(user)
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked to be forgotten')
    await user.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    await user.click(within(dialog).getByRole('button', { name: 'Erase personal data' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have permission to do this')
    expect(within(dialog).queryByLabelText('Also erase their offer and employee records')).not.toBeInTheDocument()
  })

  it('closes with nothing sent on Cancel and on Escape', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'rejected')])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    let dialog = await openErase(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: /Erase personal data/ })).not.toBeInTheDocument()

    dialog = await openErase(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Erase personal data/ })).not.toBeInTheDocument()
    expect(api.erase).not.toHaveBeenCalled()
  })
})

describe('an erased person in the pipeline', () => {
  const tombstone = (stage = 'rejected', over: Row = {}): Row => ({
    resume_id: 'r9', candidate_id: 'cand_r9', pipeline_stage: stage, erased: true, erased_at: '2026-10-01T10:00:00Z', ...over,
  })

  it('reads Erased candidate, with no name, no email and no skills', async () => {
    await renderPipeline([tombstone()])
    const row = screen.getByText('Erased candidate').closest('tr') as HTMLElement
    expect(row).toHaveClass('row-erased')
    expect(row.textContent).not.toContain('@')
    expect(row.querySelector('.cand-meta')).toBeNull()
    expect(row.querySelector('.skill-tag')).toBeNull()
  })

  it('has no actions at all, not even a menu', async () => {
    await renderPipeline([tombstone()])
    const row = screen.getByText('Erased candidate').closest('tr') as HTMLElement
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })

  it('has no actions for a Super Admin either', async () => {
    api.myPermissions.mockResolvedValue({ data: { permissions: [...ALL_PERMISSIONS, 'candidates:erase'] } })
    useAuthStore.setState({ token: 'tok', user: { role: 'superadmin', email: 'root@x.com' } })
    await renderPipeline([tombstone()])
    await waitFor(() => expect(api.myPermissions).toHaveBeenCalled())
    await flush()
    const row = screen.getByText('Erased candidate').closest('tr') as HTMLElement
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })

  it('is listed in the stage it was in, whatever the score filter says', async () => {
    await renderPipeline([tombstone('matched'), makeRow('r1', 'Ada Lovelace', 'matched')])
    expect(screen.getByText('Erased candidate')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('cannot be ticked for a bulk move', async () => {
    const user = await renderPipeline([tombstone('matched'), makeRow('r1', 'Ada Lovelace', 'matched')])
    await user.click(filterTab(/^matched/))
    const row = screen.getByText('Erased candidate').closest('tr') as HTMLElement
    expect(within(row).queryByRole('checkbox')).toBeNull()
    expect(within(rowOf('Ada Lovelace')).getByRole('checkbox')).toBeInTheDocument()
  })

  it('does not crash on a row that carries the flag on its résumé instead', async () => {
    await renderPipeline([makeRow('r1', '', 'rejected', { resume: { erased: true } })])
    expect(screen.getByText('Erased candidate')).toBeInTheDocument()
  })

  it('does not crash on a row with no résumé at all', async () => {
    await renderPipeline([{ resume_id: 'r8', candidate_id: 'cand_r8', pipeline_stage: 'completed', similarity_score: 0.9 }])
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })
})

describe('the AI interview score column', () => {
  const cellOf = (name: string) => rowOf(name).querySelector('td[data-label="Interview score"]') as HTMLElement

  it('shows an admin the score of an interview held here, next to the match score and not as a percentage', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 62 })])
    expect(screen.getByRole('columnheader', { name: 'Interview score' })).toBeInTheDocument()
    expect(cellOf('Ada Lovelace')).toHaveTextContent('62')
    expect(cellOf('Ada Lovelace')).not.toHaveTextContent('%')
    expect(rowOf('Ada Lovelace').querySelector('td[data-label="Score"]')).toHaveTextContent('82%')
  })

  it('puts the column between the match score and the skills', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 62 })])
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers.slice(headers.indexOf('Score'), headers.indexOf('Score') + 3)).toEqual(['Score', 'Interview score', 'Skills'])
  })

  it('opens the interview report from the ring', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 62 })])
    await user.click(within(cellOf('Ada Lovelace')).getByRole('button', { name: 'Open the interview report of Ada Lovelace, interview score 62 out of 100' }))
    expect(onViewReport).toHaveBeenCalledWith('tok_r1')
  })

  it('shows a dash for a candidate not interviewed yet', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'invited'), makeRow('r2', 'Grace Hopper', 'matched')])
    expect(cellOf('Ada Lovelace')).toHaveTextContent('-')
    expect(cellOf('Grace Hopper')).toHaveTextContent('-')
    expect(within(cellOf('Ada Lovelace')).queryByRole('button')).toBeNull()
  })

  it('shows a score of zero as a score, not as missing', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 0 })])
    expect(cellOf('Ada Lovelace')).toHaveTextContent('0')
    expect(cellOf('Ada Lovelace')).not.toHaveTextContent('-')
  })

  it('reads green from 70, amber below 40 and neutral between', async () => {
    await renderPipeline([
      makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 85 }),
      makeRow('r2', 'Grace Hopper', 'completed', { final_score: 62 }),
      makeRow('r3', 'Alan Turing', 'completed', { final_score: 30 }),
    ])
    expect(cellOf('Ada Lovelace').querySelector('.score-ring')).toHaveClass('score-ring-ok')
    expect(cellOf('Grace Hopper').querySelector('.score-ring')).not.toHaveClass('score-ring-ok', 'score-ring-warn')
    expect(cellOf('Alan Turing').querySelector('.score-ring')).toHaveClass('score-ring-warn')
  })

  it('shows the ring without a button when there is no report to open', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 62, secure_token: undefined })])
    expect(cellOf('Ada Lovelace')).toHaveTextContent('62')
    expect(within(cellOf('Ada Lovelace')).queryByRole('button')).toBeNull()
  })

  it('shows a dash for an erased person', async () => {
    await renderPipeline([{ resume_id: 'r9', candidate_id: 'cand_r9', pipeline_stage: 'rejected', erased: true, final_score: 62 }])
    const row = screen.getByText('Erased candidate').closest('tr') as HTMLElement
    expect(row.querySelector('td[data-label="Interview score"]')).toHaveTextContent('-')
  })

  it('is not there at all for a recruiter, whatever the payload carries', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'completed', { final_score: 62 })])
    expect(screen.queryByRole('columnheader', { name: 'Interview score' })).toBeNull()
    expect(rowOf('Ada Lovelace').querySelector('td[data-label="Interview score"]')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Score' })).toBeInTheDocument()
  })
})

const ADDRESS = 'Hirely.ai Head Office, 228 Rose Commercial, Hyderabad'
const physicalRow = (id: string, name: string, stage: string, over: Row = {}): Row =>
  externalRow(id, name, stage, {
    external_platform: 'physical',
    external_platform_label: 'In person',
    external_join_url: null,
    external_location: ADDRESS,
    ...over,
  })
async function choosePhysical(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('radio', { name: 'Physical Interview Call' }))
}
async function fillPhysical(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, when = futureLocal(), address = ADDRESS) {
  await user.type(within(dialog).getByLabelText('Address'), address)
  fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: when } })
}
const sendCallButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Send interview call' })

describe('Set up interview: Physical Interview Call', () => {
  it('is the third way to run the interview, and swaps the online fields for an address', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)

    expect(within(dialog).getAllByRole('radio').map(r => r.closest('label')?.textContent)).toEqual([
      'AI interview on our platform', 'Another platform', 'Physical Interview Call',
    ])
    await choosePhysical(user, dialog)

    expect(within(dialog).getByRole('radio', { name: 'Physical Interview Call' })).toBeChecked()
    expect(within(dialog).getByLabelText('Address')).toHaveAttribute('maxlength', '300')
    expect(within(dialog).getByLabelText('Date and time')).toHaveAttribute('type', 'datetime-local')
    expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(45)
    expect(within(dialog).getByLabelText('Notes for the candidate (optional)')).toBeInTheDocument()
    expect(within(dialog).getByText('The candidate receives the time and address by email. Nothing else is sent.')).toBeInTheDocument()
    for (const absent of ['Platform', 'Platform name', 'Meeting link', 'Create the meeting for me', 'Question Type']) {
      expect(within(dialog).queryByLabelText(absent)).not.toBeInTheDocument()
    }
    expect(within(dialog).queryByRole('button', { name: 'Create Interview Link' })).not.toBeInTheDocument()
    expect(sendCallButton(dialog)).toBeDisabled()
  })

  it('can be left for either of the others, and each keeps its own fields', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Meeting link')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Address')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Send meeting details' })).toBeDisabled()

    await user.click(within(dialog).getByRole('radio', { name: 'AI interview on our platform' }))
    expect(within(dialog).getByLabelText('Question Type')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Address')).not.toBeInTheDocument()
  })

  it('needs an address (not only spaces) and a time in the future before it can be sent', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)

    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal() } })
    await user.type(within(dialog).getByLabelText('Address'), '   ')
    expect(sendCallButton(dialog)).toBeDisabled()

    await user.clear(within(dialog).getByLabelText('Address'))
    await user.type(within(dialog).getByLabelText('Address'), ADDRESS)
    expect(sendCallButton(dialog)).toBeEnabled()

    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: toLocalInput(new Date(Date.now() - 86_400_000)) } })
    expect(within(dialog).getByText('Pick a date and time in the future.')).toBeInTheDocument()
    expect(sendCallButton(dialog)).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: futureLocal() } })
    await user.clear(within(dialog).getByLabelText('Duration (minutes)'))
    await user.type(within(dialog).getByLabelText('Duration (minutes)'), '2')
    expect(within(dialog).getByText('Duration must be between 5 and 480 minutes.')).toBeInTheDocument()
    expect(sendCallButton(dialog)).toBeDisabled()
  })

  it('sends the address instead of a link, with the time in ISO and the zone, and says details were sent', async () => {
    const when = futureLocal(3)
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await fillPhysical(user, dialog, when)
    await user.type(within(dialog).getByLabelText('Notes for the candidate (optional)'), 'Ask for Priya at reception')
    await user.click(sendCallButton(dialog))

    expect(api.scheduleExternal).toHaveBeenCalledTimes(1)
    const sent = api.scheduleExternal.mock.calls[0][0]
    expect(sent).toEqual({
      candidate_id: 'cand_r1',
      platform: 'physical',
      location: ADDRESS,
      scheduled_start_at: new Date(when).toISOString(),
      duration_minutes: 45,
      notes: 'Ask for Priya at reception',
      display_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(sent).not.toHaveProperty('join_url')
    expect(sent).not.toHaveProperty('create_meeting')
    expect(sent).not.toHaveProperty('platform_label')
    expect(api.create).not.toHaveBeenCalled()
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Interview details sent to Ada Lovelace')
    expect(within(dialog).getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument()
  })

  it('trims the address, and creates the candidate record when the row has none', async () => {
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted', { candidate_id: undefined })])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await user.clear(within(dialog).getByLabelText('Candidate Email'))
    await user.type(within(dialog).getByLabelText('Candidate Email'), '  ada@new.com ')
    await fillPhysical(user, dialog, futureLocal(), `  ${ADDRESS}  `)
    await user.click(sendCallButton(dialog))

    const body = api.scheduleExternal.mock.calls[0][0]
    expect(body).toMatchObject({ job_id: 'job_1', resume_id: 'r1', name: 'Ada Lovelace', email: 'ada@new.com', platform: 'physical', location: ADDRESS })
    expect(body).not.toHaveProperty('candidate_id')
    expect(body.notes).toBeUndefined()
  })

  it('locks the name and email when the row has a candidate record, as for any outside interview', async () => {
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    expect(within(dialog).getByLabelText('Candidate Name')).toBeDisabled()
    expect(within(dialog).getByLabelText('Candidate Email')).toBeDisabled()
    expect(within(dialog).getByText('The interview details go to the address on the existing candidate record.')).toBeInTheDocument()
  })

  it('shows the server sentence when it refuses, and keeps the form for another try', async () => {
    api.scheduleExternal.mockRejectedValue({ response: { status: 422, data: { detail: 'The address can be at most 300 characters.' } } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await fillPhysical(user, dialog)
    await user.click(sendCallButton(dialog))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The address can be at most 300 characters.')
    expect(within(dialog).getByLabelText('Address')).toHaveValue(ADDRESS)
    expect(sendCallButton(dialog)).toBeEnabled()
  })

  it('says the email failed when it was saved but not delivered', async () => {
    api.scheduleExternal.mockResolvedValue({ data: { ...SCHEDULED_OK.data, email_sent: false } })
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    const dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await fillPhysical(user, dialog)
    await user.click(sendCallButton(dialog))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved, but the email could not be sent')
  })

  it('never remembers in person as the platform for the next online meeting', async () => {
    api.scheduleExternal.mockResolvedValue(SCHEDULED_OK)
    const user = await renderPipeline([makeRow('r1', 'Ada Lovelace', 'shortlisted')])
    let dialog = await openSetup(user)
    await choosePhysical(user, dialog)
    await fillPhysical(user, dialog)
    await user.click(sendCallButton(dialog))
    await within(dialog).findByRole('status')
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    dialog = await openSetup(user)
    await chooseAnotherPlatform(user, dialog)
    expect(within(dialog).getByLabelText('Platform')).toHaveValue('zoom')
  })
})

describe('row actions for an interview in person', () => {
  it('names the place in the row, and offers the in-person versions of the meeting actions', async () => {
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing')])
    expect(within(rowOf('Ada Lovelace')).getByText(/^In person · /)).toBeInTheDocument()
    expect(primaryLabel('Ada Lovelace')).toBe('Add scorecard')

    const menu = await menuLabels(user, 'Ada Lovelace')
    expect(menu).toEqual(DEFAULT_MENU.map(label => ({
      'Change time or link': 'Change time or place',
      'Resend meeting link': 'Resend interview details',
      'Copy meeting link': 'Copy address',
    }[label] ?? label)))
  })

  it('a no-show makes "Change time or place" the primary action', async () => {
    await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing', { external_status: 'no_show' })])
    expect(primaryLabel('Ada Lovelace')).toBe('Change time or place')
  })

  it('Resend interview details calls the endpoint and toasts the address', async () => {
    api.resendExternal.mockResolvedValue({ data: { email_sent: true, sent_to: 'r1@x.com' } })
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Resend interview details')
    expect(api.resendExternal).toHaveBeenCalledWith('cand_r1')
    expect(await screen.findByText('Interview details resent to r1@x.com')).toBeInTheDocument()
  })

  it('Copy address puts the address on the clipboard', async () => {
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing')])
    await pick(user, 'Ada Lovelace', 'Copy address')
    expect(await screen.findByText('Address copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(ADDRESS)
  })

  it('leaves Copy address out when none is on file', async () => {
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing', { external_location: null })])
    expect(await menuLabels(user, 'Ada Lovelace')).not.toContain('Copy address')
  })

  it('Change time or place opens the address form filled from the row, with no kind to choose', async () => {
    api.getExternalReview.mockResolvedValue({
      data: { external_interview: { platform: 'physical', duration_minutes: 60, notes: 'Bring ID', location: ADDRESS }, external_review: null },
    })
    const when = futureLocal(4)
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: new Date(when).toISOString() })])
    await pick(user, 'Ada Lovelace', 'Change time or place')

    const dialog = await screen.findByRole('dialog', { name: 'Change time or place' })
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Address')).toHaveValue(ADDRESS)
    expect(within(dialog).getByLabelText('Date and time')).toHaveValue(when)
    expect(within(dialog).queryByLabelText('Meeting link')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Platform')).not.toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText('Duration (minutes)')).toHaveValue(60))
    expect(within(dialog).getByLabelText('Notes for the candidate (optional)')).toHaveValue('Bring ID')
    expect(within(dialog).getByLabelText('Candidate Name')).toBeDisabled()
    expect(within(dialog).getByText('The interview details go to the address on the existing candidate record.')).toBeInTheDocument()
  })

  it('saves a new place with PATCH, as in person, tells the candidate, and reloads', async () => {
    api.updateExternal.mockResolvedValue({ data: { external_interview: {}, email_sent: true } })
    const user = await renderPipeline([physicalRow('r1', 'Ada Lovelace', 'interviewing', { external_scheduled_at: PAST_AT })])
    await pick(user, 'Ada Lovelace', 'Change time or place')
    const dialog = await screen.findByRole('dialog', { name: 'Change time or place' })

    const save = within(dialog).getByRole('button', { name: 'Save and notify candidate' })
    await waitFor(() => expect(save).toBeDisabled())
    const when = futureLocal(5)
    fireEvent.change(within(dialog).getByLabelText('Date and time'), { target: { value: when } })
    const address = within(dialog).getByLabelText('Address')
    await user.clear(address)
    await user.type(address, 'Annexe Building, 4th floor, Pune')
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    const [id, body] = api.updateExternal.mock.calls[0]
    expect(id).toBe('cand_r1')
    expect(body).toMatchObject({
      platform: 'physical',
      location: 'Annexe Building, 4th floor, Pune',
      scheduled_start_at: new Date(when).toISOString(),
      duration_minutes: 45,
    })
    expect(body).not.toHaveProperty('join_url')
    expect(api.scheduleExternal).not.toHaveBeenCalled()
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Interview details sent to Ada Lovelace')
    await waitFor(() => expect(api.pipeline).toHaveBeenCalledTimes(2))
  })
})

describe('applicants from the careers page', () => {
  it('tags a candidate who applied through the careers page next to the name', async () => {
    await renderPipeline([makeRow('r1', 'Ada Lovelace', 'matched', { source: 'career_page' })])
    const row = rowOf('Ada Lovelace')
    expect(within(row).getByText('Career page')).toHaveClass('cand-source-tag')
    expect(within(row).getByText('Career page').parentElement).toHaveClass('cand-name')
  })

  it('keeps a careers applicant in view below the match cutoff while hiding other low scorers', async () => {
    await renderPipeline([
      makeRow('r1', 'Ada Lovelace', 'matched', { source: 'career_page', similarity_score: 0.1 }),
      makeRow('r2', 'Grace Hopper', 'matched', { similarity_score: 0.1 }),
      makeRow('r3', 'Alan Turing', 'matched', { similarity_score: 0.9 }),
    ])
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()
    expect(screen.getByText('1 hidden below cutoff')).toBeInTheDocument()
  })

  it('shows no tag for candidates from any other source', async () => {
    await renderPipeline([
      makeRow('r1', 'Ada Lovelace', 'matched', { source: 'upload' }),
      makeRow('r2', 'Grace Hopper', 'matched'),
    ])
    expect(screen.queryByText('Career page')).not.toBeInTheDocument()
  })
})
