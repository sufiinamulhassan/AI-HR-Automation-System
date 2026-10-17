import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

const { default: SharedReportPage } = await import('./SharedReportPage')

const REPORT = {
  candidate_name: 'Sara Khan',
  job_title: 'Senior Backend Engineer',
  interview_date: '2026-06-06T15:00:00Z',
  evaluation_status: 'scored',
  overall_score: 87,
  final_score: 82,
  recommendation: 'hire',
  summary: 'Strong technical depth, clear communicator.',
  strengths: ['Deep FastAPI knowledge', 'Good system design instincts'],
  areas_for_improvement: ['Could be more concise'],
  dimensions: [
    { key: 'technical', label: 'Technical', score: 90, weight: 0.4, rationale: 'Correctly explained async tradeoffs.' },
  ],
  scenario_scores: [{ key: 'scenario:leadership', label: 'Leadership', value: 75 }],
  coding_score: 80,
  coding_quality_score: 70,
  integrity: {
    score: 95,
    assessment: 'No material integrity concerns.',
    multiplier: 0.95,
    events: [{ event: 'tab_switch', count: 1 }],
  },
  view_count: 2,
  feedback: [
    { reviewer_name: 'Alex Hiring Manager', rating: 5, comment: 'Would hire.', created_at: '2026-06-07T10:00:00Z' },
  ],
}

function mockFetch(opts: { status?: number; feedbackStatus?: number } = {}) {
  const { status = 200, feedbackStatus = 200 } = opts
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith(`/interview/shared-report/${TOKEN}/feedback`)) {
      return {
        ok: feedbackStatus === 200,
        status: feedbackStatus,
        json: async () => (feedbackStatus === 200 ? { recorded: true, feedback_id: 'fb_1' } : { detail: 'error' }),
      }
    }
    if (u.endsWith(`/interview/shared-report/${TOKEN}`)) {
      if (status !== 200) return { ok: false, status, json: async () => ({ detail: 'error' }) }
      return { ok: true, status: 200, json: async () => REPORT }
    }
    throw new Error(`Unexpected fetch call: ${u} ${JSON.stringify(init)}`)
  }))
}

describe('SharedReportPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the full reduced report on a valid, active link', async () => {
    mockFetch()
    render(<SharedReportPage />)

    expect(await screen.findByText('Sara Khan')).toBeInTheDocument()
    expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('HIRE')).toBeInTheDocument()
    expect(screen.getByText('Strong technical depth, clear communicator.')).toBeInTheDocument()
    expect(screen.getByText('Deep FastAPI knowledge')).toBeInTheDocument()
    expect(screen.getByText('Could be more concise')).toBeInTheDocument()
    expect(screen.getByText('Technical')).toBeInTheDocument()
    expect(screen.getByText('Correctly explained async tradeoffs.')).toBeInTheDocument()
    expect(screen.getByText('Leadership')).toBeInTheDocument()
    expect(screen.getByText('No material integrity concerns.')).toBeInTheDocument()
    expect(screen.getByText('tab switch × 1')).toBeInTheDocument()
    expect(screen.getByText('2 views')).toBeInTheDocument()
    expect(screen.getByText('Alex Hiring Manager')).toBeInTheDocument()
    expect(screen.getByText('Would hire.')).toBeInTheDocument()
  })

  it("shows a clear 'link isn't valid' state on a 404, not a generic error", async () => {
    mockFetch({ status: 404 })
    render(<SharedReportPage />)

    expect(await screen.findByText(/this link isn.t valid/i)).toBeInTheDocument()
    expect(screen.queryByText('Sara Khan')).not.toBeInTheDocument()
  })

  it('shows a distinct expired-link state on a 410, not the invalid-link message', async () => {
    mockFetch({ status: 410 })
    render(<SharedReportPage />)

    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument()
    expect(screen.queryByText(/this link isn.t valid/i)).not.toBeInTheDocument()
  })

  it('shows a generic error state on an unrelated failure', async () => {
    mockFetch({ status: 500 })
    render(<SharedReportPage />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('submits reviewer feedback with a star rating and comment', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<SharedReportPage />)

    await screen.findByText('Sara Khan')

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Alex Reviewer')
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.type(screen.getByPlaceholderText('Share your thoughts on this candidate'), 'Impressive candidate.')
    await user.click(screen.getByRole('button', { name: /submit feedback/i }))

    await waitFor(() => {
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/feedback'))
      expect(call).toBeTruthy()
    })
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/feedback'))!
    const [, init] = call
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ reviewer_name: 'Alex Reviewer', rating: 4, comment: 'Impressive candidate.' })

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument()
  })

  it('keeps Submit Feedback disabled until a comment is entered', async () => {
    mockFetch()
    render(<SharedReportPage />)

    await screen.findByText('Sara Khan')
    expect(screen.getByRole('button', { name: /submit feedback/i })).toBeDisabled()
  })

  it('shows an error instead of a crash when feedback submission fails', async () => {
    mockFetch({ feedbackStatus: 500 })
    const user = userEvent.setup()
    render(<SharedReportPage />)

    await screen.findByText('Sara Khan')
    await user.type(screen.getByPlaceholderText('Share your thoughts on this candidate'), 'Solid.')
    await user.click(screen.getByRole('button', { name: /submit feedback/i }))

    expect(await screen.findByText(/something went wrong submitting your feedback/i)).toBeInTheDocument()
  })
})
