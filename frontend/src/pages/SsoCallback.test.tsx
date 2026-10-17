import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const me = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: { me: (...a: unknown[]) => me(...a) },
}))

const { default: SsoCallback } = await import('./SsoCallback')
const { useAuthStore } = await import('../store/auth.store')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sso-callback" element={<SsoCallback />} />
        <Route path="/dashboard" element={<div>Workspace dashboard</div>} />
        <Route path="/platform" element={<div>Platform console</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const WORKSPACE = { email: 'sam@acme.test', role: 'admin', company_name: 'Acme Corp', workspace_kind: 'workspace', is_platform_admin: false }
const PLATFORM = { email: 'owner@hirely.test', role: 'superadmin', company_name: 'Platform', workspace_kind: 'platform', is_platform_admin: true }

beforeEach(() => {
  me.mockReset()
  useAuthStore.setState({ token: null, user: null })
})

describe('SsoCallback', () => {
  it('lands a workspace account on its dashboard, with the user /auth/me described', async () => {
    me.mockResolvedValue({ data: WORKSPACE })
    renderAt('/sso-callback?token=tok_sso')

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('tok_sso')
    expect(useAuthStore.getState().user).toEqual(WORKSPACE)
  })

  it('lands an account in the platform workspace on the console', async () => {
    me.mockResolvedValue({ data: PLATFORM })
    renderAt('/sso-callback?token=tok_sso')

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
  })

  it('lands an answer with no workspace fields on the dashboard', async () => {
    me.mockResolvedValue({ data: { email: 'old@x.test', role: 'standard' } })
    renderAt('/sso-callback?token=tok_sso')
    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('has stored the token before it asks who the person is', async () => {
    let tokenWhenAsked: string | null = null
    me.mockImplementation(async () => {
      tokenWhenAsked = useAuthStore.getState().token
      return { data: WORKSPACE }
    })
    renderAt('/sso-callback?token=tok_sso')
    await screen.findByText('Workspace dashboard')
    expect(tokenWhenAsked).toBe('tok_sso')
  })

  it('says so when no token came back', () => {
    renderAt('/sso-callback')
    expect(screen.getByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.getByText('No SSO token was returned. Please try signing in again.')).toBeInTheDocument()
    expect(me).not.toHaveBeenCalled()
  })

  it('signs the person out again if their account cannot be read after three tries', async () => {
    me.mockRejectedValue(new Error('boom'))
    renderAt('/sso-callback?token=tok_sso')

    expect(await screen.findByText('Sign-in failed', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(me).toHaveBeenCalledTimes(3)
    expect(useAuthStore.getState().token).toBeNull()
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
  }, 10000)

  it('shows the sentence the provider sent back in ?error=, with a way back to sign-in', () => {
    renderAt('/sso-callback?error=Your%20email%20domain%20is%20not%20allowed%20for%20this%20company.')

    expect(screen.getByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.getByText('Your email domain is not allowed for this company.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login')
    expect(me).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('shows the error rather than a token that came with it', () => {
    renderAt('/sso-callback?token=tok_sso&error=Refused')
    expect(screen.getByText('Refused')).toBeInTheDocument()
    expect(me).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('treats a blank error as none and carries on with the token', async () => {
    me.mockResolvedValue({ data: WORKSPACE })
    renderAt('/sso-callback?token=tok_sso&error=%20')
    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
  })
})
