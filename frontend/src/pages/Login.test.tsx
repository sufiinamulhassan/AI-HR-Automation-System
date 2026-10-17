import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND } from '../lib/brand'

const login = vi.fn()
const verifyOtp = vi.fn()
const oidcConfig = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: {
    login: (...a: unknown[]) => login(...a),
    verifyOtp: (...a: unknown[]) => verifyOtp(...a),
  },
  ssoApi: { oidcConfig: (...a: unknown[]) => oidcConfig(...a) },
  oidcLoginUrl: (company: string) => `/api/v1/sso/oidc/login?company=${encodeURIComponent(company)}`,
}))

const { default: Login } = await import('./Login')
const { useAuthStore } = await import('../store/auth.store')

function renderLogin(brand = DEFAULT_BRAND, path = '/login') {
  return render(
    <BrandContext.Provider value={brand}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<div>Forgot password page</div>} />
          <Route path="/dashboard" element={<div>Workspace dashboard</div>} />
          <Route path="/platform" element={<div>Platform console</div>} />
        </Routes>
      </MemoryRouter>
    </BrandContext.Provider>,
  )
}

async function signIn(email = 'sam@acme.test') {
  const user = userEvent.setup({ delay: null })
  await user.type(screen.getByLabelText('Email address'), email)
  await user.type(screen.getByLabelText('Password'), 'S3cur3P@ssword!')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

const WORKSPACE_USER = {
  email: 'sam@acme.test', name: 'Sam Lee', role: 'superadmin',
  company_id: 'cmp_acme', company_name: 'Acme Corp', client_id: 'cli_acme', client_name: 'Acme Holdings',
  workspace_kind: 'workspace', is_platform_admin: false,
}
const OWNER_USER = {
  email: 'owner@hirely.test', name: 'Olive Owner', role: 'superadmin',
  company_id: 'cmp_platform', company_name: 'Platform', client_id: 'cli_platform', client_name: 'Platform',
  workspace_kind: 'platform', is_platform_admin: true,
}

beforeEach(() => {
  login.mockReset()
  verifyOtp.mockReset()
  oidcConfig.mockReset().mockRejectedValue(new Error('no company'))
  useAuthStore.setState({ token: null, user: null })
})

describe('Login landing', () => {
  it('sends a workspace account to its dashboard and keeps the user it was told about', async () => {
    login.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER } })
    renderLogin()
    await signIn()

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    expect(login).toHaveBeenCalledWith('sam@acme.test', 'S3cur3P@ssword!')
    expect(useAuthStore.getState().token).toBe('tok_acme')
    expect(useAuthStore.getState().user).toEqual(WORKSPACE_USER)
  })

  it('sends an account in the platform workspace to the console', async () => {
    login.mockResolvedValue({ data: { access_token: 'tok_owner', user: OWNER_USER } })
    renderLogin()
    await signIn('owner@hirely.test')

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
    expect(useAuthStore.getState().user?.is_platform_admin).toBe(true)
  })

  it('sends a platform owner to the console even when the account is filed under a customer workspace', async () => {
    const both = { ...OWNER_USER, workspace_kind: 'workspace', company_id: 'cmp_default', company_name: 'Hirely' }
    login.mockResolvedValue({ data: { access_token: 'tok_both', user: both } })
    renderLogin()
    await signIn('owner@hirely.test')

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
    expect(useAuthStore.getState().user?.is_platform_admin).toBe(true)
  })

  it('treats an answer with no workspace fields as a workspace account', async () => {
    login.mockResolvedValue({ data: { access_token: 'tok', user: { email: 'old@x.test', role: 'admin' } } })
    renderLogin()
    await signIn('old@x.test')
    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('falls back to the typed email and the dashboard when the answer names no user', async () => {
    login.mockResolvedValue({ data: { access_token: 'tok' } })
    renderLogin()
    await signIn('typed@x.test')

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    expect(useAuthStore.getState().user).toEqual({ email: 'typed@x.test' })
  })

  it('lands by workspace after the one-time code as well', async () => {
    login.mockResolvedValue({ data: { otp_required: true } })
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok_owner', user: OWNER_USER } })
    renderLogin()
    const user = await signIn('owner@hirely.test')

    await user.type(await screen.findByLabelText('One-time code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    expect(await screen.findByText('Platform console')).toBeInTheDocument()
    expect(verifyOtp).toHaveBeenCalledWith('owner@hirely.test', '123456')
  })

  it('lands a workspace account on its dashboard after the one-time code', async () => {
    login.mockResolvedValue({ data: { otp_required: true } })
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER } })
    renderLogin()
    const user = await signIn()

    await user.type(await screen.findByLabelText('One-time code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('stays on the page and shows the server message when sign-in is refused', async () => {
    login.mockRejectedValue({ response: { status: 403, data: { detail: 'This workspace is suspended. Contact your administrator.' } } })
    renderLogin()
    await signIn()

    expect(await screen.findByText('This workspace is suspended. Contact your administrator.')).toBeInTheDocument()
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })
})

describe('Login: forgotten passwords', () => {
  it('links to the page that asks for a reset link', async () => {
    const user = userEvent.setup({ delay: null })
    renderLogin()
    const link = screen.getByRole('link', { name: 'Forgot your password?' })
    expect(link).toHaveAttribute('href', '/forgot-password')

    await user.click(link)
    expect(await screen.findByText('Forgot password page')).toBeInTheDocument()
  })

  it('does not offer it on the one-time code step', async () => {
    login.mockResolvedValue({ data: { otp_required: true } })
    renderLogin()
    await signIn()

    await screen.findByLabelText('One-time code')
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).not.toBeInTheDocument()
  })
})

describe('Login: what the address can say', () => {
  const SUSPENDED = 'This workspace is suspended. Contact your administrator.'

  it('says in an alert that the workspace is suspended when the session was ended for that', () => {
    renderLogin(DEFAULT_BRAND, '/login?suspended=1')
    expect(screen.getByRole('alert')).toHaveTextContent(SUSPENDED)
  })

  it('says nothing of the kind otherwise', () => {
    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })

  it('does not take another value of suspended for a suspension', () => {
    renderLogin(DEFAULT_BRAND, '/login?suspended=0')
    expect(screen.queryByText(SUSPENDED)).not.toBeInTheDocument()
  })

  it('keeps the notice above a sign-in failure rather than replacing it', async () => {
    login.mockRejectedValue({ response: { status: 401, data: { detail: 'Invalid email or password' } } })
    renderLogin(DEFAULT_BRAND, '/login?suspended=1')
    await signIn()

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(screen.getByText(SUSPENDED)).toBeInTheDocument()
  })

  it('welcomes a person back after they set a new password', () => {
    renderLogin(DEFAULT_BRAND, '/login?reset=1')
    expect(screen.getByRole('status')).toHaveTextContent('Your password has been updated. Sign in with the new one.')
  })

  it('welcomes a person who set a password from an invitation', () => {
    renderLogin(DEFAULT_BRAND, '/login?reset=invite')
    expect(screen.getByRole('status')).toHaveTextContent('Your password is set. Sign in to get started.')
  })

  it('shows no notice for a value it does not know', () => {
    renderLogin(DEFAULT_BRAND, '/login?reset=whatever')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('Login branding', () => {
  const logoText = () => document.querySelector('.login-brand-name')!

  it('names the product when no company is known', () => {
    renderLogin()
    expect(logoText()).toHaveTextContent('Hirely.ai')
    expect(document.querySelector('.login-brand img')).toBeNull()
    expect(document.querySelector('.login-brand svg')).not.toBeNull()
  })

  it('names the company, and shows its logo, when the page knows it', () => {
    renderLogin({ ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp', logoUrl: 'https://cdn.acme.test/logo.png' })

    expect(logoText()).toHaveTextContent('Acme Corp')
    expect(logoText()).not.toHaveTextContent('Hirely')
    const img = document.querySelector('.login-brand img')!
    expect(img).toHaveAttribute('src', 'https://cdn.acme.test/logo.png')
    expect(img).toHaveAttribute('alt', '')
    expect(document.querySelector('.login-brand svg')).toBeNull()
  })

  it('keeps the company name when only the logo is missing', async () => {
    renderLogin({ ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp' })
    await waitFor(() => expect(logoText()).toHaveTextContent('Acme Corp'))
    expect(document.querySelector('.login-brand svg')).not.toBeNull()
  })
})

describe('Login: the authenticator step', () => {
  async function toAuthenticatorStep(path = '/login') {
    login.mockResolvedValue({ data: { otp_required: true, method: 'totp', message: 'Enter your authenticator code' } })
    renderLogin(DEFAULT_BRAND, path)
    return signIn()
  }

  it('asks for an authenticator code, not the emailed one, and says a recovery code works in the same box', async () => {
    await toAuthenticatorStep()

    expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument()
    expect(screen.queryByLabelText('One-time code')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument()
    expect(screen.getByText(/Use a recovery code/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).not.toBeInTheDocument()
  })

  it('lets six digits through, with the spaces an app shows removed, and signs in', async () => {
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER } })
    const user = await toAuthenticatorStep()

    await user.type(await screen.findByLabelText('Authenticator code'), '123 456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    expect(verifyOtp).toHaveBeenCalledWith('sam@acme.test', '123456')
    expect(useAuthStore.getState().token).toBe('tok_acme')
  })

  it('takes a recovery code as typed and room for all eleven characters of it', async () => {
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER } })
    const user = await toAuthenticatorStep()

    const box = await screen.findByLabelText('Authenticator code')
    await user.type(box, 'abcde-12345')
    expect(box).toHaveValue('abcde-12345')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    await screen.findByText('Workspace dashboard')
    expect(verifyOtp).toHaveBeenCalledWith('sam@acme.test', 'abcde-12345')
  })

  it('tells the person how many recovery codes are left before it goes on', async () => {
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER, recovery_codes_left: 6 } })
    const user = await toAuthenticatorStep()

    await user.type(await screen.findByLabelText('Authenticator code'), 'abcde-12345')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    expect(await screen.findByRole('status')).toHaveTextContent('You used a recovery code. 6 codes remain.')
    expect(screen.queryByText('Workspace dashboard')).not.toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('tok_acme')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
  })

  it('says so when the last recovery code was used', async () => {
    verifyOtp.mockResolvedValue({ data: { access_token: 'tok', user: WORKSPACE_USER, recovery_codes_left: 0 } })
    const user = await toAuthenticatorStep()
    await user.type(await screen.findByLabelText('Authenticator code'), 'abcde-12345')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByRole('status')).toHaveTextContent('No recovery codes remain')
  })

  it('shows the server sentence for a code that did not work, and stays on the step', async () => {
    verifyOtp.mockRejectedValue({ response: { status: 401, data: { detail: 'Invalid or expired OTP' } } })
    const user = await toAuthenticatorStep()

    await user.type(await screen.findByLabelText('Authenticator code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    expect(await screen.findByText('Invalid or expired OTP')).toBeInTheDocument()
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('goes back to the password step and drops the code', async () => {
    const user = await toAuthenticatorStep()
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Back to login' }))

    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument()
  })

  it('keeps the emailed-code step exactly as it was for method email', async () => {
    login.mockResolvedValue({ data: { otp_required: true, method: 'email' } })
    renderLogin()
    await signIn()

    expect(await screen.findByLabelText('One-time code')).toBeInTheDocument()
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('Enter the 6-digit code we sent you.')).toBeInTheDocument()
  })
})

describe('Login: what the server refuses', () => {
  it('shows a locked sign-in (423) with its own message', async () => {
    login.mockRejectedValue({ response: { status: 423, data: { detail: 'Too many sign-in attempts. Try again later.' } } })
    renderLogin()
    await signIn()
    expect(await screen.findByText('Too many sign-in attempts. Try again later.')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('shows the single sign-on requirement (403) as the form error', async () => {
    login.mockRejectedValue({ response: { status: 403, data: { detail: 'Your company requires single sign-on.' } } })
    renderLogin()
    await signIn()
    expect(await screen.findByText('Your company requires single sign-on.')).toBeInTheDocument()
  })
})

describe('Login: a blocked workspace', () => {
  it.each([
    ['suspended', 'This workspace is suspended. Contact your administrator.'],
    ['trial', "This workspace's trial has ended. Ask your administrator to subscribe."],
    ['subscription', "This workspace's subscription has ended. Ask your administrator to renew."],
  ])('says the exact sentence for ?blocked=%s, in an alert', (reason, sentence) => {
    renderLogin(DEFAULT_BRAND, `/login?blocked=${reason}`)
    expect(screen.getByRole('alert')).toHaveTextContent(sentence)
  })

  it('still understands the older ?suspended=1', () => {
    renderLogin(DEFAULT_BRAND, '/login?suspended=1')
    expect(screen.getByRole('alert')).toHaveTextContent('This workspace is suspended. Contact your administrator.')
  })

  it('says nothing for a reason it does not know', () => {
    renderLogin(DEFAULT_BRAND, '/login?blocked=whatever')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Login: the company single sign-on', () => {
  const ENABLED = { data: { enabled: true, enforce: false, name: 'Okta' } }

  it('asks nobody when no company is known', () => {
    renderLogin()
    expect(oidcConfig).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /single sign-on/ })).not.toBeInTheDocument()
  })

  it('offers a plain link to the company login when the company has it on', async () => {
    oidcConfig.mockResolvedValue(ENABLED)
    renderLogin(DEFAULT_BRAND, '/login?company=acme')

    const link = await screen.findByRole('link', { name: 'Sign in with Okta single sign-on' })
    expect(link).toHaveAttribute('href', '/api/v1/sso/oidc/login?company=acme')
    expect(oidcConfig).toHaveBeenCalledWith('acme')
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('offers nothing when the company has not turned it on', async () => {
    oidcConfig.mockResolvedValue({ data: { enabled: false, enforce: false, name: '' } })
    renderLogin(DEFAULT_BRAND, '/login?company=acme')

    await waitFor(() => expect(oidcConfig).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /single sign-on/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('offers nothing, and the password form stays, when the configuration cannot be read', async () => {
    oidcConfig.mockRejectedValue({ response: { status: 404, data: { detail: 'Not found' } } })
    renderLogin(DEFAULT_BRAND, '/login?company=nobody')

    await waitFor(() => expect(oidcConfig).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /single sign-on/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('names the company when the answer has no name of its own', async () => {
    oidcConfig.mockResolvedValue({ data: { enabled: true, enforce: false } })
    renderLogin({ ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp' }, '/login?company=acme')
    expect(await screen.findByRole('link', { name: 'Sign in with Acme Corp single sign-on' })).toBeInTheDocument()
  })

  it('uses the slug of the company whose own domain this is when the address names none', async () => {
    oidcConfig.mockResolvedValue(ENABLED)
    renderLogin({ ...DEFAULT_BRAND, companyName: 'Acme Corp', companySlug: 'acme-corp' })

    const link = await screen.findByRole('link', { name: 'Sign in with Okta single sign-on' })
    expect(link).toHaveAttribute('href', '/api/v1/sso/oidc/login?company=acme-corp')
    expect(oidcConfig).toHaveBeenCalledWith('acme-corp')
  })

  it('prefers the company the link names over the one the domain belongs to', async () => {
    oidcConfig.mockResolvedValue(ENABLED)
    renderLogin({ ...DEFAULT_BRAND, companySlug: 'on-this-domain' }, '/login?company=from-link')
    await screen.findByRole('link', { name: /single sign-on/ })
    expect(oidcConfig).toHaveBeenCalledWith('from-link')
    expect(oidcConfig).not.toHaveBeenCalledWith('on-this-domain')
  })

  describe('when it is enforced', () => {
    beforeEach(() => oidcConfig.mockResolvedValue({ data: { enabled: true, enforce: true, name: 'Okta' } }))

    it('leads with single sign-on and hides the password form behind a small administrator toggle', async () => {
      renderLogin(DEFAULT_BRAND, '/login?company=acme')

      expect(await screen.findByRole('link', { name: 'Sign in with Okta single sign-on' })).toBeInTheDocument()
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Sign in with Google' })).not.toBeInTheDocument()
      const toggle = screen.getByRole('button', { name: 'Administrator sign-in' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens the password form for an administrator, who is exempt, and closes it again', async () => {
      login.mockResolvedValue({ data: { access_token: 'tok_acme', user: WORKSPACE_USER } })
      renderLogin(DEFAULT_BRAND, '/login?company=acme')
      const user = userEvent.setup({ delay: null })

      await user.click(await screen.findByRole('button', { name: 'Administrator sign-in' }))
      expect(screen.getByRole('button', { name: 'Administrator sign-in' })).toHaveAttribute('aria-expanded', 'true')
      await user.type(screen.getByLabelText('Email address'), 'sam@acme.test')
      await user.type(screen.getByLabelText('Password'), 'S3cur3P@ssword!')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(await screen.findByText('Workspace dashboard')).toBeInTheDocument()
    })

    it('shows the server sentence when an administrator-less account tries the password anyway', async () => {
      login.mockRejectedValue({ response: { status: 403, data: { detail: 'Your company requires single sign-on.' } } })
      renderLogin(DEFAULT_BRAND, '/login?company=acme')
      const user = userEvent.setup({ delay: null })
      await user.click(await screen.findByRole('button', { name: 'Administrator sign-in' }))
      await user.type(screen.getByLabelText('Email address'), 'bob@acme.test')
      await user.type(screen.getByLabelText('Password'), 'S3cur3P@ssword!')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(await screen.findByText('Your company requires single sign-on.')).toBeInTheDocument()
    })
  })
})

describe('Login: legal links', () => {
  it('shows Terms and Privacy from the brand, each in a new tab', () => {
    renderLogin({ ...DEFAULT_BRAND, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' })
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://acme.test/terms')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows neither when the company has set none', () => {
    renderLogin()
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
  })
})
