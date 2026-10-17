import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformOwner } from '../../lib/platformTypes'
import { httpError } from '../../test/platformFixtures'

const listOwners = vi.fn()
const createOwner = vi.fn()
const setOwnerActive = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: {
    listOwners: (...a: unknown[]) => listOwners(...a),
    createOwner: (...a: unknown[]) => createOwner(...a),
    setOwnerActive: (...a: unknown[]) => setOwnerActive(...a),
  },
}))

const { default: PlatformOwnersPage } = await import('./PlatformOwnersPage')
const { useAuthStore } = await import('../../store/auth.store')

const OWNERS: PlatformOwner[] = [
  { email: 'owner@hirely.test', name: 'Olive Owner', is_active: true, last_login_at: null, company_name: 'Platform' },
  { email: 'second@hirely.test', name: 'Sol Second', is_active: true, last_login_at: '2020-01-01T00:00:00Z', company_name: null },
  { email: 'gone@hirely.test', name: '', is_active: false, last_login_at: null, company_name: 'Acme Corp' },
]

const user = () => userEvent.setup({ delay: null })
const row = (email: string) => screen.getByText(email).closest('tr')!

beforeEach(() => {
  listOwners.mockReset().mockResolvedValue({ data: { owners: OWNERS } })
  createOwner.mockReset()
  setOwnerActive.mockReset()
  useAuthStore.setState({ token: 'tok', user: { email: 'Owner@Hirely.test', role: 'superadmin' } })
})

describe('PlatformOwnersPage', () => {
  it('shows a loading state, then each owner', async () => {
    let resolve!: (v: unknown) => void
    listOwners.mockReturnValue(new Promise(r => { resolve = r }))
    render(<PlatformOwnersPage />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading the owners/i)

    resolve({ data: { owners: OWNERS } })
    expect(await screen.findByRole('table')).toBeInTheDocument()

    const olive = row('owner@hirely.test')
    expect(olive).toHaveTextContent('Olive Owner')
    expect(olive).toHaveTextContent('Active')
    expect(olive).toHaveTextContent('Platform')
    expect(olive).toHaveTextContent('-')

    const gone = screen.getAllByText('gone@hirely.test')[0].closest('tr')!
    expect(gone).toHaveTextContent('Inactive')
    expect(gone).toHaveTextContent('Acme Corp')
  })

  it('has a button for each owner, and refuses to let someone deactivate themselves', async () => {
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    const mine = within(row('owner@hirely.test')).getByRole('button', { name: 'Deactivate' })
    expect(mine).toBeDisabled()
    expect(mine).toHaveAttribute('title', 'You cannot deactivate your own account.')
    expect(within(row('second@hirely.test')).getByRole('button', { name: 'Deactivate' })).toBeEnabled()
    expect(within(screen.getAllByText('gone@hirely.test')[0].closest('tr')!).getByRole('button', { name: 'Reactivate' })).toBeEnabled()
  })

  it('asks first, then deactivates and reloads', async () => {
    const u = user()
    setOwnerActive.mockResolvedValue({ data: {} })
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    await u.click(within(row('second@hirely.test')).getByRole('button', { name: 'Deactivate' }))
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Sol Second?' })
    expect(setOwnerActive).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await u.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(setOwnerActive).toHaveBeenCalledWith('second@hirely.test', false))
    expect(await screen.findByText('Sol Second deactivated')).toBeInTheDocument()
    await waitFor(() => expect(listOwners).toHaveBeenCalledTimes(2))
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const u = user()
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    await u.click(within(row('second@hirely.test')).getByRole('button', { name: 'Deactivate' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(setOwnerActive).not.toHaveBeenCalled()
  })

  it('reactivates an inactive owner', async () => {
    const u = user()
    setOwnerActive.mockResolvedValue({ data: {} })
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    await u.click(within(screen.getAllByText('gone@hirely.test')[0].closest('tr')!).getByRole('button', { name: 'Reactivate' }))
    await u.click(within(screen.getByRole('dialog', { name: 'Reactivate gone@hirely.test?' })).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(setOwnerActive).toHaveBeenCalledWith('gone@hirely.test', true))
  })

  it('shows the server\'s refusal, such as the last owner, and keeps the dialog open', async () => {
    const u = user()
    setOwnerActive.mockRejectedValue(httpError(400, 'You cannot deactivate the last platform owner.'))
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    await u.click(within(row('second@hirely.test')).getByRole('button', { name: 'Deactivate' }))
    const dialog = screen.getByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You cannot deactivate the last platform owner.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('adds an owner after checking the fields', async () => {
    const u = user()
    createOwner.mockResolvedValue({ data: {} })
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Add owner' }))
    const dialog = screen.getByRole('dialog', { name: 'Add platform owner' })

    await u.click(within(dialog).getByRole('button', { name: 'Add owner' }))
    expect(within(dialog).getByText("Enter the owner's name.")).toBeInTheDocument()
    expect(within(dialog).getByText("Enter the owner's email.")).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a password.')).toBeInTheDocument()
    expect(createOwner).not.toHaveBeenCalled()

    await u.type(within(dialog).getByLabelText('Name'), ' New Person ')
    await u.type(within(dialog).getByLabelText('Email'), 'new@hirely.test')
    await u.type(within(dialog).getByLabelText('Password'), 'S3cur3P@ssword!')
    await u.click(within(dialog).getByRole('button', { name: 'Add owner' }))

    await waitFor(() => expect(createOwner).toHaveBeenCalledWith({ name: 'New Person', email: 'new@hirely.test', password: 'S3cur3P@ssword!' }))
    expect(await screen.findByText('New Person added as a platform owner')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(listOwners).toHaveBeenCalledTimes(2))
  })

  it('needs a password of at least 8 characters, says one-time codes are required, and offers no invitation', async () => {
    const u = user()
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Add owner' }))
    const dialog = screen.getByRole('dialog', { name: 'Add platform owner' })

    const password = within(dialog).getByLabelText('Password')
    expect(password).toHaveAccessibleDescription('At least 8 characters. Owners always sign in with a one-time code as well.')
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()

    await u.type(within(dialog).getByLabelText('Name'), 'New Person')
    await u.type(within(dialog).getByLabelText('Email'), 'new@hirely.test')
    await u.type(password, 'short')
    await u.click(within(dialog).getByRole('button', { name: 'Add owner' }))
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(createOwner).not.toHaveBeenCalled()
  })

  it('shows each owner\'s one-time code state when the server reports it', async () => {
    listOwners.mockResolvedValue({
      data: {
        owners: [
          { ...OWNERS[0], otp_required: true },
          { ...OWNERS[1], otp_required: false },
          { ...OWNERS[2] },
        ],
      },
    })
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')

    expect(screen.getByRole('columnheader', { name: 'One-time code' })).toBeInTheDocument()
    expect(row('owner@hirely.test')).toHaveTextContent('Required')
    expect(row('second@hirely.test')).toHaveTextContent('Off')
    expect(screen.getAllByText('gone@hirely.test')[0].closest('tr')).not.toHaveTextContent(/Required|Off/)
  })

  it('has no one-time code column when the server does not report the state', async () => {
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')
    expect(screen.queryByRole('columnheader', { name: 'One-time code' })).not.toBeInTheDocument()
  })

  it('shows the server message when the owner cannot be added', async () => {
    const u = user()
    createOwner.mockRejectedValue(httpError(409, 'That email address is already in use.'))
    render(<PlatformOwnersPage />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Add owner' }))
    const dialog = screen.getByRole('dialog')
    await u.type(within(dialog).getByLabelText('Name'), 'Dup')
    await u.type(within(dialog).getByLabelText('Email'), 'owner@hirely.test')
    await u.type(within(dialog).getByLabelText('Password'), 'S3cur3P@ssword!')
    await u.click(within(dialog).getByRole('button', { name: 'Add owner' }))

    expect(await within(dialog).findByText('That email address is already in use.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add owner' })).toBeEnabled()
  })

  it('has an empty state', async () => {
    listOwners.mockResolvedValue({ data: { owners: [] } })
    render(<PlatformOwnersPage />)
    expect(await screen.findByText('No platform owners yet.')).toBeInTheDocument()
  })

  it('shows the server message on a failure and retries', async () => {
    const u = user()
    listOwners.mockRejectedValueOnce(httpError(403, 'Platform owners only.'))
    render(<PlatformOwnersPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owners only.')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries no detail', async () => {
    listOwners.mockRejectedValue(new Error('Network Error'))
    render(<PlatformOwnersPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the platform owners.')
  })
})
