import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageMatrix } from '../../lib/platformTypes'
import { USAGE, httpError } from '../../test/platformFixtures'

const usage = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: { usage: (...a: unknown[]) => usage(...a) },
}))

const { default: PlatformUsagePage, heatOf } = await import('./PlatformUsagePage')

function Where() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderPage(path = '/platform/usage') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformUsagePage />
      <Where />
    </MemoryRouter>,
  )
}

const order = () => within(screen.getByRole('table')).getAllByRole('rowheader').map(h => h.querySelector('a')!.textContent)

function cellsOf(name: string) {
  const tr = screen.getByRole('link', { name }).closest('tr')!
  return within(tr).getAllByRole('cell')
}

beforeEach(() => {
  usage.mockReset().mockResolvedValue({ data: USAGE })
})

describe('heatOf', () => {
  it('is the count against the column maximum, from 0 to 1', () => {
    expect(heatOf(0, 200)).toBe(0)
    expect(heatOf(50, 200)).toBe(0.25)
    expect(heatOf(200, 200)).toBe(1)
  })

  it('is 0 for a column nobody has used, never NaN', () => {
    expect(heatOf(0, 0)).toBe(0)
  })

  it('never goes past 1', () => {
    expect(heatOf(300, 200)).toBe(1)
  })
})

describe('PlatformUsagePage', () => {
  it('shows a loading state, then a column per feature and a row per client', async () => {
    let resolve!: (v: unknown) => void
    usage.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the usage matrix/i)

    resolve({ data: USAGE })
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Client', 'Jobs', 'Resumes', 'Interviews', 'Total'])
    expect(order()).toEqual(['Acme Holdings', 'Zed Staffing', 'Midway Group'])
  })

  it('prints every count, and a total per client', async () => {
    renderPage()
    await screen.findByRole('table')

    expect(cellsOf('Acme Holdings').map(c => c.textContent)).toEqual(['6', '40★ (top feature)', '9', '55'])
    expect(cellsOf('Zed Staffing').map(c => c.textContent)).toEqual(['3', '200★ (top feature)', '0', '203'])
    expect(cellsOf('Midway Group').map(c => c.textContent)).toEqual(['12★ (top feature)', '0', '3', '15'])
  })

  it('shades each cell against the biggest count in its own column', async () => {
    renderPage()
    await screen.findByRole('table')
    const heat = (name: string) => cellsOf(name).slice(0, 3).map(c => c.getAttribute('data-heat'))

    expect(heat('Acme Holdings')).toEqual(['0.50', '0.20', '1.00'])
    expect(heat('Zed Staffing')).toEqual(['0.25', '1.00', '0.00'])
    expect(heat('Midway Group')).toEqual(['1.00', '0.00', '0.33'])
    expect(cellsOf('Acme Holdings')[0].style.getPropertyValue('--heat')).toBe('0.5')
  })

  it('picks out each client\'s top feature with more than a colour', async () => {
    renderPage()
    await screen.findByRole('table')

    const acme = cellsOf('Acme Holdings')
    expect(acme[1]).toHaveClass('pco-heat-top')
    expect(acme[1]).toHaveTextContent('★')
    expect(acme[1]).toHaveTextContent('(top feature)')
    expect(acme[0]).not.toHaveClass('pco-heat-top')
    expect(acme[2]).not.toHaveClass('pco-heat-top')

    expect(cellsOf('Midway Group')[0]).toHaveClass('pco-heat-top')
    expect(cellsOf('Midway Group')[1]).not.toHaveClass('pco-heat-top')
  })

  it('marks an empty cell as such', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(cellsOf('Zed Staffing')[2]).toHaveClass('pco-heat-zero')
    expect(cellsOf('Zed Staffing')[0]).not.toHaveClass('pco-heat-zero')
  })

  it('flags a suspended client in words', async () => {
    renderPage()
    await screen.findByRole('table')
    const mid = screen.getByRole('link', { name: 'Midway Group' }).closest('th')!
    expect(mid).toHaveTextContent('Suspended')
    expect(screen.getByRole('link', { name: 'Acme Holdings' }).closest('th')).not.toHaveTextContent('Suspended')
  })

  it('links each client to its page', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: 'Zed Staffing' })).toHaveAttribute('href', '/platform/clients/cli_zed')
  })

  it('shows the order the server sent until a header is clicked', async () => {
    renderPage()
    await screen.findByRole('table')
    for (const th of screen.getAllByRole('columnheader')) expect(th).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts by a feature, biggest first, then flips', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Resumes' }))
    expect(order()).toEqual(['Zed Staffing', 'Acme Holdings', 'Midway Group'])
    expect(screen.getByRole('columnheader', { name: /Resumes/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: /Jobs/ })).toHaveAttribute('aria-sort', 'none')

    await user.click(screen.getByRole('button', { name: /Resumes/ }))
    expect(order()).toEqual(['Midway Group', 'Acme Holdings', 'Zed Staffing'])
    expect(screen.getByRole('columnheader', { name: /Resumes/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts by each of the other columns', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Jobs' }))
    expect(order()).toEqual(['Midway Group', 'Acme Holdings', 'Zed Staffing'])

    await user.click(screen.getByRole('button', { name: 'Interviews' }))
    expect(order()).toEqual(['Acme Holdings', 'Midway Group', 'Zed Staffing'])

    await user.click(screen.getByRole('button', { name: 'Total' }))
    expect(order()).toEqual(['Zed Staffing', 'Acme Holdings', 'Midway Group'])
  })

  it('sorts the client names from A to Z first', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Client' }))
    expect(order()).toEqual(['Acme Holdings', 'Midway Group', 'Zed Staffing'])
    await user.click(screen.getByRole('button', { name: /Client/ }))
    expect(order()).toEqual(['Zed Staffing', 'Midway Group', 'Acme Holdings'])
  })

  it('keeps the shading where it was when the rows are re-sorted', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Resumes' }))
    expect(cellsOf('Zed Staffing')[1].getAttribute('data-heat')).toBe('1.00')
    expect(cellsOf('Acme Holdings')[1].getAttribute('data-heat')).toBe('0.20')
  })

  it('asks for the default window and offers 7, 30 and 90 days', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(usage).toHaveBeenLastCalledWith(30)
    expect(within(screen.getByRole('radiogroup', { name: 'Time window' })).getAllByRole('radio').map(r => r.textContent)).toEqual(['7 days', '30 days', '90 days'])
  })

  it('reloads for another window and keeps it in the URL', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(usage).toHaveBeenLastCalledWith(90))
    expect(screen.getByTestId('search')).toHaveTextContent('?window=90')
  })

  it('opens on the window named in the URL', async () => {
    renderPage('/platform/usage?window=7')
    await screen.findByRole('table')
    expect(usage).toHaveBeenLastCalledWith(7)
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
  })

  it('asks for a calendar month named in the URL and shows the dates the server reported for it', async () => {
    usage.mockResolvedValue({
      data: { ...USAGE, period: { kind: 'month', from: '2026-09-01T00:00:00+00:00', to: '2026-10-01T00:00:00+00:00' } },
    })
    renderPage('/platform/usage?month=2026-09')
    await screen.findByRole('table')

    expect(usage).toHaveBeenLastCalledWith({ month: '2026-09' })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-09-01 to 2026-10-01')
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
  })

  it('reloads for a month picked by the owner and keeps it in the URL', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2026-07' } })
    await waitFor(() => expect(usage).toHaveBeenLastCalledWith({ month: '2026-07' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?month=2026-07')
  })

  it('says so when there are no clients', async () => {
    const empty: UsageMatrix = { ...USAGE, rows: [] }
    usage.mockResolvedValue({ data: empty })
    renderPage()
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the server message on a failure and retries', async () => {
    const user = userEvent.setup({ delay: null })
    usage.mockRejectedValueOnce(httpError(403, 'Platform owners only.'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owners only.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('shows no subtitle or footnote', async () => {
    const { container } = renderPage()
    await screen.findByRole('table')
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})

describe('the time the figures were worked out', () => {
  it('shows As of with the time from computed_at, and a Refresh button', async () => {
    usage.mockResolvedValue({ data: { ...USAGE, computed_at: '2020-03-04T14:02:00Z' } })
    renderPage()
    expect(await screen.findByText(/^As of /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('asks for fresh figures once on Refresh', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    expect(usage).toHaveBeenLastCalledWith(30)

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2))
    expect(usage).toHaveBeenLastCalledWith(30, { refresh: true })

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(3))
    expect(usage).toHaveBeenLastCalledWith(7)
  })
})
