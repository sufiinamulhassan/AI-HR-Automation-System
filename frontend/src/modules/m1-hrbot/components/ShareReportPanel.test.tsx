import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const list = vi.fn()
const revoke = vi.fn()

vi.mock('../../../lib/api', () => ({
  interviewApi: {
    shares: {
      create: (...a: unknown[]) => create(...a),
      list: (...a: unknown[]) => list(...a),
      revoke: (...a: unknown[]) => revoke(...a),
    },
  },
}))

const { default: ShareReportPanel } = await import('./ShareReportPanel')

const ACTIVE_ROW = {
  share_id: 'share_1',
  candidate_id: 'cand_1',
  job_id: 'job_1',
  created_by: 'admin@acme.com',
  created_at: '2026-06-01T10:00:00Z',
  expires_at: '2026-06-08T10:00:00Z',
  revoked: false,
  revoked_at: null,
  revoked_by: null,
  expired: false,
  active: true,
  view_count: 3,
  last_viewed_at: '2026-06-02T09:00:00Z',
  feedback: [
    { feedback_id: 'f1', reviewer_name: 'Jane Hiring Manager', rating: 4, comment: 'Strong technically.', created_at: '2026-06-02T09:00:00Z' },
  ],
}

describe('ShareReportPanel', () => {
  beforeEach(() => {
    create.mockReset()
    list.mockReset()
    revoke.mockReset()
  })

  it('renders existing shares with status, view count and feedback', async () => {
    list.mockResolvedValue({ data: { shares: [ACTIVE_ROW] } })

    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith('tok_secure')
    expect(screen.getByText('3 views')).toBeInTheDocument()
    expect(screen.getByText('Jane Hiring Manager')).toBeInTheDocument()
    expect(screen.getByText('Strong technically.')).toBeInTheDocument()
    expect(screen.getByText('★★★★☆')).toBeInTheDocument()
  })

  it('shows an empty state when no shares exist yet', async () => {
    list.mockResolvedValue({ data: { shares: [] } })

    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    expect(await screen.findByText('No share links have been created for this candidate yet.')).toBeInTheDocument()
  })

  it('creates a new share link and shows the one-time URL with a working copy button', async () => {
    list.mockResolvedValue({ data: { shares: [] } })
    create.mockResolvedValue({
      data: {
        share_id: 'share_new',
        token: 'raw_token_abc',
        share_url: 'https://app.example.com/report/shared/raw_token_abc',
        candidate_id: 'cand_1',
        job_id: 'job_1',
        created_at: '2026-06-05T10:00:00Z',
        expires_at: '2026-06-12T10:00:00Z',
        view_count: 0,
      },
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    await screen.findByText('No share links have been created for this candidate yet.')
    await userEvent.click(screen.getByRole('button', { name: 'Create Share Link' }))

    expect(create).toHaveBeenCalledWith('tok_secure', 7)
    expect(await screen.findByText(/won.t be shown again/i)).toBeInTheDocument()
    const linkInput = screen.getByLabelText('New share link') as HTMLInputElement
    expect(linkInput.value).toBe('https://app.example.com/report/shared/raw_token_abc')

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith('https://app.example.com/report/shared/raw_token_abc')
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('shows the backend 400 detail when the report is not ready to share', async () => {
    list.mockResolvedValue({ data: { shares: [] } })
    create.mockRejectedValue({ response: { data: { detail: "This candidate's report is not ready to share yet" } } })

    const user = userEvent.setup()
    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    await screen.findByText('No share links have been created for this candidate yet.')
    await user.click(screen.getByRole('button', { name: 'Create Share Link' }))

    expect(await screen.findByText("This candidate's report is not ready to share yet")).toBeInTheDocument()
    expect(screen.queryByLabelText('New share link')).not.toBeInTheDocument()
  })

  it('revokes an active share and updates the list in place', async () => {
    list.mockResolvedValue({ data: { shares: [ACTIVE_ROW] } })
    revoke.mockResolvedValue({
      data: { ...ACTIVE_ROW, revoked: true, revoked_at: '2026-06-03T10:00:00Z', revoked_by: 'admin@acme.com', active: false },
    })

    const user = userEvent.setup()
    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    await screen.findByText('Active')
    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    expect(revoke).toHaveBeenCalledWith('share_1')
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(screen.getByText(/Revoked.*by admin@acme.com/)).toBeInTheDocument()
  })

  it('shows a plain error instead of crashing when the shares list fails to load', async () => {
    list.mockRejectedValue(new Error('network error'))

    render(<ShareReportPanel token="tok_secure" onClose={() => {}} />)

    expect(await screen.findByText("Couldn't load existing share links.")).toBeInTheDocument()
  })
})
