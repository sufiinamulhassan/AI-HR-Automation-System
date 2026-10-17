import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewGuide } from '../../../lib/api'
import { formatWhen } from './externalInterview'

vi.setConfig({ testTimeout: 30_000 })

const getGuide = vi.fn()
const generate = vi.fn()
const addQuestion = vi.fn()
const removeQuestion = vi.fn()
const reorder = vi.fn()

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    getInterviewGuide: (...a: unknown[]) => getGuide(...a),
    generateInterviewGuide: (...a: unknown[]) => generate(...a),
    addGuideQuestion: (...a: unknown[]) => addQuestion(...a),
    removeGuideQuestion: (...a: unknown[]) => removeQuestion(...a),
    reorderGuideQuestions: (...a: unknown[]) => reorder(...a),
  },
}))

const { default: InterviewGuideModal } = await import('./InterviewGuideModal')

const GUIDE: InterviewGuide = {
  questions: [
    { id: 'q1', text: 'Explain how you would shard a database.', dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
    { id: 'q2', text: 'How do you explain a trade-off to a product manager?', dimension: 'communication', listen_for: 'Plain language' },
    { id: 'q3', text: 'Tell me about a time you disagreed with a teammate.', dimension: 'cultural_fit', listen_for: '' },
  ],
  generated_at: '2026-10-19T09:00:00Z',
  generated_by: 'hr@x.com',
  model: 'gpt-test',
  fallback: false,
}

function renderModal() {
  const onClose = vi.fn()
  render(<InterviewGuideModal candidateId="cand_1" candidateName="Ada Lovelace" onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

async function renderLoaded() {
  const r = renderModal()
  await screen.findByText(GUIDE.questions[0].text)
  return r
}

beforeEach(() => {
  getGuide.mockReset()
  generate.mockReset()
  addQuestion.mockReset()
  removeQuestion.mockReset()
  reorder.mockReset()
  vi.restoreAllMocks()
  document.body.classList.remove('igm-printing')
  getGuide.mockResolvedValue({ data: GUIDE })
})

describe('reading the guide', () => {
  it('is a labelled modal dialog that names the candidate, rendered into the document body', async () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Interview guide, Ada Lovelace' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(screen.getByTestId('guide-backdrop').parentElement).toBe(document.body)
    await screen.findByText(GUIDE.questions[0].text)
  })

  it('loads the guide for that candidate, with a loading state first', async () => {
    renderModal()
    expect(screen.getByRole('status')).toHaveTextContent('Loading guide…')
    await screen.findByText(GUIDE.questions[0].text)
    expect(getGuide).toHaveBeenCalledWith('cand_1')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lists the questions in order with their dimension and what to listen for', async () => {
    await renderLoaded()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Explain how you would shard a database.')
    expect(items[0]).toHaveTextContent('Technical')
    expect(items[0]).toHaveTextContent('Listen for: Consistent hashing and hot keys')
    expect(items[1]).toHaveTextContent('Communication')
    expect(items[2]).toHaveTextContent('Cultural fit')
    expect(items[2]).not.toHaveTextContent('Listen for')
    expect(screen.getByText(`Generated ${formatWhen(GUIDE.generated_at)}`.replace(/\s+/g, ' '))).toBeInTheDocument()
  })

  it('says the questions are generic only for a fallback guide', async () => {
    getGuide.mockResolvedValue({ data: { ...GUIDE, fallback: true } })
    await renderLoaded()
    expect(screen.getByText('These questions are generic, not tailored to this candidate.')).toBeInTheDocument()
  })

  it('shows an inline error with a Retry that loads it again', async () => {
    getGuide.mockRejectedValueOnce(new Error('503'))
    const { user } = renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the guide.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(GUIDE.questions[0].text)).toBeInTheDocument()
    expect(getGuide).toHaveBeenCalledTimes(2)
  })
})

describe('generating', () => {
  it('offers Generate, and only that, when there is no guide yet', async () => {
    getGuide.mockResolvedValue({ data: null })
    renderModal()
    expect(await screen.findByText('No interview guide yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Copy all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
  })

  it('Generate creates the guide and turns into Regenerate', async () => {
    getGuide.mockResolvedValue({ data: null })
    generate.mockResolvedValue({ data: GUIDE })
    const { user } = renderModal()
    await user.click(await screen.findByRole('button', { name: 'Generate' }))

    expect(generate).toHaveBeenCalledWith('cand_1', false)
    expect(await screen.findByText(GUIDE.questions[1].text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeInTheDocument()
  })

  it('disables the button while working', async () => {
    getGuide.mockResolvedValue({ data: null })
    let resolve!: (v: unknown) => void
    generate.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = renderModal()
    await user.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    resolve({ data: GUIDE })
    await screen.findByText(GUIDE.questions[0].text)
  })

  it('Regenerate asks first, then replaces the questions', async () => {
    const next: InterviewGuide = { ...GUIDE, questions: [{ id: 'n1', text: 'A brand new question?', dimension: 'confidence', listen_for: 'Poise' }] }
    generate.mockResolvedValue({ data: next })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(generate).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(generate).toHaveBeenCalledWith('cand_1', true)
    expect(await screen.findByText('A brand new question?')).toBeInTheDocument()
    expect(screen.queryByText(GUIDE.questions[0].text)).not.toBeInTheDocument()
  })

  it('shows the server detail when the questions can no longer change, and keeps the guide', async () => {
    generate.mockRejectedValue({ response: { status: 409, data: { detail: 'Scorecards already exist for this interview.' } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scorecards already exist for this interview.')
    expect(screen.getByText(GUIDE.questions[0].text)).toBeInTheDocument()
  })

  it('falls back to a generic message when generating fails without a detail', async () => {
    getGuide.mockResolvedValue({ data: null })
    generate.mockRejectedValue(new Error('Network Error'))
    const { user } = renderModal()
    await user.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not generate the questions. Please try again')
  })
})

describe('copy and print', () => {
  it('Copy all puts the numbered questions with their hints on the clipboard', async () => {
    const { user } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Copy all' }))

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    const text = await navigator.clipboard.readText()
    expect(text).toBe([
      'Interview guide: Ada Lovelace',
      '',
      '1. Explain how you would shard a database. (Technical)',
      '   Listen for: Consistent hashing and hot keys',
      '',
      '2. How do you explain a trade-off to a product manager? (Communication)',
      '   Listen for: Plain language',
      '',
      '3. Tell me about a time you disagreed with a teammate. (Cultural fit)',
    ].join('\n'))
  })

  it('Print opens the print dialog with the app hidden by the print styles, and puts it back afterwards', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { user } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(document.body).toHaveClass('igm-printing')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.body).not.toHaveClass('igm-printing')
  })

  it('marks every control as not for print', async () => {
    await renderLoaded()
    const footer = screen.getByRole('button', { name: 'Close' }).parentElement as HTMLElement
    expect(footer).toHaveClass('igm-no-print')
    expect(screen.getByRole('button', { name: 'Close guide' })).toHaveClass('igm-no-print')
  })
})

describe('closing', () => {
  it('closes from Close, the close icon, Escape and a backdrop click', async () => {
    const { user, onClose } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Close guide' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('guide-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('keeps Tab inside the dialog', async () => {
    const { user } = await renderLoaded()
    await user.tab({ shift: true })
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('takes the page out of print mode when the dialog goes away mid-print', async () => {
    document.body.classList.add('igm-printing')
    const { unmount } = render(<InterviewGuideModal candidateId="cand_1" candidateName="Ada" onClose={() => {}} />)
    await waitFor(() => expect(getGuide).toHaveBeenCalled())
    unmount()
    expect(document.body).not.toHaveClass('igm-printing')
  })
})

const CUSTOM_Q = { id: 'q4', text: 'What would you change about our product?', dimension: 'problem_solving' as const, listen_for: 'Specific, prioritised ideas', source: 'custom' as const }
const WITH_CUSTOM: InterviewGuide = { ...GUIDE, questions: [...GUIDE.questions, CUSTOM_Q] }

async function fill(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  await user.click(screen.getByLabelText(label))
  await user.paste(text)
}
const itemOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement
const ids = () => screen.getAllByRole('listitem').map(li => li.querySelector('.igm-q')?.textContent)

describe('Custom badge', () => {
  it('marks a question HR added, and no other', async () => {
    getGuide.mockResolvedValue({ data: { ...WITH_CUSTOM, questions: [{ ...WITH_CUSTOM.questions[0], source: 'ai' }, ...WITH_CUSTOM.questions.slice(1)] } })
    await renderLoaded()
    expect(within(itemOf(CUSTOM_Q.text)).getByText('Custom')).toBeInTheDocument()
    expect(screen.getAllByText('Custom')).toHaveLength(1)
    expect(within(itemOf(GUIDE.questions[0].text)).queryByText('Custom')).not.toBeInTheDocument()
    expect(within(itemOf(GUIDE.questions[1].text)).queryByText('Custom')).not.toBeInTheDocument()
  })

  it('is left out of the copied text', async () => {
    getGuide.mockResolvedValue({ data: WITH_CUSTOM })
    const { user } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Copy all' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    const text = await navigator.clipboard.readText()
    expect(text).toContain('4. What would you change about our product? (Problem solving)')
    expect(text).not.toContain('Custom')
  })
})

describe('adding a question', () => {
  async function openForm() {
    const r = await renderLoaded()
    await r.user.click(screen.getByRole('button', { name: 'Add question' }))
    return r
  }

  it('shows the form only after Add question, with the question, the area and what to listen for', async () => {
    const { user } = await renderLoaded()
    expect(screen.queryByLabelText('Question')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add question' }))

    expect(screen.getByLabelText('Question')).toHaveFocus()
    expect(screen.getByLabelText('Area')).toHaveValue('technical')
    expect(within(screen.getByLabelText('Area')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence'])
    expect(screen.getByLabelText('Listen for (optional)')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Add question' })).not.toBeInTheDocument()
  })

  it('keeps Add disabled until there is a question', async () => {
    const { user } = await openForm()
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    await fill(user, 'Question', '   ')
    expect(add).toBeDisabled()
    await fill(user, 'Question', 'x')
    expect(add).toBeEnabled()
  })

  it('sends the trimmed text, the area and the hint, then shows the guide the server returns', async () => {
    addQuestion.mockResolvedValue({ data: WITH_CUSTOM })
    const { user } = await openForm()
    await fill(user, 'Question', '  What would you change about our product?  ')
    await user.selectOptions(screen.getByLabelText('Area'), 'problem_solving')
    await fill(user, 'Listen for (optional)', 'Specific, prioritised ideas')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(addQuestion).toHaveBeenCalledWith('cand_1', {
      text: 'What would you change about our product?', dimension: 'problem_solving', listen_for: 'Specific, prioritised ideas',
    })
    expect(await screen.findByText(CUSTOM_Q.text)).toBeInTheDocument()
    expect(within(itemOf(CUSTOM_Q.text)).getByText('Custom')).toBeInTheDocument()
    expect(ids()).toHaveLength(4)
    expect(screen.queryByLabelText('Question')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add question' })).toBeInTheDocument()
  })

  it('leaves the hint out of the request when it is empty', async () => {
    addQuestion.mockResolvedValue({ data: WITH_CUSTOM })
    const { user } = await openForm()
    await fill(user, 'Question', 'A new one?')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(addQuestion.mock.calls[0][1]).toEqual({ text: 'A new one?', dimension: 'technical' })
  })

  it('disables the button while adding', async () => {
    let resolve!: (v: unknown) => void
    addQuestion.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = await openForm()
    await fill(user, 'Question', 'A new one?')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
    resolve({ data: WITH_CUSTOM })
    await screen.findByText(CUSTOM_Q.text)
  })

  it('keeps the form and what was typed when the server refuses, showing its message', async () => {
    addQuestion.mockRejectedValue({ response: { status: 409, data: { detail: 'The questions are fixed once a scorecard exists.' } } })
    const { user } = await openForm()
    await fill(user, 'Question', 'A new one?')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The questions are fixed once a scorecard exists.')
    expect(screen.getByLabelText('Question')).toHaveValue('A new one?')
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
    expect(ids()).toHaveLength(3)
  })

  it('falls back to a plain message when there is no detail', async () => {
    addQuestion.mockRejectedValue(new Error('Network Error'))
    const { user } = await openForm()
    await fill(user, 'Question', 'A new one?')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the question. Please try again')
  })

  it('Cancel puts the form away and forgets what was typed', async () => {
    const { user } = await openForm()
    await fill(user, 'Question', 'Half a thought')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Question')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getByLabelText('Question')).toHaveValue('')
    expect(addQuestion).not.toHaveBeenCalled()
  })

  it('is not offered when there is no guide yet', async () => {
    getGuide.mockResolvedValue({ data: null })
    renderModal()
    await screen.findByText('No interview guide yet')
    expect(screen.queryByRole('button', { name: 'Add question' })).not.toBeInTheDocument()
  })

  it('asks before an Escape or Close throws away a question being typed, and not otherwise', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onClose } = await openForm()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()

    await fill(user, 'Question', 'Half a thought')
    await user.keyboard('{Escape}')
    expect(confirmSpy).toHaveBeenCalledWith('Discard the question you were typing?')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('removing a question', () => {
  const removeButton = (text: string) => within(itemOf(text)).getByRole('button', { name: `Remove: ${text}` })

  it('asks first, and changes nothing when declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderLoaded()
    await user.click(removeButton(GUIDE.questions[1].text))
    expect(confirmSpy).toHaveBeenCalledWith('Remove this question?')
    expect(removeQuestion).not.toHaveBeenCalled()
    expect(ids()).toHaveLength(3)
  })

  it('removes a question HR added and shows the guide the server returns', async () => {
    getGuide.mockResolvedValue({ data: WITH_CUSTOM })
    removeQuestion.mockResolvedValue({ data: GUIDE })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(removeButton(CUSTOM_Q.text))

    expect(removeQuestion).toHaveBeenCalledWith('cand_1', 'q4')
    await waitFor(() => expect(screen.queryByText(CUSTOM_Q.text)).not.toBeInTheDocument())
    expect(ids()).toHaveLength(3)
  })

  it('can remove a question the AI wrote too', async () => {
    removeQuestion.mockResolvedValue({ data: { ...GUIDE, questions: GUIDE.questions.slice(1) } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(removeButton(GUIDE.questions[0].text))
    expect(removeQuestion).toHaveBeenCalledWith('cand_1', 'q1')
    await waitFor(() => expect(screen.queryByText(GUIDE.questions[0].text)).not.toBeInTheDocument())
  })

  it('shows the server\'s 409 message under that question and keeps the question', async () => {
    removeQuestion.mockRejectedValue({ response: { status: 409, data: { detail: 'A scorecard already holds marks for this question.' } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(removeButton(GUIDE.questions[1].text))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A scorecard already holds marks for this question.')
    expect(itemOf(GUIDE.questions[1].text)).toContainElement(alert)
    expect(ids()).toHaveLength(3)
    expect(removeButton(GUIDE.questions[1].text)).toBeEnabled()
  })

  it('clears an earlier message when the next change starts', async () => {
    removeQuestion.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Not this one.' } } })
    reorder.mockResolvedValue({ data: GUIDE })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(removeButton(GUIDE.questions[1].text))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(within(itemOf(GUIDE.questions[2].text)).getByRole('button', { name: `Move up: ${GUIDE.questions[2].text}` }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('falls back to a plain message when there is no detail', async () => {
    removeQuestion.mockRejectedValue(new Error('Network Error'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = await renderLoaded()
    await user.click(removeButton(GUIDE.questions[0].text))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the question. Please try again')
  })
})

describe('moving a question', () => {
  const up = (text: string) => within(itemOf(text)).getByRole('button', { name: `Move up: ${text}` })
  const down = (text: string) => within(itemOf(text)).getByRole('button', { name: `Move down: ${text}` })
  const [Q1, Q2, Q3] = GUIDE.questions.map(q => q.text)

  it('cannot move the first question up or the last one down', async () => {
    await renderLoaded()
    expect(up(Q1)).toBeDisabled()
    expect(down(Q1)).toBeEnabled()
    expect(up(Q3)).toBeEnabled()
    expect(down(Q3)).toBeDisabled()
  })

  it('Move down sends the whole new order and shows the order the server returns', async () => {
    reorder.mockResolvedValue({ data: { ...GUIDE, questions: [GUIDE.questions[1], GUIDE.questions[0], GUIDE.questions[2]] } })
    const { user } = await renderLoaded()
    await user.click(down(Q1))

    expect(reorder).toHaveBeenCalledWith('cand_1', ['q2', 'q1', 'q3'])
    await waitFor(() => expect(ids()).toEqual([Q2, Q1, Q3]))
  })

  it('Move up swaps with the question above', async () => {
    reorder.mockResolvedValue({ data: { ...GUIDE, questions: [GUIDE.questions[0], GUIDE.questions[2], GUIDE.questions[1]] } })
    const { user } = await renderLoaded()
    await user.click(up(Q3))
    expect(reorder).toHaveBeenCalledWith('cand_1', ['q1', 'q3', 'q2'])
    await waitFor(() => expect(ids()).toEqual([Q1, Q3, Q2]))
  })

  it('works from the order on screen after an earlier move', async () => {
    reorder
      .mockResolvedValueOnce({ data: { ...GUIDE, questions: [GUIDE.questions[1], GUIDE.questions[0], GUIDE.questions[2]] } })
      .mockResolvedValueOnce({ data: { ...GUIDE, questions: [GUIDE.questions[1], GUIDE.questions[2], GUIDE.questions[0]] } })
    const { user } = await renderLoaded()
    await user.click(down(Q1))
    await waitFor(() => expect(ids()).toEqual([Q2, Q1, Q3]))
    await user.click(down(Q1))
    expect(reorder).toHaveBeenLastCalledWith('cand_1', ['q2', 'q3', 'q1'])
  })

  it('disables every move and remove control while a change is in flight', async () => {
    let resolve!: (v: unknown) => void
    reorder.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = await renderLoaded()
    await user.click(down(Q1))
    expect(down(Q2)).toBeDisabled()
    expect(up(Q2)).toBeDisabled()
    expect(within(itemOf(Q3)).getByRole('button', { name: `Remove: ${Q3}` })).toBeDisabled()
    resolve({ data: GUIDE })
    await waitFor(() => expect(down(Q2)).toBeEnabled())
  })

  it('shows the server message under the question and keeps the order when a move is refused', async () => {
    reorder.mockRejectedValue({ response: { status: 409, data: { detail: 'The order is fixed once a scorecard exists.' } } })
    const { user } = await renderLoaded()
    await user.click(down(Q1))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The order is fixed once a scorecard exists.')
    expect(itemOf(Q1)).toContainElement(alert)
    expect(ids()).toEqual([Q1, Q2, Q3])
  })

  it('falls back to a plain message when there is no detail', async () => {
    reorder.mockRejectedValue(new Error('Network Error'))
    const { user } = await renderLoaded()
    await user.click(down(Q1))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not move the question. Please try again')
  })
})

describe('editing and print', () => {
  it('keeps every editing control out of the printed page', async () => {
    getGuide.mockResolvedValue({ data: WITH_CUSTOM })
    const { user } = await renderLoaded()
    const item = itemOf(CUSTOM_Q.text)
    expect(within(item).getByRole('button', { name: `Move up: ${CUSTOM_Q.text}` }).parentElement).toHaveClass('igm-no-print')
    expect(within(item).getByText('Custom')).toHaveClass('igm-no-print')
    expect(screen.getByRole('button', { name: 'Add question' }).parentElement).toHaveClass('igm-no-print')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getByLabelText('Question').closest('.igm-add')).toHaveClass('igm-no-print')
  })
})

describe('writing rules', () => {
  it('has no em dash anywhere in the open editor', async () => {
    getGuide.mockResolvedValue({ data: WITH_CUSTOM })
    const { user } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getByRole('dialog').textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
