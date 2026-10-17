import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({}))

const { default: PlatformLayout } = await import('./PlatformLayout')
const { useAuthStore } = await import('../../store/auth.store')

function renderAt(path = '/platform') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<div>Overview page</div>} />
          <Route path="clients" element={<div>Clients page</div>} />
          <Route path="clients/:clientId" element={<div>Client detail page</div>} />
          <Route path="companies/:companyId" element={<div>Company detail page</div>} />
          <Route path="usage" element={<div>Usage page</div>} />
          <Route path="ai" element={<div>AI models page</div>} />
          <Route path="billing" element={<div>Billing page</div>} />
          <Route path="health" element={<div>Health page</div>} />
          <Route path="audit" element={<div>Audit page</div>} />
          <Route path="owners" element={<div>Owners page</div>} />
        </Route>
        <Route path="/dashboard" element={<div>Workspace dashboard</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const PLATFORM_ONLY = { email: 'owner@hirely.test', name: 'Olive Owner', role: 'superadmin', workspace_kind: 'platform' as const, is_platform_admin: true }
const WITH_WORKSPACE = { ...PLATFORM_ONLY, workspace_kind: 'workspace' as const, company_name: 'Hirely' }

beforeEach(() => {
  useAuthStore.setState({ token: 'tok', user: PLATFORM_ONLY })
})

describe('PlatformLayout', () => {
  it('names the console and lists its nine pages', () => {
    renderAt()
    const nav = screen.getByRole('navigation', { name: 'Platform console' })

    expect(screen.getByText('Platform Console')).toBeInTheDocument()
    expect(within(nav).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Overview', '/platform'],
      ['Clients', '/platform/clients'],
      ['Inbox', '/platform/inbox'],
      ['Usage', '/platform/usage'],
      ['AI models', '/platform/ai'],
      ['Billing', '/platform/billing'],
      ['Health', '/platform/health'],
      ['Audit', '/platform/audit'],
      ['Platform owners', '/platform/owners'],
    ])
  })

  it('shows the page for the route inside the shell', () => {
    renderAt('/platform/usage')
    expect(screen.getByText('Usage page')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Platform console' })).toBeInTheDocument()
  })

  it('marks the current page, and only Overview on the front page', () => {
    renderAt('/platform')
    const nav = screen.getByRole('navigation', { name: 'Platform console' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Clients' })).not.toHaveAttribute('aria-current')
  })

  it('keeps Clients marked while a client is open', () => {
    renderAt('/platform/clients/cli_acme')
    const nav = screen.getByRole('navigation', { name: 'Platform console' })
    expect(screen.getByText('Client detail page')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Clients' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it.each([
    ['/platform/ai', 'AI models'],
    ['/platform/billing', 'Billing'],
    ['/platform/health', 'Health'],
    ['/platform/audit', 'Audit'],
  ])('marks %s as the current page', (path, label) => {
    renderAt(path)
    const nav = screen.getByRole('navigation', { name: 'Platform console' })
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    expect(document.querySelector('.plat-mobile-title')).toHaveTextContent(label)
  })

  it('shows the page for a company inside the shell, titled Clients on a small screen', () => {
    renderAt('/platform/companies/cmp_acme')
    expect(screen.getByText('Company detail page')).toBeInTheDocument()
    expect(document.querySelector('.plat-mobile-title')).toHaveTextContent('Clients')
  })

  it('moves between pages from the sidebar', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()
    await user.click(screen.getByRole('link', { name: 'Platform owners' }))
    expect(await screen.findByText('Owners page')).toBeInTheDocument()
  })

  it('shows who is signed in', () => {
    renderAt()
    expect(screen.getByText('Olive Owner')).toBeInTheDocument()
    expect(screen.getByText('Platform owner')).toBeInTheDocument()
  })

  it('falls back to the email when the account has no name', () => {
    useAuthStore.setState({ user: { email: 'owner@hirely.test', is_platform_admin: true, workspace_kind: 'platform' } })
    renderAt()
    expect(screen.getByText('owner@hirely.test')).toBeInTheDocument()
  })

  it.each([['an account that only lives in the platform workspace', PLATFORM_ONLY], ['an owner whose account is also filed under a customer workspace', WITH_WORKSPACE]])(
    'offers no link into a customer workspace to %s',
    (_label, account) => {
      useAuthStore.setState({ user: account })
      renderAt()
      expect(screen.queryByRole('link', { name: /workspace/i })).not.toBeInTheDocument()
      expect(document.querySelector('a[href="/dashboard"]')).toBeNull()
    },
  )

  it('signs out and goes to the login page', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('opens and closes the menu on a small screen, and shows the page title', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('/platform/usage')

    expect(document.querySelector('.plat-mobile-title')).toHaveTextContent('Usage')
    const menu = screen.getByRole('button', { name: 'Open menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.plat-sidebar')).not.toHaveClass('plat-sidebar-open')

    await user.click(menu)
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('.plat-sidebar')).toHaveClass('plat-sidebar-open')

    await user.click(screen.getByRole('link', { name: 'Clients' }))
    expect(await screen.findByText('Clients page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('shows no subtitle or footnote in its chrome', () => {
    const { container } = renderAt()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })
})
