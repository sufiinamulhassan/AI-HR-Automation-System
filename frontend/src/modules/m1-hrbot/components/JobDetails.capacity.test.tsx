import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api', () => ({
  jobsApi: { pruneLowMatches: vi.fn() },
}))

const { default: JobDetails, jobCapacity } = await import('./JobDetails')

const JOB = { job_id: 'job-1', title: 'Senior Engineer', description: 'Build things.', source: 'manual', created_at: '2026-10-01T00:00:00Z' }

describe('JobDetails: résumé limit', () => {
  it('reads the limit from the server, or counts the pipeline when only the list row is loaded', () => {
    expect(jobCapacity({ max_resumes: 10, resume_count: 4 })).toEqual({ max: 10, count: 4, full: false })
    expect(jobCapacity({ max_resumes: 2, candidate_pipeline: [{}, {}] })).toEqual({ max: 2, count: 2, full: true })
    expect(jobCapacity({ max_resumes: 0, candidate_pipeline: [{}] })).toEqual({ max: null, count: 1, full: false })
  })

  it('says there is no limit when none is set', () => {
    render(<JobDetails job={{ ...JOB, candidate_pipeline: [{}, {}, {}] }} />)
    expect(screen.getByRole('heading', { name: 'Résumé Limit' })).toBeInTheDocument()
    expect(screen.getByText(/No limit\. 3 résumés in the pipeline\./)).toBeInTheDocument()
  })

  it('shows how many résumés are taken and how many are left', () => {
    render(<JobDetails job={{ ...JOB, max_resumes: 10, resume_count: 4 }} />)
    expect(screen.getByText('4 of 10 résumés taken')).toBeInTheDocument()
    expect(screen.getByText('6 left')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Résumés taken' })).toHaveAttribute('aria-valuenow', '4')
  })

  it('marks a full JD as taking no more candidates', () => {
    render(<JobDetails job={{ ...JOB, max_resumes: 4, resume_count: 4 }} />)
    expect(screen.getByText('Full, no more candidates accepted')).toHaveClass('is-full')
    expect(screen.getByText(/careers page tells candidates that no more candidates are accepted/)).toBeInTheDocument()
  })
})

describe('JobDetails: remove low matches', () => {
  it('is no longer inside Job Details because it has its own tab', () => {
    render(<JobDetails job={JOB} />)
    expect(screen.queryByRole('heading', { name: 'Remove Low Matches' })).not.toBeInTheDocument()
  })
})
