import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANS, clientRow, httpError } from '../../test/platformFixtures'

const listClients = vi.fn()
const createClient = vi.fn()
const plans = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: {
    listClients: (...a: unknown[]) => listClients(...a),
    createClient: (...a: unknown[]) => createClient(...a),
    plans: (...a: unknown[]) => plans(...a),
  },
}))

const { default: PlatformClientsPage } = await import('./PlatformClientsPage')

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/platform/clients']}>
      <Routes>
        <Route path="/platform/clients" element={<PlatformClientsPage />} />
        <Route path="/platform/clients/:clientId" element={<div>Client page</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const ROWS = [
  clientRow(),
  clientRow({
    client_id: 'cli_zed', name: 'Zed Staffing', slug: 'zed', contact_email: null, status: 'suspended',
    companies: 1, users: 9, ai_cost_usd: 1.5, email_cost_usd: 0.2, total_cost_usd: 1.7, usage: { jobs: 2 }, top_feature: { key: 'jobs', label: 'Jobs', count: 2 },
    last_active_at: null,
  }),
  clientRow({
    client_id: 'cli_new', name: 'Brand New Co', slug: 'brand-new', contact_email: 'hi@new.test',
    companies: 0, users: 0, ai_cost_usd: 0, email_cost_usd: 0, total_cost_usd: 0, usage: {}, top_feature: null, last_active_at: null,
  }),
]

const names = () => within(screen.getByRole('table')).getAllByRole('rowheader').map(h => h.querySelector('a')!.textContent)

beforeEach(() => {
  listClients.mockReset().mockResolvedValue({ data: { clients: ROWS } })
  createClient.mockReset()
  plans.mockReset().mockResolvedValue({ data: PLANS })
})

describe('PlatformClientsPage list', () => {
  it('shows a loading state, then one row per client with its numbers', async () => {
    let resolve!: (v: unknown) => void
    listClients.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the clients/i)

    resolve({ data: { clients: ROWS } })
    const table = await screen.findByRole('table')
    expect(screen.getByText('3 clients')).toBeInTheDocument()

    const acme = within(table).getByRole('link', { name: 'Acme Holdings' }).closest('tr')!
    expect(acme).toHaveTextContent('Active')
    expect(acme).toHaveTextContent('dana@acme.test')
    const cells = within(acme).getAllByRole('cell').map(c => c.textContent)
    expect(cells[1]).toBe('2')
    expect(cells[2]).toBe('18')
    expect(cells[3]).toBe('155')
    expect(cells[4]).toBe('$3.22')
    expect(cells[5]).toBe('-')
    expect(cells[6]).toBe('-')
    expect(cells[7]).toBe('Resumes140')
    expect(within(acme).getByText('Resumes').closest('.pco-chip')).not.toBeNull()
  })

  it('shows each client\'s total cost: the AI spend plus the email estimate, as its own dashboard does', async () => {
    renderPage()
    const zed = (await screen.findByRole('link', { name: 'Zed Staffing' })).closest('tr')!
    expect(within(zed).getAllByRole('cell')[4]).toHaveTextContent('$1.70')
    expect(within(zed).queryByText('$1.50')).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Total cost/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /AI spend/ })).not.toBeInTheDocument()
  })

  it('marks a suspended client with the word, not only a colour, and falls back to the slug', async () => {
    renderPage()
    const zed = (await screen.findByRole('link', { name: 'Zed Staffing' })).closest('tr')!
    expect(zed).toHaveTextContent('Suspended')
    expect(zed).toHaveTextContent('zed')
  })

  it('shows a dash where a client has no top feature', async () => {
    renderPage()
    const row = (await screen.findByRole('link', { name: 'Brand New Co' })).closest('tr')!
    expect(within(row).getAllByRole('cell').pop()).toHaveTextContent('-')
  })

  it('opens the client when its row is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = (await screen.findByRole('link', { name: 'Zed Staffing' })).closest('tr')!

    await user.click(within(row).getByText('Suspended'))
    expect(await screen.findByText('Client page')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/platform/clients/cli_zed')
  })

  it('opens the client from the name link too', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('link', { name: 'Acme Holdings' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/platform/clients/cli_acme')
  })

  it('asks for every client at first, with no filter', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(listClients).toHaveBeenCalledTimes(1)
    expect(listClients).toHaveBeenLastCalledWith(undefined)
  })

  it('searches on the server after a pause in typing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'zed')
    await waitFor(() => expect(listClients).toHaveBeenLastCalledWith({ search: 'zed' }))
    expect(listClients).toHaveBeenCalledTimes(2)
  })

  it('filters by status on the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'suspended')
    await waitFor(() => expect(listClients).toHaveBeenLastCalledWith({ status: 'suspended' }))

    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'z')
    await waitFor(() => expect(listClients).toHaveBeenLastCalledWith({ search: 'z', status: 'suspended' }))
  })

  it('says so when no client matches the filters', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    listClients.mockResolvedValue({ data: { clients: [] } })
    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'nothing')
    expect(await screen.findByText('No clients match these filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('invites the first client when there are none', async () => {
    listClients.mockResolvedValue({ data: { clients: [] } })
    renderPage()
    expect(await screen.findByText('No clients yet. Create the first one.')).toBeInTheDocument()
    expect(screen.getByText('0 clients')).toBeInTheDocument()
  })

  it('shows the server message on a failure and retries', async () => {
    const user = userEvent.setup()
    listClients.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries no detail', async () => {
    listClients.mockRejectedValue(new Error('Network Error'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the clients.')
  })
})

describe('PlatformClientsPage sorting', () => {
  it('keeps the server order until a header is clicked', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(names()).toEqual(['Acme Holdings', 'Zed Staffing', 'Brand New Co'])
    for (const th of screen.getAllByRole('columnheader')) expect(th).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts a name from A to Z, then back', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Client' }))
    expect(names()).toEqual(['Acme Holdings', 'Brand New Co', 'Zed Staffing'])
    expect(screen.getByRole('columnheader', { name: /Client/ })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: /Client/ }))
    expect(names()).toEqual(['Zed Staffing', 'Brand New Co', 'Acme Holdings'])
    expect(screen.getByRole('columnheader', { name: /Client/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts a count with the biggest first', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Users' }))
    expect(names()).toEqual(['Acme Holdings', 'Zed Staffing', 'Brand New Co'])
    await user.click(screen.getByRole('button', { name: /Users/ }))
    expect(names()).toEqual(['Brand New Co', 'Zed Staffing', 'Acme Holdings'])
  })

  it('sorts by activity and by total cost', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Activity' }))
    expect(names()).toEqual(['Acme Holdings', 'Zed Staffing', 'Brand New Co'])

    await user.click(screen.getByRole('button', { name: 'Total cost' }))
    expect(names()).toEqual(['Acme Holdings', 'Zed Staffing', 'Brand New Co'])
    await user.click(screen.getByRole('button', { name: /Total cost/ }))
    expect(names()).toEqual(['Brand New Co', 'Zed Staffing', 'Acme Holdings'])
  })
})

describe('PlatformClientsPage New client form', () => {
  async function openForm() {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'New client' }))
    const dialog = await screen.findByRole('dialog', { name: 'New client' })
    return { user, dialog }
  }

  it('opens a dialog with the client fields, and only offers the first company on request', async () => {
    const { user, dialog } = await openForm()

    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
    for (const label of ['Plan name', 'Max companies', 'Max users per company', 'Monthly AI budget (USD)', 'Contact name', 'Contact email', 'Notes']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(dialog).queryByLabelText('Administrator email')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: 'Create the first company now' }))
    for (const label of ['Company name', 'Company slug', 'Administrator name', 'Administrator email', 'Administrator password']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('refuses a blank name and sends nothing', async () => {
    const { user, dialog } = await openForm()

    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))
    expect(within(dialog).getByText("Enter the client's name.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('checks the contact email and the plan numbers', async () => {
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.type(within(dialog).getByLabelText('Contact email'), 'not-an-email')
    await user.type(within(dialog).getByLabelText('Max companies'), '0')
    await user.type(within(dialog).getByLabelText('Max users per company'), 'many')
    await user.type(within(dialog).getByLabelText('Monthly AI budget (USD)'), '-5')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Use a whole number, 1 or more.')).toHaveLength(2)
    expect(within(dialog).getByText('Use an amount of 0 or more.')).toBeInTheDocument()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('needs the first company\'s administrator once that section is on', async () => {
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Create the first company now' }))
    await user.type(within(dialog).getByLabelText('Administrator email'), 'sam@acme')
    await user.type(within(dialog).getByLabelText('Administrator password'), 'short')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(within(dialog).getByText("Enter the administrator's name.")).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('sends only the name when nothing else is filled in', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Solo' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), '  Solo  ')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    expect(createClient).toHaveBeenCalledWith({ name: 'Solo' })
  })

  it('sends the plan, the contact and the first company with its administrator', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Acme Holdings' }), company: null } })
    const { user, dialog } = await openForm()
    const type = (label: string, value: string) => user.type(within(dialog).getByLabelText(label), value)

    await type('Name', 'Acme Holdings')
    await type('Plan name', 'growth')
    await type('Max companies', '3')
    await type('Max users per company', '50')
    await type('Monthly AI budget (USD)', '100.5')
    await type('Contact name', 'Dana Reyes')
    await type('Contact email', 'dana@acme.test')
    await type('Notes', 'Pilot customer')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Create the first company now' }))
    await type('Company slug', 'acme-corp')
    await type('Administrator name', 'Sam Lee')
    await type('Administrator email', 'sam@acme.test')
    await type('Administrator password', 'S3cur3P@ssword!')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    expect(createClient).toHaveBeenCalledWith({
      name: 'Acme Holdings',
      plan: { name: 'growth', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 100.5 },
      contact_name: 'Dana Reyes',
      contact_email: 'dana@acme.test',
      notes: 'Pilot customer',
      company: {
        name: 'Acme Holdings',
        slug: 'acme-corp',
        admin: { name: 'Sam Lee', email: 'sam@acme.test', password: 'S3cur3P@ssword!' },
      },
    })
  })

  it('closes, says so, and reloads the list once the client is created', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Solo' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Solo')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(await screen.findByText('Client Solo created')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(listClients).toHaveBeenCalledTimes(2))
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    createClient.mockRejectedValue(httpError(409, 'That email address is already in use.'))
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Create the first company now' }))
    await user.type(within(dialog).getByLabelText('Administrator name'), 'Sam')
    await user.type(within(dialog).getByLabelText('Administrator email'), 'sam@acme.test')
    await user.type(within(dialog).getByLabelText('Administrator password'), 'S3cur3P@ssword!')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(await within(dialog).findByText('That email address is already in use.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create client' })).toBeEnabled()
  })

  it('shows the first message of a validation error from the server', async () => {
    createClient.mockRejectedValue(httpError(422, [{ msg: 'value is not a valid email address' }]))
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))
    expect(await within(dialog).findByText('value is not a valid email address')).toBeInTheDocument()
  })

  it('closes on Cancel and on Escape without sending anything', async () => {
    const { user, dialog } = await openForm()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New client' }))
    await screen.findByRole('dialog', { name: 'New client' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('PlatformClientsPage: inviting the first administrator', () => {
  async function fillClientWithCompany() {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'New client' }))
    const dialog = await screen.findByRole('dialog', { name: 'New client' })
    const type = (label: string, value: string) => user.type(within(dialog).getByLabelText(label), value)

    await type('Name', 'Acme Holdings')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Create the first company now' }))
    await type('Administrator name', 'Sam Lee')
    await type('Administrator email', 'sam@acme.test')
    return { user, dialog }
  }

  it('leaves the password out when the invitation is chosen, and says the invitation went', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ name: 'Acme Holdings' }), company: null, email_sent: true } })
    const { user, dialog } = await fillClientWithCompany()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    expect(within(dialog).queryByLabelText('Administrator password')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledWith({
      name: 'Acme Holdings',
      company: { name: 'Acme Holdings', admin: { name: 'Sam Lee', email: 'sam@acme.test' } },
    }))
    expect(await screen.findByText('Client Acme Holdings created, invitation sent')).toBeInTheDocument()
  })

  it('invites when the password is simply left blank', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ name: 'Acme Holdings' }), company: null, email_sent: true } })
    const { user, dialog } = await fillClientWithCompany()
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    expect(createClient.mock.calls[0][0].company.admin).toEqual({ name: 'Sam Lee', email: 'sam@acme.test' })
  })

  it('warns, and does not claim an email was sent, when the invitation did not leave', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ name: 'Acme Holdings' }), company: null, email_sent: false } })
    const { user, dialog } = await fillClientWithCompany()
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The account was created but the email could not be sent')
    expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(listClients).toHaveBeenCalledTimes(2))
  })

  it('has nothing to warn about when a password was given', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ name: 'Acme Holdings' }), company: null } })
    const { user, dialog } = await fillClientWithCompany()
    await user.type(within(dialog).getByLabelText('Administrator password'), 'S3cur3P@ssword!')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(await screen.findByText('Client Acme Holdings created')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has nothing to warn about when no company was asked for', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ name: 'Solo' }), company: null } })
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'New client' }))
    const dialog = await screen.findByRole('dialog', { name: 'New client' })
    await user.type(within(dialog).getByLabelText('Name'), 'Solo')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    expect(await screen.findByText('Client Solo created')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PlatformClientsPage: a suspension\'s reason and a deletion', () => {
  it('shows the reason under a suspended client\'s status, and none for an active one', async () => {
    listClients.mockResolvedValue({
      data: {
        clients: [
          clientRow({ suspended_reason: 'Stale' }),
          clientRow({ client_id: 'cli_zed', name: 'Zed Staffing', slug: 'zed', status: 'suspended', suspended_reason: 'Unpaid invoice' }),
        ],
      },
    })
    renderPage()
    const table = await screen.findByRole('table')

    expect(within(table).getByRole('link', { name: 'Zed Staffing' }).closest('tr')).toHaveTextContent('Unpaid invoice')
    expect(within(table).getByRole('link', { name: 'Acme Holdings' }).closest('tr')).not.toHaveTextContent('Stale')
  })

  it('says a client was deleted when the owner arrives from its page, once', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/platform/clients', state: { notice: 'Acme Holdings deleted' } }]}>
        <Routes>
          <Route path="/platform/clients" element={<PlatformClientsPage />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Acme Holdings deleted')).toBeInTheDocument()
    await screen.findByRole('table')
  })
})

describe('PlatformClientsPage New client plan', () => {
  async function openForm() {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'New client' }))
    const dialog = await screen.findByRole('dialog', { name: 'New client' })
    await within(dialog).findByLabelText('Tier')
    return { user, dialog }
  }

  it('offers a tier, storage, price, trial and the eight switches, all on', async () => {
    const { dialog } = await openForm()
    for (const label of ['Max storage per company (MB)', 'Monthly price (USD)', 'Trial ends']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(dialog).getAllByRole('checkbox').filter(c => c.closest('.pco-features'))).toHaveLength(8)
    for (const box of within(dialog).getAllByRole('checkbox').filter(c => c.closest('.pco-features'))) expect(box).toBeChecked()
  })

  it('fills the plan from a tier, and sends the tier with its values and switches', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Starter Co' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Starter Co')
    await user.selectOptions(within(dialog).getByLabelText('Tier'), 'starter')

    expect(within(dialog).getByLabelText('Max companies')).toHaveValue('1')
    expect(within(dialog).getByLabelText('Max storage per company (MB)')).toHaveValue('500')
    expect(within(dialog).getByLabelText('Monthly price (USD)')).toHaveValue('29')
    expect(within(dialog).getByRole('checkbox', { name: 'Webhooks' })).not.toBeChecked()

    await user.click(within(dialog).getByRole('checkbox', { name: 'Webhooks' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    const body = createClient.mock.calls[0][0]
    expect(body.name).toBe('Starter Co')
    expect(body.plan).toMatchObject({
      tier: 'starter', name: 'starter', max_companies: 1, max_users_per_company: 5, monthly_ai_budget_usd: 10,
      max_storage_mb: 500, price_monthly_usd: 29,
    })
    expect(body.plan.features).toMatchObject({ webhooks: true, coding: false })
  })

  it('sends a blank limit as null when a tier is chosen, so the preset does not win', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.selectOptions(within(dialog).getByLabelText('Tier'), 'starter')
    await user.clear(within(dialog).getByLabelText('Max users per company'))
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    expect(createClient.mock.calls[0][0].plan.max_users_per_company).toBeNull()
  })

  it('sends only the name when the tier and the switches were left alone', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Solo' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Solo')
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))
    await waitFor(() => expect(createClient).toHaveBeenCalledWith({ name: 'Solo' }))
  })

  it('sends a switch that was turned off, with the trial day and the storage', async () => {
    createClient.mockResolvedValue({ data: { client: clientRow({ client_id: 'cli_x', name: 'Acme' }), company: null } })
    const { user, dialog } = await openForm()
    await user.type(within(dialog).getByLabelText('Name'), 'Acme')
    await user.type(within(dialog).getByLabelText('Max storage per company (MB)'), '2000')
    fireEvent.change(within(dialog).getByLabelText('Trial ends'), { target: { value: '2026-11-30' } })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Custom domains' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create client' }))

    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1))
    const plan = createClient.mock.calls[0][0].plan
    expect(plan.max_storage_mb).toBe(2000)
    expect(plan.trial_ends_at).toBe('2026-11-30')
    expect(plan.features.custom_domain).toBe(false)
  })
})

describe('PlatformClientsPage storage and freshness', () => {
  it('shows storage used, with the cap each company has, or that there is none', async () => {
    listClients.mockResolvedValue({
      data: {
        clients: [
          clientRow({ storage_mb: 1200.5, storage_limit_mb: 2000 }),
          clientRow({ client_id: 'cli_zed', name: 'Zed Staffing', slug: 'zed', storage_mb: 12, storage_limit_mb: null }),
          clientRow({ client_id: 'cli_new', name: 'Brand New Co', slug: 'brand-new', storage_mb: null }),
        ],
      },
    })
    renderPage()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Storage/ })).toBeInTheDocument()
    const cell = (name: string) => {
      const tr = within(table).getByRole('link', { name }).closest('tr')!
      return within(tr).getAllByRole('cell')[5]
    }
    expect(cell('Acme Holdings')).toHaveTextContent('1,200.5 MBCap 2,000 MB each')
    expect(cell('Zed Staffing')).toHaveTextContent('12 MBNo cap')
    expect(cell('Brand New Co').textContent).toBe('-')
  })

  it('sorts by storage, biggest first, then smallest first', async () => {
    listClients.mockResolvedValue({
      data: {
        clients: [
          clientRow({ storage_mb: 100 }),
          clientRow({ client_id: 'cli_zed', name: 'Zed Staffing', slug: 'zed', storage_mb: 900 }),
          clientRow({ client_id: 'cli_new', name: 'Brand New Co', slug: 'brand-new', storage_mb: 5 }),
        ],
      },
    })
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: /Storage/ }))
    expect(names()).toEqual(['Zed Staffing', 'Acme Holdings', 'Brand New Co'])
    await user.click(screen.getByRole('button', { name: /Storage/ }))
    expect(names()).toEqual(['Brand New Co', 'Acme Holdings', 'Zed Staffing'])
  })

  it('shows As of from computed_at and asks for fresh figures once on Refresh', async () => {
    listClients.mockResolvedValue({ data: { clients: ROWS, computed_at: '2020-03-04T14:02:00Z' } })
    const user = userEvent.setup({ delay: null })
    renderPage()
    expect(await screen.findByText(/^As of /)).toBeInTheDocument()
    expect(listClients).toHaveBeenLastCalledWith(undefined)

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(listClients).toHaveBeenCalledTimes(2))
    expect(listClients).toHaveBeenLastCalledWith(undefined, { refresh: true })
  })

  it('keeps a search when it refreshes', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await screen.findByRole('table')
    await user.type(screen.getByLabelText('Search clients'), 'acme')
    await waitFor(() => expect(listClients).toHaveBeenLastCalledWith({ search: 'acme' }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(listClients).toHaveBeenLastCalledWith({ search: 'acme' }, { refresh: true }))
  })
})
