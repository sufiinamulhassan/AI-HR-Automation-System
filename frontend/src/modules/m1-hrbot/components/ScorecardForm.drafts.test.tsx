import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuideQuestion } from '../../../lib/api'
import ScorecardForm from './ScorecardForm'
import { clearScorecardDraft } from './scorecardDraft'

vi.setConfig({ testTimeout: 30_000 })

const QUESTIONS: GuideQuestion[] = [
  { id: 'q1', text: 'Explain how you would shard a database.', dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
  { id: 'q2', text: 'Walk me through the hardest bug you fixed.', dimension: 'problem_solving', listen_for: 'Hypotheses and bisecting' },
  { id: 'q3', text: 'How do you explain a trade-off to a product manager?', dimension: 'communication', listen_for: 'Plain language' },
  { id: 'q4', text: 'Describe the design of a rate limiter.', dimension: 'technical', listen_for: 'Token bucket versus sliding window' },
]
const SUMMARY = 'Clear thinker, explained trade-offs well and asked sharp questions.'
const KEY = 'hr-bot.scorecard-draft:test'

type User = ReturnType<typeof userEvent.setup>

const onSubmit = vi.fn()
const onDirtyChange = vi.fn()

function formElement(props: Partial<React.ComponentProps<typeof ScorecardForm>> = {}) {
  return (
    <ScorecardForm
      variant="admin"
      questions={QUESTIONS}
      initial={{ interviewerName: 'Sam Rivera', interviewerRole: 'hr' }}
      submitLabel="Submit scorecard"
      onSubmit={onSubmit}
      onDirtyChange={onDirtyChange}
      {...props}
    />
  )
}
function renderForm(props: Partial<React.ComponentProps<typeof ScorecardForm>> = {}) {
  const view = render(formElement(props))
  return { user: userEvent.setup(), ...view }
}

const group = (question: string) => screen.getByRole('radiogroup', { name: question })
const area = (user: User, label: string, n: number) => user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
const mark = (user: User, question: string, n: number | 'Not asked') =>
  user.click(within(group(question)).getByRole('radio', { name: n === 'Not asked' ? n : `${n} out of 5` }))
const submitBtn = () => screen.getByRole('button', { name: 'Submit scorecard' })
async function paste(user: User, label: string, text: string) {
  await user.click(screen.getByLabelText(label))
  await user.paste(text)
}

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
const store = (draft: Record<string, unknown>) => window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...draft }))

const COMPLETE = {
  name: 'Priya Nair',
  role: 'engineer',
  marks: { q1: { rating: 4, notes: 'Knew hot keys' }, q2: { rating: null, notes: 'Ran out of time' } },
  ratings: { technical: 5, communication: 4 },
  recommendation: 'hire',
  summary: SUMMARY,
  strengths: 'Systems depth',
  concerns: 'Slow to start',
}

beforeEach(() => {
  onSubmit.mockReset()
  onDirtyChange.mockReset()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('keeping', () => {
  it('keeps everything typed or picked, under the key given', async () => {
    const { user } = renderForm({ draftKey: KEY })
    expect(window.localStorage.getItem(KEY)).toBeNull()

    await mark(user, QUESTIONS[0].text, 4)
    await paste(user, `Notes: ${QUESTIONS[0].text}`, 'Knew hot keys')
    await area(user, 'Technical', 5)
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
    await paste(user, 'Summary', SUMMARY)
    await paste(user, 'Strengths (optional)', 'Systems depth')
    await paste(user, 'Concerns (optional)', 'Slow to start')

    expect(stored()).toMatchObject({
      v: 1,
      name: 'Sam Rivera',
      role: 'hr',
      marks: { q1: { rating: 4, notes: 'Knew hot keys' } },
      ratings: { technical: 5 },
      recommendation: 'hire',
      summary: SUMMARY,
      strengths: 'Systems depth',
      concerns: 'Slow to start',
    })
    expect(typeof stored().savedAt).toBe('number')
  })

  it('keeps the interviewer\'s name and role too, for a form that opens blank', async () => {
    const { user } = renderForm({ variant: 'public', initial: {}, draftKey: KEY })
    await paste(user, 'Interviewer name', 'Priya Nair')
    await user.selectOptions(screen.getByLabelText('Interviewer role'), 'engineer')
    expect(stored()).toMatchObject({ name: 'Priya Nair', role: 'engineer' })
  })

  it('keeps nothing once the form is back at its starting values', async () => {
    const { user } = renderForm({ draftKey: KEY })
    await mark(user, QUESTIONS[0].text, 4)
    expect(stored()).not.toBeNull()
    await mark(user, QUESTIONS[0].text, 'Not asked')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps nothing without a key', async () => {
    const { user } = renderForm()
    await mark(user, QUESTIONS[0].text, 4)
    await paste(user, 'Summary', SUMMARY)
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps a draft for each key apart', async () => {
    const first = renderForm({ draftKey: `${KEY}:a` })
    await mark(first.user, QUESTIONS[0].text, 2)
    first.unmount()
    const second = renderForm({ draftKey: `${KEY}:b` })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    await mark(second.user, QUESTIONS[0].text, 5)
    expect(JSON.parse(window.localStorage.getItem(`${KEY}:a`) ?? 'null').marks.q1.rating).toBe(2)
    expect(JSON.parse(window.localStorage.getItem(`${KEY}:b`) ?? 'null').marks.q1.rating).toBe(5)
  })
})

describe('restoring', () => {
  it('puts a kept draft back and says so', () => {
    store(COMPLETE)
    renderForm({ draftKey: KEY })

    expect(screen.getByRole('status')).toHaveTextContent('Draft restored')
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Priya Nair')
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('engineer')
    expect(within(group(QUESTIONS[0].text)).getByRole('radio', { name: '4 out of 5' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`)).toHaveValue('Knew hot keys')
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[1].text}`)).toHaveValue('Ran out of time')
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Communication: 4 out of 5' })).toBeChecked()
    expect(screen.getByLabelText('Recommendation')).toHaveValue('hire')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(screen.getByLabelText('Strengths (optional)')).toHaveValue('Systems depth')
    expect(screen.getByLabelText('Concerns (optional)')).toHaveValue('Slow to start')
  })

  it('does not mark an area picked by hand as prefilled, and still prefills the rest from the marks', () => {
    store({ ...COMPLETE, marks: { q3: { rating: 3, notes: '' } }, ratings: { technical: 5 } })
    renderForm({ draftKey: KEY })
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Communication: 3 out of 5' })).toBeChecked()
    expect(screen.getAllByText('Prefilled')).toHaveLength(1)
  })

  it('counts as typed work: the host is told the form is dirty', () => {
    store(COMPLETE)
    renderForm({ draftKey: KEY })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('can be submitted as it stands when it was complete', async () => {
    store({ ...COMPLETE, ratings: { technical: 5, communication: 4, problem_solving: 4, cultural_fit: 4, confidence: 4 } })
    const { user } = renderForm({ draftKey: KEY })
    expect(submitBtn()).toBeEnabled()
    await user.click(submitBtn())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      interviewer_name: 'Priya Nair', interviewer_role: 'engineer', recommendation: 'hire', summary: SUMMARY,
      strengths: 'Systems depth', concerns: 'Slow to start',
    }))
    expect(onSubmit.mock.calls[0][0].questions).toEqual([
      { question_id: 'q1', rating: 4, notes: 'Knew hot keys' },
      { question_id: 'q2', rating: null, notes: 'Ran out of time' },
      { question_id: 'q3', rating: null },
      { question_id: 'q4', rating: null },
    ])
  })

  it('shows nothing about drafts when none was kept', () => {
    renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument()
  })

  it('shows nothing about a kept draft that matches the form as it opens', () => {
    store({ name: 'Sam Rivera', role: 'hr', marks: {}, ratings: {}, recommendation: '', summary: '', strengths: '', concerns: '' })
    renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('never puts a draft over a scorecard the server already holds, and drops the leftover', async () => {
    store(COMPLETE)
    const { user } = renderForm({
      draftKey: KEY,
      saved: true,
      initial: { interviewerName: 'Sam Rivera', interviewerRole: 'hr', summary: 'Saved earlier, nothing more to add.' },
    })

    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('Summary')).toHaveValue('Saved earlier, nothing more to add.')
    expect(window.localStorage.getItem(KEY)).toBeNull()

    await mark(user, QUESTIONS[0].text, 3)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps the marks for a question the guide no longer has, and shows them again if it returns', async () => {
    store({ ...COMPLETE, marks: { q1: { rating: 4, notes: '' }, q9: { rating: 2, notes: 'From the earlier guide' } } })
    const { user, rerender } = renderForm({ draftKey: KEY, questions: [QUESTIONS[0]] })
    await paste(user, 'Summary', ' Plus a line.')
    expect(stored().marks.q9).toEqual({ rating: 2, notes: 'From the earlier guide' })

    rerender(formElement({
      draftKey: KEY,
      questions: [QUESTIONS[0], { id: 'q9', text: 'The returning question', dimension: 'technical', listen_for: '' }],
    }))
    expect(within(group('The returning question')).getByRole('radio', { name: '2 out of 5' })).toBeChecked()
  })
})

describe('bad data', () => {
  it('keeps what is valid and drops the rest', () => {
    store({
      name: 'x'.repeat(500),
      role: 'wizard',
      marks: { q1: { rating: 9, notes: 'ok' }, q2: { rating: 3, notes: 7 }, q3: 'junk', q4: null },
      ratings: { technical: 6, communication: 3, bogus: 4, confidence: 2.5 },
      recommendation: 'maybe',
      summary: SUMMARY,
      strengths: 12,
      concerns: ['a'],
    })
    renderForm({ draftKey: KEY })

    expect((screen.getByLabelText('Interviewer name (optional)') as HTMLInputElement).value).toHaveLength(120)
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('')
    expect(within(group(QUESTIONS[0].text)).getByRole('radio', { name: 'Not asked' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`)).toHaveValue('ok')
    expect(within(group(QUESTIONS[1].text)).getByRole('radio', { name: '3 out of 5' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[1].text}`)).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Communication: 3 out of 5' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Technical: 4 out of 5' })).not.toBeChecked()
    expect(screen.getByLabelText('Recommendation')).toHaveValue('')
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(screen.getByLabelText('Strengths (optional)')).toHaveValue('')
  })

  it.each([
    ['text that is not JSON', '{broken'],
    ['JSON that is not an object', '[1,2]'],
    ['null', 'null'],
  ])('treats %s as no draft', (_what, text) => {
    window.localStorage.setItem(KEY, text)
    renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Sam Rivera')
  })

  it('drops a draft left alone for more than a month', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now() - 31 * 24 * 3600 * 1000, ...COMPLETE }))
    renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('treats a draft with no time on it as old', () => {
    window.localStorage.setItem(KEY, JSON.stringify(COMPLETE))
    renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
  })

  it('works as before when storage cannot be read or written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    const { user } = renderForm({ draftKey: KEY })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()

    for (const label of ['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence']) await area(user, label, 4)
    await user.selectOptions(screen.getByLabelText('Recommendation'), 'hire')
    await paste(user, 'Summary', SUMMARY)
    expect(submitBtn()).toBeEnabled()
    await user.click(submitBtn())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('discarding', () => {
  it('asks first, and keeps the draft when declined', async () => {
    store(COMPLETE)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = renderForm({ draftKey: KEY })
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))

    expect(confirmSpy).toHaveBeenCalledWith('Discard this draft? What you entered will be lost.')
    expect(screen.getByText('Draft restored')).toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(stored()).not.toBeNull()
  })

  it('puts the form back to the values it opened with, forgets the draft and drops the notice', async () => {
    store(COMPLETE)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderForm({ draftKey: KEY })
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))

    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(screen.getByLabelText('Interviewer name (optional)')).toHaveValue('Sam Rivera')
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('hr')
    expect(within(group(QUESTIONS[0].text)).getByRole('radio', { name: 'Not asked' })).toBeChecked()
    expect(screen.getByLabelText(`Notes: ${QUESTIONS[0].text}`)).toHaveValue('')
    expect(screen.getByLabelText('Summary')).toHaveValue('')
    expect(screen.getByLabelText('Recommendation')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).not.toBeChecked()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps the form usable and keeps a new draft after a discard', async () => {
    store(COMPLETE)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderForm({ draftKey: KEY })
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    await mark(user, QUESTIONS[0].text, 2)
    expect(stored().marks.q1.rating).toBe(2)
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
  })

  it('is forgotten by the host with clearScorecardDraft once the scorecard is saved', async () => {
    const { user } = renderForm({ draftKey: KEY })
    await mark(user, QUESTIONS[0].text, 2)
    expect(stored()).not.toBeNull()
    clearScorecardDraft(KEY)
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(() => clearScorecardDraft(undefined)).not.toThrow()
  })
})

describe('writing rules', () => {
  it('has no em dash in the notice', () => {
    store(COMPLETE)
    renderForm({ draftKey: KEY })
    expect(screen.getByRole('status').textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
