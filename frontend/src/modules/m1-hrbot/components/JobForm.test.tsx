import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createJob = vi.fn()
const updateJob = vi.fn()
const listJobGrades = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    create: (...a: unknown[]) => createJob(...a),
    update: (...a: unknown[]) => updateJob(...a),
  },
  jobGradesApi: {
    list: (...a: unknown[]) => listJobGrades(...a),
  },
}))

const { default: JobForm } = await import('./JobForm')

async function fillRequiredFields() {
  await userEvent.type(screen.getByPlaceholderText(/senior react developer/i), 'Backend Engineer')
  await userEvent.type(screen.getByPlaceholderText(/describe the role/i), 'Some description')
}

describe('JobForm, job grade field', () => {
  beforeEach(() => {
    createJob.mockReset().mockResolvedValue({ data: {} })
    updateJob.mockReset().mockResolvedValue({ data: {} })
    listJobGrades.mockReset()
  })

  it('falls back to a free-text input when the org has no configured grade list', async () => {
    listJobGrades.mockResolvedValue({ data: { job_grades: [] } })
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(listJobGrades).toHaveBeenCalled())
    expect(await screen.findByPlaceholderText(/grade 5, avp, vp/i)).toBeInTheDocument()
  })

  it('falls back to free text when the grade-list endpoint is not available yet', async () => {
    listJobGrades.mockRejectedValue({ response: { status: 404 } })
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByPlaceholderText(/grade 5, avp, vp/i)).toBeInTheDocument()
  })

  it('renders a select of org-configured grades and submits the chosen one', async () => {
    listJobGrades.mockResolvedValue({
      data: { job_grades: [{ grade_id: 'g1', name: 'AVP' }, { grade_id: 'g2', name: 'VP' }] },
    })
    const user = userEvent.setup()
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)

    const select = await screen.findByRole('combobox', { name: /job grade/i })
    expect(screen.queryByPlaceholderText(/grade 5, avp, vp/i)).not.toBeInTheDocument()

    await user.selectOptions(select, 'AVP')
    await fillRequiredFields()
    await user.click(screen.getByRole('button', { name: /create jd/i }))

    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1))
    expect(createJob.mock.calls[0][0]).toMatchObject({ job_grade: 'AVP' })
    expect(createJob.mock.calls[0][0]).not.toHaveProperty('model_override')
  })

  it('keeps an existing out-of-list grade selectable when editing', async () => {
    listJobGrades.mockResolvedValue({ data: { job_grades: [{ grade_id: 'g1', name: 'AVP' }] } })
    render(<JobForm job={{ job_id: 'job-1', title: 'X', description: 'Y', job_grade: 'Grade 7' }} onSave={vi.fn()} onClose={vi.fn()} />)

    const select = await screen.findByRole('combobox', { name: /job grade/i }) as HTMLSelectElement
    expect(select.value).toBe('Grade 7')
    expect(screen.getByText('Grade 7 (custom)')).toBeInTheDocument()
  })
})

describe('JobForm, careers page visibility', () => {
  beforeEach(() => {
    createJob.mockReset().mockResolvedValue({ data: {} })
    updateJob.mockReset().mockResolvedValue({ data: {} })
    listJobGrades.mockReset().mockResolvedValue({ data: { job_grades: [] } })
  })

  it('is on by default for a new job and is sent as true', async () => {
    const user = userEvent.setup()
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: /show on the careers page/i })).toBeChecked()
    await fillRequiredFields()
    await user.click(screen.getByRole('button', { name: /create jd/i }))

    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1))
    expect(createJob.mock.calls[0][0]).toMatchObject({ is_public: true })
  })

  it('sends false when it is turned off', async () => {
    const user = userEvent.setup()
    render(<JobForm job={null} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('checkbox', { name: /show on the careers page/i }))
    expect(screen.getByRole('checkbox', { name: /show on the careers page/i })).not.toBeChecked()
    await fillRequiredFields()
    await user.click(screen.getByRole('button', { name: /create jd/i }))

    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1))
    expect(createJob.mock.calls[0][0]).toMatchObject({ is_public: false })
  })

  it('loads the saved value when editing and sends the change on update', async () => {
    const user = userEvent.setup()
    render(<JobForm job={{ job_id: 'job-1', title: 'X', description: 'Y', is_public: false }} onSave={vi.fn()} onClose={vi.fn()} />)

    const box = screen.getByRole('checkbox', { name: /show on the careers page/i })
    expect(box).not.toBeChecked()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: /update jd/i }))

    await waitFor(() => expect(updateJob).toHaveBeenCalledTimes(1))
    expect(updateJob.mock.calls[0][0]).toBe('job-1')
    expect(updateJob.mock.calls[0][1]).toMatchObject({ is_public: true })
  })

  it('shows an older manual job as public and an imported one as not public', () => {
    const { unmount } = render(<JobForm job={{ job_id: 'a', title: 'X', description: 'Y', source: 'manual' }} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /show on the careers page/i })).toBeChecked()
    unmount()

    render(<JobForm job={{ job_id: 'b', title: 'X', description: 'Y', source: 'remotive' }} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /show on the careers page/i })).not.toBeChecked()
  })
})
