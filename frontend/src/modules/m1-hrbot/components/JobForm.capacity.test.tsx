import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createJob = vi.fn()
const updateJob = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    create: (...a: unknown[]) => createJob(...a),
    update: (...a: unknown[]) => updateJob(...a),
  },
  jobGradesApi: { list: () => Promise.resolve({ data: { job_grades: [] } }) },
}))

const { default: JobForm } = await import('./JobForm')

beforeEach(() => {
  createJob.mockReset().mockResolvedValue({ data: {} })
  updateJob.mockReset().mockResolvedValue({ data: {} })
})

describe('JobForm: max résumés', () => {
  it('defaults to no limit and sends 0', async () => {
    const user = userEvent.setup()
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Max résumés/)).toHaveValue(0)
    await user.type(screen.getByPlaceholderText(/senior react developer/i), 'Backend Engineer')
    await user.type(screen.getByPlaceholderText(/describe the role/i), 'Some description')
    await user.click(screen.getByRole('button', { name: /create jd/i }))
    await waitFor(() => expect(createJob).toHaveBeenCalled())
    expect(createJob.mock.calls[0][0]).toMatchObject({ max_resumes: 0 })
  })

  it('sends the limit typed by HR', async () => {
    const user = userEvent.setup()
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/senior react developer/i), 'Backend Engineer')
    await user.type(screen.getByPlaceholderText(/describe the role/i), 'Some description')
    const field = screen.getByLabelText(/Max résumés/)
    await user.clear(field)
    await user.type(field, '25')
    await user.click(screen.getByRole('button', { name: /create jd/i }))
    await waitFor(() => expect(createJob).toHaveBeenCalled())
    expect(createJob.mock.calls[0][0]).toMatchObject({ max_resumes: 25 })
  })

  it('loads the saved limit when editing and an emptied field means no limit', async () => {
    const user = userEvent.setup()
    render(<JobForm job={{ job_id: 'j1', title: 'T', description: 'D', max_resumes: 40 }} onSave={vi.fn()} onClose={vi.fn()} />)
    const field = screen.getByLabelText(/Max résumés/)
    expect(field).toHaveValue(40)
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: /update jd/i }))
    await waitFor(() => expect(updateJob).toHaveBeenCalled())
    expect(updateJob.mock.calls[0][1]).toMatchObject({ max_resumes: 0 })
  })

  it('keeps the form short with no long hints under the fields', () => {
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Max résumés/)).toHaveAttribute('placeholder', '0 = no limit')
    expect(screen.getByLabelText(/Days open/)).toHaveAttribute('placeholder', '0 = no deadline')
    expect(screen.queryByText(/Application window in days/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Anyone can see this job/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Remote OK' })).toBeInTheDocument()
  })
})
