import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPolicies = vi.fn()
const updatePolicies = vi.fn()
const myPermissions = vi.fn()

vi.mock('../../../lib/api', () => ({
  securityPoliciesApi: {
    get: (...a: unknown[]) => getPolicies(...a),
    update: (...a: unknown[]) => updatePolicies(...a),
  },
  authApi: {
    myPermissions: (...a: unknown[]) => myPermissions(...a),
  },
}))

const { default: PlatformSettingsPage } = await import('../PlatformSettingsPage')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformSettingsPage />
    </MemoryRouter>
  )
}

function httpError(status: number, detail: string) {
  return { response: { status, data: { detail } } }
}

const DEFAULT_POLICIES = {
  password_min_length: 1,
  password_require_number: false,
  password_require_symbol: false,
  max_login_attempts_before_lockout: 0,
  account_lockout_duration_minutes: 15,
  session_timeout_minutes: null,
}

describe('Security Policies tab (Platform Settings)', () => {
  beforeEach(() => {
    getPolicies.mockReset().mockResolvedValue({ data: DEFAULT_POLICIES })
    updatePolicies.mockReset()
    myPermissions.mockReset().mockResolvedValue({
      data: { role: 'superadmin', permissions: ['jobs:read', 'security:manage'] },
    })
  })

  it('selects the tab via ?tab=security', async () => {
    renderAt('/dashboard/settings?tab=security')
    expect(await screen.findByRole('tab', { name: 'Security Policies' })).toHaveAttribute('aria-selected', 'true')
    expect(getPolicies).toHaveBeenCalled()
  })

  it('loads and displays the current policy values', async () => {
    getPolicies.mockResolvedValue({
      data: { ...DEFAULT_POLICIES, password_min_length: 10, password_require_number: true, session_timeout_minutes: 45 },
    })
    renderAt('/dashboard/settings?tab=security')

    expect(await screen.findByDisplayValue('10')).toBeInTheDocument()
    expect(screen.getByLabelText(/require a number/i)).toBeChecked()
    expect(screen.getByLabelText(/require a symbol/i)).not.toBeChecked()
    expect(screen.getByLabelText(/override the platform's default session timeout/i)).toBeChecked()
    expect(screen.getByDisplayValue('45')).toBeInTheDocument()
  })

  it('keeps the session timeout override off, and its field hidden, by default', async () => {
    renderAt('/dashboard/settings?tab=security')
    await screen.findByLabelText(/minimum password length/i)

    expect(screen.getByLabelText(/override the platform's default session timeout/i)).not.toBeChecked()
    expect(screen.queryByLabelText(/^session timeout \(minutes\)$/i)).not.toBeInTheDocument()
  })

  it('saves changes and shows a success toast', async () => {
    const user = userEvent.setup()
    updatePolicies.mockResolvedValue({ data: { ...DEFAULT_POLICIES, password_min_length: 8 } })
    renderAt('/dashboard/settings?tab=security')

    const input = await screen.findByLabelText(/minimum password length/i)
    await user.clear(input)
    await user.type(input, '8')
    await user.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(updatePolicies).toHaveBeenCalledWith(expect.objectContaining({ password_min_length: 8 })))
    expect(await screen.findByText('Security policies saved')).toBeInTheDocument()
  })

  it('sends session_timeout_minutes: null while the override is unchecked', async () => {
    const user = userEvent.setup()
    updatePolicies.mockResolvedValue({ data: DEFAULT_POLICIES })
    renderAt('/dashboard/settings?tab=security')

    await screen.findByLabelText(/minimum password length/i)
    await user.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(updatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({ session_timeout_minutes: null }),
    ))
  })

  it('enables the session timeout field and sends a value once the override is checked', async () => {
    const user = userEvent.setup()
    updatePolicies.mockResolvedValue({ data: { ...DEFAULT_POLICIES, session_timeout_minutes: 90 } })
    renderAt('/dashboard/settings?tab=security')

    await user.click(await screen.findByLabelText(/override the platform's default session timeout/i))
    const sessionInput = screen.getByLabelText(/^session timeout \(minutes\)$/i)
    await user.clear(sessionInput)
    await user.type(sessionInput, '90')
    await user.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(updatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({ session_timeout_minutes: 90 }),
    ))
  })

  it('surfaces a backend validation error from a failed save', async () => {
    const user = userEvent.setup()
    updatePolicies.mockRejectedValue(httpError(400, 'password_min_length must be an integer >= 1'))
    renderAt('/dashboard/settings?tab=security')

    await screen.findByLabelText(/minimum password length/i)
    await user.click(screen.getByText('Save Changes'))

    expect(await screen.findByText('password_min_length must be an integer >= 1')).toBeInTheDocument()
  })

  it('rejects an invalid lockout duration client-side before ever calling the backend', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/settings?tab=security')

    const lockoutInput = await screen.findByLabelText(/lockout duration/i)
    await user.clear(lockoutInput)
    await user.type(lockoutInput, '0')
    await user.click(screen.getByText('Save Changes'))

    expect(await screen.findByText(/lockout duration must be/i)).toBeInTheDocument()
    expect(updatePolicies).not.toHaveBeenCalled()
  })

  it('rejects a blank minimum password length client-side before ever calling the backend', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/settings?tab=security')

    const input = await screen.findByLabelText(/minimum password length/i)
    await user.clear(input)
    await user.click(screen.getByText('Save Changes'))

    expect(await screen.findByText(/minimum password length must be/i)).toBeInTheDocument()
    expect(updatePolicies).not.toHaveBeenCalled()
  })

  it('shows a plain notice instead of the form when the read itself is refused', async () => {
    getPolicies.mockRejectedValue(httpError(403, 'Forbidden'))
    renderAt('/dashboard/settings?tab=security')

    expect(await screen.findByText('Your role cannot view the security policies.')).toBeInTheDocument()
    expect(screen.queryByText(/security:manage/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/minimum password length/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Save Changes')).not.toBeInTheDocument()
  })

  describe('without the security:manage permission (an HR Admin)', () => {
    beforeEach(() => {
      myPermissions.mockResolvedValue({ data: { role: 'admin', permissions: ['jobs:read'] } })
    })

    it('shows the stored values read-only, with no Save button', async () => {
      getPolicies.mockResolvedValue({
        data: { ...DEFAULT_POLICIES, password_min_length: 12, password_require_symbol: true, session_timeout_minutes: 30 },
      })
      renderAt('/dashboard/settings?tab=security')

      const length = await screen.findByLabelText(/minimum password length/i)
      expect(length).toHaveValue(12)
      expect(length).toBeDisabled()
      expect(screen.getByLabelText(/require a symbol/i)).toBeChecked()
      expect(screen.getByLabelText(/require a symbol/i)).toBeDisabled()
      expect(screen.getByLabelText(/require a number/i)).toBeDisabled()
      expect(screen.getByLabelText(/max failed login attempts/i)).toBeDisabled()
      expect(screen.getByLabelText(/lockout duration/i)).toBeDisabled()
      expect(screen.getByLabelText(/override the platform's default session timeout/i)).toBeDisabled()
      expect(screen.getByLabelText(/^session timeout \(minutes\)$/i)).toBeDisabled()
      expect(screen.getByText('Read only')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
    })

    it('never writes', async () => {
      renderAt('/dashboard/settings?tab=security')
      await screen.findByLabelText(/minimum password length/i)

      expect(updatePolicies).not.toHaveBeenCalled()
    })

    it('reads the policy without any error or permission notice', async () => {
      renderAt('/dashboard/settings?tab=security')
      await screen.findByLabelText(/minimum password length/i)

      expect(getPolicies).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText(/security:manage/)).not.toBeInTheDocument()
      expect(screen.queryByText('Your role cannot view the security policies.')).not.toBeInTheDocument()
    })

    it('still shows who last saved it, without a Save button', async () => {
      getPolicies.mockResolvedValue({
        data: { ...DEFAULT_POLICIES, updated_at: '2025-03-01T10:00:00Z', updated_by: 'root@x.com' },
      })
      renderAt('/dashboard/settings?tab=security')

      expect(await screen.findByText(/Last saved .* by root@x\.com/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
    })

    it('does not send a save when a disabled field is changed by script or click', async () => {
      const user = userEvent.setup()
      renderAt('/dashboard/settings?tab=security')

      await user.click(await screen.findByLabelText(/require a number/i))
      expect(screen.getByLabelText(/require a number/i)).not.toBeChecked()
      expect(updatePolicies).not.toHaveBeenCalled()
    })
  })

  it('does not label the form read-only for someone who can save', async () => {
    renderAt('/dashboard/settings?tab=security')

    await screen.findByLabelText(/minimum password length/i)
    expect(screen.queryByText('Read only')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/minimum password length/i)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  describe('when the stored policy cannot be loaded', () => {
    it('shows an error with Retry instead of the defaults, and offers no Save', async () => {
      getPolicies.mockRejectedValue(httpError(500, 'Policy store unavailable'))
      renderAt('/dashboard/settings?tab=security')

      expect(await screen.findByRole('alert')).toHaveTextContent('Policy store unavailable')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      expect(screen.queryByLabelText(/minimum password length/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
      expect(screen.queryByText('Read only')).not.toBeInTheDocument()
      expect(updatePolicies).not.toHaveBeenCalled()
    })

    it('falls back to a generic message when the error carries no detail', async () => {
      getPolicies.mockRejectedValue(new Error('Network Error'))
      renderAt('/dashboard/settings?tab=security')

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the security policies.')
    })

    it('loads the real values after Retry', async () => {
      const user = userEvent.setup()
      getPolicies.mockRejectedValueOnce(httpError(502, 'Bad gateway'))
      getPolicies.mockResolvedValue({ data: { ...DEFAULT_POLICIES, password_min_length: 14 } })
      renderAt('/dashboard/settings?tab=security')

      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      expect(await screen.findByDisplayValue('14')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
      expect(getPolicies).toHaveBeenCalledTimes(2)
    })

    it('shows an error with Retry, and no form, when the permissions cannot be read', async () => {
      const user = userEvent.setup()
      myPermissions.mockRejectedValueOnce(httpError(500, 'Permissions unavailable'))
      renderAt('/dashboard/settings?tab=security')

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your permissions.')
      expect(screen.queryByLabelText(/minimum password length/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByLabelText(/minimum password length/i)).toBeEnabled()
    })

    it('still treats a 403 as the plain notice, not an error', async () => {
      getPolicies.mockRejectedValue(httpError(403, 'Forbidden'))
      renderAt('/dashboard/settings?tab=security')

      expect(await screen.findByText('Your role cannot view the security policies.')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    })
  })
})
