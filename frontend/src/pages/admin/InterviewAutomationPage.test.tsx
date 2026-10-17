import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scenariosList = vi.fn()
const workflowsList = vi.fn()
const listQuestions = vi.fn()
const listSubmissions = vi.fn()
const getLive = vi.fn()
const workflowsCreate = vi.fn()
const workflowsUpdate = vi.fn()
const workflowsTriggers = vi.fn()
const runReminders = vi.fn()
const cronStatus = vi.fn()
const scenariosCreate = vi.fn()
const scenariosUpdate = vi.fn()
const createQuestion = vi.fn()
const updateQuestion = vi.fn()
const listLiveSessions = vi.fn()

vi.mock('../../lib/api', () => ({
  scenariosApi: {
    list: (...a: unknown[]) => scenariosList(...a),
    create: (...a: unknown[]) => scenariosCreate(...a),
    update: (...a: unknown[]) => scenariosUpdate(...a),
    delete: vi.fn(),
  },
  workflowsApi: {
    list: (...a: unknown[]) => workflowsList(...a),
    create: (...a: unknown[]) => workflowsCreate(...a),
    update: (...a: unknown[]) => workflowsUpdate(...a),
    triggers: (...a: unknown[]) => workflowsTriggers(...a),
    runReminders: (...a: unknown[]) => runReminders(...a),
    delete: vi.fn(), test: vi.fn(),
  },
  cronApi: {
    status: (...a: unknown[]) => cronStatus(...a),
  },
}))

vi.mock('../../lib/codingApi', () => ({
  codingApi: {
    listQuestions: (...a: unknown[]) => listQuestions(...a),
    listSubmissions: (...a: unknown[]) => listSubmissions(...a),
    getLive: (...a: unknown[]) => getLive(...a),
    listLiveSessions: (...a: unknown[]) => listLiveSessions(...a),
    createQuestion: (...a: unknown[]) => createQuestion(...a),
    updateQuestion: (...a: unknown[]) => updateQuestion(...a),
    deleteQuestion: vi.fn(),
  },
}))

const TRIGGERS = [
  { key: 'candidate_invited', label: 'Candidate invited' },
  { key: 'candidate_status_changed', label: 'Candidate status changed' },
  { key: 'interview_completed', label: 'Interview completed' },
  { key: 'offer_created', label: 'Offer created' },
  { key: 'offer_status_changed', label: 'Offer status changed' },
]

const CRON_ON = { enabled: true, jobs: [] }

function mockLookups() {
  workflowsTriggers.mockReset().mockResolvedValue({ data: { triggers: TRIGGERS } })
  cronStatus.mockReset().mockResolvedValue({ data: CRON_ON })
  listLiveSessions.mockReset().mockResolvedValue({ data: { sessions: [] } })
  runReminders.mockReset().mockResolvedValue({ data: { sent: 0 } })
}

const { default: InterviewAutomationPage } = await import('./InterviewAutomationPage')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InterviewAutomationPage />
    </MemoryRouter>
  )
}

describe('InterviewAutomationPage', () => {
  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({
      data: {
        scenarios: [{
          scenario_id: 's1', name: 'System Design Deep Dive', prompt: 'Design a URL shortener',
          evaluation_dimensions: ['technical'], job_domain: 'software_engineering',
          is_active: true, created_by: 'admin@example.com', created_at: '2026-01-01T00:00:00Z',
        }],
      },
    })
    workflowsList.mockReset().mockResolvedValue({
      data: {
        rules: [{
          rule_id: 'r1', name: 'Auto-invite high scorers', trigger_type: 'resume_processed',
          conditions: [], action_type: 'send_email', action_params: {}, is_active: true,
        }],
      },
    })
    listQuestions.mockReset().mockResolvedValue({
      data: {
        questions: [{
          question_id: 'q1', title: 'Two Sum', description: 'Find the pair',
          language_templates: { python: '' }, test_cases: [], difficulty: 'easy', job_domain: null,
        }],
      },
    })
    listSubmissions.mockReset().mockResolvedValue({ data: { submissions: [], total: 0 } })
    getLive.mockReset().mockResolvedValue({ data: { status: 'not_assigned' } })
    workflowsCreate.mockReset().mockResolvedValue({ data: {} })
    workflowsUpdate.mockReset().mockResolvedValue({ data: {} })
  })

  it('defaults to the Scenarios tab and shows its rows', async () => {
    renderAt('/dashboard/interview-automation')

    expect(await screen.findByText('System Design Deep Dive')).toBeInTheDocument()
    expect(screen.queryByText('Auto-invite high scorers')).not.toBeInTheDocument()
  })

  it('shows tab counts once the three configuration lists have loaded', async () => {
    renderAt('/dashboard/interview-automation')

    const scenariosTab = await screen.findByRole('tab', { name: /Scenarios/ })
    await waitFor(() => expect(scenariosTab).toHaveTextContent('1'))
    expect(screen.getByRole('tab', { name: /Workflow Rules/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Coding Questions/ })).toHaveTextContent('1')
  })

  it.each([
    ['workflows', 'Auto-invite high scorers'],
    ['questions', 'Two Sum'],
  ])('?tab=%s selects that tab, the old routes redirect here', async (tab, expected) => {
    renderAt(`/dashboard/interview-automation?tab=${tab}`)
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('passes ?candidate_id= to the submissions API as a filter', async () => {
    renderAt('/dashboard/interview-automation?tab=submissions&candidate_id=cand-123')

    await waitFor(() => expect(listSubmissions).toHaveBeenCalled())
    expect(listSubmissions.mock.calls[0][0]).toMatchObject({ candidate_id: 'cand-123' })
    expect(await screen.findByText(/Submissions for cand-123/)).toBeInTheDocument()
  })

  it('loads all submissions when no candidate_id is given', async () => {
    renderAt('/dashboard/interview-automation?tab=submissions')

    await waitFor(() => expect(listSubmissions).toHaveBeenCalled())
    expect(listSubmissions.mock.calls[0][0].candidate_id).toBeUndefined()
    expect(await screen.findByText('All submissions')).toBeInTheDocument()
  })

  it('switching to the Submissions tab does not carry a filter that was never set', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation')

    await user.click(await screen.findByRole('tab', { name: /Submissions/ }))

    await waitFor(() => expect(listSubmissions).toHaveBeenCalled())
    expect(listSubmissions.mock.calls[0][0].candidate_id).toBeUndefined()
  })
})

function httpError(status: number, detail: string) {
  return { response: { status, data: { detail } } }
}

describe('InterviewAutomationPage workflow triggers', () => {
  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    listQuestions.mockReset().mockResolvedValue({ data: { questions: [] } })
    workflowsCreate.mockReset().mockResolvedValue({ data: {} })
    workflowsUpdate.mockReset().mockResolvedValue({ data: {} })
  })

  async function openNewRule(user: ReturnType<typeof userEvent.setup>) {
    renderAt('/dashboard/interview-automation?tab=workflows')
    const add = await screen.findByRole('button', { name: '+ Add Rule' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    return screen.getByLabelText('Trigger Type') as HTMLSelectElement
  }

  it('offers the triggers the server lists, by label, and not resume_processed', async () => {
    const user = userEvent.setup()
    const select = await openNewRule(user)

    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(o => o.value)).toEqual([
      'candidate_invited', 'candidate_status_changed', 'interview_completed',
      'offer_created', 'offer_status_changed',
    ])
    expect(options.map(o => o.textContent)).toEqual([
      'Candidate invited', 'Candidate status changed', 'Interview completed',
      'Offer created', 'Offer status changed',
    ])
    expect(options.map(o => o.value)).not.toContain('resume_processed')
    expect(workflowsTriggers).toHaveBeenCalledTimes(1)
  })

  it('follows the server: a trigger it adds appears, with no change here', async () => {
    const user = userEvent.setup()
    workflowsTriggers.mockResolvedValue({
      data: { triggers: [{ key: 'new_hire_started', label: 'New hire started' }, ...TRIGGERS] },
    })
    const select = await openNewRule(user)

    expect(within(select).getByRole('option', { name: 'New hire started' })).toBeInTheDocument()
    expect(select.value).toBe('new_hire_started')
  })

  it('does not let a rule be added until the triggers are known, and offers Retry when they cannot be read', async () => {
    const user = userEvent.setup()
    workflowsTriggers.mockRejectedValueOnce(httpError(500, 'Trigger list unavailable'))
    renderAt('/dashboard/interview-automation?tab=workflows')

    expect(await screen.findByText('Trigger list unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add Rule' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '+ Add Rule' })).toBeEnabled())
    expect(screen.queryByText('Trigger list unavailable')).not.toBeInTheDocument()
    expect(workflowsTriggers).toHaveBeenCalledTimes(2)
  })

  it('flags a rule whose trigger the server no longer lists as one that never fires', async () => {
    workflowsList.mockResolvedValue({
      data: {
        rules: [
          { rule_id: 'r1', name: 'Legacy rule', trigger_type: 'resume_processed', conditions: [], action_type: 'send_email', action_params: {}, is_active: true },
          { rule_id: 'r2', name: 'Live rule', trigger_type: 'candidate_invited', conditions: [], action_type: 'send_email', action_params: {}, is_active: true },
        ],
      },
    })
    renderAt('/dashboard/interview-automation?tab=workflows')

    const legacy = (await screen.findByText('Legacy rule')).closest('tr') as HTMLElement
    await within(legacy).findByText('Never fires')
    const live = screen.getByText('Live rule').closest('tr') as HTMLElement
    expect(within(live).queryByText('Never fires')).not.toBeInTheDocument()
  })

  it('defaults a new rule to a trigger that fires', async () => {
    const user = userEvent.setup()
    const select = await openNewRule(user)

    expect(select.value).toBe('candidate_invited')
    await user.type(screen.getByPlaceholderText('e.g. Auto-invite high scorers'), 'Welcome')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(workflowsCreate).toHaveBeenCalledTimes(1))
    expect(workflowsCreate.mock.calls[0][0]).toMatchObject({ name: 'Welcome', trigger_type: 'candidate_invited' })
  })

  it('keeps an existing resume_processed rule visible and marked as one that never fires', async () => {
    const user = userEvent.setup()
    workflowsList.mockResolvedValue({
      data: {
        rules: [{
          rule_id: 'r1', name: 'Legacy rule', trigger_type: 'resume_processed',
          conditions: [], action_type: 'send_email', action_params: {}, is_active: true,
        }],
      },
    })
    renderAt('/dashboard/interview-automation?tab=workflows')

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const select = screen.getByLabelText('Trigger Type') as HTMLSelectElement
    expect(select.value).toBe('resume_processed')
    expect(await within(select).findByRole('option', { name: 'resume_processed (never fires)' })).toBeInTheDocument()

    await user.selectOptions(select, 'candidate_invited')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(workflowsUpdate).toHaveBeenCalledTimes(1))
    expect(workflowsUpdate.mock.calls[0][1]).toMatchObject({ trigger_type: 'candidate_invited' })
  })
})

describe('InterviewAutomationPage list loading', () => {
  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    listQuestions.mockReset().mockResolvedValue({ data: { questions: [] } })
  })

  it('asks for up to 100 coding questions, not the server default of 20', async () => {
    renderAt('/dashboard/interview-automation?tab=questions')

    await waitFor(() => expect(listQuestions).toHaveBeenCalled())
    expect(listQuestions).toHaveBeenCalledWith({ limit: 100 })
  })

  it('shows the question list beyond the 21st row', async () => {
    listQuestions.mockResolvedValue({
      data: {
        questions: Array.from({ length: 30 }, (_, i) => ({
          question_id: `q${i}`, title: `Question ${i + 1}`, description: '',
          language_templates: { python: '' }, test_cases: [], difficulty: 'easy', job_domain: null,
        })),
      },
    })
    renderAt('/dashboard/interview-automation?tab=questions')

    expect(await screen.findByText('Question 30')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Coding Questions/ })).toHaveTextContent('30')
  })

  it.each([
    ['scenarios', 'No scenarios yet.', 'Scenarios', scenariosList, 'scenarios', 'System Design Deep Dive'],
    ['workflows', 'No workflow rules yet.', 'Workflow Rules', workflowsList, 'rules', 'Nightly reminder'],
    ['questions', 'No coding questions yet.', 'Coding Questions', listQuestions, 'questions', 'Two Sum'],
  ])('%s: a failed load shows the error with Retry, never the empty state', async (tab, emptyText, tabName, mock, key, rowName) => {
    const user = userEvent.setup()
    mock.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    mock.mockResolvedValue({
      data: {
        [key]: [
          key === 'rules'
            ? { rule_id: 'r1', name: rowName, trigger_type: 'candidate_invited', conditions: [], action_type: 'send_email', action_params: {}, is_active: true }
            : key === 'questions'
              ? { question_id: 'q1', title: rowName, description: '', language_templates: {}, test_cases: [], difficulty: 'easy' }
              : { scenario_id: 's1', name: rowName, prompt: 'p', evaluation_dimensions: [], job_domain: null, is_active: true },
        ],
      },
    })
    renderAt(`/dashboard/interview-automation?tab=${tab}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: new RegExp(tabName) })).not.toHaveTextContent(/\d/)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(rowName)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: new RegExp(tabName) })).toHaveTextContent('1')
  })

  it('falls back to a generic message when a failure carries no detail', async () => {
    scenariosList.mockRejectedValue(new Error('Network Error'))
    renderAt('/dashboard/interview-automation')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load scenarios.')
  })

  it('still shows the empty state for a list that loaded and is genuinely empty', async () => {
    renderAt('/dashboard/interview-automation')

    expect(await screen.findByText('No scenarios yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('one failed list does not hide the others', async () => {
    workflowsList.mockRejectedValue(httpError(500, 'Rules store down'))
    scenariosList.mockResolvedValue({
      data: {
        scenarios: [{
          scenario_id: 's1', name: 'System Design Deep Dive', prompt: 'p',
          evaluation_dimensions: [], job_domain: null, is_active: true,
        }],
      },
    })
    renderAt('/dashboard/interview-automation')

    expect(await screen.findByText('System Design Deep Dive')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const SESSIONS = [
  {
    candidate_id: 'cand-1', candidate_name: 'Ada Lovelace', question_title: 'Two Sum',
    language: 'python', last_saved_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    candidate_id: 'cand-2', candidate_name: 'Grace Hopper', question_title: 'Fizz Buzz',
    language: 'javascript', last_saved_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
]

describe('InterviewAutomationPage, Live Sessions tab', () => {
  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    listQuestions.mockReset().mockResolvedValue({ data: { questions: [] } })
    listSubmissions.mockReset().mockResolvedValue({ data: { submissions: [], total: 0 } })
    getLive.mockReset()
  })

  it('lists who is coding instead of asking for a typed candidate id', async () => {
    listLiveSessions.mockResolvedValue({ data: { sessions: SESSIONS } })
    renderAt('/dashboard/interview-automation?tab=live')

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Two Sum · python')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(getLive).not.toHaveBeenCalled()
    expect(screen.queryByText(/^Live session,/)).not.toBeInTheDocument()
  })

  it('says so when no one is coding, rather than showing an empty box', async () => {
    renderAt('/dashboard/interview-automation?tab=live')

    expect(await screen.findByText('No one is coding right now.')).toBeInTheDocument()
  })

  it('shows an error with Retry when the sessions cannot be read', async () => {
    const user = userEvent.setup()
    listLiveSessions.mockRejectedValueOnce(httpError(500, 'Session store unavailable'))
    listLiveSessions.mockResolvedValue({ data: { sessions: SESSIONS } })
    renderAt('/dashboard/interview-automation?tab=live')

    expect(await screen.findByRole('alert')).toHaveTextContent('Session store unavailable')
    expect(screen.queryByText('No one is coding right now.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the live view of the row that is clicked, and Close returns to the list', async () => {
    const user = userEvent.setup()
    listLiveSessions.mockResolvedValue({ data: { sessions: SESSIONS } })
    getLive.mockResolvedValue({
      data: {
        candidate_id: 'cand-1', status: 'in_progress', question_id: 'q1',
        question_title: 'Two Sum', language: 'python', code: 'return 42',
        last_saved_at: '2026-01-01T12:00:00Z',
      },
    })
    renderAt('/dashboard/interview-automation?tab=live')

    await user.click(await screen.findByRole('button', { name: /Ada Lovelace/ }))

    expect(await screen.findByText('Live session, Ada Lovelace')).toBeInTheDocument()
    expect(await screen.findByText('return 42')).toBeInTheDocument()
    expect(getLive).toHaveBeenCalledWith('cand-1')
    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Grace Hopper/ })).not.toHaveAttribute('aria-current')

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByText(/^Live session,/)).not.toBeInTheDocument()
    expect(screen.queryByText('return 42')).not.toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('switching to another session never shows the previous candidate\'s code', async () => {
    const user = userEvent.setup()
    listLiveSessions.mockResolvedValue({ data: { sessions: SESSIONS } })
    getLive.mockImplementation((id: string) => Promise.resolve({
      data: {
        candidate_id: id, status: 'in_progress', question_id: 'q1', question_title: 'Two Sum',
        language: 'python', code: id === 'cand-1' ? 'code of ada' : 'code of grace',
        last_saved_at: '2026-01-01T12:00:00Z',
      },
    }))
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')
    expect(await screen.findByText('code of ada')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Grace Hopper/ }))

    expect(await screen.findByText('code of grace')).toBeInTheDocument()
    expect(screen.queryByText('code of ada')).not.toBeInTheDocument()
  })

  it('falls back to the candidate id in the heading when the sessions list does not name them', async () => {
    getLive.mockResolvedValue({ data: { candidate_id: 'cand-9', status: 'not_assigned' } })
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-9')

    expect(await screen.findByText('Live session, cand-9')).toBeInTheDocument()
  })

  it('renders the not_assigned status as a clear "not assigned yet" state', async () => {
    getLive.mockResolvedValue({ data: { candidate_id: 'cand-1', status: 'not_assigned', question_id: null, question_title: null, language: null, code: null, last_saved_at: null } })
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')

    expect(await screen.findByText(/no coding question has been assigned/i)).toBeInTheDocument()
    expect(screen.getByText('Not assigned')).toBeInTheDocument()
  })

  it('renders the not_started status as a "hasn\'t started" state', async () => {
    getLive.mockResolvedValue({
      data: {
        candidate_id: 'cand-1', status: 'not_started', question_id: 'q1',
        question_title: 'Two Sum', language: null, code: null, last_saved_at: null,
      },
    })
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')

    expect(await screen.findByText(/hasn't started writing code yet/i)).toBeInTheDocument()
    expect(screen.getByText('Not started')).toBeInTheDocument()
  })

  it('renders a live, read-only code view while in_progress', async () => {
    getLive.mockResolvedValue({
      data: {
        candidate_id: 'cand-1', status: 'in_progress', question_id: 'q1',
        question_title: 'Two Sum', language: 'python', code: 'return 42',
        last_saved_at: '2026-01-01T12:00:00Z',
      },
    })
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')

    expect(await screen.findByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Two Sum')).toBeInTheDocument()
    expect(screen.getByText('python')).toBeInTheDocument()
    expect(screen.getByText('return 42')).toBeInTheDocument()
    expect(screen.getByText('Live Code (read-only)')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /code editor/i })).not.toBeInTheDocument()
  })

  it('links a submitted session to the existing post-hoc Submissions view', async () => {
    const user = userEvent.setup()
    getLive.mockResolvedValue({
      data: {
        candidate_id: 'cand-1', status: 'submitted', question_id: 'q1',
        question_title: 'Two Sum', language: 'python', code: 'def solve(): return 1',
        last_saved_at: '2026-01-01T12:00:00Z',
      },
    })
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')

    expect(await screen.findByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText(/already been\s+submitted/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view full results in submissions/i }))

    await waitFor(() => expect(listSubmissions).toHaveBeenCalled())
    expect(listSubmissions.mock.calls[0][0]).toMatchObject({ candidate_id: 'cand-1' })
    expect(await screen.findByText(/Submissions for cand-1/)).toBeInTheDocument()
  })
})

describe('InterviewAutomationPage: live polling', () => {
  const IN_PROGRESS = {
    candidate_id: 'cand-1', status: 'in_progress', question_id: 'q1', question_title: 'Two Sum',
    language: 'python', code: 'return 42', last_saved_at: '2026-01-01T12:00:00Z',
  }

  function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  async function tick(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    listQuestions.mockReset().mockResolvedValue({ data: { questions: [] } })
    getLive.mockReset().mockResolvedValue({ data: IN_PROGRESS })
    listLiveSessions.mockResolvedValue({ data: { sessions: SESSIONS } })
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'hidden')
  })

  it('refreshes the session list every five seconds while the tab is visible', async () => {
    renderAt('/dashboard/interview-automation?tab=live')
    await screen.findByText('Ada Lovelace')
    expect(listLiveSessions).toHaveBeenCalledTimes(1)

    await tick(5000)
    expect(listLiveSessions).toHaveBeenCalledTimes(2)

    await tick(5000)
    expect(listLiveSessions).toHaveBeenCalledTimes(3)
  })

  it('shows a session that appears on a later refresh', async () => {
    listLiveSessions.mockResolvedValueOnce({ data: { sessions: [] } })
    renderAt('/dashboard/interview-automation?tab=live')
    await screen.findByText('No one is coding right now.')

    await tick(5000)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('No one is coding right now.')).not.toBeInTheDocument()
  })

  it('refreshes the watched candidate on the same five second beat', async () => {
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')
    await screen.findByText('return 42')
    expect(getLive).toHaveBeenCalledTimes(1)

    await tick(5000)
    expect(getLive).toHaveBeenCalledTimes(2)
  })

  it('stops asking while the browser tab is hidden', async () => {
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')
    await screen.findByText('return 42')
    const sessionCalls = listLiveSessions.mock.calls.length
    const liveCalls = getLive.mock.calls.length

    setHidden(true)
    await tick(30_000)

    expect(listLiveSessions).toHaveBeenCalledTimes(sessionCalls)
    expect(getLive).toHaveBeenCalledTimes(liveCalls)
  })

  it('refreshes at once when the tab becomes visible again, then carries on every five seconds', async () => {
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')
    await screen.findByText('return 42')
    setHidden(true)
    await tick(30_000)
    const sessionCalls = listLiveSessions.mock.calls.length
    const liveCalls = getLive.mock.calls.length

    await act(async () => { setHidden(false) })

    await waitFor(() => expect(listLiveSessions).toHaveBeenCalledTimes(sessionCalls + 1))
    expect(getLive).toHaveBeenCalledTimes(liveCalls + 1)

    await tick(5000)
    expect(listLiveSessions).toHaveBeenCalledTimes(sessionCalls + 2)
  })

  it('does not start polling at all when the page opens in a hidden tab', async () => {
    setHidden(true)
    renderAt('/dashboard/interview-automation?tab=live')
    await tick(20_000)

    expect(listLiveSessions).not.toHaveBeenCalled()

    await act(async () => { setHidden(false) })
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(listLiveSessions).toHaveBeenCalledTimes(1)
  })

  it('stops polling a candidate that does not exist', async () => {
    getLive.mockRejectedValue(httpError(404, 'Candidate not found'))
    renderAt('/dashboard/interview-automation?tab=live&candidate_id=nobody')
    expect(await screen.findByText('No candidate found with that ID.')).toBeInTheDocument()
    const calls = getLive.mock.calls.length

    await tick(20_000)

    expect(getLive).toHaveBeenCalledTimes(calls)
  })

  it('stops polling when the page is left', async () => {
    const { unmount } = renderAt('/dashboard/interview-automation?tab=live&candidate_id=cand-1')
    await screen.findByText('return 42')
    unmount()
    const sessionCalls = listLiveSessions.mock.calls.length
    const liveCalls = getLive.mock.calls.length

    await tick(20_000)

    expect(listLiveSessions).toHaveBeenCalledTimes(sessionCalls)
    expect(getLive).toHaveBeenCalledTimes(liveCalls)
  })
})

describe('InterviewAutomationPage: scheduled runs', () => {
  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    listQuestions.mockReset().mockResolvedValue({ data: { questions: [] } })
  })

  it('says scheduled runs are off, in one line, when the cron secret is not set', async () => {
    cronStatus.mockResolvedValue({
      data: { enabled: false, jobs: [{ key: 'reminders', label: 'Reminders', last_run_at: null, last_status: null, last_detail: null }] },
    })
    renderAt('/dashboard/interview-automation?tab=workflows')

    expect(await screen.findByText('Scheduled runs are off because the cron secret is not set.')).toBeInTheDocument()
    expect(screen.queryByText('Reminders')).not.toBeInTheDocument()
  })

  it('shows each job with its last run and last status', async () => {
    const lastRun = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    cronStatus.mockResolvedValue({
      data: {
        enabled: true,
        jobs: [
          { key: 'reminders', label: 'Interview reminders', last_run_at: lastRun, last_status: 'ok', last_detail: '4 sent' },
          { key: 'expiry', label: 'Expire invites', last_run_at: null, last_status: null, last_detail: null },
          { key: 'digest', label: 'Daily digest', last_run_at: lastRun, last_status: 'failed', last_detail: 'SMTP timeout' },
        ],
      },
    })
    renderAt('/dashboard/interview-automation?tab=workflows')

    const reminders = (await screen.findByText('Interview reminders')).closest('li') as HTMLElement
    expect(within(reminders).getByText('3 h ago')).toBeInTheDocument()
    expect(within(reminders).getByText('ok')).toHaveClass('badge-green')
    expect(within(reminders).getByText('4 sent')).toBeInTheDocument()

    const expiry = screen.getByText('Expire invites').closest('li') as HTMLElement
    expect(within(expiry).getByText('Never run')).toBeInTheDocument()
    expect(within(expiry).queryByText(/ago$/)).not.toBeInTheDocument()

    const digest = screen.getByText('Daily digest').closest('li') as HTMLElement
    expect(within(digest).getByText('failed')).toHaveClass('badge-red')
    expect(within(digest).getByText('SMTP timeout')).toBeInTheDocument()

    expect(screen.queryByText(/cron secret/)).not.toBeInTheDocument()
  })

  it('sits with the Send Pending Reminders Now control, and reads again after it runs', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation?tab=workflows')
    await screen.findByRole('button', { name: 'Send Pending Reminders Now' })
    await waitFor(() => expect(cronStatus).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Send Pending Reminders Now' }))

    await waitFor(() => expect(runReminders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(cronStatus).toHaveBeenCalledTimes(2))
  })

  it('says so, without hiding the rules, when the status cannot be read', async () => {
    cronStatus.mockRejectedValue(httpError(500, 'boom'))
    workflowsList.mockResolvedValue({
      data: {
        rules: [{ rule_id: 'r1', name: 'Welcome', trigger_type: 'candidate_invited', conditions: [], action_type: 'send_email', action_params: {}, is_active: true }],
      },
    })
    renderAt('/dashboard/interview-automation?tab=workflows')

    expect(await screen.findByText('Scheduled run status is unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('InterviewAutomationPage: job domain', () => {
  beforeEach(() => {
    mockLookups()
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
    scenariosCreate.mockReset().mockResolvedValue({ data: {} })
    scenariosUpdate.mockReset().mockResolvedValue({ data: {} })
    createQuestion.mockReset().mockResolvedValue({ data: {} })
    updateQuestion.mockReset().mockResolvedValue({ data: {} })
    scenariosList.mockReset().mockResolvedValue({
      data: {
        scenarios: [{
          scenario_id: 's1', name: 'System Design Deep Dive', prompt: 'Design a URL shortener',
          evaluation_dimensions: ['technical'], job_domain: 'software_engineering',
          is_active: true, created_by: 'admin@example.com', created_at: '2026-01-01T00:00:00Z',
        }],
      },
    })
    listQuestions.mockReset().mockResolvedValue({
      data: {
        questions: [{
          question_id: 'q1', title: 'Two Sum', description: 'Find the pair',
          language_templates: { python: '' }, test_cases: [{ input: '1', expected_output: '2', is_hidden: false }],
          difficulty: 'easy', job_domain: 'software_engineering',
        }],
        total: 1,
      },
    })
  })

  it('clears a scenario\'s domain by sending null when the field is emptied', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation')
    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    const field = screen.getByLabelText('Job Domain')
    expect(field).toHaveValue('software_engineering')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(scenariosUpdate).toHaveBeenCalledTimes(1))
    expect(scenariosUpdate.mock.calls[0][0]).toBe('s1')
    expect(scenariosUpdate.mock.calls[0][1]).toHaveProperty('job_domain', null)
  })

  it('sends the domain as typed, trimmed, when it is kept or changed', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation')
    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    const field = screen.getByLabelText('Job Domain')
    await user.clear(field)
    await user.type(field, '  data_science ')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(scenariosUpdate).toHaveBeenCalledTimes(1))
    expect(scenariosUpdate.mock.calls[0][1]).toHaveProperty('job_domain', 'data_science')
  })

  it('leaves the domain out of a new scenario that has none', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation')
    await user.click(await screen.findByRole('button', { name: '+ Add Scenario' }))
    await user.type(screen.getByLabelText('Name *'), 'New one')
    await user.type(screen.getByLabelText('Prompt *'), 'Do the thing')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(scenariosCreate).toHaveBeenCalledTimes(1))
    expect(scenariosCreate.mock.calls[0][0].job_domain).toBeUndefined()
  })

  it('clears a coding question\'s domain by sending null when the field is emptied', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation?tab=questions')
    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    const field = screen.getByLabelText('Job Domain')
    expect(field).toHaveValue('software_engineering')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1))
    expect(updateQuestion.mock.calls[0][0]).toBe('q1')
    expect(updateQuestion.mock.calls[0][1]).toHaveProperty('job_domain', null)
  })

  it('leaves the domain out of a new coding question that has none', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/interview-automation?tab=questions')
    await user.click(await screen.findByRole('button', { name: '+ Add Question' }))
    await user.type(screen.getByLabelText('Title *'), 'Fizz Buzz')
    await user.type(screen.getByLabelText('Description *'), 'Print numbers')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(1))
    expect(createQuestion.mock.calls[0][0].job_domain).toBeUndefined()
  })
})

describe('InterviewAutomationPage: question total', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    question_id: `q${i}`, title: `Question ${i + 1}`, description: '',
    language_templates: { python: '' }, test_cases: [], difficulty: 'easy', job_domain: null,
  }))

  beforeEach(() => {
    mockLookups()
    scenariosList.mockReset().mockResolvedValue({ data: { scenarios: [] } })
    workflowsList.mockReset().mockResolvedValue({ data: { rules: [] } })
  })

  it('counts the questions that exist, not just the ones fetched', async () => {
    listQuestions.mockReset().mockResolvedValue({ data: { questions: rows(100), total: 137 } })
    renderAt('/dashboard/interview-automation?tab=questions')

    expect(await screen.findByText('Question 100')).toBeInTheDocument()
    expect(listQuestions).toHaveBeenCalledWith({ limit: 100 })
    expect(screen.getByRole('tab', { name: /Coding Questions/ })).toHaveTextContent('137')
    expect(screen.getByText('Showing 100 of 137')).toBeInTheDocument()
  })

  it('shows no "showing" note when everything was fetched', async () => {
    listQuestions.mockReset().mockResolvedValue({ data: { questions: rows(30), total: 30 } })
    renderAt('/dashboard/interview-automation?tab=questions')

    expect(await screen.findByText('Question 30')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Coding Questions/ })).toHaveTextContent('30')
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument()
  })

  it('falls back to the rows it has when the answer carries no total', async () => {
    listQuestions.mockReset().mockResolvedValue({ data: { questions: rows(3) } })
    renderAt('/dashboard/interview-automation?tab=questions')

    expect(await screen.findByText('Question 3')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Coding Questions/ })).toHaveTextContent('3')
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument()
  })
})
