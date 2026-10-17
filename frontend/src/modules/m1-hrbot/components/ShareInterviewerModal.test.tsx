import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewerLink } from '../../../lib/api'

const createLink = vi.fn()
const listLinks = vi.fn()
const revokeLink = vi.fn()

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    createInterviewerLink: (...a: unknown[]) => createLink(...a),
    listInterviewerLinks: (...a: unknown[]) => listLinks(...a),
    revokeInterviewerLink: (...a: unknown[]) => revokeLink(...a),
  },
}))

const { default: ShareInterviewerModal } = await import('./ShareInterviewerModal')

const DAY = 86_400_000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()

function link(over: Partial<InterviewerLink> = {}): InterviewerLink {
  return {
    link_id: 'l1',
    interviewer_name: 'Priya Nair',
    interviewer_role: 'engineer',
    created_at: inDays(-1),
    expires_at: inDays(6),
    revoked: false,
    submitted: false,
    ...over,
  }
}

const CREATED = { link_id: 'l9', token: 'tok_secret_123', url: 'https://elsewhere.example/interviewer/tok_secret_123', expires_at: inDays(7) }
const OWN_URL = `${window.location.origin}/interviewer/tok_secret_123`

function renderModal() {
  const onClose = vi.fn()
  render(<ShareInterviewerModal candidateId="cand_1" candidateName="Ada Lovelace" onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

async function renderLoaded(links: InterviewerLink[] = []) {
  listLinks.mockResolvedValue({ data: links })
  const r = renderModal()
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  return r
}

const createBtn = () => screen.getByRole('button', { name: 'Create link' })

beforeEach(() => {
  createLink.mockReset()
  listLinks.mockReset()
  revokeLink.mockReset()
  vi.restoreAllMocks()
  listLinks.mockResolvedValue({ data: [] })
})

describe('the dialog', () => {
  it('is a labelled modal dialog that names the candidate and loads that candidate\'s links', async () => {
    await renderLoaded()
    const dialog = screen.getByRole('dialog', { name: 'Share with interviewer, Ada Lovelace' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(listLinks).toHaveBeenCalledWith('cand_1')
  })

  it('closes from Close, the close icon, Escape and a backdrop click when no new link is on screen', async () => {
    const { user, onClose } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Close share' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('share-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('keeps Tab inside the dialog', async () => {
    const { user } = await renderLoaded()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})

describe('creating a link', () => {
  it('starts with the Engineer role and 7 days, and offers the four roles', async () => {
    await renderLoaded()
    expect(screen.getByLabelText('Interviewer role')).toHaveValue('engineer')
    expect(screen.getByLabelText('Expires in (days)')).toHaveValue(7)
    expect(within(screen.getByLabelText('Interviewer role')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['HR', 'Engineer', 'Hiring manager', 'Other'])
  })

  it('sends the name, role and expiry, then shows the link once with a Copy button and a notice', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const { user } = await renderLoaded()
    await user.type(screen.getByLabelText('Interviewer name (optional)'), '  Priya Nair ')
    await user.selectOptions(screen.getByLabelText('Interviewer role'), 'hiring_manager')
    await user.clear(screen.getByLabelText('Expires in (days)'))
    await user.type(screen.getByLabelText('Expires in (days)'), '14')
    await user.click(createBtn())

    expect(createLink).toHaveBeenCalledWith('cand_1', { interviewer_name: 'Priya Nair', interviewer_role: 'hiring_manager', expires_in_days: 14 })
    const group = await screen.findByRole('group', { name: 'New link' })
    expect(within(group).getByText('This link will not be shown again. Copy it now.')).toBeInTheDocument()
    expect(within(group).getByLabelText('Interviewer link')).toHaveValue(OWN_URL)
    expect(within(group).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(within(group).getByText(/^Expires /)).toBeInTheDocument()
  })

  it('leaves the name out when none is given', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const { user } = await renderLoaded()
    await user.click(createBtn())
    expect(createLink).toHaveBeenCalledWith('cand_1', { interviewer_name: undefined, interviewer_role: 'engineer', expires_in_days: 7 })
  })

  it('builds the link from this tab\'s own origin, and uses the server\'s when no token comes back', async () => {
    createLink.mockResolvedValue({ data: { ...CREATED, token: '' } })
    const { user } = await renderLoaded()
    await user.click(createBtn())
    expect(await screen.findByLabelText('Interviewer link')).toHaveValue(CREATED.url)
  })

  it('Copy link puts the link on the clipboard', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const { user } = await renderLoaded()
    await user.click(createBtn())
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(OWN_URL)
  })

  it('reloads the list, and the list never shows the link itself', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const { user } = await renderLoaded()
    listLinks.mockResolvedValue({ data: [link({ link_id: 'l9', interviewer_name: 'Priya Nair' })] })
    await user.click(createBtn())

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(listLinks).toHaveBeenCalledTimes(2)
    const row = screen.getByText('Priya Nair').closest('.sim-item') as HTMLElement
    expect(row.textContent).not.toContain('tok_secret_123')
  })

  it('does not show the link again when the dialog is opened afresh', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const { user } = await renderLoaded()
    await user.click(createBtn())
    await screen.findByLabelText('Interviewer link')
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    cleanup()

    await renderLoaded([link()])
    expect(screen.queryByLabelText('Interviewer link')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('tok_secret_123')
  })

  it.each([['0'], ['31'], ['2.5'], ['']])('refuses %s days: Create is disabled and the range is stated', async value => {
    const { user } = await renderLoaded()
    const days = screen.getByLabelText('Expires in (days)')
    await user.clear(days)
    if (value) await user.type(days, value)
    expect(createBtn()).toBeDisabled()
    expect(screen.getByText('Enter a whole number from 1 to 30.')).toBeInTheDocument()
  })

  it('disables Create while working', async () => {
    let resolve!: (v: unknown) => void
    createLink.mockReturnValue(new Promise(res => { resolve = res }))
    const { user } = await renderLoaded()
    await user.click(createBtn())
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
    resolve({ data: CREATED })
    await screen.findByLabelText('Interviewer link')
  })

  it('shows the server detail when the link cannot be created, and a generic message otherwise', async () => {
    createLink.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'This interview is already closed.' } } })
    createLink.mockRejectedValueOnce(new Error('Network Error'))
    const { user } = await renderLoaded()
    await user.click(createBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('This interview is already closed.')
    await user.click(createBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not create the link. Please try again'))
    expect(screen.queryByLabelText('Interviewer link')).not.toBeInTheDocument()
  })

  it('asks before closing while the new link has not been copied, and not after it was', async () => {
    createLink.mockResolvedValue({ data: CREATED })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onClose } = await renderLoaded()
    await user.click(createBtn())
    await screen.findByLabelText('Interviewer link')

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('existing links', () => {
  it('says so when there are none', async () => {
    await renderLoaded([])
    expect(screen.getByText('No links yet')).toBeInTheDocument()
  })

  it('shows each link\'s interviewer, role and status: Submitted, Pending, Revoked or Expired', async () => {
    await renderLoaded([
      link({ link_id: 'a', interviewer_name: 'Priya Nair', submitted: true }),
      link({ link_id: 'b', interviewer_name: 'Omar Haddad', interviewer_role: 'hiring_manager' }),
      link({ link_id: 'c', interviewer_name: 'Lena Fischer', revoked: true }),
      link({ link_id: 'd', interviewer_name: 'Tom Baker', expires_at: inDays(-2) }),
    ])
    const statusOf = (name: string) => (screen.getByText(name).closest('.sim-item') as HTMLElement).querySelector('.badge')?.textContent
    expect(statusOf('Priya Nair')).toBe('Submitted')
    expect(statusOf('Omar Haddad')).toBe('Pending')
    expect(statusOf('Lena Fischer')).toBe('Revoked')
    expect(statusOf('Tom Baker')).toBe('Expired')
    expect(screen.getByText('Omar Haddad').closest('.sim-item')).toHaveTextContent('Hiring manager')
  })

  it('gives a revoked link the Revoked status even when it was submitted or has expired', async () => {
    await renderLoaded([link({ revoked: true, submitted: true, expires_at: inDays(-2) })])
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument()
  })

  it('offers Revoke on a Pending or Submitted link only', async () => {
    await renderLoaded([
      link({ link_id: 'a', interviewer_name: 'Priya Nair', submitted: true }),
      link({ link_id: 'b', interviewer_name: 'Omar Haddad' }),
      link({ link_id: 'c', interviewer_name: 'Lena Fischer', revoked: true }),
      link({ link_id: 'd', interviewer_name: 'Tom Baker', expires_at: inDays(-2) }),
    ])
    expect(screen.getByRole('button', { name: 'Revoke link for Priya Nair' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke link for Omar Haddad' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Revoke link for Lena Fischer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Revoke link for Tom Baker/ })).not.toBeInTheDocument()
  })

  it('Revoke calls the endpoint for that link and turns the row to Revoked', async () => {
    revokeLink.mockResolvedValue({ data: {} })
    const { user } = await renderLoaded([link({ link_id: 'l7' })])
    await user.click(screen.getByRole('button', { name: 'Revoke link for Priya Nair' }))

    expect(revokeLink).toHaveBeenCalledWith('cand_1', 'l7')
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Revoke link for/ })).not.toBeInTheDocument()
  })

  it('shows the server detail when Revoke fails and keeps the link as it was', async () => {
    revokeLink.mockRejectedValue({ response: { status: 500, data: { detail: 'The link store is unavailable.' } } })
    const { user } = await renderLoaded([link()])
    await user.click(screen.getByRole('button', { name: 'Revoke link for Priya Nair' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The link store is unavailable.')
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke link for Priya Nair' })).toBeEnabled()
  })

  it('shows an inline error with a Retry when the list cannot be loaded', async () => {
    listLinks.mockRejectedValueOnce(new Error('503'))
    listLinks.mockResolvedValueOnce({ data: [link()] })
    const { user } = renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the existing links.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Pending')).toBeInTheDocument()
  })

  it('names an unnamed interviewer plainly', async () => {
    await renderLoaded([link({ interviewer_name: null, interviewer_role: null })])
    expect(screen.getByText('Interviewer')).toBeInTheDocument()
  })
})
