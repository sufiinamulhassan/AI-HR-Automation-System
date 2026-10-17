import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sourcing = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    sourcing: (...a: unknown[]) => sourcing(...a),
  },
}))

const { default: SourcingPanel } = await import('./SourcingPanel')

const RESPONSE = {
  job_id: 'job_1',
  spec: {
    title: 'Senior Backend Engineer',
    seniority: 'senior',
    domain: 'software_engineering',
    industry: 'technology',
    location: 'Bangalore',
    is_remote: false,
    skills: ['Python', 'Django', 'PostgreSQL', 'AWS'],
    nice_to_have: ['Kubernetes', 'Terraform'],
    keywords: ['fintech', 'payments'],
  },
  queries: {
    strict: '"Senior Backend Engineer" AND Python AND Django AND PostgreSQL AND AWS AND Bangalore',
    balanced: '"Senior Backend Engineer" AND Python AND Django AND Bangalore',
    broad: '("Senior Backend Engineer" OR fintech OR payments) AND (Python OR Django OR PostgreSQL OR AWS OR Kubernetes OR Terraform) AND Bangalore',
  },
}

describe('SourcingPanel', () => {
  beforeEach(() => {
    sourcing.mockReset()
  })

  it('renders the spec chips and all three query tiers from the mocked response', async () => {
    sourcing.mockResolvedValue({ data: RESPONSE })
    render(<SourcingPanel jobId="job_1" />)

    expect(await screen.findByText('Senior Backend Engineer')).toBeInTheDocument()
    expect(sourcing).toHaveBeenCalledWith('job_1')

    expect(screen.getByText('senior')).toBeInTheDocument()
    expect(screen.getByText('software engineering')).toBeInTheDocument()
    expect(screen.getByText('technology')).toBeInTheDocument()
    expect(screen.getByText('Bangalore')).toBeInTheDocument()
    for (const s of ['Python', 'Django', 'PostgreSQL', 'AWS']) expect(screen.getByText(s)).toBeInTheDocument()
    for (const s of ['Kubernetes', 'Terraform']) expect(screen.getByText(s)).toBeInTheDocument()
    for (const s of ['fintech', 'payments']) expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.queryByText('Remote')).not.toBeInTheDocument()

    expect(screen.getByText('Strict')).toBeInTheDocument()
    expect(screen.getByText('Balanced')).toBeInTheDocument()
    expect(screen.getByText('Broad')).toBeInTheDocument()
    expect(screen.getByText(RESPONSE.queries.strict)).toBeInTheDocument()
    expect(screen.getByText(RESPONSE.queries.balanced)).toBeInTheDocument()
    expect(screen.getByText(RESPONSE.queries.broad)).toBeInTheDocument()
    expect(screen.getByText(/fewest, most tightly-qualified/i)).toBeInTheDocument()
    expect(screen.getByText(/widest net/i)).toBeInTheDocument()
  })

  it('skips empty/null spec fields instead of rendering an empty chip', async () => {
    sourcing.mockResolvedValue({
      data: {
        job_id: 'job_2',
        spec: { title: 'Data Analyst', skills: [] },
        queries: { strict: 'strict q', balanced: 'balanced q', broad: 'broad q' },
      },
    })
    render(<SourcingPanel jobId="job_2" />)

    expect(await screen.findByText('Data Analyst')).toBeInTheDocument()
    expect(screen.queryByText('Seniority')).not.toBeInTheDocument()
    expect(screen.queryByText('Location')).not.toBeInTheDocument()
    expect(screen.queryByText('Skills')).not.toBeInTheDocument()
    expect(screen.queryByText('Nice to Have')).not.toBeInTheDocument()
    expect(screen.queryByText('Keywords')).not.toBeInTheDocument()
  })

  it('copies each tier to the clipboard independently', async () => {
    sourcing.mockResolvedValue({ data: RESPONSE })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<SourcingPanel jobId="job_1" />)
    await screen.findByText('Senior Backend Engineer')

    await userEvent.click(screen.getByRole('button', { name: 'Copy Strict query' }))
    expect(writeText).toHaveBeenLastCalledWith(RESPONSE.queries.strict)

    await userEvent.click(screen.getByRole('button', { name: 'Copy Balanced query' }))
    expect(writeText).toHaveBeenLastCalledWith(RESPONSE.queries.balanced)

    await userEvent.click(screen.getByRole('button', { name: 'Copy Broad query' }))
    expect(writeText).toHaveBeenLastCalledWith(RESPONSE.queries.broad)

    expect(writeText).toHaveBeenCalledTimes(3)
  })

  it('shows a plain error instead of crashing on a 404 / missing job', async () => {
    sourcing.mockRejectedValue({ response: { status: 404 } })
    render(<SourcingPanel jobId="missing-job" />)

    expect(await screen.findByText("Couldn't load sourcing strings for this job.")).toBeInTheDocument()
    expect(screen.queryByText('Strict')).not.toBeInTheDocument()
  })

  it('re-fetches when the jobId prop changes', async () => {
    sourcing.mockResolvedValue({ data: RESPONSE })
    const { rerender } = render(<SourcingPanel jobId="job_1" />)
    await waitFor(() => expect(sourcing).toHaveBeenCalledWith('job_1'))

    rerender(<SourcingPanel jobId="job_2" />)
    await waitFor(() => expect(sourcing).toHaveBeenCalledWith('job_2'))
  })
})
