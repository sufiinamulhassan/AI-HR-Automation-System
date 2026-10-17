import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const report = vi.fn()
const reportPdf = vi.fn()

vi.mock('../../../lib/api', () => ({
  interviewApi: {
    report: (...args: unknown[]) => report(...args),
    reportPdf: (...args: unknown[]) => reportPdf(...args),
  },
}))

vi.mock('./ShareReportPanel', () => ({
  default: ({ token, onClose }: { token: string; onClose: () => void }) => (
    <div data-testid="share-panel" data-token={token}>
      <button onClick={onClose}>Close share panel</button>
    </div>
  ),
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

  it('shows a distinct "generation failed" state when report_status is failed, not the generic processing message', async () => {
    respondWith({
      name: 'Sara Khan',
      transcript: [],
      report: {
        report_status: 'failed',
        report_error: 'Mongo write timed out after 3 retries.',
      },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText(/Report generation failed/i)).toBeInTheDocument()
    expect(screen.getByText('Mongo write timed out after 3 retries.')).toBeInTheDocument()
    expect(screen.queryByText(/may still be processing/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Overall')).not.toBeInTheDocument()
    expect(screen.queryByText('AI Overall')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when a failed report has no report_error', async () => {
    respondWith({ transcript: [], report: { report_status: 'failed', report_error: null } })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText(/Report generation failed/i)).toBeInTheDocument()
    expect(screen.getByText(/No error details were recorded/i)).toBeInTheDocument()
  })

  it('renders normally when report_status is "ready"', async () => {
    respondWith({ transcript: [], report: { report_status: 'ready', overall_score: 91 } })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Overall')).toBeInTheDocument()
    expect(screen.getByText('91')).toBeInTheDocument()
    expect(screen.queryByText(/Report generation failed/i)).not.toBeInTheDocument()
  })

  it('renders the score breakdown: dimensions with weight + rationale, a distinctly labeled final score, and a timestamp-sorted integrity ledger', async () => {
    respondWith({
      name: 'Sara Khan',
      transcript: [],
      report: {
        overall_score: 82,
        recommendation: 'hire',
        score_breakdown: {
          dimensions: [
            { name: 'technical', score: 88, weight: 0.3, rationale: 'Correctly explained async/await tradeoffs.' },
            { name: 'communication', score: 75, weight: 0.2, rationale: 'Clear but occasionally rambled.' },
          ],
          integrity_deductions: [
            { event: 'tab_switch', timestamp: '2026-06-06T15:05:00Z', points: -10 },
            { event: 'no_face_detected', timestamp: '2026-06-06T15:01:00Z', points: -12 },
          ],
          integrity_multiplier: 0.85,
          final_score: 74,
        },
      },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('AI Overall')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.queryByText('Overall')).not.toBeInTheDocument()

    expect(screen.getAllByText('technical')).toHaveLength(2)
    expect(screen.getByText('88')).toBeInTheDocument()
    expect(screen.getByText(/0\.3/)).toBeInTheDocument()
    expect(screen.getByText('Correctly explained async/await tradeoffs.')).toBeInTheDocument()
    expect(screen.getAllByText('communication')).toHaveLength(2)
    expect(screen.getByText('Clear but occasionally rambled.')).toBeInTheDocument()

    expect(screen.getByText('Final Score (weighted + integrity-adjusted)')).toBeInTheDocument()
    expect(screen.getByText('74')).toBeInTheDocument()

    const events = screen.getAllByText(/tab switch|no face detected/i).map(el => el.textContent)
    expect(events).toEqual(['no face detected', 'tab switch'])
    expect(screen.getByText('-12')).toBeInTheDocument()
    expect(screen.getByText('-10')).toBeInTheDocument()
  })

  it('renders nothing extra for the score breakdown section when score_breakdown is absent (no crash, no empty section)', async () => {
    respondWith({ transcript: [], report: { overall_score: 87, recommendation: 'hire' } })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Overall')).toBeInTheDocument()
    expect(screen.queryByText('AI Overall')).not.toBeInTheDocument()
    expect(screen.queryByText('Score Breakdown')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrity Deductions')).not.toBeInTheDocument()
    expect(screen.queryByText(/Final Score/i)).not.toBeInTheDocument()
  })

  it('renders exactly as before when a report has neither report_status nor score_breakdown (no regression)', async () => {
    respondWith({
      name: 'Sara Khan',
      transcript: [{ role: 'candidate', content: 'I have seven years of Python.' }],
      report: { overall_score: 87, recommendation: 'hire', summary: 'Strong candidate.' },
    })

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Overall')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('HIRE')).toBeInTheDocument()
    expect(screen.getByText('Strong candidate.')).toBeInTheDocument()
    expect(screen.queryByText(/Report generation failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/may still be processing/i)).not.toBeInTheDocument()
  })

  it('launches ShareReportPanel with this report\'s token when "Share" is clicked', async () => {
    respondWith({ name: 'Sara Khan', transcript: [], report: { overall_score: 87 } })
    const user = userEvent.setup()

    render(<ReportModal token="tok_test" onClose={() => {}} />)

    const shareBtn = await screen.findByRole('button', { name: 'Share' })
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument()

    await user.click(shareBtn)

    const panel = await screen.findByTestId('share-panel')
    expect(panel).toHaveAttribute('data-token', 'tok_test')

    await user.click(screen.getByRole('button', { name: 'Close share panel' }))
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument()
  })

  it('disables the Share action while the report is still loading', () => {
    report.mockReturnValue(new Promise(() => {}))
    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
  })
})

describe('ReportModal: a report built from interviewer scorecards', () => {
  const SCORECARD_REPORT = {
    source: 'interviewer_scorecard',
    interview_platform: 'Zoom',
    overall_score: 82,
    technical_score: 85,
    communication_score: 90,
    problem_solving_score: 75,
    cultural_fit_score: 80,
    confidence_score: 80,
    recommendation: 'hire',
    summary: 'Both interviewers would hire.',
    strengths: ['Systems depth'],
    areas_for_improvement: ['Observability'],
    integrity_assessment: 'No proctoring was available for this interview.',
    interviewers: [
      { name: 'Sam Rivera', role: 'hr', source: 'hr', recommendation: 'hire', overall: 80 },
      { name: 'Priya Nair', role: 'engineer', source: 'link', recommendation: 'strong_hire', overall: 4.4 },
    ],
    questions: [
      {
        question_id: 'q1',
        text: 'Explain how you would shard a database.',
        dimension: 'technical',
        entries: [
          { by: 'Sam Rivera', role: 'hr', rating: 4, notes: 'Solid on sharding' },
          { by: 'Priya Nair', role: 'engineer', rating: 5, notes: 'Knew hot-key mitigation' },
        ],
      },
      {
        question_id: 'q2',
        text: 'Walk me through the hardest bug you fixed.',
        dimension: 'problem_solving',
        entries: [{ by: 'Sam Rivera', role: 'hr', rating: null, notes: '' }],
      },
      { question_id: 'q3', text: 'Describe a rate limiter.', dimension: 'technical', entries: [] },
    ],
  }

  beforeEach(() => {
    report.mockReset()
    reportPdf.mockReset()
  })

  function renderScorecardReport(over: Record<string, unknown> = {}) {
    respondWith({ name: 'Ada Lovelace', transcript: [], report: { ...SCORECARD_REPORT, ...over } })
    render(<ReportModal token="tok_test" onClose={() => {}} />)
  }

  it('labels the overall tile "Interviewer overall" and shows the five area scores', async () => {
    renderScorecardReport()
    expect(await screen.findByText('Interviewer overall')).toBeInTheDocument()
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.queryByText('Overall')).not.toBeInTheDocument()
    expect(screen.queryByText('AI Overall')).not.toBeInTheDocument()
    const tiles = within(document.querySelector('.score-grid') as HTMLElement)
    for (const label of ['Technical', 'Communication', 'Problem Solving', 'Cultural Fit', 'Confidence']) {
      expect(tiles.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('HIRE')).toBeInTheDocument()
  })

  it('labels the overall tile "Interviewer overall" even when a score breakdown is present', async () => {
    renderScorecardReport({ score_breakdown: { dimensions: [{ name: 'technical', score: 85, weight: 0.3, rationale: 'Marked 4 and 5.' }], final_score: 82 } })
    expect(await screen.findByText('Interviewer overall')).toBeInTheDocument()
    expect(screen.queryByText('AI Overall')).not.toBeInTheDocument()
  })

  it('leaves out the Integrity tile, the integrity ledger and the integrity assessment', async () => {
    renderScorecardReport({
      score_breakdown: {
        dimensions: [{ name: 'technical', score: 85, weight: 0.3, rationale: 'Marked 4 and 5.' }],
        integrity_deductions: [{ event: 'tab_switch', timestamp: '2026-06-06T15:05:00Z', points: -10 }],
        integrity_multiplier: 0.9,
        final_score: 82,
      },
    })
    await screen.findByText('Interviewer overall')

    expect(screen.queryByText('Integrity')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrity Deductions')).not.toBeInTheDocument()
    expect(screen.queryByText(/tab switch/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Integrity Assessment')).not.toBeInTheDocument()
    expect(screen.queryByText('No proctoring was available for this interview.')).not.toBeInTheDocument()
    expect(screen.queryByText(/integrity/i)).not.toBeInTheDocument()
  })

  it('never renders "undefined" or "NaN" when the integrity score and breakdown pieces are absent', async () => {
    renderScorecardReport({
      score_breakdown: { dimensions: [{ name: 'technical', score: 85, weight: 0.3, rationale: 'Marked 4 and 5.' }], final_score: 82 },
    })
    await screen.findByText('Interviewer overall')
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
    expect(screen.getByText('Final Score')).toBeInTheDocument()
  })

  it('shows the platform and each interviewer with role, source, recommendation and overall', async () => {
    renderScorecardReport()
    await screen.findByText('Scorecard')
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByText('Zoom')).toBeInTheDocument()

    const interviewers = within(screen.getByRole('list', { name: 'Interviewers' })).getAllByRole('listitem')
    expect(interviewers).toHaveLength(2)
    expect(interviewers[0]).toHaveTextContent('Sam Rivera')
    expect(interviewers[0]).toHaveTextContent('HR')
    expect(interviewers[0]).toHaveTextContent('In app')
    expect(interviewers[0]).toHaveTextContent('Hire')
    expect(interviewers[0]).toHaveTextContent('80 / 100')
    expect(interviewers[1]).toHaveTextContent('Priya Nair')
    expect(interviewers[1]).toHaveTextContent('Engineer')
    expect(interviewers[1]).toHaveTextContent('Shared link')
    expect(interviewers[1]).toHaveTextContent('Strong hire')
    expect(interviewers[1]).toHaveTextContent('88 / 100')
  })

  it('shows a per-question table with the dimension and each interviewer\'s rating and notes', async () => {
    renderScorecardReport()
    await screen.findByText('Scorecard')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Question', 'Dimension', 'Ratings and notes'])

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Explain how you would shard a database.')
    expect(rows[0]).toHaveTextContent('Technical')
    expect(rows[0]).toHaveTextContent('Sam Rivera (HR)')
    expect(rows[0]).toHaveTextContent('4 / 5')
    expect(rows[0]).toHaveTextContent('Solid on sharding')
    expect(rows[0]).toHaveTextContent('Priya Nair (Engineer)')
    expect(rows[0]).toHaveTextContent('5 / 5')
    expect(rows[0]).toHaveTextContent('Knew hot-key mitigation')
    expect(rows[1]).toHaveTextContent('Problem solving')
    expect(rows[1]).toHaveTextContent('Not asked')
    expect(rows[2]).toHaveTextContent('-')
  })

  it('shows the summary and lists as for any report', async () => {
    renderScorecardReport()
    expect(await screen.findByText('Both interviewers would hire.')).toBeInTheDocument()
    expect(screen.getByText('Systems depth')).toBeInTheDocument()
    expect(screen.getByText('Observability')).toBeInTheDocument()
  })

  it('shows no Scorecard section for an AI report, and keeps its Integrity tile and assessment', async () => {
    respondWith({
      transcript: [],
      report: { overall_score: 87, integrity_score: 95, integrity_assessment: 'No material integrity concerns.' },
    })
    render(<ReportModal token="tok_test" onClose={() => {}} />)

    expect(await screen.findByText('Overall')).toBeInTheDocument()
    expect(screen.getByText('Integrity')).toBeInTheDocument()
    expect(screen.getByText('95')).toBeInTheDocument()
    expect(screen.getByText('Integrity Assessment')).toBeInTheDocument()
    expect(screen.queryByText('Scorecard')).not.toBeInTheDocument()
    expect(screen.queryByText('Interviewer overall')).not.toBeInTheDocument()
  })

  it('copes with a scorecard report that has no interviewers, no questions and no platform', async () => {
    renderScorecardReport({ interviewers: undefined, questions: undefined, interview_platform: undefined })
    expect(await screen.findByText('Scorecard')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Interviewers' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
  })
})
