import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformOverview } from '../../lib/platformTypes'
import { OVERVIEW, httpError } from '../../test/platformFixtures'

const overview = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: { overview: (...a: unknown[]) => overview(...a) },
}))

const { default: PlatformOverviewPage } = await import('./PlatformOverviewPage')

function Where() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderAt(path = '/platform') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformOverviewPage />
      <Where />
    </MemoryRouter>,
  )
}

const EMPTY: PlatformOverview = {
  ...OVERVIEW,
  totals: Object.fromEntries(Object.keys(OVERVIEW.totals).map(k => [k, 0])) as unknown as PlatformOverview['totals'],
  features: OVERVIEW.features.map(f => ({ ...f, total: 0, window: 0, top_client: null })),
  top_clients: [],
  growth: [],
  recent: [],
}

beforeEach(() => {
  overview.mockReset().mockResolvedValue({ data: OVERVIEW })
})

describe('PlatformOverviewPage', () => {
  it('shows a loading state, then the data', async () => {
    let resolve!: (v: { data: PlatformOverview }) => void
    overview.mockReturnValue(new Promise(r => { resolve = r }))
    renderAt()

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    resolve({ data: OVERVIEW })
    expect(await screen.findByRole('heading', { name: 'Feature usage' })).toBeInTheDocument()
    expect(screen.queryByText(/loading the overview/i)).not.toBeInTheDocument()
  })

  it('shows the headline tiles and the other totals', async () => {
    renderAt()
    const main = await screen.findByLabelText('Headline numbers')

    expect(within(main).getByText('Clients').nextElementSibling).toHaveTextContent('4')
    const companies = within(main).getByText('Companies').parentElement!
    expect(companies).toHaveTextContent('6')
    expect(companies).toHaveTextContent('5 active')
    expect(companies).toHaveTextContent('1 suspended')
    const active = within(main).getByText('Active users').parentElement!
    expect(active).toHaveTextContent('38')
    expect(active).toHaveTextContent('of 63 users')
    expect(within(main).getByText('Total cost').parentElement).toHaveTextContent('$9.41')

    const more = screen.getByLabelText('Totals')
    for (const label of ['Users', 'Jobs', 'Resumes', 'Candidates', 'Interviews', 'Coding assessments', 'Offers', 'Performance reviews', 'Emails', 'AI calls']) {
      expect(within(more).getByText(label)).toBeInTheDocument()
    }
    expect(within(more).getByText('AI calls').parentElement).toHaveTextContent((1204).toLocaleString())
  })

  it('headlines the total cost a company\'s own dashboard shows, with the AI spend and the email estimate beside it', async () => {
    overview.mockResolvedValue({
      data: {
        ...OVERVIEW,
        totals: { ...OVERVIEW.totals, ai_cost_usd: 0.333, email_cost_usd: 0.0009, total_cost_usd: 0.3339 },
        top_clients: [{ ...OVERVIEW.top_clients[0], ai_cost_usd: 0.333, email_cost_usd: 0.0009, total_cost_usd: 0.3339 }],
      },
    })
    renderAt()
    const main = await screen.findByLabelText('Headline numbers')
    expect(within(main).getByText('Total cost').parentElement).toHaveTextContent('$0.3339')
    expect(within(main).queryByText('AI spend')).not.toBeInTheDocument()
    const more = screen.getByLabelText('Totals')
    expect(within(more).getByText('AI spend').parentElement).toHaveTextContent('$0.3330')
    expect(within(more).getByText('Email (estimated)').parentElement).toHaveTextContent('$0.0009')
    const top = (await screen.findByRole('heading', { name: 'Top clients' })).closest('section')!
    expect(top).toHaveTextContent('$0.3339')
    expect(top).not.toHaveTextContent('$0.3330')
  })

  it('leaves the suspended badge off when no company is suspended', async () => {
    overview.mockResolvedValue({ data: { ...OVERVIEW, totals: { ...OVERVIEW.totals, suspended_companies: 0 } } })
    renderAt()
    const main = await screen.findByLabelText('Headline numbers')
    expect(within(main).queryByText(/suspended/)).not.toBeInTheDocument()
  })

  it('lists each feature as window against total and names the top client', async () => {
    renderAt()
    const section = (await screen.findByRole('heading', { name: 'Feature usage' })).closest('section')!

    expect(within(section).getByRole('img', { name: 'Resumes: 310 in the last 30 days, 900 in total' })).toBeInTheDocument()
    expect(within(section).getByRole('img', { name: 'Jobs: 8 in the last 30 days, 21 in total' })).toBeInTheDocument()

    const zed = within(section).getByRole('link', { name: 'Zed Staffing' })
    expect(zed).toHaveAttribute('href', '/platform/clients/cli_zed')
    expect(within(section).getByRole('link', { name: 'Acme Holdings' })).toHaveAttribute('href', '/platform/clients/cli_acme')
    const coding = within(section).getByText('Coding assessments').closest('li')!
    expect(within(coding).queryByRole('link')).not.toBeInTheDocument()
    expect(coding).toHaveTextContent('-')
  })

  it('ranks the top clients with links to their pages', async () => {
    renderAt()
    const section = (await screen.findByRole('heading', { name: 'Top clients' })).closest('section')!
    const rows = within(section).getAllByRole('listitem')

    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: 'Acme Holdings' })).toHaveAttribute('href', '/platform/clients/cli_acme')
    expect(rows[0]).toHaveTextContent('2 companies')
    expect(rows[0]).toHaveTextContent('11 of 18 users active')
    expect(within(rows[1]).getByRole('link')).toHaveTextContent('Zed Staffing')
    expect(rows[1]).toHaveTextContent('1 company')
    expect(within(section).getByRole('img', { name: 'Acme Holdings: 186 events in the last 30 days' })).toBeInTheDocument()
  })

  it('draws the growth chart with a text alternative and a table of the same numbers', async () => {
    renderAt()
    const chart = await screen.findByRole('img', { name: /clients and companies per month, aug 2026 to oct 2026/i })
    expect(chart).toHaveAccessibleName(/clients went from 2 to 4, companies from 3 to 6/i)

    const table = screen.getByRole('table', { name: 'Clients and companies per month' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(rows[3]).toHaveTextContent('Oct 2026')
    expect(rows[3]).toHaveTextContent('4')
    expect(rows[3]).toHaveTextContent('6')
  })

  it('lists recent platform activity', async () => {
    renderAt()
    const section = (await screen.findByRole('heading', { name: 'Recent platform activity' })).closest('section')!
    expect(within(section).getByText('Client suspend')).toBeInTheDocument()
    expect(within(section).getByText('owner@hirely.test')).toBeInTheDocument()
    expect(within(section).getByText(/Acme Holdings/)).toBeInTheDocument()
  })

  it('asks for the default window and offers 7, 30 and 90 days', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })

    expect(overview).toHaveBeenLastCalledWith(30)
    const group = screen.getByRole('radiogroup', { name: 'Time window' })
    expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['7 days', '30 days', '90 days'])
    expect(within(group).getByRole('radio', { name: '30 days' })).toBeChecked()
  })

  it('reloads for another window and keeps it in the URL', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith(7))
    expect(screen.getByTestId('search')).toHaveTextContent('?window=7')
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '30 days' }))
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith(30))
    expect(screen.getByTestId('search')).toBeEmptyDOMElement()
  })

  it('opens on the window named in the URL and ignores one it does not offer', async () => {
    renderAt('/platform?window=90')
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(overview).toHaveBeenLastCalledWith(90)
    expect(screen.getByRole('radio', { name: '90 days' })).toBeChecked()
  })

  it('falls back to 30 days for a window it does not offer', async () => {
    renderAt('/platform?window=45')
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(overview).toHaveBeenLastCalledWith(30)
  })

  it('asks for a calendar month named in the URL and shows the dates the server reported for it', async () => {
    overview.mockResolvedValue({
      data: { ...OVERVIEW, period: { kind: 'month', from: '2026-09-01T00:00:00+00:00', to: '2026-10-01T00:00:00+00:00' } },
    })
    renderAt('/platform?month=2026-09')
    await screen.findByRole('heading', { name: 'Feature usage' })

    expect(overview).toHaveBeenLastCalledWith({ month: '2026-09' })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-09-01 to 2026-10-01')
    expect(screen.getByLabelText('Calendar month')).toHaveValue('2026-09')
    expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Resumes: 310 recently, 900 in total$/ })).toBeInTheDocument()
  })

  it('reloads for a month picked by the owner and keeps it in the URL', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })

    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2026-08' } })
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ month: '2026-08' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?month=2026-08')
    expect(screen.queryByLabelText('Period covered')).not.toBeInTheDocument()
  })

  it('shows no dates when the server reports none', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(screen.queryByLabelText('Period covered')).not.toBeInTheDocument()
  })

  it('shows an empty state for every section that has nothing to show', async () => {
    overview.mockResolvedValue({ data: EMPTY })
    renderAt()

    expect(await screen.findByText('No feature has been used yet.')).toBeInTheDocument()
    expect(screen.getByText('No client activity in this window.')).toBeInTheDocument()
    expect(screen.getByText('No growth data yet.')).toBeInTheDocument()
    expect(screen.getByText('No platform activity yet.')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Headline numbers')).getByText('Total cost').parentElement).toHaveTextContent('$0.00')
  })

  it('shows the server message when the overview cannot be loaded, and retries', async () => {
    const user = userEvent.setup()
    overview.mockRejectedValueOnce(httpError(403, 'Platform owners only.'))
    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owners only.')
    expect(screen.queryByRole('heading', { name: 'Feature usage' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Feature usage' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(overview).toHaveBeenCalledTimes(2)
  })

  it('falls back to a plain message when the failure carries no detail', async () => {
    overview.mockRejectedValue(new Error('Network Error'))
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the platform overview.')
  })

  it('keeps the data on screen and reports the failure when a reload fails', async () => {
    const user = userEvent.setup()
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })

    overview.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    await user.click(screen.getByRole('radio', { name: '90 days' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('heading', { name: 'Feature usage' })).toBeInTheDocument()
  })

  it('shows no subtitle or footnote under its titles', async () => {
    const { container } = renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
    expect(container.querySelector('.pco-card > p')).toBeNull()
  })
})

describe('the time the figures were worked out', () => {
  it('shows As of with the time from computed_at, and a Refresh button', async () => {
    overview.mockResolvedValue({ data: { ...OVERVIEW, computed_at: '2020-03-04T14:02:00Z' } })
    renderAt()
    expect(await screen.findByText(/^As of /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('prints no As of when the server sent no time, but still offers Refresh', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(screen.queryByText(/^As of /)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('asks for fresh figures once on Refresh, and a window change afterwards uses the cache', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })
    expect(overview).toHaveBeenLastCalledWith(30)

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2))
    expect(overview).toHaveBeenLastCalledWith(30, { refresh: true })

    await user.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(3))
    expect(overview).toHaveBeenLastCalledWith(90)
  })

  it('waits while the figures are on their way', async () => {
    let resolve!: (v: { data: PlatformOverview }) => void
    overview.mockResolvedValueOnce({ data: OVERVIEW }).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const user = userEvent.setup({ delay: null })
    renderAt()
    await screen.findByRole('heading', { name: 'Feature usage' })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    resolve({ data: OVERVIEW })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
  })
})
