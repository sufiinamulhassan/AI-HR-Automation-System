import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jobScores = vi.fn()

vi.mock('../../../lib/api', () => ({
  resumesApi: { jobScores: (...a: unknown[]) => jobScores(...a) },
}))

const { default: ResumeJobsModal, scorePercent } = await import('./ResumeJobsModal')

const JOBS = [
  { job_id: 'j1', title: 'Backend Engineer', score: 0.59, stage: 'matched', status: 'active' },
  { job_id: 'j2', title: 'Data Analyst', score: 0.5, stage: 'shortlisted', status: 'active' },
  { job_id: 'j3', title: 'Upload Only', score: null, stage: 'matched', status: 'active' },
  { job_id: 'j4', title: 'Frontend Engineer', score: null, stage: null, status: 'removed' },
]

function setup() {
  const onClose = vi.fn()
  render(<ResumeJobsModal resumeId="r1" candidateName="Ana Ruiz" onClose={onClose} />)
  return { onClose }
}

beforeEach(() => {
  jobScores.mockReset().mockResolvedValue({ data: { resume_id: 'r1', candidate_name: 'Ana Ruiz', jobs: JOBS, total: 4 } })
})

describe('ResumeJobsModal', () => {
  it('turns a 0 to 1 score into a whole number out of 100', () => {
    expect(scorePercent(0.594)).toBe(59)
    expect(scorePercent(1.4)).toBe(100)
    expect(scorePercent(null)).toBeNull()
  })

  it('lists every JD in the order the server ranked them, with the score against each', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Job matches for Ana Ruiz' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(r => r.querySelector('.rjm-title')?.textContent)).toEqual([
      'Backend Engineer', 'Data Analyst', 'Upload Only', 'Frontend Engineer',
    ])
    expect(within(rows[0]).getByText('Ana Ruiz scored 59 against this JD · Matched')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('Score 59 out of 100')).toBeInTheDocument()
    expect(within(rows[1]).getByLabelText('Score 50 out of 100')).toBeInTheDocument()
    expect(within(rows[2]).getByText('No score')).toBeInTheDocument()
    expect(jobScores).toHaveBeenCalledWith('r1')
    expect(screen.getByText('Ana Ruiz appears in 3 job descriptions, highest score first.')).toBeInTheDocument()
  })

  it('shows a JD the admin removed it from as low score with no number', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Job matches for Ana Ruiz' })
    const removed = within(list).getAllByRole('listitem')[3]
    expect(within(removed).getByText('Low score, removed by admin')).toBeInTheDocument()
    expect(within(removed).getByText('Low score')).toBeInTheDocument()
    expect(within(removed).queryByLabelText(/^Score /)).not.toBeInTheDocument()
  })

  it('closes from the X button and from the Escape key', async () => {
    const { onClose } = setup()
    await screen.findByRole('list')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('says so when the candidate is in no JD', async () => {
    jobScores.mockResolvedValue({ data: { resume_id: 'r1', candidate_name: 'Ana Ruiz', jobs: [], total: 0 } })
    setup()
    expect(await screen.findByText('Ana Ruiz is not in any job description yet.')).toBeInTheDocument()
  })

  it('shows the server error when the matches cannot load', async () => {
    jobScores.mockRejectedValue({ response: { data: { detail: 'Resume not found' } } })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Resume not found')
  })

  it('lets a long list scroll inside the dialog', async () => {
    setup()
    const list = await screen.findByRole('list')
    expect(list.parentElement).toHaveClass('rjm-body')
  })
})
