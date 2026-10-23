import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jobsList = vi.fn()
const jobsGet = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    list: (...a: unknown[]) => jobsList(...a),
    get: (...a: unknown[]) => jobsGet(...a),
    browse: vi.fn(),
    delete: vi.fn(),
    rematchAll: vi.fn(),
  },
  intelApi: { stats: () => Promise.resolve({ data: {} }) },
}))

vi.mock('../components/CandidatePipeline', () => ({ default: () => <div data-testid="pipeline" /> }))
vi.mock('../components/JobDetails', () => ({ default: () => <div data-testid="details" /> }))
vi.mock('../components/SourcingPanel', () => ({ default: () => <div data-testid="sourcing" /> }))
vi.mock('../components/JobForm', () => ({ default: () => null }))
vi.mock('../components/UploadResumesModal', () => ({ default: () => null }))
vi.mock('../components/UploadProgressWidget', () => ({ default: () => null }))
vi.mock('../components/ReportModal', () => ({ default: () => null }))
vi.mock('../components/CompareCandidatesModal', () => ({ default: () => null }))
vi.mock('../components/LowMatchCleanup', () => ({
  default: ({ jobId, currentMinimum, onDone }: { jobId: string; currentMinimum: number | null; onDone: () => void }) => (
    <div data-testid="cleanup">
      {jobId}|{String(currentMinimum)}
      <button type="button" onClick={onDone}>mock removed</button>
    </div>
  ),
}))

const { default: HRBotDashboard } = await import('./HRBotDashboard')
const { useAuthStore } = await import('../../../store/auth.store')

const JOB = { job_id: 'j1', title: 'Platform Engineer', company_name: 'Acme', candidate_pipeline: [], min_match_score: 45 }

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <HRBotDashboard />
    </MemoryRouter>,
  )
}

const tabs = () => document.querySelector('.content-tabs') as HTMLElement

beforeEach(() => {
  jobsList.mockReset().mockResolvedValue({ data: { jobs: [JOB], total: 1 } })
  jobsGet.mockReset().mockResolvedValue({ data: JOB })
})

describe('HRBotDashboard: Remove Low Matches tab', () => {
  it.each(['admin', 'superadmin'])('puts the button right after Sourcing for a %s and opens the tool for the selected JD', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByTestId('pipeline')
    const names = within(tabs()).getAllByRole('button').map(b => b.textContent?.trim())
    expect(names.slice(0, 4)).toEqual(['Candidate Pipeline', 'Job Details', 'Sourcing', 'Remove Low Matches'])

    await user.click(screen.getByRole('button', { name: 'Remove Low Matches' }))
    expect(screen.getByRole('button', { name: 'Remove Low Matches' })).toHaveClass('active')
    expect(screen.getByRole('heading', { name: 'Remove Low Matches' })).toBeInTheDocument()
    expect(screen.getByTestId('cleanup')).toHaveTextContent('j1|45')
  })

  it('reloads the JD and the sidebar after résumés are removed', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'a@x.com' } })
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByTestId('pipeline')
    await user.click(screen.getByRole('button', { name: 'Remove Low Matches' }))
    jobsGet.mockClear()
    jobsList.mockClear()
    await user.click(screen.getByRole('button', { name: 'mock removed' }))
    await waitFor(() => expect(jobsGet).toHaveBeenCalledWith('j1'))
    expect(jobsList).toHaveBeenCalled()
  })

  it.each(['standard', 'recruiter'])('is not offered to a %s', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })
    renderDashboard()
    await screen.findByTestId('pipeline')
    expect(screen.queryByRole('button', { name: 'Remove Low Matches' })).not.toBeInTheDocument()
  })
})
