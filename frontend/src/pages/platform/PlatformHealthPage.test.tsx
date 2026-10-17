import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformHealth } from '../../lib/platformTypes'
import { HEALTH, httpError } from '../../test/platformFixtures'

const health = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: { health: (...a: unknown[]) => health(...a) },
}))

const { default: PlatformHealthPage } = await import('./PlatformHealthPage')

function renderPage() {
  return render(
    <MemoryRouter>
      <PlatformHealthPage />
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const tile = (label: string) => screen.getByText(label).closest('.pco-kpi') as HTMLElement
const loaded = () => screen.findByRole('heading', { name: 'Scheduled jobs' })

const QUIET: PlatformHealth = { ...HEALTH, cron: [], failed_emails_24h: [] }

beforeEach(() => {
  health.mockReset().mockResolvedValue({ data: HEALTH })
})

describe('PlatformHealthPage', () => {
  it('shows a loading state, then the report', async () => {
    let resolve!: (v: unknown) => void
    health.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the health checks/i)

    resolve({ data: HEALTH })
    await loaded()
    expect(screen.getByRole('heading', { level: 1, name: 'Platform health' })).toBeInTheDocument()
    expect(health).toHaveBeenCalledTimes(1)
  })

  it('shows MongoDB with its latency, email with its provider, and Pinecone', async () => {
    renderPage()
    await loaded()

    expect(tile('MongoDB')).toHaveTextContent('Connected')
    expect(tile('MongoDB')).toHaveTextContent('12 ms')
    expect(tile('Email')).toHaveTextContent('Configured')
    expect(tile('Email')).toHaveTextContent('smtp')
    expect(tile('Pinecone')).toHaveTextContent('Not configured')
  })

  it('says MongoDB is unreachable, with no latency, when the ping failed', async () => {
    health.mockResolvedValue({ data: { ...HEALTH, mongo: { ok: false, latency_ms: null } } })
    renderPage()
    await loaded()

    expect(tile('MongoDB')).toHaveTextContent('Unreachable')
    expect(tile('MongoDB')).not.toHaveTextContent('ms')
    expect(tile('MongoDB').querySelector('.badge-red')).not.toBeNull()
  })

  it('colours a working service green and a missing one red, and says the word as well', async () => {
    renderPage()
    await loaded()
    expect(tile('MongoDB').querySelector('.badge-green')).toHaveTextContent('Connected')
    expect(tile('Pinecone').querySelector('.badge-red')).toHaveTextContent('Not configured')
  })

  it('says email is not configured, with no provider named', async () => {
    health.mockResolvedValue({ data: { ...HEALTH, email: { configured: false, provider: null } } })
    renderPage()
    await loaded()
    expect(tile('Email')).toHaveTextContent('Not configured')
  })

  it('lists the scheduled jobs: last run, status, companies served and the detail', async () => {
    renderPage()
    const section = (await loaded()).closest('section')!
    const rows = within(section).getAllByRole('row')

    const digest = rows.find(r => r.textContent!.includes('Daily digest'))!
    expect(digest).toHaveTextContent('Ok')
    expect(digest).toHaveTextContent('5 of 6')
    expect(digest).toHaveTextContent('1 failed')
    expect(digest).toHaveTextContent('Sent 12 digests')
    expect(within(digest).getByText('Ok').closest('.badge')).toHaveClass('badge-green')
    expect(digest.querySelector('time')).toHaveAttribute('datetime', '2026-10-11T06:00:00Z')
  })

  it('says a job that has never run has never run, and invents no numbers for it', async () => {
    renderPage()
    const section = (await loaded()).closest('section')!
    const never = within(section).getAllByRole('row').find(r => r.textContent!.includes('Purge expired jobs'))!

    expect(never).toHaveTextContent('Never')
    expect(never).not.toHaveTextContent('failed')
    expect(never).not.toHaveTextContent(' of ')
  })

  it('marks a failed or partial run in red', async () => {
    health.mockResolvedValue({
      data: {
        ...HEALTH,
        cron: [{ ...HEALTH.cron[0], status: 'failed', companies_failed: 0 }, { ...HEALTH.cron[0], key: 'weekly_report', status: 'partial' }],
      },
    })
    renderPage()
    const section = (await loaded()).closest('section')!
    expect(within(section).getByText('Failed').closest('.badge')).toHaveClass('badge-red')
    expect(within(section).getByText('Partial').closest('.badge')).toHaveClass('badge-red')
  })

  it('shows a status it does not know as it is, in neutral grey', async () => {
    health.mockResolvedValue({ data: { ...HEALTH, cron: [{ ...HEALTH.cron[0], status: 'skipped' }] } })
    renderPage()
    const section = (await loaded()).closest('section')!
    expect(within(section).getByText('Skipped').closest('.badge')).toHaveClass('badge-gray')
  })

  it('lists failed email by company with a link to the company', async () => {
    renderPage()
    const section = (await screen.findByRole('heading', { name: 'Failed emails, last 24 hours' })).closest('section')!

    const acme = within(section).getByRole('link', { name: 'Acme Corp' })
    expect(acme).toHaveAttribute('href', '/platform/companies/cmp_acme')
    expect(acme.closest('tr')).toHaveTextContent('Acme Holdings')
    expect(acme.closest('tr')).toHaveTextContent('4')
    expect(within(section).getByRole('link', { name: 'Zed Staffing' })).toHaveAttribute('href', '/platform/companies/cmp_zed')
  })

  it('has an empty state for each table with nothing in it', async () => {
    health.mockResolvedValue({ data: QUIET })
    renderPage()
    await loaded()

    expect(screen.getByText('No scheduled job has run yet.')).toBeInTheDocument()
    expect(screen.getByText('No email failed in the last 24 hours.')).toBeInTheDocument()
  })

  it('reads it all again on Refresh, and waits while it does', async () => {
    const u = user()
    renderPage()
    await loaded()

    let resolve!: (v: unknown) => void
    health.mockReturnValue(new Promise(r => { resolve = r }))
    await u.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Scheduled jobs' })).toBeInTheDocument()

    resolve({ data: { ...HEALTH, mongo: { ok: true, latency_ms: 99 } } })
    await waitFor(() => expect(tile('MongoDB')).toHaveTextContent('99 ms'))
    expect(health).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('shows the server message when it cannot be read, and retries', async () => {
    const u = user()
    health.mockRejectedValueOnce(httpError(403, 'Platform owners only.'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owners only.')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await loaded()).toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries none', async () => {
    health.mockRejectedValue(new Error('Network Error'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the platform health.')
  })

  it('keeps the old report and says so when a refresh fails', async () => {
    const u = user()
    renderPage()
    await loaded()

    health.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    await u.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('heading', { name: 'Scheduled jobs' })).toBeInTheDocument()
  })

  it('shows no subtitle or footnote under its titles', async () => {
    const { container } = renderPage()
    await loaded()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})
