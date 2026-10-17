import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jobsList = vi.fn()
const jobsGet = vi.fn()
const jobsBrowse = vi.fn()
const intelStats = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    list: (...a: unknown[]) => jobsList(...a),
    get: (...a: unknown[]) => jobsGet(...a),
    browse: (...a: unknown[]) => jobsBrowse(...a),
    delete: vi.fn(),
    rematchAll: vi.fn(),
  },
  intelApi: { stats: (...a: unknown[]) => intelStats(...a) },
}))

type JobProp = { job: Record<string, unknown> }
type FocusProps = { focusCandidateId?: string | null; onFocusHandled?: () => void }
vi.mock('../components/CandidatePipeline', () => ({
  default: ({ job, focusCandidateId, onFocusHandled }: JobProp & FocusProps) => (
    <div>
      <div data-testid="pipeline">{String(job.title)}</div>
      <div data-testid="focus">{focusCandidateId ?? 'none'}</div>
      <button type="button" onClick={onFocusHandled}>mock focus handled</button>
    </div>
  ),
}))
vi.mock('../components/JobDetails', () => ({
  default: ({ job }: JobProp) => <div data-testid="details">{String(job.title)}</div>,
}))
vi.mock('../components/SourcingPanel', () => ({ default: () => <div data-testid="sourcing" /> }))
vi.mock('../components/JobForm', () => ({ default: () => <div data-testid="job-form" /> }))
vi.mock('../components/UploadResumesModal', () => ({ default: () => <div data-testid="upload-modal" /> }))
vi.mock('../components/UploadProgressWidget', () => ({ default: () => <div data-testid="upload-widget" /> }))
vi.mock('../components/ReportModal', () => ({ default: () => null }))
vi.mock('../components/CompareCandidatesModal', () => ({
  default: ({ jobId, jobTitle, onClose }: { jobId: string; jobTitle: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Compare candidates" data-testid="compare">
      {jobId}|{jobTitle}
      <button type="button" onClick={onClose}>mock close compare</button>
    </div>
  ),
}))

const { default: HRBotDashboard } = await import('./HRBotDashboard')
const { useAuthStore } = await import('../../../store/auth.store')

const SIDEBAR_JOBS = [
  { job_id: 'new-1', title: 'Platform Engineer', company_name: 'Acme', employment_type: 'Full-time', candidate_pipeline: [] },
  { job_id: 'new-2', title: 'Data Analyst', company_name: 'Acme', employment_type: 'Full-time', candidate_pipeline: [] },
]

const OLD_JOB = {
  job_id: 'old-1', title: 'Archived Support Lead', company_name: 'Globex', location: 'Austin',
  employment_type: 'Full-time', created_at: '2024-02-10T12:00:00+00:00', deadline_at: '2024-03-10T12:00:00+00:00',
  candidate_pipeline: [],
}

function Address({ to }: { to?: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="address">{location.pathname}{location.search}</div>
      {to && <button type="button" onClick={() => navigate(to)}>go to link</button>}
    </>
  )
}

function renderDashboard(entry = '/', goTo?: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <HRBotDashboard />
      <Address to={goTo} />
    </MemoryRouter>
  )
}

const sidebar = () => document.querySelector('.job-sidebar') as HTMLElement

describe('HRBotDashboard, Browse all jobs', () => {
  beforeEach(() => {
    jobsList.mockReset().mockResolvedValue({ data: { jobs: SIDEBAR_JOBS, total: 2 } })
    jobsGet.mockReset().mockImplementation(async (id: string) => ({
      data: { ...[...SIDEBAR_JOBS, OLD_JOB].find(j => j.job_id === id), full: true },
    }))
    jobsBrowse.mockReset().mockResolvedValue({
      data: {
        jobs: [...SIDEBAR_JOBS, OLD_JOB], total: 3, page: 1, limit: 20,
        counts: { open: 2, closed: 1, all: 3 },
      },
    })
    intelStats.mockReset().mockResolvedValue({ data: {} })
  })

  it('opens the browser from a button under the sidebar list', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await within(sidebar()).findByText('Platform Engineer')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(within(sidebar()).getByRole('button', { name: 'Browse all jobs' }))

    expect(await screen.findByRole('dialog', { name: 'Browse all jobs' })).toBeInTheDocument()
    expect(jobsBrowse).toHaveBeenCalledWith(
      { page: 1, limit: 20, status: 'all' },
      expect.any(AbortSignal),
    )
  })

  it('selects a job the sidebar never loaded, exactly as a sidebar click would', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    expect(within(sidebar()).queryByText('Archived Support Lead')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Job Details' }))
    expect(screen.getByTestId('details')).toBeInTheDocument()
    jobsGet.mockClear()

    await user.click(within(sidebar()).getByRole('button', { name: 'Browse all jobs' }))
    await user.click(await screen.findByRole('button', { name: /Archived Support Lead/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('pipeline')).toHaveTextContent('Archived Support Lead')
    expect(screen.queryByTestId('details')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Candidate Pipeline' })).toHaveClass('active')

    expect(jobsGet).toHaveBeenCalledTimes(1)
    expect(jobsGet).toHaveBeenCalledWith('old-1')
    await user.click(screen.getByRole('button', { name: 'Job Details' }))
    expect(screen.getByTestId('details')).toHaveTextContent('Archived Support Lead')
  })

  it('selects a job that is also in the sidebar the same way, highlighting its row', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    jobsGet.mockClear()

    await user.click(within(sidebar()).getByRole('button', { name: 'Browse all jobs' }))
    await user.click(await screen.findByRole('button', { name: /Data Analyst/ }))

    expect(screen.getByTestId('pipeline')).toHaveTextContent('Data Analyst')
    expect(jobsGet).toHaveBeenCalledWith('new-2')
    const row = within(sidebar()).getByText('Data Analyst').closest('.job-item')
    expect(row).toHaveClass('active')
  })

  it('leaves the current selection alone when the browser is dismissed', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    jobsGet.mockClear()

    await user.click(within(sidebar()).getByRole('button', { name: 'Browse all jobs' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer')
    expect(jobsGet).not.toHaveBeenCalled()
  })
})

describe('HRBotDashboard: Compare', () => {
  beforeEach(() => {
    jobsList.mockReset().mockResolvedValue({ data: { jobs: SIDEBAR_JOBS, total: 2 } })
    jobsGet.mockReset().mockImplementation(async (id: string) => ({
      data: { ...[...SIDEBAR_JOBS, OLD_JOB].find(j => j.job_id === id), full: true },
    }))
    intelStats.mockReset().mockResolvedValue({ data: {} })
    useAuthStore.setState({ token: null, user: null })
  })

  const signIn = (role: string) => useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })

  it.each(['admin', 'superadmin'])('gives a %s a Compare button that opens the comparison for the selected job', async role => {
    signIn(role)
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    expect(screen.queryByTestId('compare')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByTestId('compare')).toHaveTextContent('new-1|Platform Engineer')

    await user.click(screen.getByRole('button', { name: 'mock close compare' }))
    expect(screen.queryByTestId('compare')).not.toBeInTheDocument()
  })

  it('keeps the Compare button with the tabs whichever tab is open', async () => {
    signIn('admin')
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Job Details' }))
    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument()
  })

  it.each(['standard', 'recruiter'])('shows no Compare button to a %s', async role => {
    signIn(role)
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('shows no Compare button when nobody is signed in', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('has nothing to compare until a job is selected', async () => {
    signIn('admin')
    jobsList.mockResolvedValue({ data: { jobs: [], total: 0 } })
    renderDashboard()
    await screen.findByText('No job descriptions yet')
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })
})

describe('HRBotDashboard: a link to a job and a candidate', () => {
  beforeEach(() => {
    jobsList.mockReset().mockResolvedValue({ data: { jobs: SIDEBAR_JOBS, total: 2 } })
    jobsGet.mockReset().mockImplementation(async (id: string) => ({
      data: { ...[...SIDEBAR_JOBS, OLD_JOB].find(j => j.job_id === id), full: true },
    }))
    intelStats.mockReset().mockResolvedValue({ data: {} })
    useAuthStore.setState({ token: null, user: null })
  })

  const address = () => screen.getByTestId('address').textContent
  const focus = () => screen.getByTestId('focus').textContent
  const pipeline = () => screen.getByTestId('pipeline').textContent

  it('opens the job named, a job in the sidebar\'s page, instead of the first, and takes the address clean', async () => {
    renderDashboard('/dashboard/hrbot?job=new-2')
    await waitFor(() => expect(pipeline()).toBe('Data Analyst'))
    expect(within(sidebar()).getByText('Data Analyst').closest('.job-item')).toHaveClass('active')
    expect(jobsGet).toHaveBeenCalledTimes(1)
    expect(jobsGet).toHaveBeenCalledWith('new-2')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('fetches a job the sidebar never loaded, once, and opens it', async () => {
    renderDashboard('/dashboard/hrbot?job=old-1')
    await waitFor(() => expect(pipeline()).toBe('Archived Support Lead'))
    expect(jobsGet).toHaveBeenCalledTimes(1)
    expect(jobsGet).toHaveBeenCalledWith('old-1')
    expect(screen.getByRole('button', { name: 'Candidate Pipeline' })).toHaveClass('active')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('falls back to the first job when the one named is gone, without an error', async () => {
    renderDashboard('/dashboard/hrbot?job=deleted-job&candidate=cand_9')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('falls back to the first job when fetching the one named fails', async () => {
    jobsGet.mockRejectedValueOnce(new Error('500'))
    renderDashboard('/dashboard/hrbot?job=old-1')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
  })

  it('hands the candidate to the pipeline of that job, and lets go once it is handled', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/hrbot?job=new-2&candidate=cand_9')
    await waitFor(() => expect(focus()).toBe('cand_9'))
    expect(pipeline()).toBe('Data Analyst')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))

    await user.click(screen.getByRole('button', { name: 'mock focus handled' }))
    expect(focus()).toBe('none')
  })

  it('takes a candidate with no job to be in the job that opens first', async () => {
    renderDashboard('/dashboard/hrbot?candidate=cand_9')
    await waitFor(() => expect(focus()).toBe('cand_9'))
    expect(pipeline()).toBe('Platform Engineer')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('does not hand the candidate to another job the person opens next', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/hrbot?job=new-2&candidate=cand_9')
    await waitFor(() => expect(focus()).toBe('cand_9'))

    await user.click(within(sidebar()).getByText('Platform Engineer'))
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    expect(focus()).toBe('none')
  })

  it('removes only the link\'s two parameters from the address', async () => {
    renderDashboard('/dashboard/hrbot?view=table&job=new-2&candidate=cand_9&sort=name')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot?view=table&sort=name'))
  })

  it('still opens the new-job form for ?new, and still opens the job named beside it', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com' } })
    renderDashboard('/dashboard/hrbot?new=1&job=new-2')
    expect(await screen.findByTestId('job-form')).toBeInTheDocument()
    await waitFor(() => expect(pipeline()).toBe('Data Analyst'))
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('still opens the upload window for ?upload, and opens the first job', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com' } })
    renderDashboard('/dashboard/hrbot?upload=1')
    expect(await screen.findByTestId('upload-modal')).toBeInTheDocument()
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    expect(focus()).toBe('none')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('leaves the address and the choice of job alone when there is no link', async () => {
    renderDashboard('/dashboard/hrbot')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    expect(focus()).toBe('none')
    expect(address()).toBe('/dashboard/hrbot')
  })

  it('has no job to open when there are none and the one named cannot be found', async () => {
    jobsList.mockResolvedValue({ data: { jobs: [], total: 0 } })
    jobsGet.mockResolvedValue({ data: {} })
    renderDashboard('/dashboard/hrbot?job=new-2&candidate=cand_9')
    expect(await screen.findByText('No job descriptions yet')).toBeInTheDocument()
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('opens the job and candidate of a link followed while the page is already open', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/hrbot', '/dashboard/hrbot?job=new-2&candidate=cand_5')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))

    await user.click(screen.getByRole('button', { name: 'go to link' }))
    await waitFor(() => expect(pipeline()).toBe('Data Analyst'))
    expect(focus()).toBe('cand_5')
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
  })

  it('brings the pipeline back for a candidate in the job already open, from any tab', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/hrbot', '/dashboard/hrbot?candidate=cand_7')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    await user.click(screen.getByRole('button', { name: 'Job Details' }))
    expect(screen.queryByTestId('pipeline')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'go to link' }))
    await waitFor(() => expect(focus()).toBe('cand_7'))
    expect(pipeline()).toBe('Platform Engineer')
    expect(screen.getByRole('button', { name: 'Candidate Pipeline' })).toHaveClass('active')
  })

  it('fetches a job named by a link followed while open, when the sidebar does not have it', async () => {
    const user = userEvent.setup()
    renderDashboard('/dashboard/hrbot', '/dashboard/hrbot?job=old-1&candidate=cand_5')
    await waitFor(() => expect(pipeline()).toBe('Platform Engineer'))
    jobsGet.mockClear()

    await user.click(screen.getByRole('button', { name: 'go to link' }))
    await waitFor(() => expect(pipeline()).toBe('Archived Support Lead'))
    expect(focus()).toBe('cand_5')
    expect(jobsGet).toHaveBeenCalledTimes(1)
  })
})

describe('HRBotDashboard: write controls', () => {
  beforeEach(() => {
    jobsList.mockReset().mockResolvedValue({ data: { jobs: SIDEBAR_JOBS, total: 2 } })
    jobsGet.mockReset().mockImplementation(async (id: string) => ({
      data: { ...[...SIDEBAR_JOBS, OLD_JOB].find(j => j.job_id === id), full: true },
    }))
    intelStats.mockReset().mockResolvedValue({ data: {} })
    useAuthStore.setState({ token: null, user: null })
  })

  const signIn = (role: string) => useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })
  const address = () => screen.getByTestId('address').textContent

  it.each(['admin', 'superadmin'])('gives a %s Upload Resumes, Edit and Delete on every job, and the upload progress widget', async role => {
    signIn(role)
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))

    expect(within(sidebar()).getByRole('button', { name: 'Upload Resumes' })).toBeInTheDocument()
    expect(within(sidebar()).getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(within(sidebar()).getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    expect(screen.getByTestId('upload-widget')).toBeInTheDocument()
  })

  it.each(['standard', 'recruiter'])('shows a %s no Upload Resumes, Edit, Delete or upload widget, and keeps selecting a job', async role => {
    signIn(role)
    const user = userEvent.setup()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))

    expect(screen.queryByRole('button', { name: /Upload Resumes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('upload-widget')).not.toBeInTheDocument()

    await user.click(within(sidebar()).getByText('Data Analyst'))
    expect(screen.getByTestId('pipeline')).toHaveTextContent('Data Analyst')
    expect(within(sidebar()).getByRole('button', { name: 'Browse all jobs' })).toBeInTheDocument()
  })

  it('offers an admin with no jobs the Create New JD button, and opens the form from it', async () => {
    signIn('admin')
    jobsList.mockResolvedValue({ data: { jobs: [], total: 0 } })
    const user = userEvent.setup()
    renderDashboard()
    await screen.findByText('No job descriptions yet')
    expect(screen.getByText('Create your first job description to start matching candidates.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Create New JD' }))
    expect(screen.getByTestId('job-form')).toBeInTheDocument()
  })

  it('tells a standard user with no jobs that an admin adds them, with no Create New JD button', async () => {
    signIn('standard')
    jobsList.mockResolvedValue({ data: { jobs: [], total: 0 } })
    renderDashboard()
    await screen.findByText('No job descriptions yet')
    expect(screen.getByText('Job descriptions added by an admin will appear here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create New JD/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Create one to get started/)).not.toBeInTheDocument()
  })

  it.each(['?new=1', '?upload=1', '?new=1&upload=1'])('does nothing for a standard user who follows %s, and takes it off the address', async query => {
    signIn('standard')
    renderDashboard(`/dashboard/hrbot${query}`)
    await waitFor(() => expect(screen.getByTestId('pipeline')).toHaveTextContent('Platform Engineer'))
    await waitFor(() => expect(address()).toBe('/dashboard/hrbot'))
    expect(screen.queryByTestId('job-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('upload-modal')).not.toBeInTheDocument()
  })
})
