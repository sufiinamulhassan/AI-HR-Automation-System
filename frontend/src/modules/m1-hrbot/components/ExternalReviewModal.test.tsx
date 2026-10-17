import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewGuide, Scorecard } from '../../../lib/api'
import { formatWhen } from './externalInterview'

vi.setConfig({ testTimeout: 30_000 })

const submit = vi.fn()
const getReview = vi.fn()
const generate = vi.fn()
const draft = vi.fn()

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    submitExternalReview: (...a: unknown[]) => submit(...a),
    getExternalReview: (...a: unknown[]) => getReview(...a),
    generateInterviewGuide: (...a: unknown[]) => generate(...a),
    draftReviewSummary: (...a: unknown[]) => draft(...a),
  },
}))

const { default: ExternalReviewModal } = await import('./ExternalReviewModal')
const { useAuthStore } = await import('../../../store/auth.store')

const SCHEDULED_AT = '2026-10-20T10:00:00Z'
const SUMMARY = 'Clear thinker, explained trade-offs well and asked sharp questions.'
const AREAS = ['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence']

const GUIDE: InterviewGuide = {
  questions: [
    { id: 'q1', text: 'Explain how you would shard a database.', dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
    { id: 'q2', text: 'Walk me through the hardest bug you fixed.', dimension: 'problem_solving', listen_for: 'Hypotheses and bisecting' },
    { id: 'q3', text: 'How do you explain a trade-off to a product manager?', dimension: 'communication', listen_for: 'Plain language' },
  ],
  generated_at: '2026-10-19T09:00:00Z',
  generated_by: 'hr@x.com',
  model: 'gpt-test',
  fallback: false,
}

const RATINGS = { technical: 4, communication: 5, problem_solving: 3, cultural_fit: 4, confidence: 4 }

const HR_CARD: Scorecard = {
  scorecard_id: 'sc_hr',
  source: 'hr',
  submitted_by: 'hr@x.com',
  interviewer_name: 'Sam Rivera',
  interviewer_role: 'hr',
  submitted_at: '2026-10-20T12:30:00Z',
  updated_at: '2026-10-20T12:30:00Z',
  questions: [
    { question_id: 'q1', text: GUIDE.questions[0].text, dimension: 'technical', rating: 4, notes: 'Solid on sharding' },
    { question_id: 'q2', text: GUIDE.questions[1].text, dimension: 'problem_solving', rating: null, notes: '' },
  ],
  ratings: RATINGS,
  recommendation: 'hire',
  summary: SUMMARY,
  strengths: 'Clear communicator',
  concerns: 'Limited exposure to Kubernetes',
}

const LINK_CARD: Scorecard = {
  ...HR_CARD,
  scorecard_id: 'sc_link',
  source: 'link',
  submitted_by: null,
  interviewer_name: 'Priya Nair',
  interviewer_role: 'engineer',
  questions: [
    { question_id: 'q1', text: GUIDE.questions[0].text, dimension: 'technical', rating: 5, notes: 'Knew hot-key mitigation' },
  ],
  recommendation: 'strong_hire',
  summary: 'Excellent systems depth and calm under pressure.',
  strengths: null,
  concerns: null,
}

type User = ReturnType<typeof userEvent.setup>

function loaded(over: Record<string, unknown> = {}) {
  return { data: { external_interview: { platform: 'zoom' }, external_review: null, interview_guide: GUIDE, scorecards: [], ...over } }
}

function renderModal(props: Partial<React.ComponentProps<typeof ExternalReviewModal>> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <ExternalReviewModal
      candidateId="cand_1"
      candidateName="Ada Lovelace"
      platformLabel="Zoom"
      scheduledAt={SCHEDULED_AT}
      mode="edit"
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  )
  return { user: userEvent.setup(), onClose, onSaved }
}

async function renderEditor(props: Partial<React.ComponentProps<typeof ExternalReviewModal>> = {}) {
  const r = renderModal(props)
  await screen.findByRole('button', { name: 'Submit scorecard' })
  return r
}

const area = (user: User, label: string, n: number) =>
  user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
const submitBtn = () => screen.getByRole('button', { name: 'Submit scorecard' })

async function fillScorecard(user: User, over: { summary?: string; recommendation?: string } = {}) {
  for (const label of AREAS) await area(user, label, 4)
  await user.selectOptions(screen.getByLabelText('Recommendation'), over.recommendation ?? 'hire')
  await user.click(screen.getByLabelText('Summary'))
  await user.paste(over.summary ?? SUMMARY)
}

beforeEach(() => {
  submit.mockReset()
  getReview.mockReset()
  generate.mockReset()
  draft.mockReset()
  vi.restoreAllMocks()
  window.localStorage.clear()
  getReview.mockResolvedValue(loaded())
  useAuthStore.setState({ token: 'tok', user: null })
})

describe('dialog shell', () => {
  it('is a labelled modal dialog that takes focus and names the candidate, platform and local time', async () => {
    await renderEditor()
    const dialog = screen.getByRole('dialog', { name: 'Add scorecard' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(dialog).toHaveTextContent(`Ada Lovelace · Zoom · ${formatWhen(SCHEDULED_AT)}`.replace(/\s+/g, ' '))
  })

  it('keeps Tab inside the dialog', async () => {
    const { user } = await renderEditor()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('closes on Escape, the close button and a backdrop click when nothing has been entered', async () => {
    const { user, onClose } = await renderEditor()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close scorecard' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByTestId('review-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('asks before throwing away typed work, and keeps the dialog open when declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onClose } = await renderEditor()
    await area(user, 'Communication', 4)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('edit: the guide and the scorecards already filed', () => {
  it('reads them in one call, shows a loading state first, and generates nothing when the guide exists', async () => {
    renderModal()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    await screen.findByRole('button', { name: 'Submit scorecard' })

    expect(getReview).toHaveBeenCalledWith('cand_1')
    expect(generate).not.toHaveBeenCalled()
    expect(screen.getByText('3 interview questions')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: GUIDE.questions[0].text })).toBeInTheDocument()
    expect(screen.getByText('Listen for: Consistent hashing and hot keys')).toBeInTheDocument()
  })

  it('generates the guide on first open when there is none, with a visible loading state', async () => {
    getReview.mockResolvedValue(loaded({ interview_guide: null }))
    let resolve!: (v: unknown) => void
    generate.mockReturnValue(new Promise(res => { resolve = res }))
    renderModal()

    expect(await screen.findByText(/Writing interview questions/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(generate).toHaveBeenCalledWith('cand_1')
    expect(screen.queryByRole('button', { name: 'Submit scorecard' })).not.toBeInTheDocument()

    resolve({ data: GUIDE })
    expect(await screen.findByRole('button', { name: 'Submit scorecard' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: GUIDE.questions[1].text })).toBeInTheDocument()
  })

  it('still lets HR score the areas when the guide cannot be generated, and offers Retry', async () => {
    getReview.mockResolvedValue(loaded({ interview_guide: null }))
    generate.mockRejectedValueOnce({ response: { status: 502, data: { detail: 'The question writer is unavailable.' } } })
    generate.mockResolvedValueOnce({ data: GUIDE })
    const { user } = renderModal()

    expect(await screen.findByRole('alert')).toHaveTextContent('The question writer is unavailable.')
    expect(screen.getByRole('radiogroup', { name: 'Technical' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: GUIDE.questions[0].text })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('radiogroup', { name: GUIDE.questions[0].text })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps what was typed when Retry brings the questions in', async () => {
    getReview.mockResolvedValue(loaded({ interview_guide: null }))
    generate.mockRejectedValueOnce(new Error('Network Error'))
    generate.mockResolvedValueOnce({ data: GUIDE })
    const { user } = renderModal()
    await screen.findByRole('alert')
    await area(user, 'Technical', 5)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('radiogroup', { name: GUIDE.questions[0].text })
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
  })

  it('says so, and still shows the form, when the scorecards cannot be read', async () => {
    getReview.mockRejectedValue(new Error('503'))
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the interview questions.')
    expect(screen.getByRole('button', { name: 'Submit scorecard' })).toBeInTheDocument()
    expect(generate).not.toHaveBeenCalled()
  })

  it('says the questions are generic when the guide is a fallback', async () => {
    getReview.mockResolvedValue(loaded({ interview_guide: { ...GUIDE, fallback: true } }))
    await renderEditor()
    expect(screen.getByText('These questions are generic, not tailored to this candidate.')).toBeInTheDocument()
  })

  it('Regenerate replaces the questions', async () => {
    const next: InterviewGuide = { ...GUIDE, questions: [{ id: 'n1', text: 'A brand new question?', dimension: 'confidence', listen_for: 'Poise' }] }
    generate.mockResolvedValue({ data: next })
    const { user } = await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(generate).toHaveBeenCalledWith('cand_1', true)
    expect(await screen.findByRole('radiogroup', { name: 'A brand new question?' })).toBeInTheDocument()
    expect(screen.getByText('1 interview question')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: GUIDE.questions[0].text })).not.toBeInTheDocument()
  })

  it('asks before regenerating over marks that were entered', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderEditor()
    await area(user, 'Technical', 4)

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(generate).not.toHaveBeenCalled()
  })

  it('shows the server detail when Regenerate is refused', async () => {
    generate.mockRejectedValue({ response: { status: 409, data: { detail: 'Scorecards already exist for this interview.' } } })
    const { user } = await renderEditor()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scorecards already exist for this interview.')
    expect(screen.getByText('3 interview questions')).toBeInTheDocument()
  })

  it('disables Regenerate once any scorecard exists, and lists the other interviewers who have filed one', async () => {
    getReview.mockResolvedValue(loaded({ scorecards: [LINK_CARD] }))
    await renderEditor()

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    const panel = screen.getByRole('region', { name: 'Other interviewers' })
    expect(within(panel).getByText('Other interviewers (1)')).toBeInTheDocument()
    expect(within(panel).getByText('Priya Nair')).toBeInTheDocument()
    expect(within(panel).getByText('Engineer')).toBeInTheDocument()
    expect(within(panel).getByText('Strong hire')).toHaveClass('badge')
  })

  it('shows no panel of other interviewers when none has filed', async () => {
    await renderEditor()
    expect(screen.queryByRole('region', { name: 'Other interviewers' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  })
})

describe('edit: the interview took place', () => {
  it('starts on Yes with the five rating groups, the question groups, a recommendation, a summary and optional notes', async () => {
    await renderEditor()
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'The candidate did not attend' })).not.toBeChecked()

    for (const label of AREAS) {
      expect(within(screen.getByRole('radiogroup', { name: label })).getAllByRole('radio')).toHaveLength(5)
    }
    expect(screen.getByLabelText('Summary')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText('Strengths (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Concerns (optional)')).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
  })

  it('fills the interviewer from the signed-in user, as HR', async () => {
    useAuthStore.setState({ token: 'tok', user: { name: 'Sam Rivera', email: 'sam@x.com' } })
    await renderEditor()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('hr')
  })

  it('starts from HR\'s own scorecard when one is already filed', async () => {
    getReview.mockResolvedValue(loaded({ scorecards: [HR_CARD, LINK_CARD] }))
    await renderEditor()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(screen.getByRole('radio', { name: 'Communication: 5 out of 5' })).toBeChecked()
    expect(submitBtn()).toBeEnabled()
  })

  it('submits the interviewer, the marks, the five ratings, the recommendation and the text, then reports the result', async () => {
    const result = { stage: 'completed', external_status: 'reviewed', overall: 4, final_score: 80, report_ready: true }
    submit.mockResolvedValue({ data: result })
    useAuthStore.setState({ token: 'tok', user: { name: 'Sam Rivera' } })
    const { user, onSaved } = await renderEditor()

    await user.click(within(screen.getByRole('radiogroup', { name: GUIDE.questions[0].text })).getByRole('radio', { name: '4 out of 5' }))
    await user.type(screen.getByLabelText(`Notes: ${GUIDE.questions[0].text}`), 'Solid on sharding')
    await fillScorecard(user)
    await user.type(screen.getByLabelText('Strengths (optional)'), '  Clear communicator ')
    await user.click(submitBtn())

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('cand_1', {
      attended: true,
      interviewer_name: 'Sam Rivera',
      interviewer_role: 'hr',
      questions: [
        { question_id: 'q1', rating: 4, notes: 'Solid on sharding' },
        { question_id: 'q2', rating: null },
        { question_id: 'q3', rating: null },
      ],
      ratings: { technical: 4, communication: 4, problem_solving: 4, cultural_fit: 4, confidence: 4 },
      recommendation: 'hire',
      summary: SUMMARY,
      strengths: 'Clear communicator',
      concerns: undefined,
    })
    expect(submit.mock.calls[0][1]).not.toHaveProperty('interviewed_at')
    expect(onSaved).toHaveBeenCalledWith(result)
  })

  it('disables the button while saving', async () => {
    let resolve!: (v: unknown) => void
    submit.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = await renderEditor()
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    resolve({ data: { stage: 'completed', external_status: 'reviewed' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument())
  })

  it('shows the server detail on a refusal, keeps what was typed, and can be sent again', async () => {
    submit.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Write a summary of at least 20 characters.' } } })
    const { user, onSaved } = await renderEditor()
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(await screen.findByRole('alert')).toHaveTextContent('Write a summary of at least 20 characters.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)

    submit.mockResolvedValueOnce({ data: { stage: 'completed', external_status: 'reviewed' } })
    await user.click(submitBtn())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    submit.mockRejectedValue(new Error('Network Error'))
    const { user } = await renderEditor()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the scorecard. Please try again')
  })

  it('drafts the summary with AI from the marks given and lets HR edit it', async () => {
    draft.mockResolvedValue({ data: { summary: 'Strong on databases; communication was clear.' } })
    const { user } = await renderEditor()
    await user.click(within(screen.getByRole('radiogroup', { name: GUIDE.questions[0].text })).getByRole('radio', { name: '5 out of 5' }))
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))

    expect(draft).toHaveBeenCalledWith('cand_1', {
      questions: [
        { question_id: 'q1', rating: 5 },
        { question_id: 'q2', rating: null },
        { question_id: 'q3', rating: null },
      ],
      ratings: { technical: 5 },
      strengths: undefined,
      concerns: undefined,
      recommendation: undefined,
    })
    await waitFor(() => expect(screen.getByLabelText('Summary')).toHaveValue('Strong on databases; communication was clear.'))
  })
})

describe('edit: the candidate did not attend', () => {
  it('hides the scoring, explains that nothing is unlocked, and needs nothing else', async () => {
    const { user } = await renderEditor()
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'Submit scorecard' })).not.toBeInTheDocument()
    expect(screen.getByText(/does not unlock Hire or Send offer/)).toBeVisible()
    expect(screen.getByLabelText('Note (optional)')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Record no-show' })).toBeEnabled()
  })

  it('records a no-show with no ratings and passes the optional note along as the summary', async () => {
    const result = { stage: 'interviewing', external_status: 'no_show' }
    submit.mockResolvedValue({ data: result })
    const { user, onSaved } = await renderEditor()
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.type(screen.getByLabelText('Note (optional)'), ' Did not join after 15 minutes ')
    await user.click(screen.getByRole('button', { name: 'Record no-show' }))

    expect(submit).toHaveBeenCalledWith('cand_1', { attended: false, summary: 'Did not join after 15 minutes' })
    expect(submit.mock.calls[0][1]).not.toHaveProperty('ratings')
    expect(onSaved).toHaveBeenCalledWith(result)
  })

  it('records a no-show with no note at all', async () => {
    submit.mockResolvedValue({ data: { stage: 'interviewing', external_status: 'no_show' } })
    const { user } = await renderEditor()
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.click(screen.getByRole('button', { name: 'Record no-show' }))
    expect(submit).toHaveBeenCalledWith('cand_1', { attended: false, summary: undefined })
  })

  it('shows the server detail when the no-show is refused', async () => {
    submit.mockRejectedValue({ response: { status: 409, data: { detail: 'A scorecard is already filed, so this cannot be a no-show.' } } })
    const { user, onSaved } = await renderEditor()
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.click(screen.getByRole('button', { name: 'Record no-show' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A scorecard is already filed, so this cannot be a no-show.')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('keeps the scorecard typed so far when the answer is switched to no-show and back', async () => {
    const { user } = await renderEditor()
    await area(user, 'Technical', 5)
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
  })

  it('counts a typed note as work worth confirming before it is discarded', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onClose } = await renderEditor()
    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.type(screen.getByLabelText('Note (optional)'), 'x')
    await user.keyboard('{Escape}')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('view', () => {
  const REVIEW = {
    ratings: RATINGS,
    overall: 4.0,
    recommendation: 'strong_hire',
    summary: SUMMARY,
    strengths: 'Clear communicator',
    concerns: 'Limited exposure to Kubernetes',
    interviewed_at: '2026-10-20T10:00:00Z',
    reviewed_by: 'hr@x.com',
    reviewed_at: '2026-10-20T12:30:00Z',
  }
  const ratingsView = () => within(document.querySelector('.erm-ratings-view') as HTMLElement)
  const scoreOf = (label: string) => (ratingsView().getByText(label).parentElement as HTMLElement).textContent

  it('loads the combined result and shows it read-only, with the five areas and the overall out of 100', async () => {
    getReview.mockResolvedValue(loaded({ external_review: REVIEW, scorecards: [HR_CARD] }))
    renderModal({ mode: 'view' })

    expect(screen.getByRole('dialog', { name: 'Scorecard' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading scorecard…')
    expect((await screen.findAllByText(SUMMARY)).length).toBeGreaterThan(0)
    expect(getReview).toHaveBeenCalledWith('cand_1')

    expect(scoreOf('Technical')).toContain('4 / 5')
    expect(scoreOf('Communication')).toContain('5 / 5')
    expect(scoreOf('Problem solving')).toContain('3 / 5')
    expect(scoreOf('Cultural fit')).toContain('4 / 5')
    expect(scoreOf('Confidence')).toContain('4 / 5')
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('/ 100')).toBeInTheDocument()
    expect(screen.getAllByText('Strong hire')[0]).toHaveClass('badge')
    expect(screen.getAllByText('Clear communicator').length).toBeGreaterThan(0)
    expect(screen.getByText(/Reviewed by hr@x\.com on/)).toBeInTheDocument()

    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit scorecard|Record no-show/ })).not.toBeInTheDocument()
  })

  it('renders an older review that has four ratings and the old culture key, without a Confidence row', async () => {
    getReview.mockResolvedValue({ data: {
      external_interview: {},
      external_review: { ...REVIEW, ratings: { communication: 4, technical: 5, problem_solving: 3, culture_fit: 4 }, overall: 4.0 },
    } })
    renderModal({ mode: 'view' })
    await screen.findByText(SUMMARY)

    expect(scoreOf('Technical')).toContain('5 / 5')
    expect(scoreOf('Cultural fit')).toContain('4 / 5')
    expect(ratingsView().queryByText('Confidence')).not.toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
    expect(screen.queryByRole('region', { name: 'Scorecards' })).not.toBeInTheDocument()
  })

  it('takes an overall already given out of 100 as it is', async () => {
    getReview.mockResolvedValue(loaded({ external_review: { ...REVIEW, overall: 84 } }))
    renderModal({ mode: 'view' })
    await screen.findByText(SUMMARY)
    expect(screen.getByText('84')).toBeInTheDocument()
  })

  it('lists each scorecard with its interviewer, role, source, marks and notes', async () => {
    getReview.mockResolvedValue(loaded({ external_review: REVIEW, scorecards: [HR_CARD, LINK_CARD] }))
    renderModal({ mode: 'view' })

    const section = await screen.findByRole('region', { name: 'Scorecards' })
    expect(within(section).getByText('Scorecards (2)')).toBeInTheDocument()

    const cards = Array.from(section.querySelectorAll('details'))
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Sam Rivera')
    expect(cards[0]).toHaveTextContent('HR · In app')
    expect(cards[0]).toHaveTextContent('Hire')
    expect(cards[0]).toHaveTextContent('Solid on sharding')
    expect(cards[0]).toHaveTextContent('4 / 5')
    expect(cards[0]).toHaveTextContent('Not asked')
    expect(cards[1]).toHaveTextContent('Priya Nair')
    expect(cards[1]).toHaveTextContent('Engineer · Shared link')
    expect(cards[1]).toHaveTextContent('Strong hire')
    expect(cards[1]).toHaveTextContent('Knew hot-key mitigation')
    expect(cards[1]).toHaveTextContent('5 / 5')
    expect(cards[0]).not.toHaveAttribute('open')
  })

  it('opens a lone scorecard', async () => {
    getReview.mockResolvedValue(loaded({ external_review: REVIEW, scorecards: [HR_CARD] }))
    renderModal({ mode: 'view' })
    const section = await screen.findByRole('region', { name: 'Scorecards' })
    expect(section.querySelector('details')).toHaveAttribute('open')
  })

  it('leaves out the sections the reviewer did not fill in', async () => {
    getReview.mockResolvedValue(loaded({ external_review: { ...REVIEW, strengths: null, concerns: '' } }))
    renderModal({ mode: 'view' })
    await screen.findByText(SUMMARY)
    expect(screen.queryByText('Strengths')).not.toBeInTheDocument()
    expect(screen.queryByText('Concerns')).not.toBeInTheDocument()
  })

  it('says "No scorecard yet" when none has been submitted', async () => {
    getReview.mockResolvedValue(loaded())
    renderModal({ mode: 'view' })
    expect(await screen.findByText('No scorecard yet')).toBeInTheDocument()
  })

  it('shows a stored no-show as such', async () => {
    getReview.mockResolvedValue(loaded({ external_review: { ...REVIEW, attended: false, summary: 'Did not join' } }))
    renderModal({ mode: 'view' })
    expect(await screen.findByText('The candidate did not attend.')).toBeInTheDocument()
    expect(screen.getByText('Did not join')).toBeInTheDocument()
  })

  it('shows an inline error with a Retry that loads it again', async () => {
    getReview.mockRejectedValueOnce(new Error('503'))
    getReview.mockResolvedValueOnce(loaded({ external_review: REVIEW }))
    const { user } = renderModal({ mode: 'view' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the scorecard.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument()
    expect(getReview).toHaveBeenCalledTimes(2)
  })

  it('closes from Close and Escape without asking anything', async () => {
    getReview.mockResolvedValue(loaded())
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { user, onClose } = renderModal({ mode: 'view' })
    await screen.findByText('No scorecard yet')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
