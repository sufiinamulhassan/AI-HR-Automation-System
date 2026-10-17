import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttentionCandidate, AttentionDetail, AttentionItem } from '../../lib/api'

vi.setConfig({ testTimeout: 30_000 })

const get = vi.fn()
const detail = vi.fn()

vi.mock('../../lib/api', () => ({
  attentionApi: {
    get: (...a: unknown[]) => get(...a),
    detail: (...a: unknown[]) => detail(...a),
  },
}))

const { default: AttentionMenu } = await import('./AttentionMenu')

const ITEMS: AttentionItem[] = [
  { key: 'scorecards', label: 'Interviews awaiting a scorecard', count: 3, severity: 'urgent', path: '/dashboard/hrbot', query: { stage: 'interviewing', needs: 'scorecard' } },
  { key: 'invites', label: 'Invites not sent', count: 12, severity: 'warn', path: '/dashboard/hrbot' },
  { key: 'offers', label: 'Offers waiting for approval', count: 1, severity: 'info', path: '/dashboard/offers' },
]

const SCORECARDS: AttentionItem = {
  key: 'external_awaiting_scorecard', label: 'Interviews held, waiting for a scorecard', count: 120, severity: 'warn',
  path: '/dashboard/hrbot', query: { attention: 'external_awaiting_scorecard' },
}
const NO_SHOWS: AttentionItem = {
  key: 'external_no_show_open', label: 'No-shows not yet rescheduled', count: 2, severity: 'warn',
  path: '/dashboard/hrbot', query: { attention: 'external_no_show_open' },
}
const EMAIL: AttentionItem = {
  key: 'email_failures_24h', label: 'Emails that failed in the last 24 hours', count: 4, severity: 'urgent',
  path: '/dashboard/settings?tab=delivery',
}
const PLAIN: AttentionItem = {
  key: 'custom', label: 'A row with its own query', count: 1, severity: 'info', path: '/dashboard/hrbot', query: { stage: 'interviewing' },
}

const ADA: AttentionCandidate = {
  candidate_id: 'cand_1', job_id: 'job_1', job_title: 'Backend Engineer', name: 'Ada Lovelace', stage: 'interviewing',
  detail: 'Interview ended 3 days ago', due_at: '2026-10-05T10:00:00Z',
}
const GRACE: AttentionCandidate = {
  candidate_id: 'cand_2', job_id: 'job_2', job_title: 'Data Analyst', name: 'Grace Hopper', stage: 'invited',
  detail: null, due_at: null,
}

function detailOf(key: string, items: AttentionCandidate[], total = items.length): { data: AttentionDetail } {
  return { data: { key, label: 'x', total, items } }
}

function answer(items: AttentionItem[]) {
  get.mockResolvedValue({ data: { generated_at: '2026-10-08T09:00:00Z', items } })
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

function renderMenu() {
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AttentionMenu />
      <Where />
    </MemoryRouter>,
  )
  return { user: userEvent.setup(), ...view }
}

const icon = () => screen.getByRole('button', { name: /^Needs attention/ })
const panel = () => screen.getByRole('dialog', { name: 'Needs attention' })
const rowButton = (name: RegExp) => within(panel()).getByRole('button', { name })

async function openWith(items: AttentionItem[], firstRow: RegExp) {
  answer(items)
  const view = renderMenu()
  await waitFor(() => expect(get).toHaveBeenCalled())
  await view.user.click(icon())
  await within(panel()).findByRole('button', { name: firstRow })
  return view.user
}
const openScorecards = () => openWith([SCORECARDS, NO_SHOWS, EMAIL, PLAIN], /waiting for a scorecard/)

beforeEach(() => {
  get.mockReset()
  detail.mockReset()
  answer(ITEMS)
  detail.mockImplementation(async (key: string) => detailOf(key, [ADA, GRACE]))
})

describe('the icon', () => {
  it('is a button named Needs attention that opens a dialog, and the list starts closed', async () => {
    renderMenu()
    expect(icon()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(icon()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  })

  it('carries the number of things waiting, so it can be read without opening it', async () => {
    renderMenu()
    const count = await screen.findByText('16')
    expect(count).toHaveAttribute('data-severity', 'urgent')
    expect(icon()).toHaveAccessibleName('Needs attention, 16 waiting')
  })

  it('takes its colour from the most serious thing waiting', async () => {
    answer([ITEMS[1], ITEMS[2]])
    renderMenu()
    expect(await screen.findByText('13')).toHaveAttribute('data-severity', 'warn')
  })

  it('shows 99+ rather than a number wider than the icon', async () => {
    answer([{ ...ITEMS[1], count: 250 }])
    renderMenu()
    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('shows no number while loading, when nothing is waiting, or when the read failed', async () => {
    let resolve!: (v: unknown) => void
    get.mockReturnValue(new Promise(res => { resolve = res }))
    const first = renderMenu()
    expect(first.container.querySelector('.attm-count')).toBeNull()
    resolve({ data: { generated_at: 'x', items: [] } })
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(first.container.querySelector('.attm-count')).toBeNull()
    first.unmount()

    get.mockReset().mockRejectedValue(new Error('503'))
    const failed = renderMenu()
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(failed.container.querySelector('.attm-count')).toBeNull()
    expect(icon()).toHaveAccessibleName('Needs attention')
  })

  it('treats an answer without items as an empty list', async () => {
    get.mockResolvedValue({ data: {} })
    const { user, container } = renderMenu()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await user.click(icon())
    expect(await within(panel()).findByText('Nothing needs attention')).toBeInTheDocument()
    expect(container.querySelector('.attm-count')).toBeNull()
  })

  it('reads the list again each time it is opened, and keeps what it had if that read fails', async () => {
    const { user } = renderMenu()
    await screen.findByText('16')
    expect(get).toHaveBeenCalledTimes(1)

    get.mockRejectedValue(new Error('503'))
    await user.click(icon())
    expect(get).toHaveBeenCalledTimes(2)
    expect(await within(panel()).findByRole('button', { name: /Invites not sent/ })).toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument()
  })
})

describe('the panel', () => {
  it('is titled "Needs attention" and shows a loading line until the answer arrives', async () => {
    let resolve!: (v: unknown) => void
    get.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = renderMenu()
    await user.click(icon())
    expect(within(panel()).getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    expect(within(panel()).getByRole('status')).toHaveTextContent('Loading')

    resolve({ data: { generated_at: 'x', items: ITEMS } })
    await within(panel()).findByRole('button', { name: /Invites not sent/ })
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows one row per item with its label and count, in the order given', async () => {
    await openWith(ITEMS, /Invites not sent/)
    expect(within(panel()).getAllByRole('button').map(r => r.textContent)).toEqual([
      'Interviews awaiting a scorecard3',
      'Invites not sent12',
      'Offers waiting for approval1',
    ])
  })

  it('colours each count by its severity', async () => {
    await openWith(ITEMS, /Invites not sent/)
    const count = (label: RegExp) => within(rowButton(label)).getByText(/^\d+$/)
    expect(count(/awaiting a scorecard/)).toHaveClass('badge-red')
    expect(count(/Invites not sent/)).toHaveClass('badge-yellow')
    expect(count(/Offers waiting/)).toHaveClass('badge-blue')
  })

  it('says so when nothing needs attention', async () => {
    answer([])
    const { user } = renderMenu()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await user.click(icon())
    expect(await within(panel()).findByText('Nothing needs attention')).toBeInTheDocument()
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('closes on a second click of the icon, on Escape and on a click outside', async () => {
    const user = await openWith(ITEMS, /Invites not sent/)
    await user.click(icon())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(icon()).toHaveAttribute('aria-expanded', 'false')

    await user.click(icon())
    await within(panel()).findByRole('button', { name: /Invites not sent/ })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(icon())
    await within(panel()).findByRole('button', { name: /Invites not sent/ })
    await user.click(screen.getByTestId('where'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open for a click inside it', async () => {
    const user = await openWith(ITEMS, /Invites not sent/)
    await user.click(within(panel()).getByRole('heading', { name: 'Needs attention' }))
    expect(panel()).toBeInTheDocument()
  })
})

describe('opening a row', () => {
  it('goes to the item\'s path with its query string, and closes the panel', async () => {
    const user = await openWith(ITEMS, /Invites not sent/)
    await user.click(rowButton(/awaiting a scorecard/))
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/hrbot?stage=interviewing&needs=scorecard')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes to the bare path when the item has no query', async () => {
    const user = await openWith(ITEMS, /Invites not sent/)
    await user.click(rowButton(/Invites not sent/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/hrbot')
  })

  it('encodes query values rather than splicing them in', async () => {
    const user = await openWith(
      [{ key: 'k', label: 'Odd', count: 1, severity: 'info', path: '/dashboard/resumes', query: { search: 'a&b=c d' } }],
      /Odd/,
    )
    await user.click(rowButton(/Odd/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/resumes?search=a%26b%3Dc+d')
  })

  it('ignores a path that is not a route of this app, and stays open', async () => {
    const user = await openWith([
      { key: 'a', label: 'Elsewhere', count: 1, severity: 'info', path: 'https://example.com/phish' },
      { key: 'b', label: 'Protocol relative', count: 1, severity: 'info', path: '//example.com' },
    ], /Elsewhere/)
    await user.click(rowButton(/Elsewhere/))
    await user.click(rowButton(/Protocol relative/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard')
    expect(panel()).toBeInTheDocument()
  })
})

describe('when it cannot load', () => {
  it('shows a small error in the panel, with a Retry that asks again', async () => {
    get.mockReset().mockRejectedValue(new Error('503'))
    const { user } = renderMenu()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await user.click(icon())
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('Could not load.')
    expect(within(panel()).getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
  })

  it('retries from the error and shows the rows when it works', async () => {
    get.mockReset().mockRejectedValue(new Error('503'))
    const { user } = renderMenu()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await user.click(icon())
    const alert = await within(panel()).findByRole('alert')

    answer(ITEMS)
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await within(panel()).findByRole('button', { name: /Invites not sent/ })).toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('a row about candidates', () => {
  it('is marked as one that opens, and starts closed', async () => {
    await openScorecards()
    expect(rowButton(/waiting for a scorecard/)).toHaveAttribute('aria-expanded', 'false')
    expect(rowButton(/No-shows/)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: SCORECARDS.label })).not.toBeInTheDocument()
    expect(detail).not.toHaveBeenCalled()
  })

  it('opens in place on a click, asks for that row\'s candidates, and goes nowhere', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))

    expect(rowButton(/waiting for a scorecard/)).toHaveAttribute('aria-expanded', 'true')
    expect(detail).toHaveBeenCalledTimes(1)
    expect(detail).toHaveBeenCalledWith('external_awaiting_scorecard')
    expect(screen.getByTestId('where').textContent).toBe('/dashboard')
    expect(panel()).toBeInTheDocument()
  })

  it('shows a loading line, then each candidate with their name, job, stage and detail', async () => {
    let resolve!: (v: unknown) => void
    detail.mockReturnValue(new Promise(res => { resolve = res }))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    expect(within(panel()).getAllByRole('status').some(s => s.textContent === 'Loading…')).toBe(true)

    resolve(detailOf('external_awaiting_scorecard', [ADA, GRACE]))
    const list = await screen.findByRole('list', { name: SCORECARDS.label })
    expect(within(list).getAllByRole('button').map(i => i.textContent)).toEqual([
      'Ada LovelaceBackend Engineer · interviewingInterview ended 3 days ago',
      'Grace HopperData Analyst · invited',
    ])
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('leaves out a detail that is missing, a job title that is missing, and spaces a stage written with underscores', async () => {
    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', [{ ...GRACE, job_title: '', stage: 'in_review', detail: '' }]))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    const item = await within(await screen.findByRole('list', { name: SCORECARDS.label })).findByRole('button')
    expect(item.textContent).toBe('Grace Hopperin review')
    expect(item.querySelector('.att-item-detail')).toBeNull()
  })

  it('goes to that candidate in the workspace when one is clicked, and closes the panel', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await user.click(await screen.findByRole('button', { name: /Grace Hopper/ }))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/hrbot?job=job_2&candidate=cand_2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('encodes the ids it puts in the address', async () => {
    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', [{ ...ADA, job_id: 'a&b=c', candidate_id: 'x y/z' }]))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await user.click(await screen.findByRole('button', { name: /Ada Lovelace/ }))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/hrbot?job=a%26b%3Dc&candidate=x+y%2Fz')
  })

  it('closes again on a second click, and asks again the next time it is opened', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await screen.findByRole('list', { name: SCORECARDS.label })

    await user.click(rowButton(/waiting for a scorecard/))
    expect(rowButton(/waiting for a scorecard/)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: SCORECARDS.label })).not.toBeInTheDocument()

    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', [GRACE]))
    await user.click(rowButton(/waiting for a scorecard/))
    await waitFor(() => expect(within(screen.getByRole('list', { name: SCORECARDS.label })).getAllByRole('button')).toHaveLength(1))
    expect(detail).toHaveBeenCalledTimes(2)
  })

  it('has one row open at a time', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await screen.findByRole('list', { name: SCORECARDS.label })
    await user.click(rowButton(/No-shows/))

    expect(rowButton(/waiting for a scorecard/)).toHaveAttribute('aria-expanded', 'false')
    expect(rowButton(/No-shows/)).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('list', { name: NO_SHOWS.label })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: SCORECARDS.label })).not.toBeInTheDocument()
    expect(detail).toHaveBeenLastCalledWith('external_no_show_open')
  })

  it('opens no row when the panel is opened again after being closed', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await screen.findByRole('list', { name: SCORECARDS.label })
    await user.keyboard('{Escape}')

    await user.click(icon())
    await within(panel()).findByRole('button', { name: /waiting for a scorecard/ })
    expect(rowButton(/waiting for a scorecard/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('says "Nothing to show" for a row with no candidates', async () => {
    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', []))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    expect(await screen.findByText('Nothing to show')).toBeInTheDocument()
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })

  it('shows a small error inside the row, with a Retry, and the rest of the panel works', async () => {
    detail.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Unknown attention key.' } } })
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load.')
    expect(rowButton(/No-shows/)).toBeEnabled()
    expect(rowButton(/Emails that failed/)).toBeEnabled()

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: SCORECARDS.label })).toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(detail).toHaveBeenCalledTimes(2)
  })

  it('says how many are shown out of how many there are when the list is cut short', async () => {
    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', [ADA, GRACE], 120))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    expect(await screen.findByText('Showing 2 of 120')).toBeInTheDocument()
  })

  it('says nothing about a count when every candidate is listed', async () => {
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))
    await screen.findByRole('list', { name: SCORECARDS.label })
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })
})

describe('an erased person in a row', () => {
  it('reads Erased candidate, muted, and still shows the job and stage, with no name to crash on', async () => {
    const tombstone = { candidate_id: 'cand_9', job_id: 'job_9', job_title: 'Data Analyst', stage: 'rejected', erased: true, detail: null, due_at: null } as AttentionCandidate
    detail.mockImplementation(async (key: string) => detailOf(key, [ADA, tombstone]))
    const user = await openScorecards()
    await user.click(rowButton(/waiting for a scorecard/))

    const erased = await screen.findByText('Erased candidate')
    expect(erased).toHaveClass('att-item-erased')
    expect(erased.closest('button')).toHaveTextContent('Data Analyst')
    expect(erased.closest('button')).toHaveTextContent('rejected')
    expect(screen.getByText('Ada Lovelace')).not.toHaveClass('att-item-erased')
  })
})

describe('the other rows', () => {
  it('a row with no attention key goes to its path with its query, and does not open', async () => {
    const user = await openScorecards()
    expect(rowButton(/A row with its own query/)).not.toHaveAttribute('aria-expanded')
    await user.click(rowButton(/A row with its own query/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/hrbot?stage=interviewing')
    expect(detail).not.toHaveBeenCalled()
  })

  it('the email row goes to its settings tab, query and all', async () => {
    const user = await openScorecards()
    expect(rowButton(/Emails that failed/)).not.toHaveAttribute('aria-expanded')
    await user.click(rowButton(/Emails that failed/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/settings?tab=delivery')
    expect(detail).not.toHaveBeenCalled()
  })

  it('adds a row\'s own query to a path that already has one, the row\'s winning on a clash', async () => {
    const user = await openWith(
      [{ ...EMAIL, path: '/dashboard/settings?tab=delivery&x=1', query: { tab: 'email', y: '2' } }],
      /Emails that failed/,
    )
    await user.click(rowButton(/Emails that failed/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/settings?tab=email&x=1&y=2')
  })

  it('still ignores a path that is not a route of this app', async () => {
    const user = await openWith([{ ...EMAIL, path: 'https://example.com/?tab=delivery' }], /Emails that failed/)
    await user.click(rowButton(/Emails that failed/))
    expect(screen.getByTestId('where').textContent).toBe('/dashboard')
  })
})

describe('writing rules', () => {
  it('shows a title and rows only: no caption, no footnote, no em dash', async () => {
    const user = await openScorecards()
    const dialog = panel()
    expect(dialog.querySelector('p')).toBeNull()
    expect(dialog.querySelector('[class*="-sub"]')).toBeNull()
    expect(dialog.querySelector('[class*="-note"]')).toBeNull()

    detail.mockResolvedValue(detailOf('external_awaiting_scorecard', [ADA, GRACE], 120))
    await user.click(rowButton(/waiting for a scorecard/))
    await screen.findByText('Showing 2 of 120')
    expect(dialog.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(dialog.querySelector('[class*="-sub"]')).toBeNull()
  })
})
