import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JobDetails from './JobDetails'

const JOB = { job_id: 'job-1', title: 'Senior Engineer', description: 'Build things.', source: 'manual', created_at: '2026-10-01T00:00:00Z' }
const URL_OF_JOB = `${window.location.origin}/careers/job-1`

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('JobDetails: careers page block', () => {
  it('says a manual job is public and shows its link, a Copy button and an Open page link', () => {
    render(<JobDetails job={JOB} />)
    expect(screen.getByRole('heading', { name: 'Careers Page' })).toBeInTheDocument()
    expect(screen.getByText('Public')).toHaveClass('is-public')
    expect(screen.getByLabelText('Public job link')).toHaveValue(URL_OF_JOB)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    const open = screen.getByRole('link', { name: 'Open page' })
    expect(open).toHaveAttribute('href', URL_OF_JOB)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noreferrer')
  })

  it('treats a job with is_public true as public even when it was imported', () => {
    render(<JobDetails job={{ ...JOB, source: 'linkedin', is_public: true }} />)
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.getByLabelText('Public job link')).toBeInTheDocument()
  })

  it('says the job is not public and hides the link when is_public is false', () => {
    render(<JobDetails job={{ ...JOB, is_public: false }} />)
    expect(screen.getByText('Not public')).toHaveClass('is-private')
    expect(screen.queryByLabelText('Public job link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open page' })).not.toBeInTheDocument()
  })

  it('says an imported job with no flag is not public', () => {
    render(<JobDetails job={{ ...JOB, source: 'remotive' }} />)
    expect(screen.getByText('Not public')).toBeInTheDocument()
  })
})

describe('JobDetails: copying the link', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('copies the link, confirms with Copied and clears the confirmation after a moment', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    render(<JobDetails job={JOB} />)

    await u.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(URL_OF_JOB)
    expect(await screen.findByText('Copied')).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  it('asks the user to copy by hand when the clipboard is not available', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<JobDetails job={JOB} />)

    await u.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Press Ctrl+C to copy')).toBeInTheDocument()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })
})
