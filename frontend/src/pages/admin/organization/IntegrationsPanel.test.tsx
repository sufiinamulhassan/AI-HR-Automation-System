import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const usage = vi.fn()
const listIntegrations = vi.fn()
const updateIntegration = vi.fn()

vi.mock('../../../lib/api', () => ({
  companySettingsApi: {
    usage: (...a: unknown[]) => usage(...a),
    listIntegrations: (...a: unknown[]) => listIntegrations(...a),
    updateIntegration: (...a: unknown[]) => updateIntegration(...a),
  },
}))

const { default: IntegrationsPanel } = await import('./IntegrationsPanel')

const VIEWS = {
  hrms: {
    name: 'hrms', url: 'https://hr.acme.test/api', auth_header: 'Authorization', auto_push_on_hire: true,
    has_auth_token: true, configured: true, source: 'company', updated_at: '2026-10-01T10:00:00Z', updated_by: 'sam@acme.test',
  },
  zoom: { name: 'zoom', account_id: '', client_id: '', has_client_secret: false, configured: false, source: null },
  teams: {
    name: 'teams', tenant_id: 'tenant-1', client_id: 'teams-client', organizer: 'recruiting@acme.test',
    has_client_secret: true, configured: true, source: 'company',
  },
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const user = () => userEvent.setup({ delay: null })
const card = (title: string) => screen.getByText(title, { selector: '.card-title' }).closest('.card') as HTMLElement

async function renderPanel() {
  render(<IntegrationsPanel />)
  await screen.findByText('HR system', { selector: '.card-title' })
}

beforeEach(() => {
  for (const fn of [usage, listIntegrations, updateIntegration]) fn.mockReset()
  usage.mockResolvedValue({ data: { features: { integrations: true } } })
  listIntegrations.mockResolvedValue({ data: { integrations: VIEWS } })
  updateIntegration.mockImplementation(async (name: keyof typeof VIEWS, d: object) => ({ data: { ...VIEWS[name], ...d } }))
})

describe('the plan', () => {
  it('shows the section collapsed with the plan sentence, and no cards, when the plan lacks integrations', async () => {
    usage.mockResolvedValue({ data: { features: { integrations: false } } })
    render(<IntegrationsPanel />)
    expect(await screen.findByText('Your plan does not include integrations.')).toBeInTheDocument()
    expect(screen.queryByText('Zoom')).not.toBeInTheDocument()
    expect(listIntegrations).not.toHaveBeenCalled()
  })

  it('shows the server sentence for a 402', async () => {
    listIntegrations.mockRejectedValue(httpError(402, 'Your plan does not include Integrations.'))
    render(<IntegrationsPanel />)
    expect(await screen.findByText('Your plan does not include Integrations.')).toBeInTheDocument()
  })

  it('shows a failed read with a retry', async () => {
    listIntegrations.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: { integrations: VIEWS } })
    render(<IntegrationsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the integrations.')
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Zoom', { selector: '.card-title' })).toBeInTheDocument()
  })
})

describe('the cards', () => {
  it('shows an HR system, Zoom and Teams, each with its state', async () => {
    await renderPanel()
    expect(within(card('HR system')).getByText('Configured')).toBeInTheDocument()
    expect(within(card('Zoom')).getByText('Not configured')).toBeInTheDocument()
    expect(within(card('Microsoft Teams')).getByText('Configured')).toBeInTheDocument()
  })

  it('fills the HR system fields from what is saved, with the token only as saved', async () => {
    await renderPanel()
    const hr = within(card('HR system'))
    expect(hr.getByLabelText('Endpoint URL')).toHaveValue('https://hr.acme.test/api')
    expect(hr.getByLabelText('Authorization header')).toHaveValue('Authorization')
    expect(hr.getByLabelText('Send the candidate when they are hired')).toBeChecked()
    expect(hr.getByText('Token saved')).toBeInTheDocument()
  })

  it('shows no secret in any card', async () => {
    await renderPanel()
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) expect(input.value).toBe('')
  })

  it('says a system uses the platform account instead of Configured', async () => {
    listIntegrations.mockResolvedValue({
      data: { integrations: { ...VIEWS, zoom: { ...VIEWS.zoom, source: 'platform', configured: true } } },
    })
    await renderPanel()
    const zoom = within(card('Zoom'))
    expect(zoom.getByText("Using the platform's account")).toBeInTheDocument()
    expect(zoom.queryByText('Configured')).not.toBeInTheDocument()
    expect(zoom.getByLabelText('Account ID')).toBeInTheDocument()
  })
})

describe('saving one card', () => {
  it('keeps Save disabled until something in that card changes', async () => {
    await renderPanel()
    for (const t of ['HR system', 'Zoom', 'Microsoft Teams']) {
      expect(within(card(t)).getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    }
  })

  it('sends only the changed fields of that card, and the secret only when typed', async () => {
    const u = user()
    await renderPanel()
    const zoom = within(card('Zoom'))
    await u.type(zoom.getByLabelText('Account ID'), 'acc-1')
    await u.type(zoom.getByLabelText('Client ID'), 'zoom-client')
    await u.type(zoom.getByLabelText('Client secret'), 'zoom-secret')
    await u.click(zoom.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateIntegration).toHaveBeenCalledWith('zoom', {
      account_id: 'acc-1', client_id: 'zoom-client', client_secret: 'zoom-secret',
    }))
    expect(updateIntegration).toHaveBeenCalledTimes(1)
    expect(await within(card('Zoom')).findByText('Saved')).toBeInTheDocument()
  })

  it('sends the switch of the HR system as a boolean', async () => {
    const u = user()
    await renderPanel()
    const hr = within(card('HR system'))
    await u.click(hr.getByLabelText('Send the candidate when they are hired'))
    await u.click(hr.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateIntegration).toHaveBeenCalledWith('hrms', { auto_push_on_hire: false }))
  })

  it('replaces a saved token after Change, with the token sent as auth_token', async () => {
    const u = user()
    await renderPanel()
    const hr = within(card('HR system'))
    await u.click(hr.getByRole('button', { name: 'Change' }))
    await u.type(hr.getByLabelText('Token'), 'tok-2')
    await u.click(hr.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateIntegration).toHaveBeenCalledWith('hrms', { auth_token: 'tok-2' }))
    expect(await within(card('HR system')).findByText('Token saved')).toBeInTheDocument()
  })

  it('removes a saved secret only on save, as clear_secret', async () => {
    const u = user()
    await renderPanel()
    const teams = within(card('Microsoft Teams'))
    await u.click(teams.getByRole('button', { name: 'Remove' }))
    expect(updateIntegration).not.toHaveBeenCalled()
    expect(teams.getByText('Client secret will be removed')).toBeInTheDocument()
    await u.click(teams.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateIntegration).toHaveBeenCalledWith('teams', { clear_secret: true }))
  })

  it('shows the server sentence in that card only when a save is refused', async () => {
    updateIntegration.mockRejectedValue(httpError(400, 'The endpoint must be an https address.'))
    const u = user()
    await renderPanel()
    const hr = within(card('HR system'))
    await u.clear(hr.getByLabelText('Endpoint URL'))
    await u.type(hr.getByLabelText('Endpoint URL'), 'http://x')
    await u.click(hr.getByRole('button', { name: 'Save Changes' }))
    expect(await hr.findByText('The endpoint must be an https address.')).toBeInTheDocument()
    expect(within(card('Zoom')).queryByRole('alert')).not.toBeInTheDocument()
    expect(hr.getByLabelText('Endpoint URL')).toHaveValue('http://x')
  })

  it('collapses to the plan sentence when a save answers 402', async () => {
    updateIntegration.mockRejectedValue(httpError(402, 'Your plan does not include Integrations.'))
    const u = user()
    await renderPanel()
    const zoom = within(card('Zoom'))
    await u.type(zoom.getByLabelText('Account ID'), 'a')
    await u.click(zoom.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByText('Your plan does not include Integrations.')).toBeInTheDocument()
    expect(screen.queryByText('Zoom', { selector: '.card-title' })).not.toBeInTheDocument()
  })
})
