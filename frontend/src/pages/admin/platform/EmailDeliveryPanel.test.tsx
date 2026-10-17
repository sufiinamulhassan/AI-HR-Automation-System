import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getHealth = vi.fn()
const testSend = vi.fn()
const resendFailed = vi.fn()
const verify = vi.fn()
const resendWaiting = vi.fn()

vi.mock('../../../lib/api', () => ({
  emailDeliveryApi: {
    health: (...a: unknown[]) => getHealth(...a),
    testSend: (...a: unknown[]) => testSend(...a),
    resendFailed: (...a: unknown[]) => resendFailed(...a),
    verify: (...a: unknown[]) => verify(...a),
    resendWaiting: (...a: unknown[]) => resendWaiting(...a),
  },
}))

const { default: EmailDeliveryPanel } = await import('./EmailDeliveryPanel')

const showToast = vi.fn()

function renderPanel() {
  return render(<EmailDeliveryPanel showToast={showToast} />)
}

function httpError(status: number, detail: string) {
  return { response: { status, data: { detail } } }
}

const INVITE_FAILURE = {
  log_id: 'log-1',
  to: 'ada@example.com',
  subject: 'Your interview invitation',
  kind: 'invite',
  candidate_id: 'cand-1',
  created_at: '2026-10-05T09:30:00+00:00',
  error: 'Connection refused',
}
const SECOND_INVITE_FAILURE = {
  ...INVITE_FAILURE, log_id: 'log-2', to: 'grace@example.com', candidate_id: 'cand-2',
}
const OFFER_FAILURE = {
  log_id: 'log-3',
  to: 'linus@example.com',
  subject: 'Your offer letter',
  kind: 'offer',
  candidate_id: 'cand-3',
  created_at: '2026-10-05T10:00:00+00:00',
  error: 'Mailbox full',
}

const CONFIGURED = {
  configured: true,
  provider: 'smtp',
  from_address: 'hr@acme.test',
  host: 'smtp.acme.test',
  last_7d: { sent: 42, failed: 3, console_only: 0 },
  recent_failures: [] as unknown[],
}
const NOT_CONFIGURED = {
  configured: false,
  provider: null,
  from_address: null,
  host: null,
  last_7d: { sent: 0, failed: 0, console_only: 11 },
  recent_failures: [] as unknown[],
}

describe('Email Delivery panel', () => {
  beforeEach(() => {
    getHealth.mockReset().mockResolvedValue({ data: CONFIGURED })
    testSend.mockReset()
    resendFailed.mockReset()
    verify.mockReset()
    resendWaiting.mockReset()
    showToast.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  describe('status', () => {
    it('shows the configured state with provider, from address and host', async () => {
      renderPanel()

      expect(await screen.findByText('Configured')).toBeInTheDocument()
      expect(screen.getByText('SMTP')).toBeInTheDocument()
      expect(screen.getByText('hr@acme.test')).toBeInTheDocument()
      expect(screen.getByText('smtp.acme.test')).toBeInTheDocument()
      expect(screen.queryByText(/not delivered to anyone/i)).not.toBeInTheDocument()
    })

    it('shows no Host row when the server does not give the mail server\'s address to this admin', async () => {
      const { host: _omitted, ...withoutHost } = CONFIGURED
      getHealth.mockResolvedValue({ data: withoutHost })
      renderPanel()

      expect(await screen.findByText('hr@acme.test')).toBeInTheDocument()
      expect(screen.queryByText('Host')).not.toBeInTheDocument()
      expect(screen.getByText('Provider')).toBeInTheDocument()
      expect(screen.getByText('From address')).toBeInTheDocument()
    })

    it('shows no Host row for a null host either, rather than a dash', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, host: null } })
      renderPanel()

      expect(await screen.findByText('hr@acme.test')).toBeInTheDocument()
      expect(screen.queryByText('Host')).not.toBeInTheDocument()
    })

    it('names Amazon SES when that is the provider', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, provider: 'ses', host: null } })
      renderPanel()

      expect(await screen.findByText('Amazon SES')).toBeInTheDocument()
    })

    it('explains what not-configured means', async () => {
      getHealth.mockResolvedValue({ data: NOT_CONFIGURED })
      renderPanel()

      expect(await screen.findByText('Not configured')).toBeInTheDocument()
      expect(screen.getByText(/invite, status and offer emails are only written to the server log/i)).toBeInTheDocument()
      expect(screen.getByText(/not delivered to anyone/i)).toBeInTheDocument()
      expect(screen.getByText('None')).toBeInTheDocument()
    })

    it('shows the last 7 days counts', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, last_7d: { sent: 42, failed: 3, console_only: 7 } } })
      renderPanel()

      const sent = (await screen.findByText('Sent')).parentElement!
      expect(within(sent).getByText('42')).toBeInTheDocument()
      expect(within(screen.getByText('Failed').parentElement!).getByText('3')).toBeInTheDocument()
      expect(within(screen.getByText('Console only').parentElement!).getByText('7')).toBeInTheDocument()
    })

    it('loads on mount and reloads on Refresh', async () => {
      const user = userEvent.setup()
      renderPanel()
      await screen.findByText('Configured')
      expect(getHealth).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2))
    })

    it('shows a loading state before the first response', async () => {
      getHealth.mockReturnValue(new Promise(() => {}))
      renderPanel()

      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })

    it('shows an error when the status cannot be loaded, and recovers on Refresh', async () => {
      const user = userEvent.setup()
      getHealth.mockRejectedValueOnce(httpError(500, 'Mail store unavailable'))
      renderPanel()

      expect(await screen.findByRole('alert')).toHaveTextContent('Mail store unavailable')
      expect(screen.queryByText('Configured')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(await screen.findByText('Configured')).toBeInTheDocument()
    })

    it('shows a permission notice instead of an error when blocked with a 403', async () => {
      getHealth.mockRejectedValue(httpError(403, 'Forbidden'))
      renderPanel()

      expect(await screen.findByText(/requires the "email:manage" permission/)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    })
  })

  describe('test send', () => {
    async function typeAddress(user: ReturnType<typeof userEvent.setup>, value: string) {
      await user.type(await screen.findByLabelText('Send to'), value)
    }

    it('keeps the button disabled until an address is entered', async () => {
      const user = userEvent.setup()
      renderPanel()

      const button = await screen.findByRole('button', { name: 'Send test email' })
      expect(button).toBeDisabled()
      await typeAddress(user, 'me@acme.test')
      expect(button).toBeEnabled()
    })

    it('reports a delivered test email and is disabled while sending', async () => {
      const user = userEvent.setup()
      let finish: (v: unknown) => void = () => {}
      testSend.mockReturnValue(new Promise(r => { finish = r }))
      renderPanel()

      await typeAddress(user, 'me@acme.test')
      await user.click(screen.getByRole('button', { name: 'Send test email' }))

      expect(testSend).toHaveBeenCalledWith('me@acme.test')
      expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()

      finish({ data: { delivered: true, status: 'sent', detail: 'Sent via smtp.acme.test' } })
      expect(await screen.findByText('Test email delivered to me@acme.test.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send test email' })).toBeEnabled()
    })

    it('shows the detail when the email was not delivered', async () => {
      const user = userEvent.setup()
      testSend.mockResolvedValue({
        data: { delivered: false, status: 'console_only', detail: 'No email provider is configured' },
      })
      renderPanel()

      await typeAddress(user, 'me@acme.test')
      await user.click(screen.getByRole('button', { name: 'Send test email' }))

      expect(await screen.findByText('Not delivered: No email provider is configured')).toBeInTheDocument()
    })

    it('surfaces a server error from the send', async () => {
      const user = userEvent.setup()
      testSend.mockRejectedValue(httpError(500, 'SMTP login rejected'))
      renderPanel()

      await typeAddress(user, 'me@acme.test')
      await user.click(screen.getByRole('button', { name: 'Send test email' }))

      expect(await screen.findByText('SMTP login rejected')).toBeInTheDocument()
    })

    it('asks for a valid address when the server rejects the one entered', async () => {
      const user = userEvent.setup()
      testSend.mockRejectedValue({ response: { status: 422, data: { detail: [{ msg: 'not an email' }] } } })
      renderPanel()

      await typeAddress(user, 'me@acme.test')
      await user.click(screen.getByRole('button', { name: 'Send test email' }))

      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    })

    it('gives a friendly message on a 429', async () => {
      const user = userEvent.setup()
      testSend.mockRejectedValue(httpError(429, 'Rate limit exceeded'))
      renderPanel()

      await typeAddress(user, 'me@acme.test')
      await user.click(screen.getByRole('button', { name: 'Send test email' }))

      expect(await screen.findByText(/too many test emails/i)).toBeInTheDocument()
      expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()
    })
  })

  describe('recent failures', () => {
    beforeEach(() => {
      getHealth.mockResolvedValue({
        data: { ...CONFIGURED, recent_failures: [INVITE_FAILURE, SECOND_INVITE_FAILURE, OFFER_FAILURE] },
      })
    })

    it('lists each failure with its recipient, subject, kind and error', async () => {
      renderPanel()

      expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
      expect(screen.getByText('Your offer letter')).toBeInTheDocument()
      expect(screen.getByText('Mailbox full')).toBeInTheDocument()
      expect(screen.getAllByText('Interview invite')).toHaveLength(2)
      expect(screen.getByText('Offer', { selector: '.badge' })).toBeInTheDocument()
    })

    it('copes with a row that is missing its recipient and timestamp', async () => {
      getHealth.mockResolvedValue({
        data: {
          ...CONFIGURED,
          recent_failures: [{
            ...OFFER_FAILURE, log_id: 'log-9', to: null, subject: null, kind: 'other', created_at: null, error: null,
          }],
        },
      })
      renderPanel()

      const box = await screen.findByRole('checkbox', { name: 'Select email to unknown recipient' })
      expect(box).toBeDisabled()
      expect(screen.getByText('Other', { selector: '.badge' })).toBeInTheDocument()
    })

    it('only lets invite rows be selected, and explains the rest cannot be', async () => {
      const user = userEvent.setup()
      renderPanel()

      const invite = await screen.findByRole('checkbox', { name: 'Select email to ada@example.com' })
      const offer = screen.getByRole('checkbox', { name: 'Select email to linus@example.com' })
      expect(invite).toBeEnabled()
      expect(offer).toBeDisabled()
      expect(offer).toHaveAttribute('title', 'Only invite emails can be resent here')
      expect(screen.getByText(/only candidate interview invites can be resent here/i)).toBeInTheDocument()
      expect(screen.getByText(/cannot be selected/i)).toBeInTheDocument()

      await user.click(offer)
      expect(offer).not.toBeChecked()
      await user.click(invite)
      expect(invite).toBeChecked()
    })

    it('omits the "cannot be selected" note when every failure is an invite', async () => {
      getHealth.mockResolvedValue({
        data: { ...CONFIGURED, recent_failures: [INVITE_FAILURE] },
      })
      renderPanel()

      await screen.findByText('ada@example.com')
      expect(screen.queryByText(/cannot be selected/i)).not.toBeInTheDocument()
    })

    it('selects all resendable rows from the header checkbox, skipping non-invites', async () => {
      const user = userEvent.setup()
      renderPanel()

      await user.click(await screen.findByRole('checkbox', { name: 'Select all resendable emails' }))

      expect(screen.getByRole('checkbox', { name: 'Select email to ada@example.com' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Select email to grace@example.com' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Select email to linus@example.com' })).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Resend selected (2)' })).toBeEnabled()
    })

    it('disables Resend selected until something is selected', async () => {
      renderPanel()

      expect(await screen.findByRole('button', { name: 'Resend selected' })).toBeDisabled()
    })

    it('resends the selected rows, shows the summary and refreshes the list', async () => {
      const user = userEvent.setup()
      resendFailed.mockResolvedValue({ data: { attempted: 1, delivered: 1, failed: 0, skipped: 0 } })
      renderPanel()

      await user.click(await screen.findByRole('checkbox', { name: 'Select email to ada@example.com' }))
      getHealth.mockResolvedValue({
        data: { ...CONFIGURED, recent_failures: [SECOND_INVITE_FAILURE, OFFER_FAILURE] },
      })
      await user.click(screen.getByRole('button', { name: 'Resend selected (1)' }))

      await waitFor(() => expect(resendFailed).toHaveBeenCalledWith({ log_ids: ['log-1'], limit: 25 }))
      expect(await screen.findByText(
        'Resend complete: 1 attempted, 1 delivered, 0 failed, 0 skipped.',
      )).toBeInTheDocument()
      expect(showToast).toHaveBeenCalledWith('Resent 1 of 1 invite emails')

      await waitFor(() => expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument())
      expect(getHealth).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: 'Resend selected' })).toBeDisabled()
    })

    it('reports a mixed resend outcome', async () => {
      const user = userEvent.setup()
      resendFailed.mockResolvedValue({ data: { attempted: 3, delivered: 1, failed: 1, skipped: 1 } })
      renderPanel()

      await user.click(await screen.findByRole('checkbox', { name: 'Select all resendable emails' }))
      await user.click(screen.getByRole('button', { name: 'Resend selected (2)' }))

      expect(await screen.findByText(
        'Resend complete: 3 attempted, 1 delivered, 1 failed, 1 skipped.',
      )).toBeInTheDocument()
    })

    it('does not resend everything when the confirmation is declined', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Resend all eligible invites' }))

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(resendFailed).not.toHaveBeenCalled()
    })

    it('resends every eligible invite once confirmed', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      resendFailed.mockResolvedValue({ data: { attempted: 2, delivered: 2, failed: 0, skipped: 0 } })
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Resend all eligible invites' }))

      await waitFor(() => expect(resendFailed).toHaveBeenCalledWith({ log_ids: null, limit: 25 }))
      expect(await screen.findByText(/2 attempted, 2 delivered/)).toBeInTheDocument()
      expect(getHealth).toHaveBeenCalledTimes(2)
    })

    it('has nothing to select but keeps Resend all available when only non-invite failures are listed', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, recent_failures: [OFFER_FAILURE] } })
      renderPanel()

      await screen.findByText('linus@example.com')
      expect(screen.getByRole('checkbox', { name: 'Select all resendable emails' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Resend selected' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Resend all eligible invites' })).toBeEnabled()
    })

    it('explains skipped emails by reason after a resend', async () => {
      const user = userEvent.setup()
      resendFailed.mockResolvedValue({
        data: {
          attempted: 0, delivered: 0, failed: 0, skipped: 3,
          results: [
            { log_id: 'log-1', outcome: 'skipped', reason: 'invite_expired' },
            { log_id: 'log-2', outcome: 'skipped', reason: 'invite_expired' },
            { log_id: 'log-4', outcome: 'skipped', reason: 'interview_already_completed' },
          ],
        },
      })
      renderPanel()

      await user.click(await screen.findByRole('checkbox', { name: 'Select all resendable emails' }))
      await user.click(screen.getByRole('button', { name: 'Resend selected (2)' }))

      expect(await screen.findByText(
        'Skipped: invite link expired (2), interview already completed (1).',
      )).toBeInTheDocument()
    })

    it('shows an inline message and keeps the selection when a resend fails', async () => {
      const user = userEvent.setup()
      resendFailed.mockRejectedValue(httpError(429, 'Rate limit exceeded'))
      renderPanel()

      await user.click(await screen.findByRole('checkbox', { name: 'Select email to ada@example.com' }))
      await user.click(screen.getByRole('button', { name: 'Resend selected (1)' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/too many resend requests/i)
      expect(screen.getByRole('checkbox', { name: 'Select email to ada@example.com' })).toBeChecked()
      expect(getHealth).toHaveBeenCalledTimes(1)
    })

    it('shows an empty note when there are no failures', async () => {
      getHealth.mockResolvedValue({ data: CONFIGURED })
      renderPanel()

      expect(await screen.findByText('No failed emails to show.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Resend all eligible invites' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Resend selected' })).toBeDisabled()
    })

    it('shows the hint under the error of a failed row, and nothing when there is none', async () => {
      getHealth.mockResolvedValue({
        data: {
          ...CONFIGURED,
          recent_failures: [
            { ...INVITE_FAILURE, hint: 'Check the SMTP password.' },
            { ...OFFER_FAILURE, hint: null },
          ],
        },
      })
      renderPanel()

      const hint = await screen.findByText('Check the SMTP password.')
      expect(hint.closest('td')).toHaveTextContent('Connection refused')
      expect(screen.getByText('Mailbox full').querySelector('.ed-cell-hint')).toBeNull()
    })
  })

  describe('verify connection', () => {
    it('reports a working connection with the returned detail', async () => {
      const user = userEvent.setup()
      verify.mockResolvedValue({ data: { ok: true, provider: 'smtp', detail: 'Logged in to smtp.acme.test' } })
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Verify connection' }))

      expect(verify).toHaveBeenCalledTimes(1)
      const result = await screen.findByText('Connection OK')
      expect(result.closest('[role="status"]')).toHaveTextContent('Logged in to smtp.acme.test')
      expect(result.closest('[role="status"]')).toHaveClass('ed-result-ok')
    })

    it('reports a failed connection with the returned detail', async () => {
      const user = userEvent.setup()
      verify.mockResolvedValue({ data: { ok: false, provider: 'smtp', detail: 'Authentication failed' } })
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Verify connection' }))

      const result = await screen.findByText('Connection failed')
      expect(result.closest('[role="status"]')).toHaveTextContent('Authentication failed')
      expect(result.closest('[role="status"]')).toHaveClass('ed-result-bad')
    })

    it('is disabled while the check runs and does not touch the health reload count', async () => {
      const user = userEvent.setup()
      let finish: (v: unknown) => void = () => {}
      verify.mockReturnValue(new Promise(r => { finish = r }))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Verify connection' }))
      expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled()

      finish({ data: { ok: true, provider: 'ses', detail: 'ok' } })
      expect(await screen.findByText('Connection OK')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Verify connection' })).toBeEnabled()
      expect(getHealth).toHaveBeenCalledTimes(1)
    })

    it('gives a friendly message on a 429 and a permission notice on a 403', async () => {
      const user = userEvent.setup()
      verify.mockRejectedValueOnce(httpError(429, 'Rate limit exceeded'))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Verify connection' }))
      expect(await screen.findByText(/too many checks/i)).toBeInTheDocument()
      expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()

      verify.mockRejectedValueOnce(httpError(403, 'Forbidden'))
      await user.click(screen.getByRole('button', { name: 'Verify connection' }))
      expect(await screen.findByText(/requires the "email:manage" permission/)).toBeInTheDocument()
    })

    it('shows the server detail when the check itself errors', async () => {
      const user = userEvent.setup()
      verify.mockRejectedValue(httpError(500, 'Mail check crashed'))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Verify connection' }))

      expect(await screen.findByText('Mail check crashed')).toBeInTheDocument()
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })
  })

  describe('warnings', () => {
    it('lists each warning near the status', async () => {
      getHealth.mockResolvedValue({
        data: {
          ...CONFIGURED,
          warnings: [
            { code: 'frontend_url_localhost', message: 'Invite links point at localhost.' },
            { code: 'no_from_name', message: 'No sender name is set.' },
          ],
        },
      })
      renderPanel()

      const list = await screen.findByRole('list', { name: 'Warnings' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
      expect(within(list).getByText('Invite links point at localhost.')).toBeInTheDocument()
      expect(within(list).getByText('No sender name is set.')).toBeInTheDocument()
    })

    it('renders nothing when there are no warnings or the key is absent', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, warnings: [] } })
      const { unmount } = renderPanel()
      await screen.findByText('Configured')
      expect(screen.queryByRole('list', { name: 'Warnings' })).not.toBeInTheDocument()
      unmount()

      getHealth.mockResolvedValue({ data: CONFIGURED })
      renderPanel()
      await screen.findByText('Configured')
      expect(screen.queryByRole('list', { name: 'Warnings' })).not.toBeInTheDocument()
    })
  })

  describe('waiting invites', () => {
    function waitingCount() {
      return screen.getByText('Waiting Invites').closest('section')!
    }

    it('shows the count and disables the button at zero', async () => {
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 0 } })
      renderPanel()

      await screen.findByText('Waiting Invites')
      expect(within(waitingCount()).getByText('0')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send waiting invites' })).toBeDisabled()
    })

    it('treats a missing count as zero', async () => {
      renderPanel()

      await screen.findByText('Waiting Invites')
      expect(within(waitingCount()).getByText('0')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send waiting invites' })).toBeDisabled()
    })

    it('sends the waiting invites, reports sent and failed, and refreshes health', async () => {
      const user = userEvent.setup()
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 4 } })
      resendWaiting.mockResolvedValue({ data: { attempted: 4, sent: 3, failed: 1, skipped: 0, remaining: 1 } })
      renderPanel()

      await screen.findByText('Waiting Invites')
      expect(within(waitingCount()).getByText('4')).toBeInTheDocument()
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 1 } })
      await user.click(screen.getByRole('button', { name: 'Send waiting invites' }))

      await waitFor(() => expect(resendWaiting).toHaveBeenCalledWith({ limit: 25 }))
      expect(await screen.findByText('Sent 3, failed 1, 1 still waiting.')).toBeInTheDocument()
      expect(showToast).toHaveBeenCalledWith('Sent 3 waiting invites')
      await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(within(waitingCount()).getByText('1')).toBeInTheDocument())
    })

    it('is disabled while sending, along with the other bulk actions', async () => {
      const user = userEvent.setup()
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 2 } })
      let finish: (v: unknown) => void = () => {}
      resendWaiting.mockReturnValue(new Promise(r => { finish = r }))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Send waiting invites' }))

      expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Resend all eligible invites' })).toBeDisabled()

      finish({ data: { attempted: 2, sent: 2, failed: 0, skipped: 0, remaining: 0 } })
      expect(await screen.findByText('Sent 2, failed 0.')).toBeInTheDocument()
    })

    it('gives a friendly message on a 429 and does not refresh', async () => {
      const user = userEvent.setup()
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 2 } })
      resendWaiting.mockRejectedValue(httpError(429, 'Rate limit exceeded'))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Send waiting invites' }))

      expect(await screen.findByText(/too many requests/i)).toBeInTheDocument()
      expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()
      expect(getHealth).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Send waiting invites' })).toBeEnabled()
    })

    it('shows the permission notice on a 403 and the server detail on other errors', async () => {
      const user = userEvent.setup()
      getHealth.mockResolvedValue({ data: { ...CONFIGURED, waiting_invites: 2 } })
      resendWaiting.mockRejectedValueOnce(httpError(403, 'Forbidden'))
      renderPanel()

      await user.click(await screen.findByRole('button', { name: 'Send waiting invites' }))
      expect(await screen.findByText(/requires the "email:manage" permission/)).toBeInTheDocument()

      resendWaiting.mockRejectedValueOnce(httpError(502, 'Mail server unreachable'))
      await user.click(screen.getByRole('button', { name: 'Send waiting invites' }))
      expect(await screen.findByText('Mail server unreachable')).toBeInTheDocument()
    })
  })
})
