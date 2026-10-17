import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewerScorecardView, Scorecard } from '../../lib/api'
import { scorecardDraftKey } from '../../modules/m1-hrbot/components/scorecardDraft'

vi.setConfig({ testTimeout: 30_000 })

const TOKEN = 'tok_abc123'
let currentToken = TOKEN

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: currentToken }) }))

const getView = vi.fn()
const save = vi.fn()

vi.mock('../../lib/api', () => ({
  interviewerScorecardApi: {
    get: (...a: unknown[]) => getView(...a),
    save: (...a: unknown[]) => save(...a),
  },
}))

const { default: InterviewerScorecardPage } = await import('./InterviewerScorecardPage')

const SUMMARY = 'Clear thinker, explained trade-offs well and asked sharp questions.'
const AREAS = ['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence']
const Q1 = 'Explain how you would shard a database.'

const VIEW: InterviewerScorecardView = {
  candidate_name: 'Ada Lovelace',
  job_title: 'Backend Engineer',
  platform_label: 'Zoom',
  scheduled_start_at: '2026-10-20T10:00:00Z',
  interviewer_name: 'Priya Nair',
  interviewer_role: 'engineer',
  guide: {
    questions: [
      { id: 'q1', text: Q1, dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
      { id: 'q2', text: 'How do you explain a trade-off to a product manager?', dimension: 'communication', listen_for: 'Plain language' },
    ],
    fallback: false,
  },
  candidate_highlights: null,
  scorecard: null,
  locked: false,
  locked_reason: null,
  expires_at: '2026-10-27T10:00:00Z',
}

const SAVED: Scorecard = {
  scorecard_id: 'sc_1', source: 'link', submitted_by: null, interviewer_name: 'Priya Nair', interviewer_role: 'engineer',
  submitted_at: '2026-10-20T11:00:00Z', updated_at: '2026-10-20T11:00:00Z',
  questions: [{ question_id: 'q1', text: Q1, dimension: 'technical', rating: 5, notes: 'Sharp' }],
  ratings: { technical: 5, communication: 4, problem_solving: 3, cultural_fit: 4, confidence: 4 },
  recommendation: 'hire', summary: SUMMARY, strengths: null, concerns: null,
}

type User = ReturnType<typeof userEvent.setup>
const KEY = scorecardDraftKey('link', TOKEN)
const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null')

function mount(view: Partial<InterviewerScorecardView> = {}) {
  getView.mockResolvedValue({ data: { ...VIEW, ...view } })
  const result = render(<InterviewerScorecardPage />)
  return { user: userEvent.setup(), ...result }
}
async function renderPage(view: Partial<InterviewerScorecardView> = {}) {
  const r = mount(view)
  await screen.findByRole('heading', { name: 'Ada Lovelace' })
  return r
}

const area = (user: User, label: string, n: number) => user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
async function paste(user: User, label: string, text: string) {
  await user.click(screen.getByLabelText(label))
  await user.paste(text)
}
async function fillScorecard(user: User) {
  for (const label of AREAS) await area(user, label, 4)
  await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
  await paste(user, 'Summary', SUMMARY)
}

beforeEach(() => {
  getView.mockReset()
  save.mockReset()
  vi.restoreAllMocks()
  window.localStorage.clear()
  currentToken = TOKEN
})

describe('the draft on the public page', () => {
  it('is kept under this link\'s token as the interviewer fills the form in', async () => {
    const { user } = await renderPage()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    await area(user, 'Technical', 5)
    await paste(user, 'Summary', SUMMARY)

    expect(KEY).toBe(`hr-bot.scorecard-draft:link:${TOKEN}`)
    expect(stored()).toMatchObject({ name: 'Priya Nair', role: 'engineer', ratings: { technical: 5 }, summary: SUMMARY })
  })

  it('is put back after a refresh, with the notice', async () => {
    const first = await renderPage()
    await area(first.user, 'Technical', 5)
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    await renderPage()
    expect(screen.getByText('Draft restored')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
  })

  it('belongs to its link: another link starts clean', async () => {
    const first = await renderPage()
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    currentToken = 'tok_other'
    await renderPage()
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue('')
  })

  it('is cleared by a successful submit, and the next visit starts clean', async () => {
    save.mockResolvedValue({ data: { saved: true } })
    const first = await renderPage()
    await fillScorecard(first.user)
    expect(stored()).not.toBeNull()
    await first.user.click(screen.getByRole('button', { name: 'Submit scorecard' }))

    expect(await screen.findByText('Scorecard submitted')).toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('stays when the submit fails, so it can be sent again', async () => {
    save.mockRejectedValue({ response: { status: 422, data: { detail: 'The summary is too short.' } } })
    const { user } = await renderPage()
    await fillScorecard(user)
    await user.click(screen.getByRole('button', { name: 'Submit scorecard' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The summary is too short.')
    expect(stored()).not.toBeNull()
  })

  it('keeps no draft while editing a scorecard that was submitted, and leaves none behind', async () => {
    save.mockResolvedValue({ data: { saved: true } })
    const { user } = await renderPage()
    await fillScorecard(user)
    await user.click(screen.getByRole('button', { name: 'Submit scorecard' }))
    await user.click(await screen.findByRole('button', { name: 'Edit scorecard' }))

    await area(user, 'Technical', 2)
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('never puts a draft over the scorecard the link already holds', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), name: 'Priya Nair', role: 'engineer', summary: 'An unsent rewrite of the summary.' }))
    await renderPage({ scorecard: SAVED })

    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('Discard draft starts the form again from what the link says', async () => {
    const first = await renderPage()
    await area(first.user, 'Technical', 5)
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    const { user } = await renderPage()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Interviewer name')).toHaveValue('Priya Nair')
    expect(screen.getByLabelText('Summary')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).not.toBeChecked()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('works without storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    save.mockResolvedValue({ data: { saved: true } })
    const { user } = await renderPage()
    await fillScorecard(user)
    await user.click(screen.getByRole('button', { name: 'Submit scorecard' }))
    expect(await screen.findByText('Scorecard submitted')).toBeInTheDocument()
  })
})
