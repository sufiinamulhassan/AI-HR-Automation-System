import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComparisonRow, JobComparison } from '../../../lib/api'

vi.setConfig({ testTimeout: 30_000 })

const comparison = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: { comparison: (...a: unknown[]) => comparison(...a) },
}))
vi.mock('./ReportModal', () => ({
  default: (p: { token: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Interview Report" data-testid="report">
      {p.token}
      <button type="button" onClick={p.onClose}>mock close report</button>
    </div>
  ),
}))

const { default: CompareCandidatesModal } = await import('./CompareCandidatesModal')

function makeRow(over: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    rank: 1,
    candidate_id: 'c1',
    resume_id: 'r1',
    name: 'Ada Lovelace',
    stage: 'completed',
    source: 'ai',
    final_score: 88,
    dimensions: { technical: 90, communication: 80, problem_solving: 85, cultural_fit: 70, confidence: 75 },
    recommendation: 'hire',
    interviewed_at: '2026-10-01T10:00:00Z',
    match_score: 0.82,
    offer_status: null,
    secure_token: 'tok_c1',
    ...over,
  }
}

const ADA = makeRow()
const GRACE = makeRow({
  rank: 2, candidate_id: 'c2', resume_id: 'r2', name: 'Grace Hopper', stage: 'hired', source: 'interviewer_scorecard',
  final_score: 74.5, dimensions: { technical: 70, communication: 95, problem_solving: 60, cultural_fit: 70, confidence: null },
  recommendation: 'maybe', offer_status: 'sent', secure_token: 'tok_c2',
})
const LINUS = makeRow({
  rank: 3, candidate_id: 'c3', resume_id: 'r3', name: 'Linus Torvalds', stage: 'interviewing', source: 'ai',
  final_score: null, dimensions: { technical: null, communication: null, problem_solving: null, cultural_fit: null, confidence: null },
  recommendation: null, offer_status: null, secure_token: '',
})

function payload(rows: ComparisonRow[], stats?: Partial<JobComparison['stats']>): { data: JobComparison } {
  return {
    data: {
      job_id: 'job_1', title: 'Backend Engineer', rows,
      stats: { count: rows.length, average: 81.3, highest: 88, ...stats },
    },
  }
}

function renderModal() {
  const onClose = vi.fn()
  render(<CompareCandidatesModal jobId="job_1" jobTitle="Backend Engineer" onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

async function renderLoaded(rows: ComparisonRow[] = [ADA, GRACE, LINUS]) {
  comparison.mockResolvedValue(payload(rows))
  const r = renderModal()
  await screen.findByRole('table')
  return r
}

const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')
const names = () => bodyRows().map(r => within(r).getAllByRole('cell')[1].textContent)
const rowOf = (name: string) => bodyRows().find(r => within(r).getAllByRole('cell')[1].textContent === name) as HTMLElement
const cellsOf = (name: string) => within(rowOf(name)).getAllByRole('cell')
const header = (name: string) => screen.getByRole('columnheader', { name })

const FINAL = 4, TECH = 5, COMM = 6, SOLVING = 7, CULTURE = 8, CONFIDENCE = 9, REC = 10

beforeEach(() => {
  comparison.mockReset()
  comparison.mockResolvedValue(payload([ADA, GRACE, LINUS]))
})

describe('opening', () => {
  it('is a labelled modal dialog that names the job, with a loading state first', async () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Compare candidates, Backend Engineer' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Loading comparison')
    await screen.findByRole('table')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('asks for every stage without rejected candidates to begin with', async () => {
    await renderLoaded()
    expect(comparison).toHaveBeenCalledTimes(1)
    expect(comparison).toHaveBeenCalledWith('job_1', { stage: undefined, include_rejected: false })
  })

  it('closes from Close, the close icon, Escape and the backdrop', async () => {
    const { user, onClose } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Close comparison' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('compare-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })
})

describe('the table', () => {
  it('lists the candidates in the server\'s rank order with every column', async () => {
    await renderLoaded()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Rank', 'Candidate', 'Stage', 'Source', 'Final score', 'Technical', 'Communication', 'Problem solving',
      'Cultural fit', 'Confidence', 'Recommendation', 'Offer',
    ])
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'])

    expect(cellsOf('Ada Lovelace').map(c => c.textContent)).toEqual([
      '1', 'Ada Lovelace', 'Completed', 'AI interview', '88', '90', '80', '85', '70', '75', 'Hire', '-',
    ])
    expect(cellsOf('Grace Hopper').map(c => c.textContent)).toEqual([
      '2', 'Grace Hopper', 'Hired', 'Scorecard', '74.5', '70', '95', '60', '70', '-', 'Maybe', 'Sent',
    ])
    expect(cellsOf('Linus Torvalds').map(c => c.textContent)).toEqual([
      '3', 'Linus Torvalds', 'Interviewing', 'AI interview', '-', '-', '-', '-', '-', '-', '-', '-',
    ])
  })

  it('colours the source and the recommendation', async () => {
    await renderLoaded()
    expect(within(cellsOf('Ada Lovelace')[3]).getByText('AI interview')).toHaveClass('badge-blue')
    expect(within(cellsOf('Grace Hopper')[3]).getByText('Scorecard')).toHaveClass('badge-gray')
    expect(within(cellsOf('Ada Lovelace')[REC]).getByText('Hire')).toHaveClass('badge-green')
    expect(within(cellsOf('Grace Hopper')[REC]).getByText('Maybe')).toHaveClass('badge-yellow')
  })

  it('shows the count, average and highest', async () => {
    await renderLoaded()
    const stats = screen.getByText('Candidates').closest('dl') as HTMLElement
    expect(within(stats).getByText('Candidates').nextSibling).toHaveTextContent('3')
    expect(within(stats).getByText('Average').nextSibling).toHaveTextContent('81.3')
    expect(within(stats).getByText('Highest').nextSibling).toHaveTextContent('88')
  })
})

describe('an erased person', () => {
  const GONE = makeRow({
    rank: 2, candidate_id: 'c9', resume_id: 'r9', name: undefined, erased: true, stage: 'completed',
    final_score: 61, secure_token: '',
  })

  it('is ranked as Erased candidate, muted, with no name to crash on', async () => {
    await renderLoaded([ADA, GONE])
    const cell = screen.getByRole('button', { name: 'Erased candidate' })
    expect(cell).toHaveClass('cmp-name-erased')
    expect(cell.closest('tr')).toHaveTextContent('61')
    expect(screen.getByRole('button', { name: 'Ada Lovelace' })).not.toHaveClass('cmp-name-erased')
  })

  it('sorts by name without a name and exports the label, not a blank', async () => {
    const { user } = await renderLoaded([ADA, GONE])
    await user.click(screen.getByRole('button', { name: /^Candidate/ }))
    expect(screen.getByRole('button', { name: 'Erased candidate' })).toBeInTheDocument()
  })
})

describe('best value per column', () => {
  it('marks the highest figure of the final score and each area, and the best recommendation', async () => {
    await renderLoaded()
    const best = (name: string, index: number) => cellsOf(name)[index].classList.contains('cmp-best')

    expect(best('Ada Lovelace', FINAL)).toBe(true)
    expect(best('Grace Hopper', FINAL)).toBe(false)
    expect(best('Ada Lovelace', TECH)).toBe(true)
    expect(best('Grace Hopper', COMM)).toBe(true)
    expect(best('Ada Lovelace', COMM)).toBe(false)
    expect(best('Ada Lovelace', SOLVING)).toBe(true)
    expect(best('Ada Lovelace', CONFIDENCE)).toBe(false)
    expect(best('Ada Lovelace', REC)).toBe(true)
    expect(best('Grace Hopper', REC)).toBe(false)
    expect(best('Linus Torvalds', FINAL)).toBe(false)
  })

  it('marks every row of a tie, and nothing when all the figures are the same', async () => {
    await renderLoaded()
    expect(cellsOf('Ada Lovelace')[CULTURE]).not.toHaveClass('cmp-best')
    expect(cellsOf('Grace Hopper')[CULTURE]).not.toHaveClass('cmp-best')
  })

  it('marks a tie at the top', async () => {
    await renderLoaded([
      makeRow({ final_score: 90 }),
      makeRow({ rank: 2, candidate_id: 'c2', name: 'Grace Hopper', final_score: 90 }),
      makeRow({ rank: 3, candidate_id: 'c3', name: 'Linus Torvalds', final_score: 50 }),
    ])
    expect(cellsOf('Ada Lovelace')[FINAL]).toHaveClass('cmp-best')
    expect(cellsOf('Grace Hopper')[FINAL]).toHaveClass('cmp-best')
    expect(cellsOf('Linus Torvalds')[FINAL]).not.toHaveClass('cmp-best')
  })

  it('marks nothing when a single candidate is shown', async () => {
    await renderLoaded([ADA])
    expect(document.querySelector('.cmp-best')).toBeNull()
  })

  it('follows the rows on screen after a filter, not the rows hidden', async () => {
    const { user } = await renderLoaded()
    comparison.mockResolvedValue(payload([GRACE]))
    await user.selectOptions(screen.getByLabelText('Stage'), 'hired')
    await waitFor(() => expect(names()).toEqual(['Grace Hopper']))
    expect(document.querySelector('.cmp-best')).toBeNull()
  })
})

describe('sorting', () => {
  it('sorts a score column highest first, then lowest first, with unscored candidates always last', async () => {
    const { user } = await renderLoaded()
    expect(header('Rank')).toHaveAttribute('aria-sort', 'ascending')

    await user.click(within(header('Final score')).getByRole('button'))
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'])
    expect(header('Final score')).toHaveAttribute('aria-sort', 'descending')
    expect(header('Rank')).toHaveAttribute('aria-sort', 'none')

    await user.click(within(header('Final score')).getByRole('button'))
    expect(names()).toEqual(['Grace Hopper', 'Ada Lovelace', 'Linus Torvalds'])
    expect(header('Final score')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts an area by its own figures', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Communication')).getByRole('button'))
    expect(names()).toEqual(['Grace Hopper', 'Ada Lovelace', 'Linus Torvalds'])
  })

  it('sorts names A to Z first, then Z to A', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Candidate')).getByRole('button'))
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'])
    await user.click(within(header('Candidate')).getByRole('button'))
    expect(names()).toEqual(['Linus Torvalds', 'Grace Hopper', 'Ada Lovelace'])
  })

  it('sorts recommendations best first and puts a missing one last', async () => {
    const { user } = await renderLoaded([LINUS, GRACE, ADA])
    await user.click(within(header('Recommendation')).getByRole('button'))
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'])
  })

  it('returns to the server\'s order from Rank', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(within(header('Rank')).getByRole('button'))
    expect(names()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'])
  })

  it('keeps the sort when a filter loads new rows', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(within(header('Candidate')).getByRole('button'))
    comparison.mockResolvedValue(payload([ADA, GRACE]))
    await user.click(screen.getByRole('checkbox', { name: 'Include rejected' }))
    await waitFor(() => expect(names()).toEqual(['Grace Hopper', 'Ada Lovelace']))
  })
})

describe('filters', () => {
  it('offers the stages and asks the server again for the one chosen', async () => {
    const { user } = await renderLoaded()
    const stage = screen.getByLabelText('Stage')
    expect(within(stage).getAllByRole('option').map(o => o.textContent)).toEqual(['All stages', 'Invited', 'Interviewing', 'Completed', 'Hired'])

    comparison.mockResolvedValue(payload([ADA]))
    await user.selectOptions(stage, 'completed')
    await waitFor(() => expect(comparison).toHaveBeenLastCalledWith('job_1', { stage: 'completed', include_rejected: false }))
    await waitFor(() => expect(names()).toEqual(['Ada Lovelace']))

    comparison.mockResolvedValue(payload([ADA, GRACE]))
    await user.selectOptions(stage, '')
    await waitFor(() => expect(comparison).toHaveBeenLastCalledWith('job_1', { stage: undefined, include_rejected: false }))
  })

  it('Include rejected asks for the rejected candidates too, and again without them', async () => {
    const { user } = await renderLoaded()
    const rejected = makeRow({ rank: 4, candidate_id: 'c4', name: 'Rejected Rita', stage: 'rejected', secure_token: 'tok_c4' })
    comparison.mockResolvedValue(payload([ADA, rejected]))
    await user.click(screen.getByRole('checkbox', { name: 'Include rejected' }))
    await waitFor(() => expect(comparison).toHaveBeenLastCalledWith('job_1', { stage: undefined, include_rejected: true }))
    expect(await screen.findByText('Rejected Rita')).toBeInTheDocument()

    comparison.mockResolvedValue(payload([ADA]))
    await user.click(screen.getByRole('checkbox', { name: 'Include rejected' }))
    await waitFor(() => expect(comparison).toHaveBeenLastCalledWith('job_1', { stage: undefined, include_rejected: false }))
    await waitFor(() => expect(screen.queryByText('Rejected Rita')).not.toBeInTheDocument())
  })

  it('ignores a slow answer for filters that are no longer chosen', async () => {
    const { user } = await renderLoaded()
    let late!: (v: unknown) => void
    comparison.mockReturnValueOnce(new Promise(res => { late = res }))
    await user.selectOptions(screen.getByLabelText('Stage'), 'hired')
    comparison.mockResolvedValue(payload([GRACE]))
    await user.selectOptions(screen.getByLabelText('Stage'), 'completed')
    await waitFor(() => expect(names()).toEqual(['Grace Hopper']))
    late(payload([ADA, LINUS]))
    await Promise.resolve()
    expect(names()).toEqual(['Grace Hopper'])
  })
})

describe('states', () => {
  it('says there is nobody to compare yet', async () => {
    comparison.mockResolvedValue(payload([], { average: null, highest: null }))
    renderModal()
    expect(await screen.findByText('No interviewed candidates yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('says nothing matches when a filter is on', async () => {
    const { user } = await renderLoaded()
    comparison.mockResolvedValue(payload([]))
    await user.selectOptions(screen.getByLabelText('Stage'), 'invited')
    expect(await screen.findByText('No candidates match these filters')).toBeInTheDocument()
  })

  it('shows the server\'s message when the comparison cannot load, and Retry asks again', async () => {
    comparison.mockRejectedValueOnce({ response: { status: 403, data: { detail: 'Admins only.' } } })
    const { user } = renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(comparison).toHaveBeenCalledTimes(2)
  })

  it('falls back to a plain message when there is no detail', async () => {
    comparison.mockRejectedValueOnce(new Error('Network Error'))
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the comparison.')
  })
})

describe('opening a report', () => {
  it('opens that candidate\'s report from a click anywhere on the row', async () => {
    const { user } = await renderLoaded()
    await user.click(cellsOf('Grace Hopper')[FINAL])
    expect(screen.getByTestId('report')).toHaveTextContent('tok_c2')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('opens it from the name with the keyboard', async () => {
    const { user } = await renderLoaded()
    within(rowOf('Ada Lovelace')).getByRole('button', { name: 'Ada Lovelace' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('report')).toHaveTextContent('tok_c1')
  })

  it('does nothing for a candidate with no report token, and disables the name', async () => {
    const { user } = await renderLoaded()
    expect(within(rowOf('Linus Torvalds')).getByRole('button', { name: 'Linus Torvalds' })).toBeDisabled()
    await user.click(cellsOf('Linus Torvalds')[FINAL])
    expect(screen.queryByTestId('report')).not.toBeInTheDocument()
  })

  it('Escape closes the report first and the comparison only the next time', async () => {
    const { user, onClose } = await renderLoaded()
    await user.click(cellsOf('Ada Lovelace')[FINAL])
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('report')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closing the report leaves the comparison as it was', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(cellsOf('Ada Lovelace')[FINAL])
    await user.click(screen.getByRole('button', { name: 'mock close report' }))
    expect(screen.queryByTestId('report')).not.toBeInTheDocument()
    expect(header('Candidate')).toHaveAttribute('aria-sort', 'ascending')
  })
})

describe('Export CSV', () => {
  let blobs: Blob[]
  let downloads: string[]
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

  beforeEach(() => {
    blobs = []
    downloads = []
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:csv' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
  })
  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.restoreAllMocks()
  })

  const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

  it('downloads the rows on screen, in the order shown, with a header line', async () => {
    const { user } = await renderLoaded()
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(within(header('Candidate')).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(downloads).toEqual(['comparison-backend-engineer.csv'])
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toContain('text/csv')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv')

    const lines = (await readBlob(blobs[0])).split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('Rank,Candidate,Stage,Source,Final score,Technical,Communication,Problem solving,Cultural fit,Confidence,Recommendation,Offer status,Interviewed,Match score')
    expect(lines.slice(1).map(l => l.split(',')[1])).toEqual(['Linus Torvalds', 'Grace Hopper', 'Ada Lovelace'])
    expect(lines[3]).toBe('1,Ada Lovelace,completed,AI interview,88,90,80,85,70,75,Hire,,2026-10-01T10:00:00Z,0.82')
  })

  it('exports only what the filters leave', async () => {
    const { user } = await renderLoaded()
    comparison.mockResolvedValue(payload([GRACE]))
    await user.selectOptions(screen.getByLabelText('Stage'), 'hired')
    await waitFor(() => expect(names()).toEqual(['Grace Hopper']))
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    const lines = (await readBlob(blobs[0])).split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Grace Hopper')
  })

  it('makes a name that starts like a formula plain text', async () => {
    const { user } = await renderLoaded([makeRow({ name: '=HYPERLINK("http://x.example")' })])
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    const text = await readBlob(blobs[0])
    expect(text).toContain(`"'=HYPERLINK(""http://x.example"")"`)
  })

  it('says so inline when the file cannot be made', async () => {
    const { user } = await renderLoaded()
    URL.createObjectURL = vi.fn(() => { throw new Error('no blobs') })
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export the CSV')
  })
})

describe('writing rules', () => {
  it('shows titles, labels and numbers only, with no caption and no em dash', async () => {
    await renderLoaded()
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('p')).toBeNull()
    expect(dialog.querySelector('[class*="-sub"]')).toBeNull()
    expect(dialog.querySelector('[class*="-note"]')).toBeNull()
    expect(dialog.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
