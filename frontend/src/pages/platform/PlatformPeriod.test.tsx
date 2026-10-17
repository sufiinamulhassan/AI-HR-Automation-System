import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { UsagePeriod } from '../../lib/platformTypes'
import { currentMonth, fmtPeriodEdge } from './format'
import { PeriodRange, PeriodSelect } from './PlatformUi'
import { usePlatformPeriod } from './usePlatformData'

function Harness({ onPeriodSeen, range }: { onPeriodSeen?: () => void; range?: UsagePeriod }) {
  const [period, setPeriod] = usePlatformPeriod()
  const [, setTick] = useState(0)
  useEffect(() => { onPeriodSeen?.() }, [period, onPeriodSeen])
  return (
    <>
      <PeriodSelect value={period} onChange={setPeriod} />
      <PeriodRange period={range} />
      <span data-testid="period">{JSON.stringify(period)}</span>
      <span data-testid="search">{useLocation().search}</span>
      <button onClick={() => setTick(t => t + 1)}>rerender</button>
    </>
  )
}

function renderAt(search = '', props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={[`/platform${search}`]}>
      <Harness {...props} />
    </MemoryRouter>,
  )
}

const period = () => JSON.parse(screen.getByTestId('period').textContent!)
const monthInput = () => screen.getByLabelText('Calendar month') as HTMLInputElement

describe('usePlatformPeriod', () => {
  it('is 30 days by default', () => {
    renderAt()
    expect(period()).toBe(30)
  })

  it.each([7, 30, 90])('reads a window of %i days from the URL', days => {
    renderAt(`?window=${days}`)
    expect(period()).toBe(days)
  })

  it('falls back to 30 days for a window the server does not offer', () => {
    renderAt('?window=45')
    expect(period()).toBe(30)
  })

  it('reads a calendar month from the URL', () => {
    renderAt('?month=2026-09')
    expect(period()).toEqual({ month: '2026-09' })
  })

  it.each(['2026-13', '2026-00', '2026-9', '26-09', 'september', '2026-09-01', ''])('does not take %j for a month', bad => {
    renderAt(`?month=${bad}`)
    expect(period()).toBe(30)
  })

  it('lets a month win when both are given, since the server takes only one', () => {
    renderAt('?window=7&month=2026-09')
    expect(period()).toEqual({ month: '2026-09' })
  })

  it('keeps a month in the URL as ?month= and a window as ?window=, and drops the default', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()

    await user.click(screen.getByRole('radio', { name: '90 days' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?window=90')

    fireEvent.change(monthInput(), { target: { value: '2026-08' } })
    expect(screen.getByTestId('search')).toHaveTextContent('?month=2026-08')
    expect(screen.getByTestId('search')).not.toHaveTextContent('window')

    await user.click(screen.getByRole('radio', { name: '30 days' }))
    expect(screen.getByTestId('search')).toBeEmptyDOMElement()
  })

  it('hands back the same value while the URL is unchanged, so a page does not fetch again', async () => {
    const user = userEvent.setup({ delay: null })
    const seen = vi.fn()
    renderAt('?month=2026-09', { onPeriodSeen: seen })
    expect(seen).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'rerender' }))
    await user.click(screen.getByRole('button', { name: 'rerender' }))
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('PeriodSelect', () => {
  it('offers 7, 30 and 90 days with the chosen one checked, and a month picker beside them', () => {
    renderAt('?window=7')
    const group = screen.getByRole('radiogroup', { name: 'Time window' })
    expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['7 days', '30 days', '90 days'])
    expect(within(group).getByRole('radio', { name: '7 days' })).toBeChecked()
    expect(monthInput()).toHaveAttribute('type', 'month')
    expect(monthInput()).toHaveValue('')
  })

  it('checks no window while a calendar month is chosen, and shows the month', () => {
    renderAt('?month=2026-09')
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
    expect(monthInput()).toHaveValue('2026-09')
  })

  it('drops the month when a window is chosen', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('?month=2026-09')

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    expect(period()).toBe(7)
    expect(monthInput()).toHaveValue('')
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
  })

  it('does not offer a month that has not begun', () => {
    renderAt()
    expect(monthInput()).toHaveAttribute('max', currentMonth())
    expect(currentMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })

  it('ignores a cleared month rather than asking for nothing', () => {
    renderAt('?month=2026-09')
    fireEvent.change(monthInput(), { target: { value: '' } })
    expect(period()).toEqual({ month: '2026-09' })
  })
})

describe('PeriodRange', () => {
  it('shows nothing when the server reported no period', () => {
    const { container } = renderAt()
    expect(container.querySelector('.pco-range')).toBeNull()
  })

  it('shows the dates the server reported', () => {
    renderAt('?month=2026-10', { range: { kind: 'month', from: '2026-10-01T00:00:00+00:00', to: '2026-11-01T00:00:00+00:00' } })
    const range = screen.getByLabelText('Period covered')
    expect(range).toHaveTextContent('2026-10-01 to 2026-11-01')
    const [from, to] = Array.from(range.querySelectorAll('time'))
    expect(from).toHaveAttribute('datetime', '2026-10-01T00:00:00+00:00')
    expect(to).toHaveAttribute('datetime', '2026-11-01T00:00:00+00:00')
  })

  it('shows the time of day, in UTC, for a rolling window that ends now', () => {
    renderAt('', { range: { kind: 'window', from: '2026-09-12T14:05:33Z', to: '2026-10-12T14:05:33Z' } })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-09-12 14:05 UTC to 2026-10-12 14:05 UTC')
  })
})

describe('fmtPeriodEdge', () => {
  it('writes midnight UTC as a date and any other time with its minute and UTC', () => {
    expect(fmtPeriodEdge('2026-10-01')).toBe('2026-10-01')
    expect(fmtPeriodEdge('2026-10-01T00:00:00Z')).toBe('2026-10-01')
    expect(fmtPeriodEdge('2026-10-01T09:07:00Z')).toBe('2026-10-01 09:07 UTC')
  })

  it('reads an offset as the UTC moment it names', () => {
    expect(fmtPeriodEdge('2026-10-01T02:00:00+02:00')).toBe('2026-10-01')
    expect(fmtPeriodEdge('2026-10-01T00:30:00+02:00')).toBe('2026-09-30 22:30 UTC')
  })

  it('returns what it cannot read exactly as it came', () => {
    expect(fmtPeriodEdge('not a date')).toBe('not a date')
    expect(fmtPeriodEdge('')).toBe('')
  })
})
