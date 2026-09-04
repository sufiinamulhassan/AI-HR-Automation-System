import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'


const report = vi.fn()
const reportPdf = vi.fn()

vi.mock('../../../lib/api', () => ({
  interviewApi: {
    report: (...args: unknown[]) => report(...args),
    reportPdf: (...args: unknown[]) => reportPdf(...args),
  },
}))

const { default: ReportModal } = await import('./ReportModal')

function respondWith(data: Record<string, unknown>) {
  report.mockResolvedValue({ data })
}

describe('ReportModal', () => {
  beforeEach(() => {
    report.mockReset()
    reportPdf.mockReset()
  })

  it('renders a real {question, answer} transcript as readable turns', async () => {
    respondWith({
      name: 'Sara Khan',
      transcript: [
        {
          question: 'Tell me about your Python experience.',
          answer: 'Seven years, mostly FastAPI and asyncio services.',
          answered_at: '2026-06-06T15:01:30Z',
        },
      ],
      report: { overall_score: 87, recommendation: 'hire' },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Tell me about your Python experience.')).toBeInTheDocument()
    expect(screen.getByText('Seven years, mostly FastAPI and asyncio services.')).toBeInTheDocument()
    expect(screen.getByText(/2 messages/)).toBeInTheDocument()
  })

  it('still renders the chat-message transcript shape', async () => {
    respondWith({
      transcript: [{ role: 'candidate', content: 'I have seven years of Python.' }],
      report: { overall_score: 70 },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)
    expect(await screen.findByText('I have seven years of Python.')).toBeInTheDocument()
  })

  it('warns when no answer content was captured instead of showing empty scores', async () => {
    respondWith({
      transcript: [],
      report: {
        evaluation_status: 'insufficient_transcript',
        recommendation: 'maybe',
        integrity_score: 100,
        summary: 'No answer content was captured for this interview.',
      },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText(/No answer content was captured for this session/i)).toBeInTheDocument()
    expect(screen.getByText(/Integrity scoring is computed separately/i)).toBeInTheDocument()
  })

  it('shows coding dimensions only when the candidate submitted an assessment', async () => {
    respondWith({
      transcript: [],
      report: { overall_score: 80, coding_score: 75, coding_quality_score: 62 },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Coding (tests)')).toBeInTheDocument()
    expect(screen.getByText('Coding (quality)')).toBeInTheDocument()
  })

  it('omits coding dimensions entirely when there is no submission', async () => {
    respondWith({ transcript: [], report: { overall_score: 80 } })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    await screen.findByText('Overall')
    expect(screen.queryByText('Coding (tests)')).not.toBeInTheDocument()
    expect(screen.queryByText('Coding (quality)')).not.toBeInTheDocument()
  })

  it('reports gracefully when the evaluation is not ready', async () => {
    report.mockRejectedValue(new Error('404'))

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText(/Report not available yet/i)).toBeInTheDocument(),
    )
  })
})
