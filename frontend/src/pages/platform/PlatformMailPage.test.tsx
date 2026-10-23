import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMail = vi.fn()
const updateMail = vi.fn()
const verifyMail = vi.fn()
const testMail = vi.fn()

vi.mock('../../lib/api', () => ({
  companySettingsApi: {},
  platformApi: {
    getMail: (...a: unknown[]) => getMail(...a),
    updateMail: (...a: unknown[]) => updateMail(...a),
    verifyMail: (...a: unknown[]) => verifyMail(...a),
    testMail: (...a: unknown[]) => testMail(...a),
  },
}))

const { default: PlatformMailPage } = await import('./PlatformMailPage')

const DEFAULT_MAIL = {
  mode: 'platform', from_name: '', from_address: '', reply_to: '', host: '', port: null, username: '',
  use_tls: true, has_password: false, complete: false, updated_at: null, updated_by: null,
}
const OWN_MAIL = {
  ...DEFAULT_MAIL, mode: 'smtp', from_name: 'Talent Desk', from_address: 'no-reply@example.test',
  host: 'smtp.example.test', port: 587, username: 'relay', has_password: true, complete: true,
}

const user = () => userEvent.setup({ delay: null })

beforeEach(() => {
  for (const fn of [getMail, updateMail, verifyMail, testMail]) fn.mockReset()
  getMail.mockResolvedValue({ data: DEFAULT_MAIL })
  updateMail.mockImplementation(async (d: object) => ({ data: { ...OWN_MAIL, ...d } }))
  verifyMail.mockResolvedValue({ data: { ok: true, detail: 'Connected to the mail server and signed in.' } })
  testMail.mockResolvedValue({ data: { delivered: true, via: 'platform', detail: 'Sent' } })
})

describe('PlatformMailPage', () => {
  it('loads the platform mail settings with the default service selected', async () => {
    render(<PlatformMailPage />)
    expect(await screen.findByText('Platform mail')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Default service' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('Host')).not.toBeInTheDocument()
  })

  it('saves a new mail server through the platform endpoint', async () => {
    const u = user()
    render(<PlatformMailPage />)
    await u.click(await screen.findByRole('radio', { name: 'Your own mail server' }))
    await u.type(screen.getByPlaceholderText('no-reply@example.com'), 'no-reply@example.test')
    await u.type(screen.getByPlaceholderText('smtp.example.com'), 'smtp.example.test')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateMail).toHaveBeenCalledTimes(1))
    expect(updateMail.mock.calls[0][0]).toMatchObject({
      mode: 'smtp', from_address: 'no-reply@example.test', host: 'smtp.example.test',
    })
    expect(await screen.findByText('Mail settings saved')).toBeInTheDocument()
  })

  it('checks the connection and sends a test through the platform server', async () => {
    getMail.mockResolvedValue({ data: OWN_MAIL })
    const u = user()
    render(<PlatformMailPage />)
    await u.click(await screen.findByRole('button', { name: 'Check connection' }))
    expect(await screen.findByText(/Connection works/)).toBeInTheDocument()

    await u.type(screen.getByPlaceholderText('you@example.com'), 'me@example.test')
    await u.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(testMail).toHaveBeenCalledWith('me@example.test')
    expect(await screen.findByText('Delivered via your mail server')).toBeInTheDocument()
  })
})
