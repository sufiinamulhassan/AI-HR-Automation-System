import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prune = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: { pruneLowMatches: (...a: unknown[]) => prune(...a) },
}))

const { default: LowMatchCleanup } = await import('./LowMatchCleanup')

function result(over: Record<string, unknown> = {}) {
  return {
    job_id: 'j1', mode: 'job', min_score: 50, matched: 2, protected: 1, dry_run: true, removed: 0, in_progress: [],
    candidates: [
      { resume_id: 'cat', name: 'Cat Lee', similarity_score: 0.3, pipeline_stage: 'matched' },
      { resume_id: 'ben', name: 'Ben Cole', similarity_score: 0.42, pipeline_stage: 'matched' },
    ],
    ...over,
  }
}

function setup(props: Partial<{ currentMinimum: number | null }> = {}) {
  const onDone = vi.fn()
  render(<LowMatchCleanup jobId="j1" onDone={onDone} {...props} />)
  return { onDone }
}

beforeEach(() => {
  prune.mockReset()
})

describe('LowMatchCleanup', () => {
  it('previews who scored below the minimum before anything is removed', async () => {
    prune.mockResolvedValueOnce({ data: result() })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 50' }))
    expect(prune).toHaveBeenCalledWith('j1', { min_score: 50, mode: 'job', dry_run: true })
    expect(await screen.findByText('2 résumés scored below 50 and will be removed from this JD.')).toBeInTheDocument()
    expect(screen.getByText('Cat Lee')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('1 hired candidate is below the score and will be kept.')).toBeInTheDocument()
  })

  it('removes them from the JD only after the admin confirms', async () => {
    prune.mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: result({ dry_run: false, removed: 2 }) })
    const { onDone } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 50' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2 résumés' }))
    expect(prune).toHaveBeenLastCalledWith('j1', { min_score: 50, mode: 'job' })
    expect(await screen.findByText('Removed 2 résumés from this JD.')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('deletes them from the whole system when that option is chosen', async () => {
    prune
      .mockResolvedValueOnce({ data: result({ mode: 'system', min_score: 40 }) })
      .mockResolvedValueOnce({ data: result({ mode: 'system', min_score: 40, dry_run: false, removed: 2 }) })
    setup()
    const input = screen.getByLabelText('Minimum match score')
    await userEvent.clear(input)
    await userEvent.type(input, '40')
    await userEvent.click(screen.getByRole('radio', { name: /Delete from the system completely/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 40' }))
    expect(prune).toHaveBeenCalledWith('j1', { min_score: 40, mode: 'system', dry_run: true })
    expect(await screen.findByText('2 résumés scored below 40 and will be deleted from the system.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 résumés' }))
    expect(prune).toHaveBeenLastCalledWith('j1', { min_score: 40, mode: 'system' })
    expect(await screen.findByText('Deleted 2 résumés from the system.')).toBeInTheDocument()
  })

  it('cancel drops the preview without removing anything', async () => {
    prune.mockResolvedValueOnce({ data: result() })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 50' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Cat Lee')).not.toBeInTheDocument()
    expect(prune).toHaveBeenCalledTimes(1)
  })

  it('says nothing is below the score and offers no remove button', async () => {
    prune.mockResolvedValueOnce({ data: result({ matched: 0, protected: 0, candidates: [] }) })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 50' }))
    expect(await screen.findByText('No résumés in this JD scored below 50.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('rejects a score outside 1 to 100', async () => {
    setup()
    const input = screen.getByLabelText('Minimum match score')
    await userEvent.clear(input)
    await userEvent.type(input, '150')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a score from 1 to 100.')
    expect(screen.getByRole('button', { name: /Find résumés below/ })).toBeDisabled()
  })

  it('starts from the minimum already saved on the JD', () => {
    setup({ currentMinimum: 65 })
    expect(screen.getByLabelText('Minimum match score')).toHaveValue(65)
    expect(screen.getByText(/New matches below it are not added/)).toBeInTheDocument()
  })

  it('shows the server error and keeps the preview when removal fails', async () => {
    prune.mockResolvedValueOnce({ data: result() }).mockRejectedValueOnce({ response: { data: { detail: 'Missing required permission: jobs:update' } } })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Find résumés below 50' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2 résumés' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing required permission: jobs:update')
    expect(screen.getByText('Cat Lee')).toBeInTheDocument()
  })
})
