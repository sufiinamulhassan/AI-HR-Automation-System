import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND } from '../../lib/brand'

const myPermissions = vi.fn()
const getAvatar = vi.fn()
const me = vi.fn()
const attentionGet = vi.fn()

vi.mock('../../lib/api', () => ({
  performanceApi: {
    cycles: { list: vi.fn(), listActive: vi.fn() },
    myReports: vi.fn(),
  },
  attentionApi: { get: (...a: unknown[]) => attentionGet(...a), detail: vi.fn() },
  authApi: {
    myPermissions: (...a: unknown[]) => myPermissions(...a),
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    me: (...a: unknown[]) => me(...a),
    listModels: () => Promise.resolve({ data: { models: [], current: '' } }),
  },
}))

const { default: DashboardLayout } = await import('./DashboardLayout')
const { useAuthStore } = await import('../../store/auth.store')

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<div>Overview content</div>} />
        </Route>
        <Route path="/platform" element={<div>Platform console</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  getAvatar.mockReset().mockResolvedValue({ data: { configured: false } })
  me.mockReset().mockResolvedValue({ data: {} })
  attentionGet.mockReset().mockResolvedValue({
    data: { generated_at: 'x', items: [{ key: 'invites', label: 'Invites not sent', count: 4, severity: 'warn', path: '/dashboard/hrbot' }] },
  })
  useAuthStore.setState({ avatarDataUrl: undefined })
})

describe('DashboardLayout, Résumés nav entry', () => {
  beforeEach(() => {
    myPermissions.mockReset().mockResolvedValue({ data: { role: 'standard', permissions: [] } })
  })

  it.each(['standard', 'admin', 'superadmin'])('shows Résumés directly under Recruiting for %s', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
    renderLayout()

    const resumes = await screen.findByRole('link', { name: 'Résumés' })
    expect(resumes).toHaveAttribute('href', '/dashboard/resumes')

    const recruiting = screen.getByRole('link', { name: 'Recruiting' })
    expect(recruiting.nextElementSibling).toBe(resumes)
    expect(resumes.className).toBe(recruiting.className)
  })
})

describe('DashboardLayout, Performance nav visibility', () => {
  beforeEach(() => {
    myPermissions.mockReset()
  })

  it('shows Performance for an admin', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com', name: 'Admin' } })
    myPermissions.mockResolvedValue({ data: { role: 'admin', permissions: ['performance:read', 'performance:review'] } })
    renderLayout()

    expect(await screen.findByText('Performance')).toBeInTheDocument()
  })

  it('shows Performance for a superadmin too', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'superadmin', email: 'root@x.com', name: 'Root' } })
    myPermissions.mockResolvedValue({ data: { role: 'superadmin', permissions: ['performance:read', 'performance:review'] } })
    renderLayout()
    expect(await screen.findByText('Performance')).toBeInTheDocument()
  })

  it('hides Performance for a plain Recruiter (standard role) with neither performance permission', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'User' } })
    myPermissions.mockResolvedValue({ data: { role: 'standard', permissions: ['jobs:read', 'resumes:read'] } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(myPermissions).toHaveBeenCalled()
    expect(screen.queryByText('Performance')).not.toBeInTheDocument()
  })

  it('shows Performance for a non-admin custom role granted only performance:review', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'people_manager', email: 'mgr@x.com', name: 'Manager' } })
    myPermissions.mockResolvedValue({ data: { role: 'people_manager', permissions: ['performance:review'] } })
    renderLayout()

    expect(await screen.findByText('Performance')).toBeInTheDocument()
    expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument()
  })

  it('shows Performance for a non-admin custom role granted only performance:read', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'hr_business_partner', email: 'hrbp@x.com', name: 'HRBP' } })
    myPermissions.mockResolvedValue({ data: { role: 'hr_business_partner', permissions: ['performance:read'] } })
    renderLayout()

    expect(await screen.findByText('Performance')).toBeInTheDocument()
  })

  it('hides Performance while the permission check is still in flight, never a flash of the wrong state', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'User' } })
    let resolve!: (v: { data: { role: string; permissions: string[] } }) => void
    myPermissions.mockReturnValue(new Promise(r => { resolve = r }))
    renderLayout()

    expect(screen.queryByText('Performance')).not.toBeInTheDocument()
    resolve({ data: { role: 'standard', permissions: ['performance:read'] } })
    expect(await screen.findByText('Performance')).toBeInTheDocument()
  })
})

describe('DashboardLayout, avatar fallback', () => {
  function avatarImg() {
    return document.querySelector('.topbar-user-avatar-img')
  }

  beforeEach(() => {
    myPermissions.mockReset().mockResolvedValue({ data: { role: 'standard', permissions: [] } })
  })

  it('falls back to the initial circle when no avatar is configured', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'Ursula' } })
    getAvatar.mockResolvedValue({ data: { configured: false } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(avatarImg()).not.toBeInTheDocument()
  })

  it('still falls back to the initial circle if the avatar fetch fails', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'Ursula' } })
    getAvatar.mockRejectedValue({ response: { status: 404 } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(await screen.findByText('U')).toBeInTheDocument()
    expect(avatarImg()).not.toBeInTheDocument()
  })

  it('renders the uploaded avatar image instead of the initial once GET resolves', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com', name: 'Ursula' } })
    getAvatar.mockResolvedValue({ data: { configured: true, content_type: 'image/png', image_base64: 'AAAA' } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    const img = await waitFor(() => {
      const el = avatarImg()
      if (!el) throw new Error('avatar image not rendered yet')
      return el
    })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})

describe('DashboardLayout, workspace and platform', () => {
  const MEMBER = {
    role: 'admin', email: 'sam@acme.test', name: 'Sam', company_id: 'cmp_acme', company_name: 'Acme Corp',
    client_id: 'cli_acme', client_name: 'Acme Holdings', workspace_kind: 'workspace' as const, is_platform_admin: false,
  }

  beforeEach(() => {
    myPermissions.mockReset().mockResolvedValue({ data: { role: 'admin', permissions: [] } })
  })

  it('shows the name on the Organization page, not the workspace record\'s, when the brand carries one', async () => {
    useAuthStore.setState({ token: 'tok', user: { ...MEMBER, company_name: 'Default' } })
    render(
      <BrandContext.Provider value={{ ...DEFAULT_BRAND, companyName: 'Hirely.ai' }}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<div>Overview content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </BrandContext.Provider>,
    )

    await screen.findByRole('link', { name: 'Recruiting' })
    const company = document.querySelector('.sidebar-brand .brand-company')!
    expect(company).toHaveTextContent('Hirely.ai')
    expect(company).toHaveAttribute('title', 'Hirely.ai')
    expect(screen.queryByText('Default')).toBeNull()
  })

  it('names the company in the sidebar brand block', async () => {
    useAuthStore.setState({ token: 'tok', user: MEMBER })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    const brand = document.querySelector('.sidebar-brand')!
    const company = brand.querySelector('.brand-company')!
    expect(company).toHaveTextContent('Acme Corp')
    expect(company).toHaveAttribute('title', 'Acme Corp')
    expect(company.previousElementSibling).toHaveClass('brand-name')
    expect(company.nextElementSibling).toHaveClass('brand-role-desc')
    expect(company.className).not.toMatch(/-sub|-note/)
  })

  it('leaves the company line out for a session that does not carry one', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'u@x.test', name: 'U', company_id: 'cmp_x' } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(document.querySelector('.brand-company')).toBeNull()
  })

  it('shows no Platform entry to an ordinary account', async () => {
    useAuthStore.setState({ token: 'tok', user: MEMBER })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(screen.queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it('has no Platform entry in the workspace, and sends a platform owner to the console instead', async () => {
    useAuthStore.setState({ token: 'tok', user: { ...MEMBER, is_platform_admin: true } })
    renderLayout()

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(screen.queryByText('Overview content')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Recruiting' })).not.toBeInTheDocument()
    expect(attentionGet).not.toHaveBeenCalled()
  })

  it('keeps an account whose is_platform_admin is anything but true in the workspace', async () => {
    useAuthStore.setState({ token: 'tok', user: { ...MEMBER, is_platform_admin: 'yes' as unknown as boolean } })
    renderLayout()

    expect(await screen.findByRole('link', { name: 'Recruiting' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument()
    expect(screen.queryByText('Platform console')).not.toBeInTheDocument()
  })

  it.each(['standard', 'admin', 'superadmin'])('never shows a %s of a customer a Platform entry', async role => {
    useAuthStore.setState({ token: 'tok', user: { ...MEMBER, role } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(screen.queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/platform"]')).toBeNull()
  })

  it('learns the platform status of a session saved before multi-tenancy', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'superadmin', email: 'owner@hirely.test', name: 'Olive' } })
    me.mockResolvedValue({
      data: { email: 'owner@hirely.test', role: 'superadmin', company_id: 'cmp_default', company_name: 'Hirely', workspace_kind: 'workspace', is_platform_admin: true },
    })
    renderLayout()

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(me).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().user).toMatchObject({ name: 'Olive', company_name: 'Hirely', is_platform_admin: true })
  })

  it('does not ask /auth/me when the session already carries its workspace', async () => {
    useAuthStore.setState({ token: 'tok', user: MEMBER })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(me).not.toHaveBeenCalled()
  })

  it('keeps working when /auth/me cannot be reached', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'u@x.test', name: 'U' } })
    me.mockRejectedValue(new Error('Network Error'))
    renderLayout()

    expect(await screen.findByRole('link', { name: 'Recruiting' })).toBeInTheDocument()
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument()
  })
})

describe('DashboardLayout: the top bar', () => {
  beforeEach(() => {
    myPermissions.mockReset().mockResolvedValue({ data: { role: 'standard', permissions: [] } })
  })

  it.each(['admin', 'superadmin'])('gives a %s the Needs attention icon, with how much is waiting', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
    renderLayout()

    const icon = await screen.findByRole('button', { name: 'Needs attention, 4 waiting' })
    expect(icon.closest('.dashboard-topbar')).not.toBeNull()
    expect(attentionGet).toHaveBeenCalledTimes(1)
  })

  it('gives a Recruiter no Needs attention icon and never asks for its data', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'r@x.com', name: 'Rec' } })
    renderLayout()

    await screen.findByRole('link', { name: 'Recruiting' })
    expect(screen.queryByRole('button', { name: /Needs attention/ })).not.toBeInTheDocument()
    expect(attentionGet).not.toHaveBeenCalled()
  })

  it('has no navigation search box, and keeps the notifications bell', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'a@x.com', name: 'Admin' } })
    renderLayout()

    await screen.findByRole('button', { name: /Needs attention/ })
    expect(screen.queryByRole('textbox', { name: 'Search navigation' })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search navigation')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/dashboard/activity')
    expect(document.querySelector('.nav-item-dim')).toBeNull()
  })

  it('does not put the Needs attention widget on the dashboard page', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'a@x.com', name: 'Admin' } })
    renderLayout()

    await screen.findByRole('button', { name: /Needs attention/ })
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
  })
})
