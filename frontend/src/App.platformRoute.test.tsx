import { render, screen } from '@testing-library/react'
import { Outlet } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OVERVIEW, clientRow } from './test/platformFixtures'

vi.mock('./components/BrandingProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./components/layout/DashboardLayout', () => ({
  default: () => <div><div>Workspace shell</div><Outlet /></div>,
}))
vi.mock('./modules/m1-hrbot/pages/DashboardOverview', () => ({ default: () => <div>Workspace overview</div> }))

const { platformApi } = await import('./lib/api')
const { useAuthStore } = await import('./store/auth.store')
const { default: App } = await import('./App')

const OWNER = { email: 'owner@hirely.test', name: 'Olive Owner', role: 'superadmin', company_id: 'cmp_platform', workspace_kind: 'platform' as const, is_platform_admin: true }
const MEMBER = { email: 'sam@acme.test', name: 'Sam', role: 'superadmin', company_id: 'cmp_acme', workspace_kind: 'workspace' as const, is_platform_admin: false }

function open(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(platformApi, 'overview').mockResolvedValue({ data: OVERVIEW } as never)
  vi.spyOn(platformApi, 'listClients').mockResolvedValue({ data: { clients: [clientRow()] } } as never)
  vi.spyOn(platformApi, 'usage').mockReturnValue(new Promise(() => {}) as never)
  vi.spyOn(platformApi, 'billingStatement').mockReturnValue(new Promise(() => {}) as never)
  vi.spyOn(platformApi, 'listOwners').mockReturnValue(new Promise(() => {}) as never)
  vi.spyOn(platformApi, 'health').mockReturnValue(new Promise(() => {}) as never)
  vi.spyOn(platformApi, 'audit').mockReturnValue(new Promise(() => {}) as never)
  vi.spyOn(platformApi, 'contactRequests').mockReturnValue(new Promise(() => {}) as never)
  useAuthStore.setState({ token: null, user: null })
})

describe('/platform', () => {
  it('opens the console, inside its own shell, for a platform owner', async () => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    open('/platform')

    expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Platform console' })).toBeInTheDocument()
    expect(screen.queryByText('Workspace shell')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/platform')
  })

  it.each([
    ['/platform/clients', 'Clients'],
    ['/platform/usage', 'Usage by client'],
    ['/platform/billing', 'Billing statement'],
    ['/platform/owners', 'Platform owners'],
    ['/platform/health', 'Platform health'],
    ['/platform/audit', 'Platform audit'],
    ['/platform/inbox', 'Inbox'],
  ])('routes %s to its page', async (path, heading) => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    open(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
  })

  it('routes /platform/clients/:id to that client', async () => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    const getClient = vi.spyOn(platformApi, 'getClient').mockReturnValue(new Promise(() => {}) as never)
    open('/platform/clients/cli_acme')

    expect(await screen.findByRole('link', { name: 'All clients' })).toBeInTheDocument()
    expect(getClient).toHaveBeenCalledWith('cli_acme', 30)
  })

  it('routes /platform/companies/:id to that company', async () => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    const getCompany = vi.spyOn(platformApi, 'getCompany').mockReturnValue(new Promise(() => {}) as never)
    open('/platform/companies/cmp_acme')

    expect(await screen.findByRole('link', { name: 'All clients' })).toBeInTheDocument()
    expect(getCompany).toHaveBeenCalledWith('cmp_acme', 30)
  })

  it('brings a stray path under it back to the front page', async () => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    open('/platform/nothing-here')

    expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/platform')
  })

  it('sends an account that is not a platform owner to its dashboard', async () => {
    useAuthStore.setState({ token: 'tok', user: MEMBER })
    open('/platform/clients')

    expect(await screen.findByText('Workspace shell')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
    expect(platformApi.listClients).not.toHaveBeenCalled()
  })

  it('sends a visitor who is not signed in to the login page', async () => {
    open('/platform')
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })
})
