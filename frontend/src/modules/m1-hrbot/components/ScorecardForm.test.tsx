import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuideQuestion, Scorecard } from '../../../lib/api'
import ScorecardForm, { scorecardToInitial, type ScorecardInitial } from './ScorecardForm'

vi.setConfig({ testTimeout: 30_000 })

const QUESTIONS: GuideQuestion[] = [
  { id: 'q1', text: 'Explain how you would shard a database.', dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
  { id: 'q2', text: 'Walk me through the hardest bug you fixed.', dimension: 'problem_solving', listen_for: 'Hypotheses and bisecting' },
  { id: 'q3', text: 'How do you explain a trade-off to a product manager?', dimension: 'communication', listen_for: 'Plain language' },
  { id: 'q4', text: 'Describe the design of a rate limiter.', dimension: 'technical', listen_for: 'Token bucket versus sliding window' },
]
const SUMMARY = 'Clear thinker, explained trade-offs well and asked sharp questions.'
const AREAS = ['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence']

type User = ReturnType<typeof userEvent.setup>

const onSubmit = vi.fn()
const onDirtyChange = vi.fn()

function renderForm(props: Partial<React.ComponentProps<typeof ScorecardForm>> = {}) {
  const view = render(
    <ScorecardForm
      variant="admin"
      questions={QUESTIONS}
      initial={{ interviewerName: 'Sam Rivera', interviewerRole: 'hr' }}
      submitLabel="Submit scorecard"
      onSubmit={onSubmit}
      onDirtyChange={onDirtyChange}
      {...props}
    />,
  )
  return { user: userEvent.setup(), ...view }
}

const area = (user: User, label: string, n: number) =>
  user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
const mark = (user: User, question: string, n: number | 'Not asked') =>
  user.click(within(screen.getByRole('radiogroup', { name: question })).getByRole('radio', { name: n === 'Not asked' ? n : `${n} out of 5` }))
const submitBtn = () => screen.getByRole('button', { name: 'Submit scorecard' })
async function writeSummary(user: User, text: string) {
  await user.click(screen.getByLabelText('Summary'))
  await user.paste(text)
}

async function rateEveryArea(user: User, n = 4) {
  for (const label of AREAS) await area(user, label, n)
}
async function completeForm(user: User) {
  await rateEveryArea(user)
  await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
  await writeSummary(user, SUMMARY)
}

beforeEach(() => {
  onSubmit.mockReset()
  onDirtyChange.mockReset()
  vi.restoreAllMocks()
})

describe('questions', () => {
  it('groups the guide questions by dimension in the scorecard order, each with its listen-for hint', () => {
    renderForm()
    const titles = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)
    expect(titles).toEqual(['Technical', 'Communication', 'Problem solving'])

    const technical = screen.getByRole('region', { name: 'Technical' })
    expect(within(technical).getByText(QUESTIONS[0].text)).toBeInTheDocument()
    expect(within(technical).getByText(QUESTIONS[3].text)).toBeInTheDocument()
    expect(within(technical).getByText('Listen for: Consistent hashing and hot keys')).toBeInTheDocument()
    expect(within(technical).queryByText(QUESTIONS[1].text)).not.toBeInTheDocument()
  })

  it('gives each question a 1 to 5 radio group plus "Not asked", starting on "Not asked", and a notes box', () => {
    renderForm()
    const group = screen.getByRole('radiogroup', { name: QUESTIONS[0].text })
    expect(within(group).getAllByRole('radio').map(r => r.getAttribute('aria-label')))
      .toEqual(['1 out of 5', '2 out of 5', '3 out of 5', '4 out of 5', '5 out of 5', 'Not asked'])
    expect(within(group).getByRole('radio', { name: 'Not asked' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`)).toBeInTheDocument()
  })

  it('moves the mark when another is picked and clears it with "Not asked"', async () => {
    const { user } = renderForm()
    const group = screen.getByRole('radiogroup', { name: QUESTIONS[0].text })
    await mark(user, QUESTIONS[0].text, 4)
    expect(within(group).getByRole('radio', { name: '4 out of 5' })).toBeChecked()
    await mark(user, QUESTIONS[0].text, 2)
    expect(within(group).getByRole('radio', { name: '2 out of 5' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: '4 out of 5' })).not.toBeChecked()
    await mark(user, QUESTIONS[0].text, 'Not asked')
    expect(within(group).getByRole('radio', { name: 'Not asked' })).toBeChecked()
  })

  it('still works with a guide that has no questions', () => {
    renderForm({ questions: [] })
    expect(screen.queryByRole('heading', { name: 'Questions' })).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Technical' })).toBeInTheDocument()
  })

  it('says the questions are generic only when the guide is a fallback', () => {
    const { unmount } = renderForm({ fallback: true })
    expect(screen.getByText('These questions are generic, not tailored to this candidate.')).toBeInTheDocument()
    unmount()
    renderForm({ fallback: false })
    expect(screen.queryByText(/generic/)).not.toBeInTheDocument()
  })
})

describe('candidate highlights', () => {
  it('shows seniority, domain and skills when provided', () => {
    renderForm({ highlights: { seniority: 'senior', domain: 'software_engineering', skills: ['Python', 'Django'] } })
    const strip = screen.getByRole('region', { name: 'Candidate highlights' })
    expect(within(strip).getByText('senior')).toBeInTheDocument()
    expect(within(strip).getByText('software engineering')).toBeInTheDocument()
    expect(within(within(strip).getByRole('list', { name: 'Skills' })).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['Python', 'Django'])
  })

  it.each([
    ['not given', undefined],
    ['null', null],
    ['empty', { seniority: null, domain: null, skills: [] }],
  ])('leaves the strip out when the highlights are %s', (_label, highlights) => {
    renderForm({ highlights })
    expect(screen.queryByText('Candidate highlights')).not.toBeInTheDocument()
  })
})

describe('the five areas', () => {
  it('has a 1 to 5 radio group for each, in the report order, and starts unrated', () => {
    renderForm({ questions: [] })
    for (const label of AREAS) {
      const group = screen.getByRole('radiogroup', { name: label })
      expect(within(group).getAllByRole('radio')).toHaveLength(5)
      expect(within(group).queryByRole('radio', { checked: true })).toBeNull()
    }
    expect(screen.getByTestId('overall-value')).toHaveTextContent('-')
    expect(screen.getByText('0 of 5 rated')).toBeInTheDocument()
  })

  it('prefills an area from the mean of its rated questions, rounded, and marks it as prefilled', async () => {
    const { user } = renderForm()
    await mark(user, QUESTIONS[0].text, 3)
    await mark(user, QUESTIONS[3].text, 4)
    await mark(user, QUESTIONS[1].text, 2)

    expect(screen.getByRole('radio', { name: 'Technical: 4 out of 5' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Problem solving: 2 out of 5' })).toBeChecked()
    expect(screen.getAllByText('Prefilled')).toHaveLength(2)
    expect(within(screen.getByRole('radiogroup', { name: 'Communication' })).queryByRole('radio', { checked: true })).toBeNull()
    expect(screen.getByText('2 of 5 rated')).toBeInTheDocument()
  })

  it('ignores questions marked "Not asked" when taking the mean', async () => {
    const { user } = renderForm()
    await mark(user, QUESTIONS[0].text, 5)
    await mark(user, QUESTIONS[3].text, 'Not asked')
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
  })

  it('follows the question marks until the person picks a rating, then keeps theirs', async () => {
    const { user } = renderForm()
    await mark(user, QUESTIONS[0].text, 4)
    expect(screen.getByRole('radio', { name: 'Technical: 4 out of 5' })).toBeChecked()
    await mark(user, QUESTIONS[0].text, 5)
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()

    await area(user, 'Technical', 2)
    expect(screen.getByRole('radio', { name: 'Technical: 2 out of 5' })).toBeChecked()
    expect(screen.queryByText('Prefilled')).not.toBeInTheDocument()

    await mark(user, QUESTIONS[0].text, 1)
    expect(screen.getByRole('radio', { name: 'Technical: 2 out of 5' })).toBeChecked()
  })

  it('shows the live overall as the mean of the five ratings times 20, out of 100', async () => {
    const { user } = renderForm({ questions: [] })
    expect(screen.getByTestId('overall-value')).toHaveTextContent('-')

    await area(user, 'Technical', 4)
    await area(user, 'Communication', 5)
    expect(screen.getByTestId('overall-value')).toHaveTextContent('90')
    expect(screen.getByText('/ 100')).toBeInTheDocument()

    await area(user, 'Problem solving', 3)
    await area(user, 'Cultural fit', 4)
    await area(user, 'Confidence', 4)
    expect(screen.getByTestId('overall-value')).toHaveTextContent('80')
    expect(screen.getByText('5 of 5 rated')).toBeInTheDocument()

    await area(user, 'Technical', 1)
    expect(screen.getByTestId('overall-value')).toHaveTextContent('68')
  })
})

describe('validation', () => {
  it('starts disabled and enables only when every required part is there', async () => {
    const { user } = renderForm()
    expect(submitBtn()).toBeDisabled()

    await rateEveryArea(user)
    expect(submitBtn()).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'hold')
    expect(submitBtn()).toBeDisabled()
    await writeSummary(user, SUMMARY)
    expect(submitBtn()).toBeEnabled()
  })

  it('stays disabled while one area is unrated', async () => {
    const { user } = renderForm()
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
    await writeSummary(user, SUMMARY)
    for (const label of AREAS.slice(0, 4)) await area(user, label, 4)
    expect(submitBtn()).toBeDisabled()
    await area(user, 'Confidence', 3)
    expect(submitBtn()).toBeEnabled()
  })

  it('stays disabled without a role, and enables once one is chosen', async () => {
    const { user } = renderForm({ initial: { interviewerName: 'Sam Rivera' } })
    await completeForm(user)
    expect(submitBtn()).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Interviewer role'), 'engineer')
    expect(submitBtn()).toBeEnabled()
  })

  it('offers the four roles', () => {
    renderForm()
    expect(within(screen.getByLabelText('Interviewer role')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Select a role', 'HR', 'Engineer', 'Hiring manager', 'Other'])
  })

  it('offers the four recommendations', () => {
    renderForm()
    expect(within(screen.getByLabelText('Recommendation')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Select a recommendation', 'Strong hire', 'Hire', 'Hold', 'Do not hire'])
  })

  it('counts the summary and needs 20 characters of real text', async () => {
    const { user } = renderForm()
    await rateEveryArea(user)
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'hold')

    await user.type(screen.getByLabelText('Summary'), 'Too short')
    expect(screen.getByText('9 / 4000')).toBeInTheDocument()
    expect(screen.getByText('Required, at least 20 characters')).toHaveClass('scf-short')
    expect(submitBtn()).toBeDisabled()

    await user.clear(screen.getByLabelText('Summary'))
    await user.type(screen.getByLabelText('Summary'), `${' '.repeat(25)}short`)
    expect(submitBtn()).toBeDisabled()

    await user.clear(screen.getByLabelText('Summary'))
    await user.type(screen.getByLabelText('Summary'), 'Exactly twenty chars')
    expect(screen.getByText('20 / 4000')).toBeInTheDocument()
    expect(submitBtn()).toBeEnabled()
  })

  it('needs a name in the public variant but not in the admin one', async () => {
    const admin = renderForm({ initial: { interviewerRole: 'hr' } })
    await completeForm(admin.user)
    expect(submitBtn()).toBeEnabled()
    admin.unmount()

    const pub = renderForm({ variant: 'public', initial: { interviewerRole: 'engineer' } })
    await completeForm(pub.user)
    expect(submitBtn()).toBeDisabled()
    await pub.user.type(screen.getByLabelText('Interviewer name'), '  Priya Nair ')
    expect(submitBtn()).toBeEnabled()
  })

  it('disables Submit and says Saving while saving', async () => {
    const { user } = renderForm({ saving: true })
    await completeForm(user)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('shows the error it is given', () => {
    renderForm({ error: 'The link is locked.' })
    expect(screen.getByRole('alert')).toHaveTextContent('The link is locked.')
  })
})

describe('submitting', () => {
  it('sends the interviewer, one mark per question, the five ratings, the recommendation and the text', async () => {
    const { user } = renderForm()
    await mark(user, QUESTIONS[0].text, 4)
    await user.type(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`), '  Knew hot-key mitigation ')
    await mark(user, QUESTIONS[2].text, 5)
    await area(user, 'Cultural fit', 3)
    await area(user, 'Problem solving', 2)
    await area(user, 'Confidence', 4)
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'strong_hire')
    await writeSummary(user, SUMMARY)
    await user.type(screen.getByLabelText('Strengths (optional)'), ' Calm under pressure ')
    await user.click(submitBtn())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      interviewer_name: 'Sam Rivera',
      interviewer_role: 'hr',
      questions: [
        { question_id: 'q1', rating: 4, notes: 'Knew hot-key mitigation' },
        { question_id: 'q2', rating: null },
        { question_id: 'q3', rating: 5 },
        { question_id: 'q4', rating: null },
      ],
      ratings: { technical: 4, communication: 5, problem_solving: 2, cultural_fit: 3, confidence: 4 },
      recommendation: 'strong_hire',
      summary: SUMMARY,
      strengths: 'Calm under pressure',
      concerns: undefined,
    })
  })

  it('does not submit an incomplete form', async () => {
    const { user } = renderForm()
    await writeSummary(user, SUMMARY)
    await user.click(submitBtn())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows Cancel only when it can cancel', async () => {
    const onCancel = vi.fn()
    const { user, unmount } = renderForm({ onCancel })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    unmount()
    renderForm()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})

describe('Draft with AI', () => {
  it('is left out of the public variant', () => {
    renderForm({ variant: 'public' })
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument()
  })

  it('is left out when no drafting function is given', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument()
  })

  it('is disabled until a question or an area is rated', async () => {
    const { user } = renderForm({ onDraftSummary: vi.fn() })
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeDisabled()
    await mark(user, QUESTIONS[0].text, 4)
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeEnabled()
  })

  it('sends the current marks and puts the drafted text into the summary for editing', async () => {
    const onDraftSummary = vi.fn().mockResolvedValue('Strong on databases; communication was clear.')
    const { user } = renderForm({ onDraftSummary })
    await mark(user, QUESTIONS[0].text, 4)
    await user.type(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`), 'Good answer')
    await area(user, 'Confidence', 3)
    await user.type(screen.getByLabelText('Concerns (optional)'), 'Thin on observability')
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))

    expect(onDraftSummary).toHaveBeenCalledWith({
      questions: [
        { question_id: 'q1', rating: 4, notes: 'Good answer' },
        { question_id: 'q2', rating: null },
        { question_id: 'q3', rating: null },
        { question_id: 'q4', rating: null },
      ],
      ratings: { technical: 4, confidence: 3 },
      strengths: undefined,
      concerns: 'Thin on observability',
      recommendation: undefined,
    })
    const summary = screen.getByLabelText('Summary')
    await waitFor(() => expect(summary).toHaveValue('Strong on databases; communication was clear.'))

    await user.type(summary, ' Plus one more thing.')
    expect(summary).toHaveValue('Strong on databases; communication was clear. Plus one more thing.')
  })

  it('shows a loading state, and the summary cannot be typed into meanwhile', async () => {
    let resolve!: (text: string) => void
    const onDraftSummary = vi.fn().mockReturnValue(new Promise<string>(res => { resolve = res }))
    const { user } = renderForm({ onDraftSummary })
    await mark(user, QUESTIONS[0].text, 4)
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))

    expect(screen.getByRole('button', { name: 'Drafting…' })).toBeDisabled()
    expect(screen.getByLabelText('Summary')).toHaveAttribute('readonly')
    resolve('Drafted text for the summary field.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeEnabled())
    expect(screen.getByLabelText('Summary')).not.toHaveAttribute('readonly')
  })

  it('shows the server detail when drafting fails and keeps the summary as it was', async () => {
    const onDraftSummary = vi.fn().mockRejectedValue({ response: { status: 503, data: { detail: 'The writing model is unavailable.' } } })
    const { user } = renderForm({ onDraftSummary })
    await mark(user, QUESTIONS[0].text, 4)
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The writing model is unavailable.')
    expect(screen.getByLabelText('Summary')).toHaveValue('')
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    const onDraftSummary = vi.fn().mockRejectedValue(new Error('Network Error'))
    const { user } = renderForm({ onDraftSummary })
    await mark(user, QUESTIONS[0].text, 4)
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not draft a summary. Please try again')
  })

  it('asks before replacing a summary that already has text, and keeps it when declined', async () => {
    const onDraftSummary = vi.fn().mockResolvedValue('A brand new drafted summary text.')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = renderForm({ onDraftSummary })
    await mark(user, QUESTIONS[0].text, 4)
    await writeSummary(user, SUMMARY)

    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onDraftSummary).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))
    await waitFor(() => expect(screen.getByLabelText('Summary')).toHaveValue('A brand new drafted summary text.'))
  })
})

describe('typed work', () => {
  it('reports dirty only once something differs from the starting values', async () => {
    const { user } = renderForm()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    await mark(user, QUESTIONS[0].text, 4)
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await mark(user, QUESTIONS[0].text, 'Not asked')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    await user.type(screen.getByLabelText('Concerns (optional)'), 'x')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })
})

describe('starting from a stored scorecard', () => {
  const STORED: Scorecard = {
    scorecard_id: 'sc_1',
    source: 'link',
    submitted_by: null,
    interviewer_name: 'Priya Nair',
    interviewer_role: 'engineer',
    submitted_at: '2026-10-20T11:00:00Z',
    updated_at: '2026-10-20T11:00:00Z',
    questions: [
      { question_id: 'q1', text: QUESTIONS[0].text, dimension: 'technical', rating: 5, notes: 'Sharp' },
      { question_id: 'q2', text: QUESTIONS[1].text, dimension: 'problem_solving', rating: null, notes: '' },
    ],
    ratings: { technical: 5, communication: 4, problem_solving: 3, cultural_fit: 4, confidence: 4 },
    recommendation: 'hire',
    summary: SUMMARY,
    strengths: 'Systems depth',
    concerns: null,
  }

  it('fills every field from it and is valid at once', () => {
    renderForm({ variant: 'public', initial: scorecardToInitial(STORED) })
    expect(screen.getByLabelText('Interviewer name')).toHaveValue('Priya Nair')
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('engineer')
    expect(within(screen.getByRole('radiogroup', { name: QUESTIONS[0].text })).getByRole('radio', { name: '5 out of 5' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`)).toHaveValue('Sharp')
    expect(screen.getByRole('radio', { name: 'Communication: 4 out of 5' })).toBeChecked()
    expect(screen.getByLabelText('Recommendation')).toHaveValue('hire')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(screen.getByLabelText('Strengths (optional)')).toHaveValue('Systems depth')
    expect(screen.queryByText('Prefilled')).not.toBeInTheDocument()
    expect(submitBtn()).toBeEnabled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('reads the culture rating of an older scorecard that used the old key', () => {
    const initial: ScorecardInitial = scorecardToInitial({
      ...STORED,
      ratings: { technical: 3, communication: 3, problem_solving: 3, culture_fit: 2 },
    })
    expect(initial.ratings).toEqual({ technical: 3, communication: 3, problem_solving: 3, cultural_fit: 2 })
  })

  it('falls back to the given name and role, and to empty text, when nothing is stored', () => {
    expect(scorecardToInitial(null, { name: 'Sam', role: 'hr' })).toMatchObject({
      interviewerName: 'Sam', interviewerRole: 'hr', marks: {}, ratings: {}, recommendation: '', summary: '',
    })
  })
})
