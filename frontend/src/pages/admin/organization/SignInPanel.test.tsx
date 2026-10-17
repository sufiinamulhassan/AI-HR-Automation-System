import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const usage = vi.fn()
const getSso = vi.fn()
const updateSso = vi.fn()
const testSso = vi.fn()

vi.mock('../../../lib/api', () => ({
  companySettingsApi: {
    usage: (...a: unknown[]) => usage(...a),
    getSso: (...a: unknown[]) => getSso(...a),
    updateSso: (...a: unknown[]) => updateSso(...a),
    testSso: (...a: unknown[]) => testSso(...a),
  },
}))

const { default: SignInPanel } = await import('./SignInPanel')

const SSO = {
  enabled: true, issuer: 'https://login.acme.test', client_id: 'client-1', has_client_secret: true,
  scopes: 'openid email profile', enforce: false,
  redirect_uri: 'https://app.hirely.test/api/v1/sso/oidc/callback', sso_domains: ['acme.test', 'acme.org'],
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const showToast = vi.fn()
const user = () => userEvent.setup({ delay: null })

async function renderPanel() {
  render(<SignInPanel showToast={showToast} />)
  await screen.findByLabelText('Issuer')
}

beforeEach(() => {
  for (const fn of [usage, getSso, updateSso, testSso, showToast]) fn.mockReset()
  usage.mockResolvedValue({ data: { features: { oidc_sso: true } } })
  getSso.mockResolvedValue({ data: SSO })
  updateSso.mockImplementation(async (d: object) => ({ data: { ...SSO, ...d, client_secret: undefined } }))
  testSso.mockResolvedValue({ data: { ok: true, detail: 'Discovery document found' } })
})

afterEach(() => { vi.restoreAllMocks() })

describe('the plan', () => {
  it('shows the section collapsed with the plan sentence, and no form, when the plan lacks single sign-on', async () => {
    usage.mockResolvedValue({ data: { features: { oidc_sso: false } } })
    render(<SignInPanel showToast={showToast} />)
    expect(await screen.findByText('Your plan does not include single sign-on.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Issuer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(getSso).not.toHaveBeenCalled()
  })

  it('shows the server sentence for a 402', async () => {
    getSso.mockRejectedValue(httpError(402, 'Your plan does not include OIDC single sign-on.'))
    render(<SignInPanel showToast={showToast} />)
    expect(await screen.findByText('Your plan does not include OIDC single sign-on.')).toBeInTheDocument()
  })
})

describe('the settings', () => {
  it('shows what is saved, with the client secret only as saved', async () => {
    await renderPanel()
    expect(screen.getByLabelText('Enable single sign-on')).toBeChecked()
    expect(screen.getByLabelText('Issuer')).toHaveValue('https://login.acme.test')
    expect(screen.getByLabelText('Client ID')).toHaveValue('client-1')
    expect(screen.getByLabelText('Scopes')).toHaveValue('openid email profile')
    expect(screen.getByText('Client secret saved')).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('explains in the field help what requiring it does', async () => {
    await renderPanel()
    expect(screen.getByLabelText('Require single sign-on')).not.toBeChecked()
    expect(screen.getByText(/Super Admins can still use their password/)).toBeInTheDocument()
  })

  it('shows the redirect address read-only, and copies it', async () => {
    const u = user()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await renderPanel()
    const box = screen.getByLabelText('Redirect URI to register with your provider')
    expect(box).toHaveValue(SSO.redirect_uri)
    expect(box).toHaveAttribute('readonly')
    await u.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith(SSO.redirect_uri)
    expect(showToast).toHaveBeenCalledWith('Redirect address copied')
  })

  it('lists the domains the platform assigned, read-only, and says who assigns them', async () => {
    await renderPanel()
    const list = screen.getByRole('list', { name: 'Email domains' })
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(['acme.test', 'acme.org'])
    expect(screen.getByText(/Assigned by the platform/)).toBeInTheDocument()
    expect(within(list).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says there are none yet, and that the platform assigns them', async () => {
    getSso.mockResolvedValue({ data: { ...SSO, sso_domains: [] } })
    await renderPanel()
    expect(screen.getByText(/None yet\. Domains are assigned by the platform\./)).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('keeps Save disabled until something changes, then sends only what changed', async () => {
    const u = user()
    await renderPanel()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await u.click(screen.getByLabelText('Require single sign-on'))
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateSso).toHaveBeenCalledWith({ enforce: true }))
    expect(showToast).toHaveBeenCalledWith('Sign-in settings saved')
  })

  it('sends a new secret when one is typed after Change, and goes back to saved', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Change' }))
    await u.type(screen.getByLabelText('Client secret'), 'new-secret')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSso).toHaveBeenCalledWith({ client_secret: 'new-secret' }))
    expect(await screen.findByText('Client secret saved')).toBeInTheDocument()
  })

  it('asks for the secret again when the issuer changes, and does not send without it', async () => {
    const u = user()
    await renderPanel()
    await u.clear(screen.getByLabelText('Issuer'))
    await u.type(screen.getByLabelText('Issuer'), 'https://sso.acme.test')

    expect(screen.getByRole('alert')).toHaveTextContent('Enter the client secret again when you change the issuer or the client ID.')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Change' }))
    await u.type(screen.getByLabelText('Client secret'), 'secret-2')
    expect(screen.queryByText(/Enter the client secret again/)).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSso).toHaveBeenCalledWith({ issuer: 'https://sso.acme.test', client_secret: 'secret-2' }))
  })

  it('asks for the secret again when the client ID changes', async () => {
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Client ID'), '-b')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByText(/Enter the client secret again/)).toBeInTheDocument()
  })

  it('shows the server sentence for a refused save', async () => {
    updateSso.mockRejectedValue(httpError(400, 'The issuer must be an https address.'))
    const u = user()
    await renderPanel()
    await u.click(screen.getByLabelText('Enable single sign-on'))
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByText('The issuer must be an https address.')).toBeInTheDocument()
  })

  it('shows a failed read with a retry', async () => {
    getSso.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: SSO })
    render(<SignInPanel showToast={showToast} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the sign-in settings.')
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Issuer')).toBeInTheDocument()
  })
})

describe('the Test button', () => {
  it('tests with the issuer on screen and says it works', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Works: Discovery document found')).toBeInTheDocument()
    expect(testSso).toHaveBeenCalledWith('https://login.acme.test')
  })

  it('tests an issuer typed but not saved yet', async () => {
    const u = user()
    await renderPanel()
    await u.clear(screen.getByLabelText('Issuer'))
    await u.type(screen.getByLabelText('Issuer'), 'https://new.acme.test')
    await u.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(testSso).toHaveBeenCalledWith('https://new.acme.test'))
  })

  it('says it failed, with the reason', async () => {
    testSso.mockResolvedValue({ data: { ok: false, detail: 'No discovery document at that address' } })
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Failed: No discovery document at that address')).toBeInTheDocument()
  })

  it('shows the server sentence when the test itself is refused', async () => {
    testSso.mockRejectedValue(httpError(400, 'That address is not allowed.'))
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Failed: That address is not allowed.')).toBeInTheDocument()
  })
})
