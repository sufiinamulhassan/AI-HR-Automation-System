import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyDetail } from '../../lib/platformTypes'
import { COMPANY_AI, COMPANY_DETAIL, companyRow, httpError } from '../../test/platformFixtures'

const api = {
  getDomains: vi.fn(),
  setDomains: vi.fn(),
  getCompany: vi.fn(),
  updateCompany: vi.fn(),
  suspendCompany: vi.fn(),
  activateCompany: vi.fn(),
  addAdmin: vi.fn(),
  resetAdminPassword: vi.fn(),
  deleteCompany: vi.fn(),
}

vi.mock('../../lib/api', () => ({
  platformApi: {
    getDomains: (...a: unknown[]) => api.getDomains(...a),
    setDomains: (...a: unknown[]) => api.setDomains(...a),
    getCompany: (...a: unknown[]) => api.getCompany(...a),
    updateCompany: (...a: unknown[]) => api.updateCompany(...a),
    suspendCompany: (...a: unknown[]) => api.suspendCompany(...a),
    activateCompany: (...a: unknown[]) => api.activateCompany(...a),
    addAdmin: (...a: unknown[]) => api.addAdmin(...a),
    resetAdminPassword: (...a: unknown[]) => api.resetAdminPassword(...a),
    deleteCompany: (...a: unknown[]) => api.deleteCompany(...a),
  },
}))

const { default: PlatformCompanyDetailPage } = await import('./PlatformCompanyDetailPage')

function Where() {
  const { pathname, search, state } = useLocation()
  return <div data-testid="where">{pathname}{search}{state ? ` ${JSON.stringify(state)}` : ''}</div>
}

function renderPage(id = 'cmp_acme', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/platform/companies/${id}${search}`]}>
      <Routes>
        <Route path="/platform/clients" element={<div>Client list</div>} />
        <Route path="/platform/clients/:clientId" element={<div>Client page</div>} />
        <Route path="/platform/companies/:companyId" element={<PlatformCompanyDetailPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const heading = () => screen.findByRole('heading', { level: 1, name: 'Acme Corp' })

const suspended = (over: Partial<CompanyDetail['company']> = {}): CompanyDetail => ({
  ...COMPANY_DETAIL,
  company: { ...COMPANY_DETAIL.company, status: 'suspended', ...over },
})

const EMPTY: CompanyDetail = {
  company: companyRow({ admins: [], sso_domains: [], users: 0, active_users: 0, ai_calls: 0, ai_cost_usd: 0 }),
  features: [{ key: 'jobs', label: 'Jobs', total: 0, window: 0 }],
  cost_by_source: [],
  activity: [],
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.getCompany.mockResolvedValue({ data: COMPANY_DETAIL })
  api.getDomains.mockResolvedValue({ data: { company_id: 'cmp_acme', domains: [], plan_allows: true } })
})

describe('PlatformCompanyDetailPage', () => {
  it('loads the company by the id in the URL, with a loading state first', async () => {
    let resolve!: (v: unknown) => void
    api.getCompany.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the company/i)

    resolve({ data: COMPANY_DETAIL })
    expect(await heading()).toBeInTheDocument()
    expect(api.getCompany).toHaveBeenCalledWith('cmp_acme', 30)
  })

  it('shows the header: status, slug, and a link back to its client', async () => {
    renderPage()
    const title = await heading()
    const header = title.parentElement!

    expect(within(header).getByText('Active')).toBeInTheDocument()
    expect(within(header).getByText('/acme-corp')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Acme Holdings' })).toHaveAttribute('href', '/platform/clients/cli_acme')
  })

  it('shows the totals', async () => {
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Users').parentElement).toHaveTextContent('12')
    expect(within(totals).getByText('Active users').parentElement).toHaveTextContent('8')
    expect(within(totals).getByText('AI spend').parentElement).toHaveTextContent('$2.50')
    expect(within(totals).getByText('AI calls').parentElement).toHaveTextContent('300')
    expect(within(totals).getByText('Last active').parentElement).toHaveTextContent('-')
  })

  it('headlines the total cost its own dashboard shows, with the AI spend and the email estimate that make it up', async () => {
    api.getCompany.mockResolvedValue({
      data: { ...COMPANY_DETAIL, company: companyRow({ ai_cost_usd: 0.333, email_cost_usd: 0.0009, total_cost_usd: 0.3339 }) },
    })
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Total cost').parentElement).toHaveTextContent('$0.3339')
    expect(within(totals).getByText('AI spend').parentElement).toHaveTextContent('$0.3330')
    expect(within(totals).getByText('Email (estimated)').parentElement).toHaveTextContent('$0.0009')
  })

  it('lists the administrators with their emails, and the SSO domains', async () => {
    renderPage()
    const admins = (await screen.findByRole('heading', { name: 'Administrators' })).closest('section')!
    expect(within(admins).getByText('Sam Lee')).toBeInTheDocument()
    expect(within(admins).getByText('sam@acme.test')).toBeInTheDocument()
    expect(within(admins).getByText('Eve Park')).toBeInTheDocument()
    expect(within(admins).getByText('eve@acme.test')).toBeInTheDocument()

    const sso = screen.getByRole('heading', { name: 'SSO domains' }).closest('section')!
    expect(within(sso).getByText('acme.test')).toBeInTheDocument()
  })

  it('shows usage by feature, cost by source and daily activity', async () => {
    renderPage()
    const features = (await screen.findByRole('heading', { name: 'Usage by feature' })).closest('section')!
    expect(within(features).getByRole('img', { name: 'Resumes: 40 recently, 100 in total' })).toBeInTheDocument()
    expect(within(features).getByRole('img', { name: 'Jobs: 1 recently, 4 in total' })).toBeInTheDocument()

    const cost = screen.getByRole('heading', { name: 'Cost by source' }).closest('section')!
    expect(within(cost).getByRole('img', { name: 'resume parse: $2.20 over 250 calls' })).toBeInTheDocument()

    const activity = screen.getByRole('heading', { name: 'Daily activity' }).closest('section')!
    expect(within(activity).getByRole('img', { name: /3 days: 24 events in all\. The busiest day was 8 Oct with 12/ })).toBeInTheDocument()
  })

  it('has an empty state for every section with nothing in it', async () => {
    api.getCompany.mockResolvedValue({ data: EMPTY })
    renderPage()

    expect(await screen.findByText('This company has no administrators.')).toBeInTheDocument()
    expect(screen.getByText('No domain is set.')).toBeInTheDocument()
    expect(screen.getByText('No feature has been used yet.')).toBeInTheDocument()
    expect(screen.getByText('No AI spend yet.')).toBeInTheDocument()
    expect(screen.getByText('No activity in this period.')).toBeInTheDocument()
  })

  it('says so when the company does not exist', async () => {
    api.getCompany.mockRejectedValue(httpError(404, 'Company not found'))
    renderPage('cmp_gone')
    expect(await screen.findByText('This company does not exist.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All clients' })).toHaveAttribute('href', '/platform/clients')
  })

  it('shows the server message on any other failure, and retries', async () => {
    const u = user()
    api.getCompany.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await heading()).toBeInTheDocument()
  })

  it('shows no subtitle or footnote under its titles', async () => {
    const { container } = renderPage()
    await heading()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})

describe('the period', () => {
  it('reloads for another window and keeps it in the URL', async () => {
    const u = user()
    renderPage()
    await heading()

    await u.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', 7))
    expect(screen.getByTestId('where')).toHaveTextContent('?window=7')
  })

  it('reads a month from the URL and shows the dates the server reported for it', async () => {
    api.getCompany.mockResolvedValue({
      data: { ...COMPANY_DETAIL, period: { kind: 'month', from: '2026-09-01T00:00:00+00:00', to: '2026-10-01T00:00:00+00:00' } },
    })
    renderPage('cmp_acme', '?month=2026-09')
    await heading()

    expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', { month: '2026-09' })
    expect(screen.getByLabelText('Period covered')).toHaveTextContent('2026-09-01 to 2026-10-01')
  })

  it('reloads for a month the owner picks', async () => {
    renderPage()
    await heading()

    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2026-08' } })
    await waitFor(() => expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', { month: '2026-08' }))
  })
})

describe('renaming', () => {
  async function openRename(u: ReturnType<typeof user>) {
    await u.click(await screen.findByRole('button', { name: 'Rename' }))
    return screen.getByRole('dialog', { name: 'Rename Acme Corp' })
  }

  it('saves the new name, trimmed, then reloads and says so', async () => {
    const u = user()
    api.updateCompany.mockResolvedValue({ data: { company: companyRow({ name: 'Acme Corporation' }) } })
    renderPage()
    const dialog = await openRename(u)

    const field = within(dialog).getByLabelText('Company name')
    expect(field).toHaveValue('Acme Corp')
    await u.clear(field)
    await u.type(field, '  Acme Corporation ')
    await u.click(within(dialog).getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(api.updateCompany).toHaveBeenCalledWith('cmp_acme', { name: 'Acme Corporation' }))
    expect(await screen.findByText('Company renamed to Acme Corporation')).toBeInTheDocument()
    await waitFor(() => expect(api.getCompany).toHaveBeenCalledTimes(2))
  })

  it('refuses a blank name', async () => {
    const u = user()
    renderPage()
    const dialog = await openRename(u)

    await u.clear(within(dialog).getByLabelText('Company name'))
    await u.click(within(dialog).getByRole('button', { name: 'Save name' }))
    expect(within(dialog).getByText("Enter the company's name.")).toBeInTheDocument()
    expect(api.updateCompany).not.toHaveBeenCalled()
  })

  it('closes without a request when the name is unchanged', async () => {
    const u = user()
    renderPage()
    const dialog = await openRename(u)

    await u.click(within(dialog).getByRole('button', { name: 'Save name' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.updateCompany).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the server message when it fails', async () => {
    const u = user()
    api.updateCompany.mockRejectedValue(httpError(409, 'That name is taken.'))
    renderPage()
    const dialog = await openRename(u)

    await u.type(within(dialog).getByLabelText('Company name'), ' East')
    await u.click(within(dialog).getByRole('button', { name: 'Save name' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That name is taken.')
  })
})

describe('SSO domains', () => {
  it('edits them from the card, normalised and sent as a list', async () => {
    const u = user()
    api.updateCompany.mockResolvedValue({ data: { company: companyRow() } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Edit domains' }))
    const dialog = screen.getByRole('dialog', { name: 'SSO domains for Acme Corp' })

    const box = within(dialog).getByLabelText('Domains')
    expect(box).toHaveValue('acme.test')
    await u.clear(box)
    await u.type(box, 'ACME.test, @Other.com')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))

    await waitFor(() => expect(api.updateCompany).toHaveBeenCalledWith('cmp_acme', { sso_domains: ['acme.test', 'other.com'] }))
    expect(await screen.findByText('SSO domains saved for Acme Corp')).toBeInTheDocument()
  })

  it('shows the 409 message when another company already claims a domain', async () => {
    const u = user()
    api.updateCompany.mockRejectedValue(httpError(409, 'acme.test is already used by another company.'))
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Edit domains' }))
    const dialog = screen.getByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))
    expect(await within(dialog).findByText('acme.test is already used by another company.')).toBeInTheDocument()
  })
})

describe('the sign-in link', () => {
  it('copies the link that names the company, and says so', async () => {
    const u = user()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Copy sign-in link' }))

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/login?company=acme-corp`)
    expect(await screen.findByText('Sign-in link for Acme Corp copied')).toBeInTheDocument()
  })

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    const u = user()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    try {
      renderPage()
      await u.click(await screen.findByRole('button', { name: 'Copy sign-in link' }))
      expect(await screen.findByText(`Could not copy. The link is ${window.location.origin}/login?company=acme-corp`)).toBeInTheDocument()
    } finally {
      write.mockRestore()
    }
  })
})

describe('suspending and activating', () => {
  it('asks for a reason, will not suspend without one, and sends it trimmed', async () => {
    const u = user()
    api.suspendCompany.mockResolvedValue({ data: { company: companyRow({ status: 'suspended' }) } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Suspend company' }))
    const dialog = screen.getByRole('dialog', { name: 'Suspend Acme Corp?' })

    await u.click(within(dialog).getByRole('button', { name: 'Suspend company' }))
    expect(within(dialog).getByText('Enter a reason.')).toBeInTheDocument()
    expect(api.suspendCompany).not.toHaveBeenCalled()

    await u.type(within(dialog).getByLabelText('Reason'), '  Contract ended ')
    await u.click(within(dialog).getByRole('button', { name: 'Suspend company' }))

    await waitFor(() => expect(api.suspendCompany).toHaveBeenCalledWith('cmp_acme', 'Contract ended'))
    expect(await screen.findByText('Acme Corp suspended')).toBeInTheDocument()
    await waitFor(() => expect(api.getCompany).toHaveBeenCalledTimes(2))
  })

  it('shows the reason on the page while the company is suspended', async () => {
    api.getCompany.mockResolvedValue({ data: suspended({ suspended_reason: 'Contract ended' }) })
    renderPage()
    expect(await screen.findByText('Suspended: Contract ended')).toBeInTheDocument()
    expect(screen.getByText('Suspended')).toBeInTheDocument()
  })

  it('shows no reason on an active company', async () => {
    api.getCompany.mockResolvedValue({ data: { ...COMPANY_DETAIL, company: { ...COMPANY_DETAIL.company, suspended_reason: 'Old' } } })
    renderPage()
    await heading()
    expect(screen.queryByText(/Old/)).not.toBeInTheDocument()
  })

  it('activates a suspended company with no reason asked', async () => {
    const u = user()
    api.getCompany.mockResolvedValue({ data: suspended() })
    api.activateCompany.mockResolvedValue({ data: { company: companyRow() } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Activate company' }))
    const dialog = screen.getByRole('dialog', { name: 'Activate Acme Corp?' })
    expect(within(dialog).queryByLabelText('Reason')).not.toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Activate company' }))

    await waitFor(() => expect(api.activateCompany).toHaveBeenCalledWith('cmp_acme'))
    expect(await screen.findByText('Acme Corp activated')).toBeInTheDocument()
  })
})

describe('administrators', () => {
  it('adds one by invitation, with no password sent', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'ann@acme.test', name: 'Ann Fox' }, email_sent: true } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Add admin' }))
    const dialog = screen.getByRole('dialog', { name: 'Add administrator to Acme Corp' })

    await u.type(within(dialog).getByLabelText('Administrator name'), 'Ann Fox')
    await u.type(within(dialog).getByLabelText('Administrator email'), 'ann@acme.test')
    await u.click(within(dialog).getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))

    await waitFor(() => expect(api.addAdmin).toHaveBeenCalledWith('cmp_acme', { name: 'Ann Fox', email: 'ann@acme.test' }))
    expect(await screen.findByText('Invitation sent to ann@acme.test')).toBeInTheDocument()
  })

  it('warns when the invitation email did not leave', async () => {
    const u = user()
    api.addAdmin.mockResolvedValue({ data: { admin: { email: 'ann@acme.test', name: 'Ann Fox' }, email_sent: false } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Add admin' }))
    const dialog = screen.getByRole('dialog')

    await u.type(within(dialog).getByLabelText('Administrator name'), 'Ann Fox')
    await u.type(within(dialog).getByLabelText('Administrator email'), 'ann@acme.test')
    await u.click(within(dialog).getByRole('button', { name: 'Add administrator' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The account was created but the email could not be sent')
  })

  it('resets the chosen administrator\'s password', async () => {
    const u = user()
    api.resetAdminPassword.mockResolvedValue({ data: {} })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Reset password' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset a password in Acme Corp' })

    await u.selectOptions(within(dialog).getByLabelText('Administrator'), 'eve@acme.test')
    await u.type(within(dialog).getByLabelText('New password'), 'N3w-passw0rd')
    await u.click(within(dialog).getByRole('button', { name: 'Reset password' }))

    await waitFor(() => expect(api.resetAdminPassword).toHaveBeenCalledWith('cmp_acme', 'eve@acme.test', 'N3w-passw0rd'))
    expect(await screen.findByText('Password reset for eve@acme.test')).toBeInTheDocument()
  })
})

describe('deleting the company', () => {
  it('is not offered while the company is active', async () => {
    renderPage()
    const button = await screen.findByRole('button', { name: 'Delete company' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Suspend the company first.')
  })

  it('opens the confirmation once suspended, and goes back to the client when the server says it is gone', async () => {
    const u = user()
    api.getCompany.mockResolvedValue({ data: suspended() })
    api.deleteCompany.mockResolvedValue({ data: { complete: true, deleted: { jobs: 4 } } })
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Delete company' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete Acme Corp?' })
    await u.type(within(dialog).getByLabelText('Type acme-corp to confirm'), 'acme-corp')
    await u.click(within(dialog).getByRole('button', { name: 'Delete company' }))

    expect(await screen.findByText('Client page')).toBeInTheDocument()
    expect(api.deleteCompany).toHaveBeenCalledWith('cmp_acme', 'acme-corp')
    expect(screen.getByTestId('where')).toHaveTextContent('/platform/clients/cli_acme {"notice":"Acme Corp deleted"}')
  })

  it('stays on the page, with the server message, when a round fails', async () => {
    const u = user()
    api.getCompany.mockResolvedValue({ data: suspended() })
    api.deleteCompany.mockRejectedValue(httpError(409, 'The company must be suspended first.'))
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Delete company' }))
    const dialog = screen.getByRole('dialog')
    await u.type(within(dialog).getByLabelText('Type acme-corp to confirm'), 'acme-corp')
    await u.click(within(dialog).getByRole('button', { name: 'Delete company' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The company must be suspended first.')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/platform\/companies\/cmp_acme$/)
  })
})

describe('custom domains', () => {
  const card = async () => (await screen.findByRole('heading', { name: 'Custom domains' })).closest('section')!

  it('lists the hostnames the company has, read from its own request', async () => {
    api.getDomains.mockResolvedValue({ data: { company_id: 'cmp_acme', domains: ['careers.acme.test', 'jobs.acme.test'], plan_allows: true } })
    renderPage()
    const c = within(await card())
    expect(await c.findByText('careers.acme.test')).toBeInTheDocument()
    expect(c.getByText('jobs.acme.test')).toBeInTheDocument()
    expect(api.getDomains).toHaveBeenCalledWith('cmp_acme')
  })

  it('says none is set', async () => {
    renderPage()
    expect(await within(await card()).findByText('No custom domain is set.')).toBeInTheDocument()
  })

  it('shows a note and does not let the domains be edited when the plan does not include them', async () => {
    api.getDomains.mockResolvedValue({ data: { company_id: 'cmp_acme', domains: [], plan_allows: false } })
    renderPage()
    const c = within(await card())
    expect(await c.findByText('This plan does not include custom domains.')).toBeInTheDocument()
    expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeDisabled()
  })

  it('waits for the read before it offers to edit', async () => {
    let resolve!: (v: unknown) => void
    api.getDomains.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    const c = within(await card())
    expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeDisabled()
    resolve({ data: { company_id: 'cmp_acme', domains: [], plan_allows: true } })
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeEnabled())
  })

  it('shows a failed read inside the card with a retry, and the rest of the page works', async () => {
    api.getDomains.mockRejectedValueOnce(httpError(500, 'Domains unavailable')).mockResolvedValueOnce({
      data: { company_id: 'cmp_acme', domains: ['careers.acme.test'], plan_allows: true },
    })
    renderPage()
    const c = within(await card())
    expect(await c.findByText('Domains unavailable')).toBeInTheDocument()
    expect(await heading()).toBeInTheDocument()
    await user().click(c.getByRole('button', { name: 'Retry' }))
    expect(await c.findByText('careers.acme.test')).toBeInTheDocument()
  })

  it('saves what was typed, lower-cased, one per line, and says so', async () => {
    const u = user()
    api.setDomains.mockResolvedValue({ data: { company_id: 'cmp_acme', domains: ['careers.acme.test', 'jobs.acme.test'] } })
    renderPage()
    const c = within(await card())
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeEnabled())
    await u.click(c.getByRole('button', { name: 'Edit custom domains' }))
    const dialog = screen.getByRole('dialog', { name: 'Custom domains for Acme Corp' })
    await u.type(within(dialog).getByLabelText('Domains'), 'Careers.Acme.test\njobs.acme.test')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))

    await waitFor(() => expect(api.setDomains).toHaveBeenCalledWith('cmp_acme', ['careers.acme.test', 'jobs.acme.test']))
    expect(await screen.findByText('Custom domains saved for Acme Corp')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await c.findByText('careers.acme.test')).toBeInTheDocument()
  })

  it('refuses a hostname that is not one, and more than five, before asking the server', async () => {
    const u = user()
    renderPage()
    const c = within(await card())
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeEnabled())
    await u.click(c.getByRole('button', { name: 'Edit custom domains' }))
    const dialog = screen.getByRole('dialog', { name: 'Custom domains for Acme Corp' })

    await u.type(within(dialog).getByLabelText('Domains'), 'not a host')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))
    expect(within(dialog).getByText('not is not a valid hostname.')).toBeInTheDocument()

    await u.clear(within(dialog).getByLabelText('Domains'))
    await u.type(within(dialog).getByLabelText('Domains'), 'a1.test\na2.test\na3.test\na4.test\na5.test\na6.test')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))
    expect(within(dialog).getByText('Use at most 5 domains.')).toBeInTheDocument()
    expect(api.setDomains).not.toHaveBeenCalled()
  })

  it.each([
    [409, 'That hostname already belongs to another company.'],
    [402, 'Your plan does not include custom domains.'],
    [400, 'careers is not a valid hostname.'],
  ])('keeps the dialog open with the %s sentence', async (status, detail) => {
    const u = user()
    api.setDomains.mockRejectedValue(httpError(status, detail))
    renderPage()
    const c = within(await card())
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit custom domains' })).toBeEnabled())
    await u.click(c.getByRole('button', { name: 'Edit custom domains' }))
    const dialog = screen.getByRole('dialog', { name: 'Custom domains for Acme Corp' })
    await u.type(within(dialog).getByLabelText('Domains'), 'careers.acme.test')
    await u.click(within(dialog).getByRole('button', { name: 'Save domains' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('dialog', { name: 'Custom domains for Acme Corp' })).toBeInTheDocument()
  })
})

describe('storage, and the time the figures were worked out', () => {
  it('shows storage against its cap among the totals', async () => {
    api.getCompany.mockResolvedValue({
      data: { ...COMPANY_DETAIL, company: { ...COMPANY_DETAIL.company, storage_mb: 120.5, storage_limit_mb: 2000 } },
    })
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Storage').parentElement).toHaveTextContent('120.5 / 2,000 MB')
  })

  it('says a dash where the storage is not known', async () => {
    renderPage()
    const totals = await screen.findByLabelText('Totals')
    expect(within(totals).getByText('Storage').parentElement).toHaveTextContent('-')
  })

  it('shows when the figures were worked out, from computed_at', async () => {
    api.getCompany.mockResolvedValue({ data: { ...COMPANY_DETAIL, computed_at: '2020-03-04T14:02:00Z' } })
    renderPage()
    expect(await screen.findByText(/^As of /)).toBeInTheDocument()
  })

  it('asks for fresh figures once when Refresh is pressed, and the next reload uses the cache again', async () => {
    const u = user()
    api.getCompany.mockResolvedValue({ data: { ...COMPANY_DETAIL, computed_at: '2020-03-04T14:02:00Z' } })
    renderPage()
    await heading()
    expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', 30)

    await u.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.getCompany).toHaveBeenCalledTimes(2))
    expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', 30, { refresh: true })

    await u.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(api.getCompany).toHaveBeenCalledTimes(3))
    expect(api.getCompany).toHaveBeenLastCalledWith('cmp_acme', 90)
  })

  it('offers Refresh even when the server sent no time', async () => {
    renderPage()
    await heading()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.queryByText(/^As of /)).not.toBeInTheDocument()
  })

  it('shows which model each job runs on and through which key, when the server sends it', async () => {
    api.getCompany.mockResolvedValue({ data: { ...COMPANY_DETAIL, ai: COMPANY_AI } })
    renderPage()
    await heading()
    const card = screen.getByRole('heading', { level: 2, name: 'AI models' }).closest('section')!
    expect(within(card).getAllByText('GPT-5 Mini').length).toBeGreaterThanOrEqual(2)
    expect(within(card).getAllByText('OPENAI_API_KEY').length).toBeGreaterThan(0)
    expect(within(card).getByRole('region', { name: 'Anthropic key' })).toBeInTheDocument()
  })

  it('has no AI models card when the server sends none', async () => {
    renderPage()
    await heading()
    expect(screen.queryByRole('heading', { name: 'AI models' })).not.toBeInTheDocument()
  })
})
