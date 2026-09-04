import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'


const scenariosList = vi.fn()
const workflowsList = vi.fn()
const listQuestions = vi.fn()
const listSubmissions = vi.fn()

vi.mock('../../lib/api', () => ({
  scenariosApi: {
    list: (...a: unknown[]) => scenariosList(...a),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  },
  workflowsApi: {
    list: (...a: unknown[]) => workflowsList(...a),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), test: vi.fn(), runReminders: vi.fn(),
  },
}))

vi.mock('../../lib/codingApi', () => ({
  codingApi: {
    listQuestions: (...a: unknown[]) => listQuestions(...a),
    listSubmissions: (...a: unknown[]) => listSubmissions(...a),
    createQuestion: vi.fn(), updateQuestion: vi.fn(), deleteQuestion: vi.fn(),
  },
}))

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
  ])('?tab=%s selects that tab - the old routes redirect here', async (tab, expected) => {
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
