import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewerScorecardView, Scorecard } from '../../lib/api'
import { formatWhen } from '../../modules/m1-hrbot/components/externalInterview'

vi.setConfig({ testTimeout: 30_000 })

const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

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
const Q2 = 'How do you explain a trade-off to a product manager?'

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
      { id: 'q2', text: Q2, dimension: 'communication', listen_for: 'Plain language' },
    ],
    fallback: false,
  },
  candidate_highlights: { seniority: 'senior', domain: 'software_engineering', skills: ['Python', 'Django'] },
  scorecard: null,
  locked: false,
  locked_reason: null,
  expires_at: '2026-10-27T10:00:00Z',
}

const SAVED: Scorecard = {
  scorecard_id: 'sc_1',
  source: 'link',
  submitted_by: null,
  interviewer_name: 'Priya Nair',
  interviewer_role: 'engineer',
  submitted_at: '2026-10-20T11:00:00Z',
  updated_at: '2026-10-20T11:00:00Z',
  questions: [
    { question_id: 'q1', text: Q1, dimension: 'technical', rating: 5, notes: 'Sharp' },
    { question_id: 'q2', text: Q2, dimension: 'communication', rating: null, notes: '' },
  ],
  ratings: { technical: 5, communication: 4, problem_solving: 3, cultural_fit: 4, confidence: 4 },
  recommendation: 'hire',
  summary: SUMMARY,
  strengths: 'Systems depth',
  concerns: null,
}

type User = ReturnType<typeof userEvent.setup>

async function renderPage(view: Partial<InterviewerScorecardView> & Record<string, unknown> = {}) {
  getView.mockResolvedValue({ data: { ...VIEW, ...view } })
  render(<InterviewerScorecardPage />)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Ada Lovelace' })
  return user
}

const area = (user: User, label: string, n: number) =>
  user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
const submitBtn = (name = 'Submit scorecard') => screen.getByRole('button', { name })

async function fillScorecard(user: User) {
  for (const label of AREAS) await area(user, label, 4)
  await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
  await user.click(screen.getByLabelText('Summary'))
  await user.paste(SUMMARY)
}

beforeEach(() => {
  getView.mockReset()
  save.mockReset()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('loading the link', () => {
  it('shows a loading state, then asks the endpoint for this token', async () => {
    getView.mockReturnValue(new Promise(() => {}))
    render(<InterviewerScorecardPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading scorecard…')
    expect(getView).toHaveBeenCalledWith(TOKEN)
  })

  it('shows the candidate, the job, the platform and the time, and when the link expires', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument()
    expect(screen.getByText('Zoom')).toBeInTheDocument()
    expect(screen.getByText(formatWhen(VIEW.scheduled_start_at).replace(/\s+/g, ' '))).toBeInTheDocument()
    expect(screen.getByText(`Link expires ${formatWhen(VIEW.expires_at)}`.replace(/\s+/g, ' '))).toBeInTheDocument()
  })

  it('shows the scorecard form with the interviewer the link was made for, the questions and the highlights', async () => {
    await renderPage()
    expect(screen.getByLabelText('Interviewer name')).toHaveValue('Priya Nair')
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('engineer')
    expect(screen.getByRole('radiogroup', { name: Q1 })).toBeInTheDocument()
    expect(screen.getByText('Listen for: Consistent hashing and hot keys')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: 'Candidate highlights' })
    expect(within(strip).getByText('senior')).toBeInTheDocument()
    expect(within(strip).getByText('Python')).toBeInTheDocument()
  })

  it('has no Draft with AI: that is for HR only', async () => {
    await renderPage()
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument()
  })

  it('says the questions are generic for a fallback guide', async () => {
    await renderPage({ guide: { ...VIEW.guide, fallback: true } })
    expect(screen.getByText('These questions are generic, not tailored to this candidate.')).toBeInTheDocument()
  })

  it('leaves the highlights out when the endpoint gives none', async () => {
    await renderPage({ candidate_highlights: null })
    expect(screen.queryByText('Candidate highlights')).not.toBeInTheDocument()
  })

  it('shows and asks for nothing about the candidate beyond what the endpoint returns', async () => {
    await renderPage({ candidate_email: 'ada@secret.example', candidate_phone: '+44 20 7946 0000', resume_text: 'Private CV text' })
    expect(document.body.textContent).not.toMatch(/ada@secret\.example|7946|Private CV text/)
    expect(screen.getAllByRole('textbox').filter(el => el.tagName === 'INPUT')).toHaveLength(1)
    expect(document.querySelector('input[type="email"], input[type="tel"]')).toBeNull()
  })

  it('starts from the scorecard already saved on this link', async () => {
    await renderPage({ scorecard: SAVED })
    expect(within(screen.getByRole('radiogroup', { name: Q1 })).getByRole('radio', { name: '5 out of 5' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${Q1}`)).toHaveValue('Sharp')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(submitBtn('Update scorecard')).toBeEnabled()
  })
})

describe('a link that does not work', () => {
  it('404: says the link is not valid and shows the server detail', async () => {
    getView.mockRejectedValue({ response: { status: 404, data: { detail: 'No scorecard link matches this address.' } } })
    render(<InterviewerScorecardPage />)
    expect(await screen.findByRole('heading', { name: 'This link isn’t valid' })).toBeInTheDocument()
    expect(screen.getByText('No scorecard link matches this address.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
  })

  it('410: says the link is no longer active and shows the server detail', async () => {
    getView.mockRejectedValue({ response: { status: 410, data: { detail: 'This link was revoked.' } } })
    render(<InterviewerScorecardPage />)
    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeInTheDocument()
    expect(screen.getByText('This link was revoked.')).toBeInTheDocument()
  })

  it('falls back to a plain sentence when the failure has no detail', async () => {
    getView.mockRejectedValue({ response: { status: 404 } })
    render(<InterviewerScorecardPage />)
    expect(await screen.findByText('Check the link or contact whoever sent it.')).toBeInTheDocument()
  })

  it('any other failure says something went wrong and can be tried again', async () => {
    getView.mockRejectedValueOnce(new Error('Network Error'))
    getView.mockResolvedValueOnce({ data: VIEW })
    render(<InterviewerScorecardPage />)
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(getView).toHaveBeenCalledTimes(2)
  })
})

describe('a locked scorecard', () => {
  it('shows the reason and no form', async () => {
    await renderPage({ locked: true, locked_reason: 'The hiring decision has been made.' })
    expect(screen.getByRole('heading', { name: 'This scorecard is locked' })).toBeInTheDocument()
    expect(screen.getByText('The hiring decision has been made.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit|Update/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
  })

  it('says it can no longer be edited when no reason is given', async () => {
    await renderPage({ locked: true, locked_reason: null })
    expect(screen.getByText('It can no longer be edited.')).toBeInTheDocument()
  })
})

describe('submitting', () => {
  it('stays disabled until the scorecard is complete', async () => {
    const user = await renderPage()
    expect(submitBtn()).toBeDisabled()
    await fillScorecard(user)
    expect(submitBtn()).toBeEnabled()
  })

  it('sends the whole scorecard to this token and then confirms', async () => {
    save.mockResolvedValue({ data: { ok: true } })
    const user = await renderPage()
    await user.click(within(screen.getByRole('radiogroup', { name: Q1 })).getByRole('radio', { name: '4 out of 5' }))
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(TOKEN, {
      interviewer_name: 'Priya Nair',
      interviewer_role: 'engineer',
      questions: [
        { question_id: 'q1', rating: 4 },
        { question_id: 'q2', rating: null },
      ],
      ratings: { technical: 4, communication: 4, problem_solving: 4, cultural_fit: 4, confidence: 4 },
      recommendation: 'hire',
      summary: SUMMARY,
      strengths: undefined,
      concerns: undefined,
    })
    expect(await screen.findByRole('heading', { name: 'Scorecard submitted' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument()
  })

  it('disables the button while saving', async () => {
    let resolve!: (v: unknown) => void
    save.mockReturnValue(new Promise(res => { resolve = res }))
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    resolve({ data: { ok: true } })
    await screen.findByRole('heading', { name: 'Scorecard submitted' })
  })

  it('can be edited and sent again, starting from what was sent', async () => {
    save.mockResolvedValue({ data: { ok: true } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    await user.click(await screen.findByRole('button', { name: 'Edit scorecard' }))

    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(screen.getByRole('radio', { name: 'Technical: 4 out of 5' })).toBeChecked()
    expect(screen.getByLabelText('Recommendation')).toHaveValue('hire')

    await area(user, 'Technical', 5)
    await user.click(submitBtn('Update scorecard'))
    await screen.findByRole('heading', { name: 'Scorecard submitted' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1]).toMatchObject({ ratings: { technical: 5, communication: 4 } })
  })

  it('429: says to wait, keeps the form and what was typed, and can be sent again', async () => {
    save.mockRejectedValueOnce({ response: { status: 429, data: { detail: 'Too many attempts. Try again in a minute.' } } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)

    save.mockResolvedValueOnce({ data: { ok: true } })
    await user.click(submitBtn())
    await screen.findByRole('heading', { name: 'Scorecard submitted' })
  })

  it('429 without a detail still gets a message', async () => {
    save.mockRejectedValueOnce({ response: { status: 429 } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a moment and try again')
  })

  it('423: the scorecard was locked meanwhile, so the page shows the reason instead of the form', async () => {
    save.mockRejectedValue({ response: { status: 423, data: { detail: 'The hiring decision has been made.' } } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(await screen.findByRole('heading', { name: 'This scorecard is locked' })).toBeInTheDocument()
    expect(screen.getByText('The hiring decision has been made.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument()
  })

  it('410: the link ended meanwhile, so the page says so', async () => {
    save.mockRejectedValue({ response: { status: 410, data: { detail: 'This link has expired.' } } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeInTheDocument()
    expect(screen.getByText('This link has expired.')).toBeInTheDocument()
  })

  it('422 and other refusals show the server detail on the form', async () => {
    save.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Rate every area from 1 to 5.' } } })
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate every area from 1 to 5.')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    save.mockRejectedValue(new Error('Network Error'))
    const user = await renderPage()
    await fillScorecard(user)
    await user.click(submitBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save the scorecard. Please try again'))
  })
})
