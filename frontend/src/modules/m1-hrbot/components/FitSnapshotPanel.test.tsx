import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ pipelineFit: vi.fn(), pipelineAiOpinion: vi.fn() }))

vi.mock('../../../lib/api', () => ({
  jobsApi: { pipelineFit: api.pipelineFit, pipelineAiOpinion: api.pipelineAiOpinion },
}))

const { default: FitSnapshotPanel, ScoreRing } = await import('./FitSnapshotPanel')

const FIT = {
  resume_id: 'r1',
  candidate_name: 'Ada Lovelace',
  score: 0.5,
  semantic_part: 0.4,
  skills_boost: 0.1,
  threshold: 0.7,
  above_threshold: false,
  skills: { matched: ['Python'], missing: ['Kubernetes', 'Terraform'], extra: [], coverage: 0.3333 },
  seniority: { candidate: 'senior', required: ['mid', 'senior'], aligned: true },
  domain: { candidate: 'software_engineering', required: 'software_engineering', aligned: true },
  headline: '50% match, is below the 70% match threshold.',
}

function panel(props: Partial<Parameters<typeof FitSnapshotPanel>[0]> = {}) {
  return (
    <FitSnapshotPanel
      jobId="job_1"
      resumeId="r1"
      candidateName="Row Name"
      canRequestOpinion
      onClose={() => {}}
      {...props}
    />
  )
}

describe('ScoreRing', () => {
  it('shows the rounded percentage and sets the fill on the gradient variable', () => {
    const { container } = render(<ScoreRing score={0.8249} />)
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--ring-pct')).toBe('82')
  })

  it('renders an empty ring with a dash when there is no score', () => {
    const { container } = render(<ScoreRing score={undefined} />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--ring-pct')).toBe('0')
  })

  it('clamps out-of-range scores', () => {
    render(<ScoreRing score={1.4} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

describe('FitSnapshotPanel', () => {
  beforeEach(() => {
    api.pipelineFit.mockReset().mockResolvedValue({ data: FIT })
    api.pipelineAiOpinion.mockReset()
  })

  it('requests the fit for this job and résumé, and nothing else until asked', async () => {
    render(panel())
    expect(await screen.findByText(FIT.headline)).toBeInTheDocument()
    expect(api.pipelineFit).toHaveBeenCalledTimes(1)
    expect(api.pipelineFit).toHaveBeenCalledWith('job_1', 'r1')
    expect(api.pipelineAiOpinion).not.toHaveBeenCalled()
  })

  it('is a labelled modal dialog titled Fit Snapshot', async () => {
    render(panel())
    const dialog = screen.getByRole('dialog', { name: 'Fit Snapshot' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await screen.findByText(FIT.headline)
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(panel({ onClose }))
    await screen.findByText(FIT.headline)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const onClose = vi.fn()
    render(panel({ onClose }))
    await screen.findByText(FIT.headline)

    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('fit-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a drag starts inside the panel and is released over the backdrop', async () => {
    const onClose = vi.fn()
    render(panel({ onClose }))
    await screen.findByText(FIT.headline)

    fireEvent.mouseDown(screen.getByRole('dialog'))
    fireEvent.click(screen.getByTestId('fit-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from the close button', async () => {
    const onClose = vi.fn()
    render(panel({ onClose }))
    await userEvent.click(screen.getByRole('button', { name: 'Close fit snapshot' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes focus on open and hands it back to the opener on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open it</button>
          {open && panel({ onClose: () => setOpen(false) })}
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'open it' })

    await userEvent.click(opener)
    expect(screen.getByRole('dialog')).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the panel', async () => {
    render(panel())
    await screen.findByText(FIT.headline)
    const close = screen.getByRole('button', { name: 'Close fit snapshot' })
    const last = screen.getByRole('button', { name: 'Get an AI take' })

    last.focus()
    await userEvent.tab()
    expect(close).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('shows the score against the match threshold, with the marker at the threshold', async () => {
    render(panel())
    await screen.findByText(FIT.headline)

    expect(screen.getByText('Match threshold')).toBeInTheDocument()
    expect(screen.queryByText(/auto-invite/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('threshold-marker').style.left).toBe('70%')
    const meter = screen.getByRole('meter', { name: 'Match score' })
    expect(meter).toHaveAttribute('aria-valuenow', '50')
    expect(meter).toHaveAttribute('aria-valuetext', '50%, below the match threshold')
  })

  it('renders an unknown seniority or domain as Unknown, never as Not aligned', async () => {
    api.pipelineFit.mockResolvedValue({
      data: {
        ...FIT,
        skills: { matched: ['Python', 'Kubernetes'], missing: [], extra: [], coverage: 1 },
        seniority: { candidate: null, required: [], aligned: null },
        domain: { candidate: null, required: null, aligned: null },
      },
    })
    render(panel())
    await screen.findByText(FIT.headline)

    const seniority = screen.getByText('Seniority').closest('li') as HTMLElement
    const domain = screen.getByText('Domain').closest('li') as HTMLElement
    expect(within(seniority).getByText('Unknown')).toBeInTheDocument()
    expect(within(domain).getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Not aligned')).not.toBeInTheDocument()
  })

  it('maps aligned true and false to Aligned and Not aligned', async () => {
    api.pipelineFit.mockResolvedValue({
      data: { ...FIT, domain: { candidate: 'finance', required: 'software_engineering', aligned: false } },
    })
    render(panel())
    await screen.findByText(FIT.headline)

    expect(within(screen.getByText('Seniority').closest('li') as HTMLElement).getByText('Aligned')).toBeInTheDocument()
    expect(within(screen.getByText('Domain').closest('li') as HTMLElement).getByText('Not aligned')).toBeInTheDocument()
    expect(within(screen.getByText('Skills coverage').closest('li') as HTMLElement).getByText('Not aligned')).toBeInTheDocument()
  })

  it('falls back to the row name when the résumé has been deleted (null candidate_name)', async () => {
    api.pipelineFit.mockResolvedValue({ data: { ...FIT, candidate_name: null } })
    render(panel())
    await screen.findByText(FIT.headline)
    expect(screen.getByText('Row Name')).toBeInTheDocument()
  })

  it('shows None for an empty chip group and a no-skills note when the job lists none', async () => {
    api.pipelineFit.mockResolvedValue({
      data: { ...FIT, skills: { matched: [], missing: [], extra: [], coverage: 0 } },
    })
    render(panel())
    await screen.findByText(FIT.headline)

    expect(screen.getAllByText('None')).toHaveLength(3)
    expect(screen.getByText('This role lists no required skills.')).toBeInTheDocument()
    expect(within(screen.getByText('Skills coverage').closest('li') as HTMLElement).getByText('Unknown')).toBeInTheDocument()
  })

  it('shows a loading state, then a retryable inline error when the fit cannot be loaded', async () => {
    api.pipelineFit.mockRejectedValueOnce({ response: { status: 500 } })
    render(panel())
    expect(screen.getByRole('status')).toHaveTextContent('Loading fit snapshot')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the fit snapshot for this candidate.')
    expect(screen.getByRole('button', { name: 'Close fit snapshot' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(FIT.headline)).toBeInTheDocument()
    expect(api.pipelineFit).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not offer the AI take without permission, and says so', async () => {
    render(panel({ canRequestOpinion: false }))
    await screen.findByText(FIT.headline)
    expect(screen.queryByRole('button', { name: /AI take/ })).not.toBeInTheDocument()
    expect(screen.getByText('AI takes are not enabled for your role.')).toBeInTheDocument()
  })

  it('shows the server detail for a 403 on the AI take', async () => {
    api.pipelineAiOpinion.mockRejectedValue({
      response: { status: 403, data: { detail: 'Missing required permission: jobs:ai_fit_opinion' } },
    })
    render(panel())
    await screen.findByText(FIT.headline)
    await userEvent.click(screen.getByRole('button', { name: 'Get an AI take' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing required permission: jobs:ai_fit_opinion')
  })

  it('keeps an earlier AI take on screen when a refresh fails', async () => {
    api.pipelineAiOpinion
      .mockResolvedValueOnce({
        data: { summary: 'Solid fit overall.', strengths: ['Python depth'], concerns: [], follow_up_questions: [], model: 'm1' },
      })
      .mockRejectedValueOnce({ response: { status: 502, data: { detail: 'AI second opinion unavailable: timed out. Please try again shortly.' } } })
    render(panel())
    await screen.findByText(FIT.headline)

    await userEvent.click(screen.getByRole('button', { name: 'Get an AI take' }))
    expect(await screen.findByText('Solid fit overall.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh AI take' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI second opinion unavailable: timed out. Please try again shortly.')
    expect(screen.getByText('Solid fit overall.')).toBeInTheDocument()
    expect(screen.queryByText('Concerns')).not.toBeInTheDocument()
  })
})
