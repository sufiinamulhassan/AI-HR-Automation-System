import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const jobScores = vi.fn()

vi.mock('../../../lib/api', () => ({
  resumesApi: {
    list: (...a: unknown[]) => list(...a),
    bulkDelete: vi.fn(),
    download: vi.fn(),
    get: () => Promise.resolve({ data: {} }),
    options: () => Promise.resolve({ data: {} }),
    domains: () => Promise.resolve({ data: { folders: [], total: 0 } }),
    semantic: vi.fn(),
    jobScores: (...a: unknown[]) => jobScores(...a),
  },
  savedFiltersApi: {
    list: () => Promise.resolve({ data: { templates: [] } }),
    create: vi.fn(),
    delete: vi.fn(),
  },
}))

const { default: ResumesPage } = await import('./ResumesPage')
const { useAuthStore } = await import('../../../store/auth.store')

const JANE = {
  resume_id: 'r-jane', filename: 'jane.pdf', candidate_name: 'Jane Doe',
  processing_status: 'processed', created_at: '2026-09-01T10:00:00+00:00',
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/dashboard/resumes']}>
      <ResumesPage />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'All Candidates' }))
}

beforeEach(() => {
  list.mockReset().mockResolvedValue({ data: { resumes: [JANE], total: 1, page: 1, limit: 20 } })
  jobScores.mockReset().mockResolvedValue({
    data: {
      resume_id: 'r-jane', candidate_name: 'Jane Doe', total: 2,
      jobs: [
        { job_id: 'j1', title: 'Backend Engineer', score: 0.59, stage: 'matched', status: 'active' },
        { job_id: 'j2', title: 'Data Analyst', score: null, stage: null, status: 'removed' },
      ],
    },
  })
})

describe('ResumesPage: job matches popup', () => {
  it.each(['admin', 'viewer'])('every row has a JDs button that opens the popup for that candidate (%s)', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
    renderPage()
    await screen.findByText('Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: 'Job matches for Jane Doe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Job matches' })
    expect(jobScores).toHaveBeenCalledWith('r-jane')
    expect(await within(dialog).findByLabelText('Score 59 out of 100')).toBeInTheDocument()
    expect(within(dialog).getByText('Low score, removed by admin')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Job matches' })).not.toBeInTheDocument())
  })
})
