import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toLocalInput } from './externalInterview'

const sendEmail = vi.fn()
const listEmails = vi.fn()

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    sendEmail: (...a: unknown[]) => sendEmail(...a),
    listEmails: (...a: unknown[]) => listEmails(...a),
  },
}))

const { default: CommunicationModal } = await import('./CommunicationModal')
const { useAuthStore } = await import('../../../store/auth.store')

const ADDRESS = 'Hirely.ai Head Office, 228 Rose Commercial, Hyderabad'
const futureLocal = (days = 2) => toLocalInput(new Date(Date.now() + days * 86_400_000))

function renderModal() {
  const onClose = vi.fn()
  render(<CommunicationModal candidateId="cand_1" candidateName="Ada Lovelace" onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}
const template = () => screen.getByRole('combobox', { name: 'Template' })

describe('Communication Center templates', () => {
  beforeEach(() => {
    sendEmail.mockReset()
    listEmails.mockReset().mockResolvedValue({ data: { emails: [] } })
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com' } })
  })

  it('lists Physical Interview Call after the existing templates', () => {
    renderModal()
    expect(Array.from(template().querySelectorAll('option')).map(o => o.textContent)).toEqual([
      'Assessment Invitation', 'Offer Letter', 'Reminder', 'Follow-up', 'Physical Interview Call',
    ])
  })

  it('shows the time, length, address and note fields only for that template', async () => {
    const { user } = renderModal()
    for (const hidden of ['Date and time', 'Duration (minutes)', 'Address', 'Notes for the candidate (optional)']) {
      expect(screen.queryByLabelText(hidden)).not.toBeInTheDocument()
    }
    await user.selectOptions(template(), 'Physical Interview Call')
    expect(screen.getByLabelText('Date and time')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(45)
    expect(screen.getByLabelText('Address')).toHaveAttribute('maxlength', '300')
    expect(screen.getByLabelText('Notes for the candidate (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Salary')).not.toBeInTheDocument()

    await user.selectOptions(template(), 'Offer Letter')
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Salary')).toBeInTheDocument()
  })

  it('cannot be sent without an address, or with a time that has passed', async () => {
    const { user } = renderModal()
    await user.selectOptions(template(), 'Physical Interview Call')
    const send = screen.getByRole('button', { name: 'Send Physical Interview Call' })
    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText('Address'), '   ')
    expect(send).toBeDisabled()
    await user.clear(screen.getByLabelText('Address'))
    await user.type(screen.getByLabelText('Address'), ADDRESS)
    expect(send).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: toLocalInput(new Date(Date.now() - 86_400_000)) } })
    expect(screen.getByText('Pick a date and time in the future.')).toBeInTheDocument()
    expect(send).toBeDisabled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends the time as ISO with the zone, the length, the trimmed address and the note', async () => {
    sendEmail.mockResolvedValue({ data: { sent: true, template: 'physical_interview_call', sent_to: 'ada@x.com' } })
    const { user } = renderModal()
    await user.selectOptions(template(), 'Physical Interview Call')
    const when = futureLocal(3)
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: when } })
    await user.clear(screen.getByLabelText('Duration (minutes)'))
    await user.type(screen.getByLabelText('Duration (minutes)'), '60')
    await user.type(screen.getByLabelText('Address'), `  ${ADDRESS}  `)
    await user.type(screen.getByLabelText('Notes for the candidate (optional)'), 'Ask for Priya at reception')
    await user.click(screen.getByRole('button', { name: 'Send Physical Interview Call' }))

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1))
    expect(sendEmail).toHaveBeenCalledWith('cand_1', {
      template: 'physical_interview_call',
      scheduled_start_at: new Date(when).toISOString(),
      duration_minutes: 60,
      location: ADDRESS,
      notes: 'Ask for Priya at reception',
      display_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    expect(await screen.findByText('Physical Interview Call email delivered successfully.')).toBeInTheDocument()
  })

  it('leaves the note out when it is empty, and never sends offer fields with it', async () => {
    sendEmail.mockResolvedValue({ data: { sent: true } })
    const { user } = renderModal()
    await user.selectOptions(template(), 'Physical Interview Call')
    await user.type(screen.getByLabelText('Address'), ADDRESS)
    await user.click(screen.getByRole('button', { name: 'Send Physical Interview Call' }))

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1))
    const body = sendEmail.mock.calls[0][1]
    expect(body.notes).toBeUndefined()
    for (const offerOnly of ['salary', 'joining_date', 'benefits']) expect(body[offerOnly]).toBeUndefined()
  })

  it('says so when the email could not be delivered', async () => {
    sendEmail.mockResolvedValue({ data: { sent: false } })
    const { user } = renderModal()
    await user.selectOptions(template(), 'Physical Interview Call')
    await user.type(screen.getByLabelText('Address'), ADDRESS)
    await user.click(screen.getByRole('button', { name: 'Send Physical Interview Call' }))
    expect(await screen.findByText(/Physical Interview Call email could not be delivered/)).toBeInTheDocument()
    expect(screen.getByText('Send failed, recorded in the log below')).toBeInTheDocument()
  })

  it('shows the sentence the server refused with', async () => {
    sendEmail.mockRejectedValue({ response: { status: 422, data: { detail: 'The address can be at most 300 characters.' } } })
    const { user } = renderModal()
    await user.selectOptions(template(), 'Physical Interview Call')
    await user.type(screen.getByLabelText('Address'), ADDRESS)
    await user.click(screen.getByRole('button', { name: 'Send Physical Interview Call' }))
    expect(await screen.findByText('The address can be at most 300 characters.')).toBeInTheDocument()
  })

  it('sends the existing templates exactly as before, with none of the in-person fields', async () => {
    sendEmail.mockResolvedValue({ data: { sent: true } })
    const { user } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Send Assessment Invitation' }))
    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1))
    const body = sendEmail.mock.calls[0][1]
    expect(body.template).toBe('assessment_invitation')
    for (const inPersonOnly of ['scheduled_start_at', 'duration_minutes', 'location', 'notes', 'display_timezone']) {
      expect(body[inPersonOnly]).toBeUndefined()
    }
  })

  it('names the template in the history, from its log entry', async () => {
    listEmails.mockResolvedValue({
      data: { emails: [{ to: 'ada@x.com', subject: 'Interview: Engineer', template: 'physical_interview_call', status: 'sent', created_at: '2026-10-13T09:00:00Z' }] },
    })
    const { user } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Email History' }))
    expect(await screen.findByText('Physical Interview Call')).toBeInTheDocument()
  })

  it('lets a non-admin read the history but not send', () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'user@x.com' } })
    renderModal()
    expect(screen.queryByRole('combobox', { name: 'Template' })).not.toBeInTheDocument()
    expect(screen.getByText(/requires an admin account/)).toBeInTheDocument()
  })
})
