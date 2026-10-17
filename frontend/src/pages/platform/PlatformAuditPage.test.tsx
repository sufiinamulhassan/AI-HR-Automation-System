import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformActivityRow } from '../../lib/platformTypes'
import { httpError } from '../../test/platformFixtures'

const audit = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: { audit: (...a: unknown[]) => audit(...a) },
}))

const { default: PlatformAuditPage } = await import('./PlatformAuditPage')

const row = (over: Partial<PlatformActivityRow> = {}): PlatformActivityRow => ({
  at: '2026-10-08T14:02:11Z',
  action: 'client_suspend',
  actor_email: 'owner@hirely.test',
  resource_type: 'client',
  resource_id: 'cli_acme',
  details: { name: 'Acme Holdings', reason: 'Unpaid invoice' },
  ...over,
})

const NEWER = [
  row(),
  row({ at: '2026-10-07T09:00:00Z', action: 'company_delete', resource_type: 'company', resource_id: 'cmp_old', details: null }),
]
const OLDER = [
  row({ at: '2026-10-01T08:00:00Z', action: 'owner_create', actor_email: null, resource_type: null, resource_id: null, details: { email: 'new@hirely.test', nested: { a: 1 }, empty: '' } }),
]

const user = () => userEvent.setup({ delay: null })
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

beforeEach(() => {
  audit.mockReset().mockResolvedValue({ data: { entries: NEWER, next_before: '2026-10-07T09:00:00Z' } })
})

describe('PlatformAuditPage', () => {
  it('shows a loading state, then the newest page, asking for 50', async () => {
    let resolve!: (v: unknown) => void
    audit.mockReturnValue(new Promise(r => { resolve = r }))
    render(<PlatformAuditPage />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading the audit log/i)

    resolve({ data: { entries: NEWER, next_before: null } })
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith({ limit: 50 })
    expect(screen.getByRole('heading', { level: 1, name: 'Platform audit' })).toBeInTheDocument()
  })

  it('shows what happened, who did it, to what, and the details', async () => {
    render(<PlatformAuditPage />)
    await screen.findByRole('table')

    const [first, second] = bodyRows()
    expect(first).toHaveTextContent('Client suspend')
    expect(first).toHaveTextContent('owner@hirely.test')
    expect(first).toHaveTextContent('client cli_acme')
    expect(first).toHaveTextContent('name: Acme Holdings, reason: Unpaid invoice')
    expect(first.querySelector('time')).toHaveAttribute('datetime', '2026-10-08T14:02:11Z')

    expect(second).toHaveTextContent('Company delete')
    expect(within(second).getAllByRole('cell').pop()).toHaveTextContent('-')
  })

  it('offers Load older while the server has given a cursor', async () => {
    render(<PlatformAuditPage />)
    await screen.findByRole('table')
    expect(screen.getByRole('button', { name: 'Load older' })).toBeEnabled()
  })

  it('has no Load older when the newest page is also the last', async () => {
    audit.mockResolvedValue({ data: { entries: NEWER, next_before: null } })
    render(<PlatformAuditPage />)
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument()
  })

  it('asks for the page before the cursor and adds it below, keeping what is shown', async () => {
    const u = user()
    audit
      .mockResolvedValueOnce({ data: { entries: NEWER, next_before: '2026-10-07T09:00:00Z' } })
      .mockResolvedValueOnce({ data: { entries: OLDER, next_before: null } })
    render(<PlatformAuditPage />)
    await screen.findByRole('table')

    await u.click(screen.getByRole('button', { name: 'Load older' }))

    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(audit).toHaveBeenLastCalledWith({ limit: 50, before: '2026-10-07T09:00:00Z' })
    expect(bodyRows()[0]).toHaveTextContent('Client suspend')
    expect(bodyRows()[2]).toHaveTextContent('Owner create')
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument()
  })

  it('follows one cursor after another through several pages', async () => {
    const u = user()
    audit
      .mockResolvedValueOnce({ data: { entries: [NEWER[0]], next_before: 'c1' } })
      .mockResolvedValueOnce({ data: { entries: [NEWER[1]], next_before: 'c2' } })
      .mockResolvedValueOnce({ data: { entries: OLDER, next_before: null } })
    render(<PlatformAuditPage />)
    await screen.findByRole('table')

    await u.click(screen.getByRole('button', { name: 'Load older' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    await u.click(screen.getByRole('button', { name: 'Load older' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(3))

    expect(audit.mock.calls.map(c => c[0])).toEqual([{ limit: 50 }, { limit: 50, before: 'c1' }, { limit: 50, before: 'c2' }])
  })

  it('writes a nested detail as JSON and leaves empty details out', async () => {
    const u = user()
    audit
      .mockResolvedValueOnce({ data: { entries: NEWER, next_before: 'c1' } })
      .mockResolvedValueOnce({ data: { entries: OLDER, next_before: null } })
    render(<PlatformAuditPage />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Load older' }))

    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    const last = bodyRows()[2]
    expect(last).toHaveTextContent('email: new@hirely.test, nested: {"a":1}')
    expect(last).not.toHaveTextContent('empty')
    const cells = within(last).getAllByRole('cell').map(c => c.textContent)
    expect(cells[1]).toBe('-')
    expect(cells[2]).toBe('-')
  })

  it('waits while older entries load and cannot ask twice', async () => {
    const u = user()
    let resolve!: (v: unknown) => void
    audit
      .mockResolvedValueOnce({ data: { entries: NEWER, next_before: 'c1' } })
      .mockReturnValueOnce(new Promise(r => { resolve = r }))
    render(<PlatformAuditPage />)
    await screen.findByRole('table')

    await u.click(screen.getByRole('button', { name: 'Load older' }))
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    expect(bodyRows()).toHaveLength(2)

    resolve({ data: { entries: OLDER, next_before: null } })
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(audit).toHaveBeenCalledTimes(2)
  })

  it('keeps the entries and says so when older ones cannot be loaded, then tries again', async () => {
    const u = user()
    audit
      .mockResolvedValueOnce({ data: { entries: NEWER, next_before: 'c1' } })
      .mockRejectedValueOnce(httpError(500, 'Database unavailable'))
      .mockResolvedValueOnce({ data: { entries: OLDER, next_before: null } })
    render(<PlatformAuditPage />)
    await screen.findByRole('table')

    await u.click(screen.getByRole('button', { name: 'Load older' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(bodyRows()).toHaveLength(2)

    await u.click(screen.getByRole('button', { name: 'Load older' }))
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(audit).toHaveBeenLastCalledWith({ limit: 50, before: 'c1' })
  })

  it('has an empty state', async () => {
    audit.mockResolvedValue({ data: { entries: [], next_before: null } })
    render(<PlatformAuditPage />)
    expect(await screen.findByText('Nothing has been recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the server message when the first page cannot be read, and retries', async () => {
    const u = user()
    audit.mockRejectedValueOnce(httpError(403, 'Platform owners only.'))
    render(<PlatformAuditPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owners only.')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries none', async () => {
    audit.mockRejectedValue(new Error('Network Error'))
    render(<PlatformAuditPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit log.')
  })

  it('shows no subtitle or footnote under its title', async () => {
    const { container } = render(<PlatformAuditPage />)
    await screen.findByRole('table')
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})
