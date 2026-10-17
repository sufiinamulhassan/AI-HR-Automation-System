import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import JobList from './JobList'

const JOBS = [
  { job_id: 'j1', title: 'Platform Engineer', company_name: 'Acme', employment_type: 'Full-time', candidate_pipeline: [] },
  { job_id: 'j2', title: 'Data Analyst', company_name: 'Acme', employment_type: 'Full-time', candidate_pipeline: [] },
]

function renderList(canManage: boolean, jobs = JOBS) {
  const handlers = { onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }
  render(<JobList jobs={jobs} canManage={canManage} {...handlers} />)
  return handlers
}

describe('JobList', () => {
  it('gives every row Edit and Delete when the caller can manage jobs', async () => {
    const user = userEvent.setup()
    const { onEdit, onDelete, onSelect } = renderList(true)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(onEdit).toHaveBeenCalledWith(JOBS[1])
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(onDelete).toHaveBeenCalledWith('j1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('leaves a row select-only when the caller cannot', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderList(false)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    await user.click(screen.getByText('Data Analyst'))
    expect(onSelect).toHaveBeenCalledWith(JOBS[1])
  })

  it('counts a careers applicant even when the match score is low', () => {
    const jobs = [{
      job_id: 'j3', title: 'Support Lead', company_name: 'Acme', employment_type: 'Full-time',
      candidate_pipeline: [
        { resume_id: 'r1', similarity_score: 0.1, source: 'career_page' },
        { resume_id: 'r2', similarity_score: 0.1 },
        { resume_id: 'r3', similarity_score: 0.9 },
      ],
    }]
    render(<JobList jobs={jobs} canManage={false} onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('2 candidates')).toBeInTheDocument()
  })

  it('tells only a caller who can manage jobs to create one', () => {
    const { unmount } = render(<JobList jobs={[]} canManage onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('No job descriptions yet. Create one to get started.')).toBeInTheDocument()
    unmount()

    render(<JobList jobs={[]} canManage={false} onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('No job descriptions yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Create one/)).not.toBeInTheDocument()
  })
})
