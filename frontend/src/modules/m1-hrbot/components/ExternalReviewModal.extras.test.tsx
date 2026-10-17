import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalInterviewChange, InterviewGuide, Scorecard } from '../../../lib/api'
import { formatWhen } from './externalInterview'
import { scorecardDraftKey } from './scorecardDraft'

vi.setConfig({ testTimeout: 30_000 })

const submit = vi.fn()
const getReview = vi.fn()
const generate = vi.fn()
const draftSummary = vi.fn()

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    submitExternalReview: (...a: unknown[]) => submit(...a),
    getExternalReview: (...a: unknown[]) => getReview(...a),
    generateInterviewGuide: (...a: unknown[]) => generate(...a),
    draftReviewSummary: (...a: unknown[]) => draftSummary(...a),
  },
}))

const { default: ExternalReviewModal } = await import('./ExternalReviewModal')
const { useAuthStore } = await import('../../../store/auth.store')

const SUMMARY = 'Clear thinker, explained trade-offs well and asked sharp questions.'
const AREAS = ['Technical', 'Communication', 'Problem solving', 'Cultural fit', 'Confidence']
const GUIDE: InterviewGuide = {
  questions: [
    { id: 'q1', text: 'Explain how you would shard a database.', dimension: 'technical', listen_for: 'Consistent hashing and hot keys' },
    { id: 'q2', text: 'Walk me through the hardest bug you fixed.', dimension: 'problem_solving', listen_for: 'Hypotheses and bisecting' },
  ],
  generated_at: '2026-10-19T09:00:00Z',
  generated_by: 'hr@x.com',
  model: 'gpt-test',
  fallback: false,
}
const HR_CARD: Scorecard = {
  scorecard_id: 'sc_hr', source: 'hr', submitted_by: 'sam@x.com', interviewer_name: 'Sam Rivera', interviewer_role: 'hr',
  submitted_at: '2026-10-20T12:30:00Z', updated_at: '2026-10-20T12:30:00Z', questions: [],
  ratings: { technical: 4, communication: 5, problem_solving: 3, cultural_fit: 4, confidence: 4 },
  recommendation: 'hire', summary: SUMMARY, strengths: null, concerns: null,
}

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()

function loaded(over: Record<string, unknown> = {}, interview: Record<string, unknown> = {}) {
  return { data: { external_interview: { platform: 'zoom', ...interview }, external_review: null, interview_guide: GUIDE, scorecards: [], ...over } }
}

function renderModal(props: Partial<React.ComponentProps<typeof ExternalReviewModal>> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const view = render(
    <ExternalReviewModal candidateId="cand_1" candidateName="Ada Lovelace" mode="edit" onClose={onClose} onSaved={onSaved} {...props} />,
  )
  return { user: userEvent.setup(), onClose, onSaved, ...view }
}
async function renderEditor(props: Partial<React.ComponentProps<typeof ExternalReviewModal>> = {}) {
  const r = renderModal(props)
  await screen.findByRole('button', { name: 'Submit scorecard' })
  return r
}

type User = ReturnType<typeof userEvent.setup>
const area = (user: User, label: string, n: number) => user.click(screen.getByRole('radio', { name: `${label}: ${n} out of 5` }))
const submitBtn = () => screen.getByRole('button', { name: 'Submit scorecard' })
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
  submit.mockReset()
  getReview.mockReset()
  generate.mockReset()
  draftSummary.mockReset()
  vi.restoreAllMocks()
  window.localStorage.clear()
  getReview.mockResolvedValue(loaded())
  useAuthStore.setState({ token: 'tok', user: { name: 'Sam Rivera', email: 'sam@x.com' } })
})

describe('view: changes to the meeting', () => {
  const FIRST: ExternalInterviewChange = {
    at: '2026-10-15T09:00:00Z',
    by: 'hr@x.com',
    changes: {
      scheduled_start_at: ['2026-10-20T10:00:00Z', '2026-10-22T14:00:00Z'],
      join_url: ['https://zoom.us/j/111', 'https://zoom.us/j/222'],
    },
  }
  const SECOND: ExternalInterviewChange = {
    at: '2026-10-17T11:30:00Z',
    by: 'lead@x.com',
    changes: { platform: ['zoom', 'meet'], duration_minutes: [45, 30], notes: [null, 'Bring a laptop'] },
  }
  const section = () => screen.findByRole('region', { name: 'Meeting changes' })

  it('lists each change with when, who and what, the latest first', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST, SECOND] }))
    renderModal({ mode: 'view' })

    const history = await section()
    expect(within(history).getByText('Meeting changes (2)')).toBeInTheDocument()
    const entries = Array.from(history.querySelectorAll('.erm-history-item'))
    expect(entries).toHaveLength(2)

    expect(norm(entries[0].querySelector('.erm-history-when')?.textContent)).toBe(norm(formatWhen(SECOND.at)))
    expect(entries[0].querySelector('.erm-history-by')).toHaveTextContent('lead@x.com')
    expect(Array.from(entries[0].querySelectorAll('.erm-history-changes li')).map(li => norm(li.textContent))).toEqual([
      'Platform: Zoom to Google Meet',
      'Duration: 45 minutes to 30 minutes',
      'Notes: - to Bring a laptop',
    ])

    expect(entries[1]).toHaveTextContent('hr@x.com')
    expect(Array.from(entries[1].querySelectorAll('.erm-history-changes li')).map(li => norm(li.textContent))).toEqual([
      norm(`Time: ${formatWhen('2026-10-20T10:00:00Z')} to ${formatWhen('2026-10-22T14:00:00Z')}`),
      'Link: https://zoom.us/j/111 to https://zoom.us/j/222',
    ])
  })

  it('shows the time in the viewer\'s own zone, as the rest of the dialog does', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST] }))
    renderModal({ mode: 'view' })
    const entry = (await section()).querySelector('.erm-history-item') as HTMLElement
    expect(norm(entry.querySelector('.erm-history-when')?.textContent)).toBe(norm(formatWhen(FIRST.at)))
  })

  it('shows it beside the scorecards, and alone when there is no scorecard yet', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST] }))
    renderModal({ mode: 'view' })
    expect(await screen.findByText('No scorecard yet')).toBeInTheDocument()
    expect(await section()).toBeInTheDocument()
  })

  it.each([
    ['no history at all', {}],
    ['an empty history', { history: [] }],
  ])('leaves the section out for %s', async (_what, interview) => {
    getReview.mockResolvedValue(loaded({ scorecards: [HR_CARD] }, interview))
    renderModal({ mode: 'view' })
    await screen.findByRole('region', { name: 'Scorecards' })
    expect(screen.queryByRole('region', { name: 'Meeting changes' })).not.toBeInTheDocument()
  })

  it('leaves it out when the meeting object is missing altogether', async () => {
    getReview.mockResolvedValue({ data: { external_review: null, interview_guide: GUIDE, scorecards: [] } })
    renderModal({ mode: 'view' })
    expect(await screen.findByText('No scorecard yet')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Meeting changes' })).not.toBeInTheDocument()
  })

  it('cuts a long value short, and keeps a nothing as a dash', async () => {
    const long = `https://example.com/${'a'.repeat(120)}`
    getReview.mockResolvedValue(loaded({}, { history: [{ at: FIRST.at, by: 'hr@x.com', changes: { join_url: [long, null], notes: ['', 'Short'] } }] }))
    renderModal({ mode: 'view' })
    const items = Array.from((await section()).querySelectorAll('.erm-history-changes li')).map(li => li.textContent ?? '')
    expect(items[0].startsWith('Link: https://example.com/aaaa')).toBe(true)
    expect(items[0].endsWith('… to -')).toBe(true)
    expect(items[0].length).toBeLessThan(100)
    expect(items[1]).toBe('Notes: - to Short')
  })

  it('names a field it does not know, and copes with a change that is not a pair', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [{ at: FIRST.at, by: '', changes: { meeting_room: ['A', 'B'], cohort_id: 'C7' } }] }))
    renderModal({ mode: 'view' })
    const history = await section()
    expect(Array.from(history.querySelectorAll('.erm-history-changes li')).map(li => li.textContent)).toEqual([
      'Meeting room: A to B',
      'Cohort id: - to C7',
    ])
    expect(history.querySelector('.erm-history-by')).toBeNull()
  })

  it('is a place for the viewer to read and nothing else: no controls in it', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST, SECOND] }))
    renderModal({ mode: 'view' })
    const history = await section()
    expect(within(history).queryByRole('button')).not.toBeInTheDocument()
    expect(within(history).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('is not part of the edit form', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST] }))
    await renderEditor()
    expect(screen.queryByRole('region', { name: 'Meeting changes' })).not.toBeInTheDocument()
  })

  it('contains no em dash', async () => {
    getReview.mockResolvedValue(loaded({}, { history: [FIRST, SECOND] }))
    renderModal({ mode: 'view' })
    const history = await section()
    expect(history.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('edit: the draft kept in this browser', () => {
  const KEY = scorecardDraftKey('candidate', 'cand_1', 'sam@x.com')
  const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null')

  it('keeps what is typed under the candidate and the signed-in user', async () => {
    const { user } = await renderEditor()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    await area(user, 'Technical', 5)
    await paste(user, 'Summary', SUMMARY)

    expect(KEY).toBe('hr-bot.scorecard-draft:candidate:sam@x.com:cand_1')
    expect(stored()).toMatchObject({ name: 'Sam Rivera', role: 'hr', ratings: { technical: 5 }, summary: SUMMARY })
  })

  it('puts it back the next time the dialog opens for that candidate, and says so', async () => {
    const first = await renderEditor()
    await area(first.user, 'Technical', 5)
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    await renderEditor()
    expect(screen.getByText('Draft restored')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).toBeChecked()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
  })

  it('does not show it for another candidate or to another user', async () => {
    const first = await renderEditor()
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    useAuthStore.setState({ token: 'tok', user: { name: 'Grace Hopper', email: 'grace@x.com' } })
    const other = await renderEditor()
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    other.unmount()

    useAuthStore.setState({ token: 'tok', user: { name: 'Sam Rivera', email: 'sam@x.com' } })
    await renderEditor({ candidateId: 'cand_2' })
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue('')
  })

  it('clears it once the scorecard is saved', async () => {
    submit.mockResolvedValue({ data: { stage: 'completed', external_status: 'reviewed' } })
    const { user, onSaved } = await renderEditor()
    await fillScorecard(user)
    expect(stored()).not.toBeNull()
    await user.click(submitBtn())

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps it when the server refuses the scorecard, so it can be sent again', async () => {
    submit.mockRejectedValue({ response: { status: 409, data: { detail: 'Add the interview review first.' } } })
    const { user, onSaved } = await renderEditor()
    await fillScorecard(user)
    await user.click(submitBtn())

    expect(await screen.findByRole('alert')).toHaveTextContent('Add the interview review first.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(stored()).not.toBeNull()
  })

  it('clears it when a no-show is recorded, since the interview did not happen', async () => {
    submit.mockResolvedValue({ data: { stage: 'interviewing', external_status: 'no_show' } })
    const { user } = await renderEditor()
    await area(user, 'Technical', 5)
    expect(stored()).not.toBeNull()

    await user.click(screen.getByRole('radio', { name: 'The candidate did not attend' }))
    await user.click(screen.getByRole('button', { name: 'Record no-show' }))
    expect(submit).toHaveBeenCalledWith('cand_1', { attended: false, summary: undefined })
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('stays when closing is declined, and goes when the discard is agreed to', async () => {
    const first = await renderEditor()
    await area(first.user, 'Technical', 5)
    first.unmount()

    const { user, onClose } = await renderEditor()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.keyboard('{Escape}')
    expect(confirmSpy).toHaveBeenCalledWith('Discard this scorecard? What you entered will be lost.')
    expect(onClose).not.toHaveBeenCalled()
    expect(stored()).not.toBeNull()

    confirmSpy.mockReturnValue(true)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('leaves an untouched form alone: nothing is kept and closing asks nothing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { user, onClose } = await renderEditor()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    const kept = Object.keys(window.localStorage).filter(k => k.startsWith('hr-bot.scorecard-draft:'))
    expect(kept).toEqual([])
  })

  it('never puts a draft over the scorecard HR already filed', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), name: 'Sam Rivera', role: 'hr', summary: 'An unsent rewrite of the summary.' }))
    getReview.mockResolvedValue(loaded({ scorecards: [HR_CARD] }))
    await renderEditor()

    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue(SUMMARY)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('Discard draft returns to the blank form and forgets the draft', async () => {
    const first = await renderEditor()
    await area(first.user, 'Technical', 5)
    await paste(first.user, 'Summary', SUMMARY)
    first.unmount()

    const { user } = await renderEditor()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(screen.queryByText('Draft restored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'Technical: 5 out of 5' })).not.toBeChecked()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('works without storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    submit.mockResolvedValue({ data: { stage: 'completed', external_status: 'reviewed' } })
    const { user, onSaved } = await renderEditor()
    await fillScorecard(user)
    await user.click(submitBtn())
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})
