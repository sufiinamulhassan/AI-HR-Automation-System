import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingStatement } from '../../lib/platformTypes'
import { STATEMENT, clientRow, httpError } from '../../test/platformFixtures'

const billingStatement = vi.fn()
const billingStatementCsv = vi.fn()
const listClients = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: {
    billingStatement: (...a: unknown[]) => billingStatement(...a),
    billingStatementCsv: (...a: unknown[]) => billingStatementCsv(...a),
    listClients: (...a: unknown[]) => listClients(...a),
  },
}))

const { default: PlatformBillingPage } = await import('./PlatformBillingPage')
const { currentMonth } = await import('./format')

function Where() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderAt(path = '/platform/billing') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformBillingPage />
      <Where />
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const tableOf = (client: string) => screen.getByRole('heading', { name: client }).closest('section')!

beforeEach(() => {
  billingStatement.mockReset().mockResolvedValue({ data: STATEMENT })
  billingStatementCsv.mockReset().mockResolvedValue({ data: new Blob(['Client,Seats\n'], { type: 'text/csv' }) })
  listClients.mockReset().mockResolvedValue({
    data: { clients: [clientRow(), clientRow({ client_id: 'cli_zed', name: 'Zed Staffing', slug: 'zed' })] },
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('PlatformBillingPage', () => {
  it('reads the current month for every client by default', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(billingStatement).toHaveBeenCalledWith({ month: currentMonth() })
    expect(screen.getByLabelText('Client')).toHaveValue('')
    expect(screen.getByLabelText('Month')).toHaveValue(currentMonth())
    expect(screen.getByRole('heading', { level: 1, name: 'Billing statement' })).toBeInTheDocument()
  })

  it('shows a loading state first', async () => {
    let resolve!: (v: unknown) => void
    billingStatement.mockReturnValue(new Promise(r => { resolve = r }))
    renderAt()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the statement/i)
    resolve({ data: STATEMENT })
    expect(await screen.findByRole('heading', { name: 'Grand total' })).toBeInTheDocument()
  })

  it('shows one table per client with a line per company and a totals row', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })

    const acme = within(tableOf('Acme Holdings'))
    const lines = acme.getAllByRole('row')
    expect(lines).toHaveLength(4)
    expect(acme.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute('href', '/platform/companies/cmp_acme')
    const corp = acme.getByRole('link', { name: 'Acme Corp' }).closest('tr')!
    expect(within(corp).getAllByRole('cell').map(c => c.textContent)).toEqual(['Active', '12', '$2.50', '300', '50', '120.5 MB'])
    const labs = acme.getByRole('link', { name: 'Acme Labs' }).closest('tr')!
    expect(labs).toHaveTextContent('Suspended')
    const total = acme.getByText('Total').closest('tr')!
    expect(within(total).getAllByRole('cell').map(c => c.textContent)).toEqual(['2 companies', '18', '$3.22', '412', '80', '140.5 MB'])

    const zed = within(tableOf('Zed Staffing'))
    expect(zed.getByText('Total').closest('tr')).toHaveTextContent('1 company')
  })

  it('names the plan, its price and the subscription beside each client', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    const acme = tableOf('Acme Holdings')
    expect(within(acme).getByText('growth')).toBeInTheDocument()
    expect(within(acme).getByText('$99.00 a month')).toBeInTheDocument()
    expect(within(acme).getByText('Active', { selector: '.badge' })).toBeInTheDocument()
    expect(within(tableOf('Zed Staffing')).getByText('Trial', { selector: '.badge' })).toBeInTheDocument()
  })

  it('links each client to its own page', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(within(tableOf('Acme Holdings')).getByRole('link', { name: 'Acme Holdings' })).toHaveAttribute('href', '/platform/clients/cli_acme')
  })

  it('ends with a grand total row, and the sum of the monthly prices', async () => {
    renderAt()
    const grand = within((await screen.findByRole('heading', { name: 'Grand total' })).closest('section')!)
    const row = grand.getAllByRole('row')[1]
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['3', '22', '$4.72', '502', '90', '152.5 MB', '$128.00'])
    expect(grand.getByRole('columnheader', { name: 'Monthly price' })).toBeInTheDocument()
  })

  it('shows the period the server reported and when the statement was made', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-10-01 to 2026-11-01')
    expect(screen.getByText(/^Generated 2026-11-02 08:00 UTC$/)).toBeInTheDocument()
  })

  it('says there is nothing to bill for an empty month, with no grand total', async () => {
    billingStatement.mockResolvedValue({
      data: { ...STATEMENT, clients: [], totals: { ...STATEMENT.totals, companies: 0 } } as BillingStatement,
    })
    renderAt()
    expect(await screen.findByText('There is nothing to bill for this month.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Grand total' })).not.toBeInTheDocument()
  })

  it('shows a failed read with a retry that reads again', async () => {
    billingStatement.mockRejectedValueOnce(httpError(500, 'Billing is unavailable')).mockResolvedValueOnce({ data: STATEMENT })
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Billing is unavailable')
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Grand total' })).toBeInTheDocument()
  })
})

describe('choosing the client and the month', () => {
  it('lists every client, All clients first', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    await waitFor(() => expect(within(screen.getByLabelText('Client')).getAllByRole('option')).toHaveLength(3))
    expect(within(screen.getByLabelText('Client')).getAllByRole('option').map(o => o.textContent)).toEqual([
      'All clients', 'Acme Holdings', 'Zed Staffing',
    ])
  })

  it('reads one client, and keeps the choice in the address', async () => {
    const u = user()
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    await waitFor(() => expect(within(screen.getByLabelText('Client')).getAllByRole('option')).toHaveLength(3))
    await u.selectOptions(screen.getByLabelText('Client'), 'cli_zed')

    await waitFor(() => expect(billingStatement).toHaveBeenLastCalledWith({ month: currentMonth(), client_id: 'cli_zed' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?client=cli_zed')
  })

  it('reads another month, and keeps it in the address', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-09' } })

    await waitFor(() => expect(billingStatement).toHaveBeenLastCalledWith({ month: '2026-09' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?month=2026-09')
  })

  it('opens on the month and the client in the address', async () => {
    renderAt('/platform/billing?month=2026-08&client=cli_acme')
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(billingStatement).toHaveBeenCalledWith({ month: '2026-08', client_id: 'cli_acme' })
    expect(screen.getByLabelText('Month')).toHaveValue('2026-08')
  })

  it('falls back to this month for an address that is not a month', async () => {
    renderAt('/platform/billing?month=soon')
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(billingStatement).toHaveBeenCalledWith({ month: currentMonth() })
  })

  it('does not offer a month that has not happened', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(screen.getByLabelText('Month')).toHaveAttribute('max', currentMonth())
  })

  it('still works when the clients cannot be listed, with only All clients to choose', async () => {
    listClients.mockRejectedValue(httpError(500, 'Clients unavailable'))
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(within(screen.getByLabelText('Client')).getAllByRole('option')).toHaveLength(1)
  })
})

describe('Download CSV', () => {
  let anchors: { download: string; href: string }[]
  let created: Blob[]

  beforeEach(() => {
    anchors = []
    created = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => { created.push(b); return 'blob:statement' },
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push({ download: this.download, href: this.href })
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks for the same month as a file, as a blob request, and saves it as statement-YYYY-MM.csv', async () => {
    const u = user()
    renderAt('/platform/billing?month=2026-09')
    await screen.findByRole('heading', { name: 'Grand total' })
    await u.click(screen.getByRole('button', { name: 'Download CSV' }))

    await waitFor(() => expect(billingStatementCsv).toHaveBeenCalledWith({ month: '2026-09' }))
    await waitFor(() => expect(anchors).toEqual([{ download: 'statement-2026-09.csv', href: 'blob:statement' }]))
    expect(created).toHaveLength(1)
    expect(created[0]).toBeInstanceOf(Blob)
  })

  it('asks for the one client chosen', async () => {
    const u = user()
    renderAt('/platform/billing?month=2026-09&client=cli_zed')
    await screen.findByRole('heading', { name: 'Grand total' })
    await u.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(billingStatementCsv).toHaveBeenCalledWith({ month: '2026-09', client_id: 'cli_zed' }))
  })

  it('waits for the statement before it can be downloaded', async () => {
    billingStatement.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  it('shows the failure in the page and saves nothing', async () => {
    billingStatementCsv.mockRejectedValue(httpError(500, 'Export failed'))
    const u = user()
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    await u.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('Export failed')).toBeInTheDocument()
    expect(anchors).toEqual([])
  })

  it('says it could not download when the refusal is itself a file, as a blob request makes it', async () => {
    billingStatementCsv.mockRejectedValue({ response: { status: 500, data: new Blob(['{"detail":"x"}']) } })
    const u = user()
    renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    await u.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByText('Could not download the statement.')).toBeInTheDocument()
  })
})

describe('writing rules', () => {
  it('shows titles, labels and numbers only', async () => {
    const { container } = renderAt()
    await screen.findByRole('heading', { name: 'Grand total' })
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
