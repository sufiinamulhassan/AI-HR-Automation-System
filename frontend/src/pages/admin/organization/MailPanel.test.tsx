import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const usage = vi.fn()
const getMail = vi.fn()
const updateMail = vi.fn()
const verifyMail = vi.fn()
const testMail = vi.fn()

vi.mock('../../../lib/api', () => ({
  companySettingsApi: {
    usage: (...a: unknown[]) => usage(...a),
    getMail: (...a: unknown[]) => getMail(...a),
    updateMail: (...a: unknown[]) => updateMail(...a),
    verifyMail: (...a: unknown[]) => verifyMail(...a),
    testMail: (...a: unknown[]) => testMail(...a),
  },
}))

const { default: MailPanel } = await import('./MailPanel')

const PLATFORM_MAIL = {
  mode: 'platform', from_name: '', from_address: '', reply_to: '', host: '', port: null, username: '',
  use_tls: true, has_password: false, complete: false, updated_at: null, updated_by: null,
}
const OWN_MAIL = {
  mode: 'smtp', from_name: 'Acme Hiring', from_address: 'hiring@acme.test', reply_to: 'hr@acme.test',
  host: 'smtp.acme.test', port: 587, username: 'mailer', use_tls: true, has_password: true, complete: true,
  updated_at: '2026-10-01T10:00:00Z', updated_by: 'sam@acme.test',
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const showToast = vi.fn()
const user = () => userEvent.setup({ delay: null })

async function renderPanel() {
  render(<MailPanel showToast={showToast} />)
  await screen.findByText('Send email through')
}

beforeEach(() => {
  for (const fn of [usage, getMail, updateMail, verifyMail, testMail, showToast]) fn.mockReset()
  usage.mockResolvedValue({ data: { features: { custom_smtp: true } } })
  getMail.mockResolvedValue({ data: OWN_MAIL })
  updateMail.mockImplementation(async (d: object) => ({ data: { ...OWN_MAIL, ...d, password: undefined } }))
  verifyMail.mockResolvedValue({ data: { ok: true, detail: 'Logged in to smtp.acme.test' } })
  testMail.mockResolvedValue({ data: { delivered: true, via: 'company', detail: 'Sent' } })
})

describe('the plan', () => {
  it('shows the section collapsed with the plan sentence, and no form, when the plan lacks it', async () => {
    usage.mockResolvedValue({ data: { features: { custom_smtp: false } } })
    render(<MailPanel showToast={showToast} />)

    expect(await screen.findByText('Your plan does not include a custom mail server.')).toBeInTheDocument()
    expect(screen.getByText('Company mail')).toBeInTheDocument()
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
    expect(getMail).not.toHaveBeenCalled()
  })

  it('treats a flag the server leaves out as on', async () => {
    usage.mockResolvedValue({ data: { features: {} } })
    await renderPanel()
    expect(getMail).toHaveBeenCalled()
  })

  it('shows the server sentence for a 402 even when the usage said the feature was on', async () => {
    getMail.mockRejectedValue(httpError(402, 'Your plan does not include Custom SMTP.'))
    render(<MailPanel showToast={showToast} />)
    expect(await screen.findByText('Your plan does not include Custom SMTP.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument()
  })
})

describe('the mode', () => {
  it('offers the platform and the own server, and shows the form only for the own server', async () => {
    getMail.mockResolvedValue({ data: PLATFORM_MAIL })
    const u = user()
    await renderPanel()

    expect(screen.getByRole('radio', { name: 'The platform' })).toBeChecked()
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument()
    expect(screen.getByText(/go out from the platform's sender/)).toBeInTheDocument()

    await u.click(screen.getByRole('radio', { name: 'Your own mail server' }))
    expect(screen.getByLabelText('Host')).toBeInTheDocument()
    expect(screen.getByLabelText('Use TLS')).toBeChecked()
  })

  it('says whether the own-server settings are complete, and what that means', async () => {
    await renderPanel()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText(/not sent another way if it fails/)).toBeInTheDocument()
  })

  it('says it is incomplete and that the own server is not used until it is complete', async () => {
    getMail.mockResolvedValue({ data: { ...OWN_MAIL, complete: false, host: '' } })
    await renderPanel()
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
    expect(screen.getByText(/used only when the settings are complete/)).toBeInTheDocument()
  })
})

describe('the form', () => {
  it('fills every field from what is saved, and never shows the password', async () => {
    await renderPanel()
    expect(screen.getByLabelText('From name')).toHaveValue('Acme Hiring')
    expect(screen.getByLabelText('From address')).toHaveValue('hiring@acme.test')
    expect(screen.getByLabelText('Reply-to address')).toHaveValue('hr@acme.test')
    expect(screen.getByLabelText('Host')).toHaveValue('smtp.acme.test')
    expect(screen.getByLabelText('Port')).toHaveValue('587')
    expect(screen.getByLabelText('Username')).toHaveValue('mailer')
    expect(screen.getByText('Password saved')).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByText(/Last saved/)).toHaveTextContent('by sam@acme.test')
  })

  it('keeps Save disabled until something changes, then sends only what changed', async () => {
    const u = user()
    await renderPanel()
    const save = screen.getByRole('button', { name: 'Save Changes' })
    expect(save).toBeDisabled()

    await u.clear(screen.getByLabelText('Host'))
    await u.type(screen.getByLabelText('Host'), 'mail.acme.test')
    expect(save).toBeEnabled()
    await u.click(save)

    await waitFor(() => expect(updateMail).toHaveBeenCalledWith({ host: 'mail.acme.test' }))
    expect(showToast).toHaveBeenCalledWith('Mail settings saved')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled())
  })

  it('sends the port as a number, and TLS off as a boolean', async () => {
    const u = user()
    await renderPanel()
    await u.clear(screen.getByLabelText('Port'))
    await u.type(screen.getByLabelText('Port'), '465')
    await u.click(screen.getByLabelText('Use TLS'))
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateMail).toHaveBeenCalledWith({ port: 465, use_tls: false }))
  })

  it('refuses a port the server would refuse, before asking it', async () => {
    const u = user()
    await renderPanel()
    await u.clear(screen.getByLabelText('Port'))
    await u.type(screen.getByLabelText('Port'), '8080')
    expect(screen.getByRole('alert')).toHaveTextContent('Use port 25, 465, 587 or 2525.')
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(updateMail).not.toHaveBeenCalled()
  })

  it('switches to the platform and sends just the mode', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('radio', { name: 'The platform' }))
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateMail).toHaveBeenCalledWith({ mode: 'platform' }))
  })

  it('shows the server sentence when a save is refused, and keeps what was typed', async () => {
    updateMail.mockRejectedValue(httpError(400, 'That host is not allowed.'))
    const u = user()
    await renderPanel()
    await u.clear(screen.getByLabelText('Host'))
    await u.type(screen.getByLabelText('Host'), '10.0.0.5')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('That host is not allowed.')).toBeInTheDocument()
    expect(screen.getByLabelText('Host')).toHaveValue('10.0.0.5')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('shows a failed read with a retry that reads again', async () => {
    getMail.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: OWN_MAIL })
    render(<MailPanel showToast={showToast} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the mail settings.')
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Host')).toBeInTheDocument()
  })
})

describe('the password', () => {
  it('is replaced by typing a new one after Change, and sent as password', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Change' }))
    await u.type(screen.getByLabelText('Password'), 'n3w-secret')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateMail).toHaveBeenCalledWith({ password: 'n3w-secret' }))
    expect(await screen.findByText('Password saved')).toBeInTheDocument()
  })

  it('can be kept after Change was clicked', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Change' }))
    await u.type(screen.getByLabelText('Password'), 'oops')
    await u.click(screen.getByRole('button', { name: 'Keep the saved one' }))
    expect(screen.getByText('Password saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  it('is removed on save, not at once, and Undo takes the removal back', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Remove' }))
    expect(updateMail).not.toHaveBeenCalled()
    expect(screen.getByText('Password will be removed')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Password saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Remove' }))
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateMail).toHaveBeenCalledWith({ clear_password: true }))
  })

  it('shows a plain field when none is saved yet', async () => {
    getMail.mockResolvedValue({ data: { ...OWN_MAIL, has_password: false } })
    await renderPanel()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
  })
})

describe('checking the settings', () => {
  it('checks the connection and says it works, with what the server said', async () => {
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Check connection' }))
    expect(await screen.findByText('Connection works: Logged in to smtp.acme.test')).toBeInTheDocument()
    expect(verifyMail).toHaveBeenCalledTimes(1)
  })

  it('says it failed, with the reason, when the server could not be reached', async () => {
    verifyMail.mockResolvedValue({ data: { ok: false, detail: 'Login was refused' } })
    const u = user()
    await renderPanel()
    await u.click(screen.getByRole('button', { name: 'Check connection' }))
    expect(await screen.findByText('Connection failed: Login was refused')).toBeInTheDocument()
  })

  it('waits for a save: with unsaved changes the checks are disabled and say why', async () => {
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Username'), 'x')
    expect(screen.getByText('Save your changes before checking them.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send a test email' })).toBeDisabled()
  })

  it('sends a test email to the address typed, and says whose sender delivered it', async () => {
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Send a test email to'), 'me@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText('Delivered via your mail server')).toBeInTheDocument()
    expect(testMail).toHaveBeenCalledWith('me@acme.test')
  })

  it('says it went through the platform when the server says so', async () => {
    testMail.mockResolvedValue({ data: { delivered: true, via: 'platform', detail: 'Sent' } })
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Send a test email to'), 'me@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText("Delivered via the platform's sender")).toBeInTheDocument()
  })

  it('says it was not delivered, with the reason', async () => {
    testMail.mockResolvedValue({ data: { delivered: false, via: 'company', detail: 'Mailbox unavailable' } })
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Send a test email to'), 'me@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText('Not delivered via your mail server: Mailbox unavailable')).toBeInTheDocument()
  })

  it('shows the 429 sentence when test emails are asked for too often', async () => {
    testMail.mockRejectedValue(httpError(429, 'Too many test emails. Try again later.'))
    const u = user()
    await renderPanel()
    await u.type(screen.getByLabelText('Send a test email to'), 'me@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText('Too many test emails. Try again later.')).toBeInTheDocument()
  })

  it('needs an address before it will send', async () => {
    await renderPanel()
    expect(screen.getByRole('button', { name: 'Send a test email' })).toBeDisabled()
    expect(within(document.body).queryByText(/Delivered/)).not.toBeInTheDocument()
  })
})
