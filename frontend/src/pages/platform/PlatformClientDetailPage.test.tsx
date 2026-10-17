import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDetail } from '../../lib/platformTypes'
import { DETAIL, PLANS, clientRow, companyRow, httpError } from '../../test/platformFixtures'

const api = {
  setSubscription: vi.fn(),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
  plans: vi.fn(),
  getClient: vi.fn(),
  suspendClient: vi.fn(),
  activateClient: vi.fn(),
  suspendCompany: vi.fn(),
  activateCompany: vi.fn(),
  createCompany: vi.fn(),
  addAdmin: vi.fn(),
  resetAdminPassword: vi.fn(),
  updateCompany: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
}

vi.mock('../../lib/api', () => ({
  platformApi: {
    setSubscription: (...a: unknown[]) => api.setSubscription(...a),
    startCheckout: (...a: unknown[]) => api.startCheckout(...a),
    openBillingPortal: (...a: unknown[]) => api.openBillingPortal(...a),
    plans: (...a: unknown[]) => api.plans(...a),
    getClient: (...a: unknown[]) => api.getClient(...a),
    suspendClient: (...a: unknown[]) => api.suspendClient(...a),
    activateClient: (...a: unknown[]) => api.activateClient(...a),
    suspendCompany: (...a: unknown[]) => api.suspendCompany(...a),
    activateCompany: (...a: unknown[]) => api.activateCompany(...a),
    createCompany: (...a: unknown[]) => api.createCompany(...a),
    addAdmin: (...a: unknown[]) => api.addAdmin(...a),
    resetAdminPassword: (...a: unknown[]) => api.resetAdminPassword(...a),
    updateCompany: (...a: unknown[]) => api.updateCompany(...a),
    updateClient: (...a: unknown[]) => api.updateClient(...a),
    deleteClient: (...a: unknown[]) => api.deleteClient(...a),
  },
}))

const { default: PlatformClientDetailPage } = await import('./PlatformClientDetailPage')

function Where() {
  const { pathname, search, state } = useLocation()
  return <div data-testid="where">{pathname}{search}{state ? ` ${JSON.stringify(state)}` : ''}</div>
}

function renderPage(id = 'cli_acme', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/platform/clients/${id}${search}`]}>
      <Routes>
        <Route path="/platform/clients" element={<div>Client list</div>} />
        <Route path="/platform/clients/:clientId" element={<PlatformClientDetailPage />} />
        <Route path="/platform/companies/:companyId" element={<div>Company page</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const row = (name: RegExp) => screen.getByRole('rowheader', { name }).closest('tr')!

const EMPTY: ClientDetail = {
  client: clientRow({ companies: 0, users: 0, active_users: 0, ai_calls: 0, ai_cost_usd: 0, top_feature: null, usage: {} }),
  companies: [],
  features: [{ key: 'jobs', label: 'Jobs', total: 0, window: 0 }],
  cost_by_source: [],
  activity: [],
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.getClient.mockResolvedValue({ data: DETAIL })
  api.plans.mockResolvedValue({ data: PLANS })
})

describe('PlatformClientDetailPage', () => {
  it('loads the client by the id in the URL, with a loading state first', async () => {
    let resolve!: (v: unknown) => void
    api.getClient.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the client/i)

    resolve({ data: DETAIL })
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })).toBeInTheDocument()
    expect(api.getClient).toHaveBeenCalledWith('cli_acme', 30)
  })

  it('shows the header: status, plan, contact and a link back to the list', async () => {
    renderPage()
    const title = await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })
    const header = title.parentElement!

    expect(within(header).getByText('Active')).toBeInTheDocument()
    expect(within(header).getByText('growth')).toBeInTheDocument()
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dana@acme.test' })).toHaveAttribute('href', 'mailto:dana@acme.test')
    expect(screen.getByRole('link', { name: 'All clients' })).toHaveAttribute('href', '/platform/clients')
  })

  it('shows the client totals', async () => {
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Companies').parentElement).toHaveTextContent('2')
    expect(within(totals).getByText('Users').parentElement).toHaveTextContent('18')
    expect(within(totals).getByText('Total cost').parentElement).toHaveTextContent('$3.22')
    expect(within(totals).getByText('AI spend').parentElement).toHaveTextContent('$3.22')
    expect(within(totals).getByText('Email (estimated)').parentElement).toHaveTextContent('$0.00')
    expect(within(totals).getByText('Last active').parentElement).toHaveTextContent('-')
  })

  it('lists the companies with status, users, administrators and SSO domains', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    const corp = row(/Acme Corp/)
    expect(corp).toHaveTextContent('/acme-corp')
    expect(corp).toHaveTextContent('SSO: acme.test')
    expect(corp).toHaveTextContent('Active')
    expect(corp).toHaveTextContent('8 / 12')
    expect(corp).toHaveTextContent('sam@acme.test')

    const labs = row(/Acme Labs/)
    expect(labs).toHaveTextContent('Suspended')
    expect(labs).not.toHaveTextContent('SSO:')
  })

  it('shows feature usage, cost by source and daily activity', async () => {
    renderPage()
    const features = (await screen.findByRole('heading', { name: 'Feature usage' })).closest('section')!
    expect(within(features).getByRole('img', { name: 'Resumes: 60 recently, 140 in total' })).toBeInTheDocument()
    expect(within(features).getByRole('img', { name: 'Jobs: 2 recently, 6 in total' })).toBeInTheDocument()

    const cost = screen.getByRole('heading', { name: 'Cost by source' }).closest('section')!
    expect(within(cost).getByText('resume parse')).toBeInTheDocument()
    expect(within(cost).getByRole('img', { name: 'resume parse: $2.90 over 380 calls' })).toBeInTheDocument()
    expect(within(cost).getByText('interview eval')).toBeInTheDocument()

    const activity = screen.getByRole('heading', { name: 'Daily activity' }).closest('section')!
    expect(within(activity).getByRole('img', { name: /3 days: 36 events in all\. The busiest day was 8 Oct with 20/ })).toBeInTheDocument()
  })

  it('has an empty state for each section with nothing in it', async () => {
    api.getClient.mockResolvedValue({ data: EMPTY })
    renderPage()

    expect(await screen.findByText('This client has no companies yet.')).toBeInTheDocument()
    expect(screen.getByText('No feature has been used yet.')).toBeInTheDocument()
    expect(screen.getByText('No AI spend yet.')).toBeInTheDocument()
    expect(screen.getByText('No activity in this period.')).toBeInTheDocument()
  })

  it('says so when the client does not exist', async () => {
    api.getClient.mockRejectedValue(httpError(404, 'Client not found'))
    renderPage('cli_gone')
    expect(await screen.findByText('This client does not exist.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the server message on any other failure, and retries', async () => {
    const u = user()
    api.getClient.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })).toBeInTheDocument()
  })

  it('shows no subtitle or footnote under its titles', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})

describe('suspending and activating the client', () => {
  it('asks first, and does nothing if the owner cancels', async () => {
    const u = user()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend client' }))

    const dialog = screen.getByRole('dialog', { name: 'Suspend Acme Holdings?' })
    expect(dialog).toHaveTextContent(/every company under this client stops working/i)

    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.suspendClient).not.toHaveBeenCalled()
  })

  it('suspends with the reason typed, then reloads and says so', async () => {
    const u = user()
    api.suspendClient.mockResolvedValue({ data: { client: clientRow({ status: 'suspended' }) } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend client' }))

    const dialog = screen.getByRole('dialog', { name: 'Suspend Acme Holdings?' })
    await u.type(within(dialog).getByLabelText('Reason'), '  Unpaid invoice ')
    await u.click(within(dialog).getByRole('button', { name: 'Suspend client' }))

    await waitFor(() => expect(api.suspendClient).toHaveBeenCalledWith('cli_acme', 'Unpaid invoice'))
    expect(await screen.findByText('Acme Holdings suspended')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getClient).toHaveBeenCalledTimes(2))
  })

  it('will not suspend without a reason, nor with a blank one', async () => {
    const u = user()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend client' }))
    const dialog = screen.getByRole('dialog')

    await u.click(within(dialog).getByRole('button', { name: 'Suspend client' }))
    expect(within(dialog).getByText('Enter a reason.')).toBeInTheDocument()
    await u.type(within(dialog).getByLabelText('Reason'), '   ')
    await u.click(within(dialog).getByRole('button', { name: 'Suspend client' }))
    expect(within(dialog).getByText('Enter a reason.')).toBeInTheDocument()
    expect(api.suspendClient).not.toHaveBeenCalled()
  })

  it('takes at most 500 characters of reason', async () => {
    const u = user()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend client' }))
    const box = within(screen.getByRole('dialog')).getByLabelText('Reason')

    expect(box).toHaveAttribute('maxlength', '500')
    await u.click(box)
    await u.paste('x'.repeat(520))
    expect((box as HTMLTextAreaElement).value).toHaveLength(500)
  })

  it('keeps the dialog open with the server message when suspending fails', async () => {
    const u = user()
    api.suspendClient.mockRejectedValue(httpError(500, 'Could not reach the database'))
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend client' }))
    const dialog = screen.getByRole('dialog')
    await u.type(within(dialog).getByLabelText('Reason'), 'Unpaid')
    await u.click(within(dialog).getByRole('button', { name: 'Suspend client' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the database')
    expect(within(dialog).getByRole('button', { name: 'Suspend client' })).toBeEnabled()
  })

  it('offers Activate for a suspended client, with no reason field', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: { ...DETAIL, client: clientRow({ status: 'suspended' }) } })
    api.activateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Activate client' }))

    const dialog = screen.getByRole('dialog', { name: 'Activate Acme Holdings?' })
    expect(within(dialog).queryByLabelText('Reason')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await u.click(within(dialog).getByRole('button', { name: 'Activate client' }))

    await waitFor(() => expect(api.activateClient).toHaveBeenCalledWith('cli_acme'))
    expect(await screen.findByText('Acme Holdings activated')).toBeInTheDocument()
  })
})

describe('companies', () => {
  it('copies a company\'s sign-in link, which names the company, and says so', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Copy sign-in link' }))

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/login?company=acme-corp`)
    expect(await screen.findByText('Sign-in link for Acme Corp copied')).toBeInTheDocument()
  })

  it('copies each company\'s own link, suspended or not', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    await u.click(within(row(/Acme Labs/)).getByRole('button', { name: 'Copy sign-in link' }))
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/login?company=acme-labs`)
    expect(await screen.findByText('Sign-in link for Acme Labs copied')).toBeInTheDocument()
  })

  it('encodes a slug that is not URL-safe', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: { ...DETAIL, companies: [companyRow({ slug: 'a b&c' })] } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    await u.click(screen.getByRole('button', { name: 'Copy sign-in link' }))
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/login?company=a%20b%26c`)
  })

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    const u = user()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    try {
      renderPage()
      await screen.findByRole('heading', { name: 'Companies' })

      await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Copy sign-in link' }))
      expect(await screen.findByText(`Could not copy. The link is ${window.location.origin}/login?company=acme-corp`)).toBeInTheDocument()
      expect(screen.queryByText('Sign-in link for Acme Corp copied')).not.toBeInTheDocument()
    } finally {
      write.mockRestore()
    }
  })

  it('suspends a company after a confirmation', async () => {
    const u = user()
    api.suspendCompany.mockResolvedValue({ data: { company: companyRow({ status: 'suspended' }) } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Suspend' }))
    const dialog = screen.getByRole('dialog', { name: 'Suspend Acme Corp?' })
    expect(api.suspendCompany).not.toHaveBeenCalled()

    await u.click(within(dialog).getByRole('button', { name: 'Suspend company' }))
    expect(within(dialog).getByText('Enter a reason.')).toBeInTheDocument()
    expect(api.suspendCompany).not.toHaveBeenCalled()

    await u.type(within(dialog).getByLabelText('Reason'), ' Contract ended ')
    await u.click(within(dialog).getByRole('button', { name: 'Suspend company' }))

    await waitFor(() => expect(api.suspendCompany).toHaveBeenCalledWith('cmp_acme', 'Contract ended'))
    expect(await screen.findByText('Acme Corp suspended')).toBeInTheDocument()
  })

  it('activates a suspended company', async () => {
    const u = user()
    api.activateCompany.mockResolvedValue({ data: { company: companyRow({ company_id: 'cmp_labs' }) } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    await u.click(within(row(/Acme Labs/)).getByRole('button', { name: 'Activate' }))
    await u.click(within(screen.getByRole('dialog', { name: 'Activate Acme Labs?' })).getByRole('button', { name: 'Activate company' }))
    await waitFor(() => expect(api.activateCompany).toHaveBeenCalledWith('cmp_labs'))
  })

  it('adds a company with its first administrator', async () => {
    const u = user()
    api.createCompany.mockResolvedValue({ data: { company: companyRow({ company_id: 'cmp_new', name: 'Acme East' }) } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Add company' }))
    const dialog = screen.getByRole('dialog', { name: 'Add company' })

    await u.click(within(dialog).getByRole('button', { name: 'Create company' }))
    expect(within(dialog).getByText("Enter the company's name.")).toBeInTheDocument()
    expect(api.createCompany).not.toHaveBeenCalled()

    await u.type(within(dialog).getByLabelText('Company name'), 'Acme East')
    await u.type(within(dialog).getByLabelText('Administrator name'), 'Eve Park')
    await u.type(within(dialog).getByLabelText('Administrator email'), 'eve@acme.test')
    await u.type(within(dialog).getByLabelText('Administrator password'), 'S3cur3P@ssword!')
    await u.click(within(dialog).getByRole('button', { name: 'Create company' }))

    await waitFor(() => expect(api.createCompany).toHaveBeenCalledWith('cli_acme', {
      name: 'Acme East',
      admin: { name: 'Eve Park', email: 'eve@acme.test', password: 'S3cur3P@ssword!' },
    }))
    expect(await screen.findByText('Company Acme East created')).toBeInTheDocument()
  })

  it('adds an administrator to a company', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' } } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Add admin' }))
    const dialog = screen.getByRole('dialog', { name: 'Add administrator to Acme Corp' })

    await u.type(within(dialog).getByLabelText('Administrator email'), 'eve@acme')
    await u.type(within(dialog).getByLabelText('Administrator password'), 'short')
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))
    expect(within(dialog).getByText("Enter the administrator's name.")).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(api.addAdmin).not.toHaveBeenCalled()

    await u.type(within(dialog).getByLabelText('Administrator name'), 'Eve Park')
    await u.type(within(dialog).getByLabelText('Administrator email'), '.test')
    await u.clear(within(dialog).getByLabelText('Administrator password'))
    await u.type(within(dialog).getByLabelText('Administrator password'), 'S3cur3P@ssword!')
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))

    await waitFor(() => expect(api.addAdmin).toHaveBeenCalledWith('cmp_acme', {
      name: 'Eve Park', email: 'eve@acme.test', password: 'S3cur3P@ssword!',
    }))
    expect(await screen.findByText('Administrator added to Acme Corp')).toBeInTheDocument()
  })

  it('resets the chosen administrator\'s password', async () => {
    const u = user()
    api.getClient.mockResolvedValue({
      data: {
        ...DETAIL,
        companies: [companyRow({ admins: [{ email: 'sam@acme.test', name: 'Sam Lee' }, { email: 'eve@acme.test', name: 'Eve Park' }] })],
      },
    })
    api.resetAdminPassword.mockResolvedValue({ data: {} })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Reset password' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset a password in Acme Corp' })

    await u.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    expect(within(dialog).getByText('Enter a password.')).toBeInTheDocument()
    expect(api.resetAdminPassword).not.toHaveBeenCalled()

    await u.selectOptions(within(dialog).getByLabelText('Administrator'), 'eve@acme.test')
    await u.type(within(dialog).getByLabelText('New password'), 'N3w-passw0rd')
    await u.click(within(dialog).getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(api.resetAdminPassword).toHaveBeenCalledWith('cmp_acme', 'eve@acme.test', 'N3w-passw0rd'))
    expect(await screen.findByText('Password reset for eve@acme.test')).toBeInTheDocument()
  })

  it('has nobody to reset in a company with no administrators', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Labs/)).getByRole('button', { name: 'Reset password' }))

    const dialog = screen.getByRole('dialog', { name: 'Reset a password in Acme Labs' })
    expect(dialog).toHaveTextContent('This company has no administrators. Add one first.')
    expect(within(dialog).queryByLabelText('New password')).not.toBeInTheDocument()
    await u.click(within(dialog).getAllByRole('button', { name: 'Close' })[1])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edits the SSO domains: normalised, de-duplicated and sent as a list', async () => {
    const u = user()
    api.updateCompany.mockResolvedValue({ data: { company: companyRow() } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'SSO domains' }))
    const dialog = screen.getByRole('dialog', { name: 'SSO domains for Acme Corp' })

    const box = within(dialog).getByLabelText('Domains')
    expect(box).toHaveValue('acme.test')
    await u.clear(box)
    await u.type(box, 'ACME.test, @Other.com{Enter}acme.test')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))

    await waitFor(() => expect(api.updateCompany).toHaveBeenCalledWith('cmp_acme', { sso_domains: ['acme.test', 'other.com'] }))
    expect(await screen.findByText('SSO domains saved for Acme Corp')).toBeInTheDocument()
  })

  it('refuses a domain that is not a hostname', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'SSO domains' }))
    const dialog = screen.getByRole('dialog')

    const box = within(dialog).getByLabelText('Domains')
    await u.clear(box)
    await u.type(box, 'not a domain!')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))
    expect(within(dialog).getByText('not is not a valid domain.')).toBeInTheDocument()
    expect(api.updateCompany).not.toHaveBeenCalled()
  })

  it('shows the 409 message when another company already claims a domain', async () => {
    const u = user()
    api.updateCompany.mockRejectedValue(httpError(409, 'acme.test is already used by another company.'))
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'SSO domains' }))
    const dialog = screen.getByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))

    expect(await within(dialog).findByText('acme.test is already used by another company.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('allows clearing every domain', async () => {
    const u = user()
    api.updateCompany.mockResolvedValue({ data: { company: companyRow() } })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'SSO domains' }))
    const dialog = screen.getByRole('dialog')
    await u.clear(within(dialog).getByLabelText('Domains'))
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))
    await waitFor(() => expect(api.updateCompany).toHaveBeenCalledWith('cmp_acme', { sso_domains: [] }))
  })
})

describe('the period', () => {
  it('asks for 30 days by default and offers a calendar month beside the windows', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })

    expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', 30)
    expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked()
    expect(screen.getByLabelText('Calendar month')).toHaveValue('')
  })

  it('reloads for another window and keeps it in the URL', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })

    await u.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', 90))
    expect(screen.getByTestId('where')).toHaveTextContent('?window=90')
  })

  it('reads a month from the URL and shows the dates the server reported for it', async () => {
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, period: { kind: 'month', from: '2026-09-01T00:00:00+00:00', to: '2026-10-01T00:00:00+00:00' } },
    })
    renderPage('cli_acme', '?month=2026-09')
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })

    expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', { month: '2026-09' })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-09-01 to 2026-10-01')
    expect(screen.getByLabelText('Calendar month')).toHaveValue('2026-09')
  })

  it('reloads for a month the owner picks', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })

    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2026-08' } })
    await waitFor(() => expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', { month: '2026-08' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?month=2026-08')
  })
})

describe('editing the client', () => {
  async function openEdit(u: ReturnType<typeof user>) {
    await u.click(await screen.findByRole('button', { name: 'Edit client' }))
    return screen.getByRole('dialog', { name: 'Edit Acme Holdings' })
  }

  it('starts from what the client has now, and says a blank limit is unlimited', async () => {
    renderPage()
    const dialog = await openEdit(user())

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Acme Holdings')
    expect(within(dialog).getByLabelText('Plan name')).toHaveValue('growth')
    expect(within(dialog).getByLabelText('Max companies')).toHaveValue('')
    expect(within(dialog).getByLabelText('Max users per company')).toHaveValue('')
    expect(within(dialog).getByLabelText('Monthly AI budget (USD)')).toHaveValue('')
    expect(within(dialog).getByLabelText('Contact name')).toHaveValue('Dana Reyes')
    expect(within(dialog).getByLabelText('Contact email')).toHaveValue('dana@acme.test')
    expect(within(dialog).getAllByText('Blank is unlimited.')).toHaveLength(4)
  })

  it('shows the limits the plan already has', async () => {
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, client: clientRow({ plan: { name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120.5 } }) },
    })
    renderPage()
    const dialog = await openEdit(user())

    expect(within(dialog).getByLabelText('Max companies')).toHaveValue('3')
    expect(within(dialog).getByLabelText('Max users per company')).toHaveValue('50')
    expect(within(dialog).getByLabelText('Monthly AI budget (USD)')).toHaveValue('120.5')
  })

  it('sends only the plan, whole, when only a plan limit changed, then reloads and says so', async () => {
    const u = user()
    api.updateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    const dialog = await openEdit(u)

    await u.type(within(dialog).getByLabelText('Max users per company'), '40')
    await u.type(within(dialog).getByLabelText('Monthly AI budget (USD)'), '100.5')
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.updateClient).toHaveBeenCalledWith('cli_acme', {
      plan: { name: 'growth', max_companies: null, max_users_per_company: 40, monthly_ai_budget_usd: 100.5 },
    }))
    expect(await screen.findByText('Acme Holdings updated')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getClient).toHaveBeenCalledTimes(2))
  })

  it('sends a limit that was cleared as null, which is how the plan says unlimited', async () => {
    const u = user()
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, client: clientRow({ plan: { name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120 } }) },
    })
    api.updateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    const dialog = await openEdit(u)

    await u.clear(within(dialog).getByLabelText('Max users per company'))
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.updateClient).toHaveBeenCalledWith('cli_acme', {
      plan: { name: 'scale', max_companies: 3, max_users_per_company: null, monthly_ai_budget_usd: 120 },
    }))
  })

  it('sends a new name trimmed, and a cleared contact as an empty string', async () => {
    const u = user()
    api.updateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    const dialog = await openEdit(u)

    const name = within(dialog).getByLabelText('Name')
    await u.clear(name)
    await u.type(name, '  Acme Group ')
    await u.clear(within(dialog).getByLabelText('Contact name'))
    await u.type(within(dialog).getByLabelText('Notes'), ' Pilot account ')
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.updateClient).toHaveBeenCalledWith('cli_acme', {
      name: 'Acme Group', contact_name: '', notes: 'Pilot account',
    }))
    expect(await screen.findByText('Acme Group updated')).toBeInTheDocument()
  })

  it('checks the fields before asking the server', async () => {
    const u = user()
    renderPage()
    const dialog = await openEdit(u)

    await u.clear(within(dialog).getByLabelText('Name'))
    await u.type(within(dialog).getByLabelText('Max companies'), '0')
    await u.type(within(dialog).getByLabelText('Max users per company'), '1.5')
    await u.type(within(dialog).getByLabelText('Monthly AI budget (USD)'), '-3')
    await u.clear(within(dialog).getByLabelText('Contact email'))
    await u.type(within(dialog).getByLabelText('Contact email'), 'dana@')
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByText("Enter the client's name.")).toBeInTheDocument()
    expect(within(dialog).getAllByText('Use a whole number, 1 or more.')).toHaveLength(2)
    expect(within(dialog).getByText('Use an amount of 0 or more.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(api.updateClient).not.toHaveBeenCalled()
  })

  it('closes without a request when nothing was changed', async () => {
    const u = user()
    renderPage()
    const dialog = await openEdit(u)

    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.updateClient).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the server message when saving fails', async () => {
    const u = user()
    api.updateClient.mockRejectedValue(httpError(422, 'contact_email is not a valid email address'))
    renderPage()
    const dialog = await openEdit(u)

    await u.type(within(dialog).getByLabelText('Notes'), 'x')
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('contact_email is not a valid email address')
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })
})

describe('deleting the client', () => {
  it('is not offered while it has companies', async () => {
    renderPage()
    const button = await screen.findByRole('button', { name: 'Delete client' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Delete its companies first.')
  })

  it('makes the owner type the slug before the red button works, then deletes and goes back to the list', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: EMPTY })
    api.deleteClient.mockResolvedValue({ data: {} })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Delete client' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete Acme Holdings?' })
    expect(dialog).toHaveTextContent(/permanently deletes the client/i)
    const confirm = within(dialog).getByRole('button', { name: 'Delete client' })
    expect(confirm).toBeDisabled()

    const slug = within(dialog).getByLabelText('Type acme-holdings to confirm')
    await u.type(slug, 'acme-holding')
    expect(confirm).toBeDisabled()
    await u.type(slug, 's')
    expect(confirm).toBeEnabled()
    await u.click(confirm)

    await waitFor(() => expect(api.deleteClient).toHaveBeenCalledWith('cli_acme', 'acme-holdings'))
    expect(await screen.findByText('Client list')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/platform/clients {"notice":"Acme Holdings deleted"}')
  })

  it('shows the server refusal and stays', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: EMPTY })
    api.deleteClient.mockRejectedValue(httpError(409, 'This client still has companies.'))
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Delete client' }))
    const dialog = screen.getByRole('dialog')
    await u.type(within(dialog).getByLabelText('Type acme-holdings to confirm'), 'acme-holdings')
    await u.click(within(dialog).getByRole('button', { name: 'Delete client' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This client still has companies.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does nothing when the owner cancels', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: EMPTY })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Delete client' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.deleteClient).not.toHaveBeenCalled()
  })
})

describe('a suspension\'s reason', () => {
  it('shows the reason on the client for as long as it is suspended', async () => {
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, client: clientRow({ status: 'suspended', suspended_reason: 'Unpaid invoice' }) },
    })
    renderPage()
    expect(await screen.findByText('Suspended: Unpaid invoice')).toBeInTheDocument()
  })

  it('shows none on an active client, whatever an old record still carries', async () => {
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, client: clientRow({ status: 'active', suspended_reason: 'Old reason' }) },
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Acme Holdings' })
    expect(screen.queryByText(/Old reason/)).not.toBeInTheDocument()
  })

  it('shows the reason on a suspended company\'s row, and none on an active one', async () => {
    api.getClient.mockResolvedValue({
      data: {
        ...DETAIL,
        companies: [
          companyRow({ suspended_reason: 'Stale' }),
          companyRow({ company_id: 'cmp_labs', name: 'Acme Labs', slug: 'acme-labs', status: 'suspended', suspended_reason: 'Contract ended' }),
        ],
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    expect(row(/Acme Labs/).closest('tr')).toHaveTextContent('Contract ended')
    expect(row(/Acme Corp/)).not.toHaveTextContent('Stale')
  })
})

describe('inviting an administrator', () => {
  const NOT_SENT = 'The account was created but the email could not be sent'

  async function openAddAdmin(u: ReturnType<typeof user>) {
    await screen.findByRole('heading', { name: 'Companies' })
    await u.click(within(row(/Acme Corp/)).getByRole('button', { name: 'Add admin' }))
    return screen.getByRole('dialog', { name: 'Add administrator to Acme Corp' })
  }

  async function fillNames(u: ReturnType<typeof user>, dialog: HTMLElement) {
    await u.type(within(dialog).getByLabelText('Administrator name'), 'Eve Park')
    await u.type(within(dialog).getByLabelText('Administrator email'), 'eve@acme.test')
  }

  it('hides the password and sends none when the invitation is chosen', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' }, email_sent: true } })
    renderPage()
    const dialog = await openAddAdmin(u)

    await fillNames(u, dialog)
    await u.type(within(dialog).getByLabelText('Administrator password'), 'typed-first-123')
    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    expect(within(dialog).queryByLabelText('Administrator password')).not.toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))

    await waitFor(() => expect(api.addAdmin).toHaveBeenCalledWith('cmp_acme', { name: 'Eve Park', email: 'eve@acme.test' }))
    expect(await screen.findByText('Invitation sent to eve@acme.test')).toBeInTheDocument()
  })

  it('invites when the password is simply left blank, and says the field is optional', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' }, email_sent: true } })
    renderPage()
    const dialog = await openAddAdmin(u)

    expect(within(dialog).getByLabelText('Administrator password')).toHaveAccessibleDescription('Optional. Leave blank to send an invitation email.')
    await fillNames(u, dialog)
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))

    await waitFor(() => expect(api.addAdmin).toHaveBeenCalledWith('cmp_acme', { name: 'Eve Park', email: 'eve@acme.test' }))
  })

  it('warns, and does not claim an email was sent, when the invitation did not leave', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' }, email_sent: false } })
    renderPage()
    const dialog = await openAddAdmin(u)

    await fillNames(u, dialog)
    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT)
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getClient).toHaveBeenCalledTimes(2))
  })

  it('does not take a missing email_sent for a sent email', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' } } })
    renderPage()
    const dialog = await openAddAdmin(u)

    await fillNames(u, dialog)
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT)
  })

  it('does not check a password that will not be sent', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'eve@acme.test', name: 'Eve Park' }, email_sent: true } })
    renderPage()
    const dialog = await openAddAdmin(u)

    await fillNames(u, dialog)
    await u.type(within(dialog).getByLabelText('Administrator password'), 'short')
    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))
    await waitFor(() => expect(api.addAdmin).toHaveBeenCalledTimes(1))
  })

  it('invites the first administrator of a new company too', async () => {
    const u = user()
    api.createCompany.mockResolvedValue({ data: { company: companyRow({ company_id: 'cmp_new', name: 'Acme East' }), email_sent: true } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Add company' }))
    const dialog = screen.getByRole('dialog', { name: 'Add company' })

    await u.type(within(dialog).getByLabelText('Company name'), 'Acme East')
    await fillNames(u, dialog)
    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await u.click(within(dialog).getByRole('button', { name: 'Create company' }))

    await waitFor(() => expect(api.createCompany).toHaveBeenCalledWith('cli_acme', {
      name: 'Acme East',
      admin: { name: 'Eve Park', email: 'eve@acme.test' },
    }))
    expect(await screen.findByText('Company Acme East created, invitation sent to eve@acme.test')).toBeInTheDocument()
  })

  it('warns when the first administrator\'s invitation did not leave', async () => {
    const u = user()
    api.createCompany.mockResolvedValue({ data: { company: companyRow(), email_sent: false } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Add company' }))
    const dialog = screen.getByRole('dialog', { name: 'Add company' })

    await u.type(within(dialog).getByLabelText('Company name'), 'Acme East')
    await fillNames(u, dialog)
    await u.click(within(dialog).getByRole('button', { name: 'Create company' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT)
  })

  it('checks the name and email even when no password is asked for', async () => {
    const u = user()
    renderPage()
    const dialog = await openAddAdmin(u)

    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))
    expect(within(dialog).getByText("Enter the administrator's name.")).toBeInTheDocument()
    expect(within(dialog).getByText("Enter the administrator's email.")).toBeInTheDocument()
    expect(api.addAdmin).not.toHaveBeenCalled()
  })
})

describe('linking to a company', () => {
  it('links each company\'s name to its own page', async () => {
    const u = user()
    renderPage()
    await screen.findByRole('heading', { name: 'Companies' })

    const link = within(row(/Acme Labs/)).getByRole('link', { name: 'Acme Labs' })
    expect(link).toHaveAttribute('href', '/platform/companies/cmp_labs')
    await u.click(link)
    expect(await screen.findByText('Company page')).toBeInTheDocument()
  })
})

describe('arriving after something was deleted', () => {
  it('says so once, then clears the note so a reload does not repeat it', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/platform/clients/cli_acme', state: { notice: 'Acme Corp deleted' } }]}>
        <Routes>
          <Route path="/platform/clients/:clientId" element={<PlatformClientDetailPage />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Acme Corp deleted')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/platform\/clients\/cli_acme$/))
  })
})

describe('editing the plan: tiers, storage, price, trial and features', () => {
  async function openEdit(u: ReturnType<typeof user>) {
    await u.click(await screen.findByRole('button', { name: 'Edit client' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Acme Holdings' })
    await within(dialog).findByLabelText('Tier')
    return dialog
  }
  const FEATURE_LABELS = [
    'Coding assessments', 'Performance reviews', 'Webhooks', 'Workflow rules', 'Custom SMTP',
    'OIDC single sign-on', 'Custom domains', 'Integrations',
  ]

  it('offers the tiers the server lists, with Custom first', async () => {
    renderPage()
    const dialog = await openEdit(user())
    const options = within(within(dialog).getByLabelText('Tier')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Custom', 'Standard', 'Starter', 'Growth'])
    expect(api.plans).toHaveBeenCalledTimes(1)
  })

  it('shows the eight features by the server labels, every one on for a plan that names none', async () => {
    renderPage()
    const dialog = await openEdit(user())
    for (const label of FEATURE_LABELS) expect(within(dialog).getByRole('checkbox', { name: label })).toBeChecked()
  })

  it('shows a feature the plan has switched off as off', async () => {
    api.getClient.mockResolvedValue({
      data: { ...DETAIL, client: clientRow({ plan: { name: 'growth', features: { webhooks: false } } }) },
    })
    renderPage()
    const dialog = await openEdit(user())
    expect(within(dialog).getByRole('checkbox', { name: 'Webhooks' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Coding assessments' })).toBeChecked()
  })

  it('shows the storage, price and trial day the plan already has', async () => {
    api.getClient.mockResolvedValue({
      data: {
        ...DETAIL,
        client: clientRow({ plan: { name: 'scale', max_storage_mb: 4000, price_monthly_usd: 199, trial_ends_at: '2026-11-30T23:59:59+00:00' } }),
      },
    })
    renderPage()
    const dialog = await openEdit(user())
    expect(within(dialog).getByLabelText('Max storage per company (MB)')).toHaveValue('4000')
    expect(within(dialog).getByLabelText('Monthly price (USD)')).toHaveValue('199')
    expect(within(dialog).getByLabelText('Trial ends')).toHaveValue('2026-11-30')
  })

  it('fills the fields and the switches from a chosen tier, and lets them be changed after', async () => {
    const u = user()
    renderPage()
    const dialog = await openEdit(u)

    await u.selectOptions(within(dialog).getByLabelText('Tier'), 'growth')
    expect(within(dialog).getByLabelText('Plan name')).toHaveValue('growth')
    expect(within(dialog).getByLabelText('Max companies')).toHaveValue('3')
    expect(within(dialog).getByLabelText('Max users per company')).toHaveValue('25')
    expect(within(dialog).getByLabelText('Monthly AI budget (USD)')).toHaveValue('50')
    expect(within(dialog).getByLabelText('Max storage per company (MB)')).toHaveValue('5000')
    expect(within(dialog).getByLabelText('Monthly price (USD)')).toHaveValue('99')
    expect(within(dialog).getByRole('checkbox', { name: 'OIDC single sign-on' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Custom domains' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Coding assessments' })).toBeChecked()

    await u.clear(within(dialog).getByLabelText('Max users per company'))
    await u.type(within(dialog).getByLabelText('Max users per company'), '40')
    expect(within(dialog).getByLabelText('Max users per company')).toHaveValue('40')
  })

  it('sends the tier with every value over it, and every switch, when saved', async () => {
    const u = user()
    api.updateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    const dialog = await openEdit(u)
    await u.selectOptions(within(dialog).getByLabelText('Tier'), 'growth')
    await u.click(within(dialog).getByRole('checkbox', { name: 'Webhooks' }))
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.updateClient).toHaveBeenCalledTimes(1))
    const [id, patch] = api.updateClient.mock.calls[0]
    expect(id).toBe('cli_acme')
    expect(patch.plan).toMatchObject({
      tier: 'growth', name: 'growth', max_companies: 3, max_users_per_company: 25, monthly_ai_budget_usd: 50,
      max_storage_mb: 5000, price_monthly_usd: 99,
    })
    expect(patch.plan.features).toEqual({
      coding: true, performance: true, webhooks: false, workflows: true, custom_smtp: true,
      oidc_sso: false, custom_domain: false, integrations: true,
    })
  })

  it('sends a feature switched off, and the trial day as a bare date', async () => {
    const u = user()
    api.updateClient.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    const dialog = await openEdit(u)
    await u.click(within(dialog).getByRole('checkbox', { name: 'Integrations' }))
    fireEvent.change(within(dialog).getByLabelText('Trial ends'), { target: { value: '2026-12-15' } })
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.updateClient).toHaveBeenCalledTimes(1))
    const plan = api.updateClient.mock.calls[0][1].plan
    expect(plan.trial_ends_at).toBe('2026-12-15')
    expect(plan.features).toEqual({ integrations: false })
  })

  it('sends nothing when only the tier list was looked at', async () => {
    const u = user()
    renderPage()
    const dialog = await openEdit(u)
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(api.updateClient).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('checks storage, price and the trial day before asking the server', async () => {
    const u = user()
    renderPage()
    const dialog = await openEdit(u)
    await u.type(within(dialog).getByLabelText('Max storage per company (MB)'), '0')
    await u.type(within(dialog).getByLabelText('Monthly price (USD)'), '-4')
    await u.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getAllByText('Use a whole number, 1 or more.').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getAllByText('Use an amount of 0 or more.').length).toBeGreaterThanOrEqual(1)
    expect(api.updateClient).not.toHaveBeenCalled()
  })

  it('still lets the limits be set by hand, with the known switches, when the tiers cannot be read', async () => {
    api.plans.mockRejectedValue(httpError(500, 'Plans unavailable'))
    const u = user()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Edit client' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Acme Holdings' })

    expect(await within(dialog).findByText('Could not load the plan tiers. Set the limits by hand.')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Tier')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Max companies')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('checkbox').length).toBeGreaterThanOrEqual(8)
  })
})

describe('billing', () => {
  const SUB = { status: 'trialing', provider: 'manual', customer_id: null, subscription_id: null, current_period_end: '2026-12-01T00:00:00Z', cancel_at_period_end: false }
  const card = async () => (await screen.findByRole('heading', { name: 'Billing' })).closest('section')!
  const withSub = (sub: object | null, plan: object = { name: 'growth', trial_ends_at: '2026-11-30T23:59:59Z' }) => ({
    data: { ...DETAIL, client: clientRow({ plan, subscription: sub as never }) },
  })

  it('shows the status as a chip, the provider, the trial end and the period end', async () => {
    api.getClient.mockResolvedValue(withSub(SUB))
    renderPage()
    const c = within(await card())
    expect(c.getByText('Trial')).toHaveClass('badge')
    expect(c.getByText('Provider').nextElementSibling).toHaveTextContent('Manual')
    expect(c.getByText('Trial ends').nextElementSibling).not.toHaveTextContent('-')
    expect(c.getByText('Current period ends').nextElementSibling).not.toHaveTextContent('-')
  })

  it('says there is no subscription for a client without one, and dashes the dates', async () => {
    api.getClient.mockResolvedValue(withSub(null, { name: 'growth' }))
    renderPage()
    const c = within(await card())
    expect(c.getByText('No subscription')).toBeInTheDocument()
    expect(c.getByText('Trial ends').nextElementSibling).toHaveTextContent('-')
    expect(c.getByText('Provider').nextElementSibling).toHaveTextContent('-')
  })

  it.each([
    ['active', 'Active'], ['past_due', 'Past due'], ['canceled', 'Canceled'], ['trialing', 'Trial'], ['none', 'No subscription'],
  ])('names %s as %s', async (status, label) => {
    api.getClient.mockResolvedValue(withSub({ ...SUB, status }))
    renderPage()
    expect(within(await card()).getByText(label)).toBeInTheDocument()
  })

  it('says the subscription ends at the end of the period when it is set to', async () => {
    api.getClient.mockResolvedValue(withSub({ ...SUB, status: 'active', cancel_at_period_end: true }))
    renderPage()
    expect(within(await card()).getByText('Cancels at the end of the period')).toBeInTheDocument()
  })

  it('changes the status by hand, with the provider, and reloads', async () => {
    const u = user()
    api.getClient.mockResolvedValue(withSub(SUB))
    api.setSubscription.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    await u.click(within(await card()).getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog', { name: 'Change status of Acme Holdings' })
    await u.selectOptions(within(dialog).getByLabelText('Status'), 'active')
    await u.click(within(dialog).getByRole('button', { name: 'Save status' }))

    await waitFor(() => expect(api.setSubscription).toHaveBeenCalledWith('cli_acme', { status: 'active', provider: 'manual' }))
    expect(await screen.findByText('Subscription of Acme Holdings is now active')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getClient).toHaveBeenCalledTimes(2))
  })

  it('asks for the trial end only while the status is Trial, and sends it as a date', async () => {
    const u = user()
    api.getClient.mockResolvedValue(withSub(null, { name: 'growth' }))
    api.setSubscription.mockResolvedValue({ data: { client: clientRow() } })
    renderPage()
    await u.click(within(await card()).getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog', { name: 'Change status of Acme Holdings' })

    expect(within(dialog).queryByLabelText('Trial ends')).not.toBeInTheDocument()
    await u.selectOptions(within(dialog).getByLabelText('Status'), 'trialing')
    fireEvent.change(within(dialog).getByLabelText('Trial ends'), { target: { value: '2026-12-15' } })
    await u.selectOptions(within(dialog).getByLabelText('Billing'), 'stripe')
    await u.click(within(dialog).getByRole('button', { name: 'Save status' }))

    await waitFor(() => expect(api.setSubscription).toHaveBeenCalledWith('cli_acme', {
      status: 'trialing', provider: 'stripe', trial_ends_at: '2026-12-15',
    }))
  })

  it('keeps the dialog open with the server sentence when the change is refused', async () => {
    const u = user()
    api.getClient.mockResolvedValue(withSub(SUB))
    api.setSubscription.mockRejectedValue(httpError(422, 'That status is not allowed.'))
    renderPage()
    await u.click(within(await card()).getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog', { name: 'Change status of Acme Holdings' })
    await u.click(within(dialog).getByRole('button', { name: 'Save status' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That status is not allowed.')
  })

  describe('with Stripe', () => {
    let assign: ReturnType<typeof vi.fn>
    beforeEach(() => {
      assign = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' })
      api.getClient.mockResolvedValue(withSub(SUB))
    })
    afterEach(() => { vi.unstubAllGlobals() })

    it('opens the address Stripe returns for a checkout', async () => {
      const u = user()
      api.startCheckout.mockResolvedValue({ data: { url: 'https://checkout.stripe.test/c/pay_1' } })
      renderPage()
      await u.click(within(await card()).getByRole('button', { name: 'Start Stripe checkout' }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay_1'))
      expect(api.startCheckout).toHaveBeenCalledWith('cli_acme')
    })

    it('opens the billing portal address', async () => {
      const u = user()
      api.openBillingPortal.mockResolvedValue({ data: { url: 'https://billing.stripe.test/p/session_1' } })
      renderPage()
      await u.click(within(await card()).getByRole('button', { name: 'Open billing portal' }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.test/p/session_1'))
      expect(api.openBillingPortal).toHaveBeenCalledWith('cli_acme')
    })

    it('does not follow an address that is not https', async () => {
      const u = user()
      api.startCheckout.mockResolvedValue({ data: { url: 'javascript:alert(1)' } })
      renderPage()
      await u.click(within(await card()).getByRole('button', { name: 'Start Stripe checkout' }))
      expect(await screen.findByText('Stripe sent an address that cannot be opened.')).toBeInTheDocument()
      expect(assign).not.toHaveBeenCalled()
    })

    it('disables both buttons and says Stripe is not configured after a 503', async () => {
      const u = user()
      api.startCheckout.mockRejectedValue(httpError(503, 'Stripe is not configured.'))
      renderPage()
      const c = within(await card())
      await u.click(c.getByRole('button', { name: 'Start Stripe checkout' }))

      expect(await c.findByText('Stripe is not configured.')).toBeInTheDocument()
      expect(c.getByRole('button', { name: 'Start Stripe checkout' })).toBeDisabled()
      expect(c.getByRole('button', { name: 'Open billing portal' })).toBeDisabled()
      expect(c.getByRole('button', { name: 'Change status' })).toBeEnabled()
      expect(assign).not.toHaveBeenCalled()
    })

    it('shows the 409 for a portal before any checkout, and keeps the buttons', async () => {
      const u = user()
      api.openBillingPortal.mockRejectedValue(httpError(409, 'This client has not started a checkout yet.'))
      renderPage()
      const c = within(await card())
      await u.click(c.getByRole('button', { name: 'Open billing portal' }))
      expect(await c.findByRole('alert')).toHaveTextContent('This client has not started a checkout yet.')
      expect(c.getByRole('button', { name: 'Open billing portal' })).toBeEnabled()
    })

    it('shows the 422 for a tier with no price', async () => {
      const u = user()
      api.startCheckout.mockRejectedValue(httpError(422, 'No price is set for this tier.'))
      renderPage()
      const c = within(await card())
      await u.click(c.getByRole('button', { name: 'Start Stripe checkout' }))
      expect(await c.findByRole('alert')).toHaveTextContent('No price is set for this tier.')
    })
  })
})

describe('storage, and the time the figures were worked out', () => {
  it('shows storage among the totals and in the companies table', async () => {
    api.getClient.mockResolvedValue({
      data: {
        ...DETAIL,
        client: clientRow({ storage_mb: 140.5, storage_limit_mb: 2000 }),
        companies: [companyRow({ storage_mb: 120.5, storage_limit_mb: 2000 }), companyRow({ company_id: 'cmp_labs', name: 'Acme Labs', slug: 'acme-labs', storage_mb: null })],
      },
    })
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Storage').parentElement).toHaveTextContent('140.5 MB')
    expect(row(/Acme Corp/)).toHaveTextContent('120.5 / 2,000 MB')
    expect(row(/Acme Labs/)).not.toHaveTextContent('MB')
  })

  it('shows when the figures were worked out and asks for fresh ones once on Refresh', async () => {
    const u = user()
    api.getClient.mockResolvedValue({ data: { ...DETAIL, computed_at: '2020-03-04T14:02:00Z' } })
    renderPage()
    expect(await screen.findByText(/^As of /)).toBeInTheDocument()
    expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', 30)

    await u.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.getClient).toHaveBeenCalledTimes(2))
    expect(api.getClient).toHaveBeenLastCalledWith('cli_acme', 30, { refresh: true })
  })
})
