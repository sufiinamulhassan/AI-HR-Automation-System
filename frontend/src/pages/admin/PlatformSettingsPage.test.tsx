import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getHealth = vi.fn()
const getPolicies = vi.fn()

vi.mock('../../lib/api', () => ({
  emailDeliveryApi: {
    health: (...a: unknown[]) => getHealth(...a),
    testSend: vi.fn(),
    resendFailed: vi.fn(),
  },
  securityPoliciesApi: {
    get: (...a: unknown[]) => getPolicies(...a),
    update: vi.fn(),
  },
  authApi: {
    myPermissions: vi.fn().mockResolvedValue({ data: { permissions: ['security:manage'] } }),
  },
}))

vi.mock('./platform/SystemPanel', () => ({ default: () => <div>System panel</div> }))

const { default: PlatformSettingsPage } = await import('./PlatformSettingsPage')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformSettingsPage />
    </MemoryRouter>
  )
}

const HEALTH = {
  configured: true,
  provider: 'smtp',
  from_address: 'hr@acme.test',
  host: 'smtp.acme.test',
  last_7d: { sent: 5, failed: 0, console_only: 0 },
  recent_failures: [],
}

describe('Platform Settings page', () => {
  beforeEach(() => {
    getHealth.mockReset().mockResolvedValue({ data: HEALTH })
    getPolicies.mockReset().mockResolvedValue({
      data: {
        password_min_length: 1,
        password_require_number: false,
        password_require_symbol: false,
        max_login_attempts_before_lockout: 0,
        account_lockout_duration_minutes: 15,
        session_timeout_minutes: null,
      },
    })
  })

  it('lists Email Delivery as a tab', async () => {
    renderAt('/dashboard/settings?tab=delivery')

    expect(await screen.findByRole('tab', { name: 'Email Delivery' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual([
      'System', 'Email Templates', 'Webhooks', 'Security Policies', 'Email Delivery',
    ])
  })

  it('does not offer AI Prompts to a company, and a saved ?tab=prompts link lands on System', async () => {
    renderAt('/dashboard/settings?tab=prompts')

    expect(await screen.findByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('System panel')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI Prompts' })).not.toBeInTheDocument()
    expect(screen.queryByText('AI Prompts')).not.toBeInTheDocument()
  })

  it('selects the Email Delivery tab via ?tab=delivery and loads its status', async () => {
    renderAt('/dashboard/settings?tab=delivery')

    expect(await screen.findByRole('tab', { name: 'Email Delivery' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('hr@acme.test')).toBeInTheDocument()
    expect(getHealth).toHaveBeenCalledTimes(1)
    expect(getPolicies).not.toHaveBeenCalled()
  })

  it('mounts the Email Delivery panel only once its tab is chosen', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/settings?tab=security')

    await waitFor(() => expect(getPolicies).toHaveBeenCalled())
    expect(getHealth).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Email Delivery' }))

    expect(screen.getByRole('tab', { name: 'Email Delivery' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Security Policies' })).toHaveAttribute('aria-selected', 'false')
    await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(1))
  })

  it('shows the panel toast on the page after a resend', async () => {
    const user = userEvent.setup()
    getHealth.mockResolvedValue({
      data: {
        ...HEALTH,
        recent_failures: [{
          log_id: 'log-1', to: 'ada@example.com', subject: 'Invite', kind: 'invite',
          candidate_id: 'cand-1', created_at: '2026-10-05T09:30:00+00:00', error: 'Timeout',
        }],
      },
    })
    const { emailDeliveryApi } = await import('../../lib/api')
    vi.mocked(emailDeliveryApi.resendFailed).mockResolvedValue({
      data: { attempted: 1, delivered: 1, failed: 0, skipped: 0 },
    } as never)
    renderAt('/dashboard/settings?tab=delivery')

    await user.click(await screen.findByRole('checkbox', { name: 'Select email to ada@example.com' }))
    await user.click(screen.getByRole('button', { name: 'Resend selected (1)' }))

    expect(await screen.findByText('Resent 1 of 1 invite emails')).toBeInTheDocument()
  })

  describe('toast timer', () => {
    const FAILED = {
      ...HEALTH,
      recent_failures: [{
        log_id: 'log-1', to: 'ada@example.com', subject: 'Invite', kind: 'invite',
        candidate_id: 'cand-1', created_at: '2026-10-05T09:30:00+00:00', error: 'Timeout',
      }],
    }

    async function showResendToast(user: ReturnType<typeof userEvent.setup>) {
      getHealth.mockResolvedValue({ data: FAILED })
      const { emailDeliveryApi } = await import('../../lib/api')
      vi.mocked(emailDeliveryApi.resendFailed).mockResolvedValue({
        data: { attempted: 1, delivered: 1, failed: 0, skipped: 0 },
      } as never)
      const view = renderAt('/dashboard/settings?tab=delivery')
      await user.click(await screen.findByRole('checkbox', { name: 'Select email to ada@example.com' }))
      await user.click(screen.getByRole('button', { name: 'Resend selected (1)' }))
      await screen.findByText('Resent 1 of 1 invite emails')
      return view
    }

    afterEach(() => { vi.useRealTimers() })

    it('hides the toast after three seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await showResendToast(user)

      act(() => { vi.advanceTimersByTime(3100) })

      expect(screen.queryByText('Resent 1 of 1 invite emails')).not.toBeInTheDocument()
    })

    it('cancels the pending timer when the page is left', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { unmount } = await showResendToast(user)
      const pending = vi.getTimerCount()

      unmount()

      expect(vi.getTimerCount()).toBeLessThan(pending)
    })
  })
})
