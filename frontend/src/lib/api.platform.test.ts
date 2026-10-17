import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  instances: [] as {
    interceptors: { request: { use: ReturnType<typeof vi.fn> }; response: { use: ReturnType<typeof vi.fn> } }
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }[],
}))

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => {
      const inst = {
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        get: vi.fn().mockResolvedValue({ data: {} }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        put: vi.fn().mockResolvedValue({ data: {} }),
        patch: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      }
      h.instances.push(inst)
      return inst
    }),
  },
}))

const { brandingApi, platformApi } = await import('./api')

const [authed, publicClient] = h.instances

beforeEach(() => {
  for (const inst of h.instances) {
    for (const fn of [inst.get, inst.post, inst.put, inst.patch, inst.delete]) fn.mockClear()
  }
})

describe('clients', () => {
  it('still has exactly two, with the authenticated one carrying one request and one response interceptor', () => {
    expect(h.instances).toHaveLength(2)
    expect(authed.interceptors.request.use).toHaveBeenCalledTimes(1)
    expect(authed.interceptors.response.use).toHaveBeenCalledTimes(1)
    expect(publicClient.interceptors.request.use).not.toHaveBeenCalled()
    expect(publicClient.interceptors.response.use).not.toHaveBeenCalled()
  })
})

describe('platformApi', () => {
  it('reads the overview and the usage matrix for a window, or for the default', async () => {
    await platformApi.overview(7)
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: { window: 7 } })
    await platformApi.overview()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: undefined })

    await platformApi.usage(90)
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: { window: 90 } })
    await platformApi.usage()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: undefined })
  })

  it('lists clients with a search and a status filter', async () => {
    await platformApi.listClients({ search: 'acme', status: 'suspended' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients', { params: { search: 'acme', status: 'suspended' } })
    await platformApi.listClients()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients', { params: undefined })
  })

  it('creates a client, with its first company when given', async () => {
    const body = {
      name: 'Acme Holdings',
      plan: { name: 'growth' },
      company: { name: 'Acme Corp', admin: { name: 'Sam', email: 'sam@acme.test', password: 'S3cur3P@ssword!' } },
    }
    await platformApi.createClient(body)
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients', body)
  })

  it('reads and updates one client, with the id encoded in the path', async () => {
    await platformApi.getClient('cli_1')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1')
    await platformApi.getClient('a/b?c')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/a%2Fb%3Fc')
    await platformApi.updateClient('cli_1', { contact_name: 'Dana' })
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/clients/cli_1', { contact_name: 'Dana' })
  })

  it('suspends a client with an optional reason, and activates it', async () => {
    await platformApi.suspendClient('cli_1', 'Unpaid')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/suspend', { reason: 'Unpaid' })
    await platformApi.suspendClient('cli_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/suspend', {})
    await platformApi.activateClient('cli_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/activate')
  })

  it('adds a company to a client', async () => {
    const body = { name: 'Acme East', admin: { name: 'Eve', email: 'eve@acme.test', password: 'S3cur3P@ssword!' } }
    await platformApi.createCompany('cli_1', body)
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/companies', body)
  })

  it('lists, reads, renames and gives SSO domains to companies', async () => {
    await platformApi.listCompanies({ client_id: 'cli_1', search: 'acme', status: 'active' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies', { params: { client_id: 'cli_1', search: 'acme', status: 'active' } })
    await platformApi.getCompany('cmp_1')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/cmp_1')
    await platformApi.updateCompany('cmp_1', { name: 'Acme', sso_domains: ['acme.test'] })
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/companies/cmp_1', { name: 'Acme', sso_domains: ['acme.test'] })
  })

  it('suspends and activates a company', async () => {
    await platformApi.suspendCompany('cmp_1', 'Unpaid')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/suspend', { reason: 'Unpaid' })
    await platformApi.suspendCompany('cmp_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/suspend', {})
    await platformApi.activateCompany('cmp_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/activate')
  })

  it('adds an administrator and resets a password, with the email encoded in the path', async () => {
    await platformApi.addAdmin('cmp_1', { name: 'Eve', email: 'eve@acme.test', password: 'S3cur3P@ssword!' })
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/admins', { name: 'Eve', email: 'eve@acme.test', password: 'S3cur3P@ssword!' })

    await platformApi.resetAdminPassword('cmp_1', 'eve+test@acme.test', 'N3w-passw0rd')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/admins/eve%2Btest%40acme.test/reset-password', { new_password: 'N3w-passw0rd' })
  })

  it('lists, adds and switches platform owners', async () => {
    await platformApi.listOwners()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/owners')
    await platformApi.createOwner({ name: 'Olive', email: 'olive@hirely.test', password: 'S3cur3P@ssword!' })
    expect(authed.post).toHaveBeenLastCalledWith('/platform/owners', { name: 'Olive', email: 'olive@hirely.test', password: 'S3cur3P@ssword!' })
    await platformApi.setOwnerActive('olive@hirely.test', false)
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/owners/olive%40hirely.test', { is_active: false })
    await platformApi.setOwnerActive('olive@hirely.test', true)
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/owners/olive%40hirely.test', { is_active: true })
  })

  it('never uses the public client', async () => {
    await platformApi.overview()
    await platformApi.listOwners()
    expect(publicClient.get).not.toHaveBeenCalled()
  })
})

describe('platformApi: periods', () => {
  it('asks for a calendar month with ?month=, never with a window beside it', async () => {
    await platformApi.overview({ month: '2026-10' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: { month: '2026-10' } })
    await platformApi.usage({ month: '2026-09' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: { month: '2026-09' } })
  })

  it('reads a client or a company for a window or a month, and with no query at all when none is given', async () => {
    await platformApi.getClient('cli_1', 7)
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1', { params: { window: 7 } })
    await platformApi.getClient('cli_1', { month: '2026-10' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1', { params: { month: '2026-10' } })

    await platformApi.getCompany('cmp_1')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/cmp_1')
    await platformApi.getCompany('cmp_1', 90)
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/cmp_1', { params: { window: 90 } })
    await platformApi.getCompany('a/b', { month: '2026-10' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/a%2Fb', { params: { month: '2026-10' } })
  })
})

describe('platformApi: offboarding, health and audit', () => {
  it('deletes a company with its slug as the confirmation, in the request body', async () => {
    await platformApi.deleteCompany('cmp_1', 'acme-corp')
    expect(authed.delete).toHaveBeenLastCalledWith('/platform/companies/cmp_1', { data: { confirm_slug: 'acme-corp' } })
  })

  it('deletes a client the same way', async () => {
    await platformApi.deleteClient('cli_1', 'acme-holdings')
    expect(authed.delete).toHaveBeenLastCalledWith('/platform/clients/cli_1', { data: { confirm_slug: 'acme-holdings' } })
  })

  it('suspends a company with the reason in the body', async () => {
    await platformApi.suspendCompany('cmp_1', 'Contract ended')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/suspend', { reason: 'Contract ended' })
  })

  it('reads the health report and pages through the audit log', async () => {
    await platformApi.health()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/health')
    await platformApi.audit({ limit: 50 })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/audit', { params: { limit: 50 } })
    await platformApi.audit({ limit: 50, before: '2026-10-08T14:02:11Z' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/audit', { params: { limit: 50, before: '2026-10-08T14:02:11Z' } })
  })

  it('adds an administrator without a password to invite them', async () => {
    await platformApi.addAdmin('cmp_1', { name: 'Eve', email: 'eve@acme.test' })
    expect(authed.post).toHaveBeenLastCalledWith('/platform/companies/cmp_1/admins', { name: 'Eve', email: 'eve@acme.test' })
  })
})

describe('brandingApi.getPublic', () => {
  it('asks with no parameters by default', async () => {
    await brandingApi.getPublic()
    expect(authed.get).toHaveBeenLastCalledWith('/branding/public', undefined)
  })

  it('names a company slug', async () => {
    await brandingApi.getPublic({ company: 'acme' })
    expect(authed.get).toHaveBeenLastCalledWith('/branding/public', { params: { company: 'acme' } })
  })

  it('names the kind and token of a public link', async () => {
    await brandingApi.getPublic({ kind: 'offer', token: 'tok_1' })
    expect(authed.get).toHaveBeenLastCalledWith('/branding/public', { params: { kind: 'offer', token: 'tok_1' } })
  })
})

describe('platformApi: cached reads and refresh', () => {
  it('adds refresh=1 to a window or a month read, and nothing when it is not asked for', async () => {
    await platformApi.overview(7, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: { window: 7, refresh: 1 } })
    await platformApi.overview({ month: '2026-10' }, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: { month: '2026-10', refresh: 1 } })
    await platformApi.usage(30, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: { window: 30, refresh: 1 } })
    await platformApi.usage(30, {})
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: { window: 30 } })
    await platformApi.usage(30, { refresh: false })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/usage', { params: { window: 30 } })
  })

  it('refreshes with no period too', async () => {
    await platformApi.overview(undefined, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/overview', { params: { refresh: 1 } })
  })

  it('keeps the search and the status when it refreshes the client and company lists', async () => {
    await platformApi.listClients({ search: 'acme' }, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients', { params: { search: 'acme', refresh: 1 } })
    await platformApi.listClients(undefined, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients', { params: { refresh: 1 } })
    await platformApi.listCompanies({ client_id: 'cli_1' }, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies', { params: { client_id: 'cli_1', refresh: 1 } })
  })

  it('refreshes one client or company, with or without a period', async () => {
    await platformApi.getClient('cli_1', 30, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1', { params: { window: 30, refresh: 1 } })
    await platformApi.getClient('cli_1', undefined, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1', { params: { refresh: 1 } })
    await platformApi.getCompany('cmp_1', { month: '2026-10' }, { refresh: true })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/cmp_1', { params: { month: '2026-10', refresh: 1 } })
  })

  it('leaves the plain calls exactly as they were', async () => {
    await platformApi.getClient('cli_1', 30)
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1', { params: { window: 30 } })
    await platformApi.getClient('cli_1')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/clients/cli_1')
  })
})

describe('platformApi: plans, subscription and billing', () => {
  it('reads the tier catalog', async () => {
    await platformApi.plans()
    expect(authed.get).toHaveBeenLastCalledWith('/platform/plans')
  })

  it('changes the subscription by hand, with the id encoded', async () => {
    await platformApi.setSubscription('cli_1', { status: 'trialing', provider: 'manual', trial_ends_at: '2026-12-15' })
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/clients/cli_1/subscription', {
      status: 'trialing', provider: 'manual', trial_ends_at: '2026-12-15',
    })
    await platformApi.setSubscription('a/b', { status: 'active' })
    expect(authed.patch).toHaveBeenLastCalledWith('/platform/clients/a%2Fb/subscription', { status: 'active' })
  })

  it('starts a Stripe checkout, with a tier only when one is given, and opens the portal', async () => {
    await platformApi.startCheckout('cli_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/billing/checkout', {})
    await platformApi.startCheckout('cli_1', 'growth')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/billing/checkout', { tier: 'growth' })
    await platformApi.openBillingPortal('cli_1')
    expect(authed.post).toHaveBeenLastCalledWith('/platform/clients/cli_1/billing/portal')
  })

  it('reads a statement as JSON, for every client or one', async () => {
    await platformApi.billingStatement({ month: '2026-10' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/billing/statement', { params: { month: '2026-10', format: 'json' } })
    await platformApi.billingStatement({ month: '2026-10', client_id: 'cli_1' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/billing/statement', { params: { month: '2026-10', client_id: 'cli_1', format: 'json' } })
  })

  it('reads a statement as a CSV file, as a blob through the authenticated client', async () => {
    await platformApi.billingStatementCsv({ month: '2026-10', client_id: 'cli_1' })
    expect(authed.get).toHaveBeenLastCalledWith('/platform/billing/statement', {
      params: { month: '2026-10', client_id: 'cli_1', format: 'csv' }, responseType: 'blob',
    })
    expect(publicClient.get).not.toHaveBeenCalled()
  })

  it('reads and sets the custom domains of a company', async () => {
    await platformApi.getDomains('cmp_1')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/cmp_1/domains')
    await platformApi.setDomains('cmp_1', ['careers.acme.test'])
    expect(authed.put).toHaveBeenLastCalledWith('/platform/companies/cmp_1/domains', { domains: ['careers.acme.test'] })
    await platformApi.getDomains('a/b')
    expect(authed.get).toHaveBeenLastCalledWith('/platform/companies/a%2Fb/domains')
  })
})

describe('brandingApi: the company slug and the legal links', () => {
  it('asks for the branding with the context as query parameters, as before', async () => {
    await brandingApi.getPublic({ company: 'acme' })
    expect(authed.get).toHaveBeenLastCalledWith('/branding/public', { params: { company: 'acme' } })
  })
})
