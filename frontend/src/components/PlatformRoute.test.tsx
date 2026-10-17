import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const me = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: { me: (...a: unknown[]) => me(...a) },
}))

const { default: PlatformRoute } = await import('./PlatformRoute')
const { useAuthStore } = await import('../store/auth.store')

function renderAt(path = '/platform') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/platform" element={<PlatformRoute><div>Console</div></PlatformRoute>} />
        <Route path="/dashboard" element={<div>Workspace dashboard</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const OWNER = {
  email: 'owner@hirely.test', role: 'superadmin', company_id: 'cmp_platform', company_name: 'Platform',
  workspace_kind: 'platform' as const, is_platform_admin: true,
}
const MEMBER = {
  email: 'sam@acme.test', role: 'superadmin', company_id: 'cmp_acme', company_name: 'Acme Corp',
  workspace_kind: 'workspace' as const, is_platform_admin: false,
}

beforeEach(() => {
  me.mockReset().mockRejectedValue(new Error('not expected'))
  useAuthStore.setState({ token: null, user: null })
})

describe('PlatformRoute', () => {
  it('opens the console for a platform owner', () => {
    useAuthStore.setState({ token: 'tok', user: OWNER })
    renderAt()
    expect(screen.getByText('Console')).toBeInTheDocument()
    expect(me).not.toHaveBeenCalled()
  })

  it('opens the console for a platform owner who also has a customer workspace', () => {
    useAuthStore.setState({ token: 'tok', user: { ...OWNER, workspace_kind: 'workspace', company_name: 'Hirely' } })
    renderAt()
    expect(screen.getByText('Console')).toBeInTheDocument()
  })

  it('sends a signed-in account that is not a platform owner to its dashboard', () => {
    useAuthStore.setState({ token: 'tok', user: MEMBER })
    renderAt()
    expect(screen.getByText('Workspace dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Console')).not.toBeInTheDocument()
  })

  it('does not take is_platform_admin on trust unless it is exactly true', () => {
    useAuthStore.setState({ token: 'tok', user: { ...MEMBER, is_platform_admin: 'true' as unknown as boolean } })
    renderAt()
    expect(screen.getByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('does not let an admin or Super Admin through on their role alone', () => {
    useAuthStore.setState({ token: 'tok', user: { email: 'root@x.test', role: 'superadmin', company_id: 'cmp_x', is_platform_admin: false } })
    renderAt()
    expect(screen.getByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('sends a visitor who is not signed in to the login page', () => {
    renderAt()
    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Console')).not.toBeInTheDocument()
  })

  it('sends a token with no user to the login page', () => {
    useAuthStore.setState({ token: 'tok', user: null })
    renderAt()
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('sends a user with no token to the login page', () => {
    useAuthStore.setState({ token: null, user: OWNER })
    renderAt()
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})

describe('PlatformRoute with a session saved before multi-tenancy', () => {
  const OLD = { email: 'owner@hirely.test', role: 'superadmin' }

  it('waits for /auth/me, then lets a platform owner in', async () => {
    let resolve!: (v: unknown) => void
    me.mockReturnValue(new Promise(r => { resolve = r }))
    useAuthStore.setState({ token: 'tok', user: OLD })
    renderAt()

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()

    resolve({ data: { ...OLD, ...OWNER } })
    expect(await screen.findByText('Console')).toBeInTheDocument()
    expect(useAuthStore.getState().user).toMatchObject({ company_name: 'Platform', is_platform_admin: true })
  })

  it('sends an ordinary account to its dashboard once /auth/me says it is not an owner', async () => {
    me.mockResolvedValue({ data: { ...OLD, ...MEMBER } })
    useAuthStore.setState({ token: 'tok', user: OLD })
    renderAt()

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('sends the person to the dashboard, not to a blank page, when /auth/me fails', async () => {
    me.mockRejectedValue(new Error('Network Error'))
    useAuthStore.setState({ token: 'tok', user: OLD })
    renderAt()

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
  })
})
