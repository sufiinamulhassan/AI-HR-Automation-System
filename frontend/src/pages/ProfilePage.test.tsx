import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const me = vi.fn()
const updateMe = vi.fn()
const setOtp = vi.fn()
const passwordPolicy = vi.fn()
const changePassword = vi.fn()
const getMySignature = vi.fn()
const uploadSignature = vi.fn()
const getAvatar = vi.fn()
const uploadAvatar = vi.fn()
const deleteAvatar = vi.fn()
const totpStatus = vi.fn()
const signOutEverywhere = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: {
    me: (...a: unknown[]) => me(...a),
    updateMe: (...a: unknown[]) => updateMe(...a),
    setOtp: (...a: unknown[]) => setOtp(...a),
    passwordPolicy: (...a: unknown[]) => passwordPolicy(...a),
    changePassword: (...a: unknown[]) => changePassword(...a),
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
    deleteAvatar: (...a: unknown[]) => deleteAvatar(...a),
    totpStatus: (...a: unknown[]) => totpStatus(...a),
    signOutEverywhere: (...a: unknown[]) => signOutEverywhere(...a),
  },
  offersApi: {
    getMySignature: (...a: unknown[]) => getMySignature(...a),
    uploadSignature: (...a: unknown[]) => uploadSignature(...a),
  },
}))

const { default: ProfilePage } = await import('./ProfilePage')
const { useAuthStore } = await import('../store/auth.store')

function baseMe() {
  return {
    email: 'admin@x.com', name: 'Admin User', role: 'admin',
    otp_required: false, is_active: true,
    created_at: '2024-01-01T00:00:00Z', last_login_at: '2026-06-01T00:00:00Z',
  }
}

function fileInput(label: 'Upload signature image' | 'Upload avatar photo') {
  return screen.getByLabelText(label) as HTMLInputElement
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback, type?: string) {
    callback(new Blob(['cropped'], { type }))
  })
}

async function finishCrop(user: ReturnType<typeof userEvent.setup>) {
  const img = await screen.findByAltText('Photo being edited')
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  fireEvent.load(img)
  await user.click(screen.getByRole('button', { name: 'Save photo' }))
}

beforeEach(() => {
  getAvatar.mockReset().mockResolvedValue({ data: { configured: false } })
  uploadAvatar.mockReset()
  deleteAvatar.mockReset()
  updateMe.mockReset().mockResolvedValue({ data: {} })
  setOtp.mockReset().mockResolvedValue({ data: { otp_enabled: true, otp_enforced: false } })
  passwordPolicy.mockReset().mockResolvedValue({ data: { min_length: 8 } })
  totpStatus.mockReset().mockResolvedValue({ data: { enabled: false, pending: false, recovery_codes_remaining: 0 } })
  signOutEverywhere.mockReset()
  useAuthStore.setState({ avatarDataUrl: undefined })
})

describe('ProfilePage, offer letter signature', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: baseMe() })
    changePassword.mockReset()
    getMySignature.mockReset()
    uploadSignature.mockReset()
    useAuthStore.setState({ token: 'test-token', user: { role: 'admin', email: 'admin@x.com' } })
  })

  it('does not render the signature section for a non-admin user', async () => {
    useAuthStore.setState({ token: 'test-token', user: { role: 'standard', email: 'user@x.com' } })
    render(<ProfilePage />)

    await screen.findByText('My Profile')
    expect(screen.queryByText('Offer Letter Signature')).not.toBeInTheDocument()
    expect(getMySignature).not.toHaveBeenCalled()
  })

  it('shows "no signature uploaded" when none exists yet', async () => {
    getMySignature.mockResolvedValue({ data: { configured: false } })
    render(<ProfilePage />)

    expect(await screen.findByText('No signature uploaded yet.')).toBeInTheDocument()
  })

  it('previews an existing signature image from GET /signature/me', async () => {
    getMySignature.mockResolvedValue({
      data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'AAAA' },
    })
    render(<ProfilePage />)

    const img = await screen.findByAltText('Your signature')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.getByText(/Uploaded/)).toBeInTheDocument()
    expect(screen.getByText('Replace Signature')).toBeInTheDocument()
  })

  it('uploads a new signature and refreshes the preview', async () => {
    const user = userEvent.setup()
    getMySignature
      .mockResolvedValueOnce({ data: { configured: false } })
      .mockResolvedValueOnce({
        data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'BBBB' },
      })
    uploadSignature.mockResolvedValue({ data: { email: 'admin@x.com', content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z' } })

    render(<ProfilePage />)
    await screen.findByText('No signature uploaded yet.')

    const file = new File(['png-bytes'], 'sig.png', { type: 'image/png' })
    await user.upload(fileInput('Upload signature image'), file)

    await waitFor(() => expect(uploadSignature).toHaveBeenCalledWith(file))
    expect(await screen.findByText('Signature uploaded')).toBeInTheDocument()
    expect(await screen.findByAltText('Your signature')).toHaveAttribute('src', 'data:image/png;base64,BBBB')
  })

  it('rejects an oversized file client-side without calling the upload endpoint', async () => {
    const user = userEvent.setup()
    getMySignature.mockResolvedValue({ data: { configured: false } })
    render(<ProfilePage />)
    await screen.findByText('No signature uploaded yet.')

    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'sig.png', { type: 'image/png' })
    await user.upload(fileInput('Upload signature image'), oversized)

    expect(await screen.findByText(/too large/)).toBeInTheDocument()
    expect(uploadSignature).not.toHaveBeenCalled()
  })

  it('rejects a non-PNG/JPEG file client-side without calling the upload endpoint', async () => {
    const user = userEvent.setup({ applyAccept: false })
    getMySignature.mockResolvedValue({ data: { configured: false } })
    render(<ProfilePage />)
    await screen.findByText('No signature uploaded yet.')

    const file = new File(['gif-bytes'], 'sig.gif', { type: 'image/gif' })
    await user.upload(fileInput('Upload signature image'), file)

    expect(await screen.findByText(/must be a PNG or JPEG/)).toBeInTheDocument()
    expect(uploadSignature).not.toHaveBeenCalled()
  })

  it('surfaces the backend detail message when an upload fails server-side', async () => {
    const user = userEvent.setup()
    getMySignature.mockResolvedValue({ data: { configured: false } })
    uploadSignature.mockRejectedValue({ response: { data: { detail: 'Signature image is too large (max 2MB)' } } })

    render(<ProfilePage />)
    await screen.findByText('No signature uploaded yet.')

    const file = new File(['png-bytes'], 'sig.png', { type: 'image/png' })
    await user.upload(fileInput('Upload signature image'), file)

    expect(await screen.findByText('Signature image is too large (max 2MB)')).toBeInTheDocument()
  })

  it('shows a permission notice instead of the upload control when blocked', async () => {
    getMySignature.mockRejectedValue({ response: { status: 403 } })
    render(<ProfilePage />)

    expect(await screen.findByText(/requires the "offers:manage_signature" permission/)).toBeInTheDocument()
    expect(screen.queryByText('Upload Signature')).not.toBeInTheDocument()
  })
})

describe('ProfilePage, avatar', () => {
  beforeEach(() => stubCanvas())
  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: { ...baseMe(), role: 'standard', name: 'Ursula' } })
    changePassword.mockReset()
    getMySignature.mockReset()
    uploadSignature.mockReset()
    useAuthStore.setState({ token: 'test-token', user: { role: 'standard', email: 'user@x.com' } })
  })

  it('renders the upload control for a non-admin user, unlike the signature section', async () => {
    render(<ProfilePage />)

    await screen.findByText('My Profile')
    expect(screen.getByText('Upload Photo')).toBeInTheDocument()
    expect(getAvatar).toHaveBeenCalled()
  })

  it('shows the initial-letter circle when no avatar is configured', async () => {
    getAvatar.mockResolvedValue({ data: { configured: false } })
    render(<ProfilePage />)

    await screen.findByText('Upload Photo')
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.queryByAltText('Your avatar')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('previews an existing avatar image from GET /auth/me/avatar', async () => {
    getAvatar.mockResolvedValue({
      data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'AAAA' },
    })
    render(<ProfilePage />)

    const img = await screen.findByAltText('Your avatar')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.getByText('Change Photo')).toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(useAuthStore.getState().avatarDataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('uploads a new avatar and refreshes the preview', async () => {
    const user = userEvent.setup()
    getAvatar
      .mockResolvedValueOnce({ data: { configured: false } })
      .mockResolvedValueOnce({
        data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'BBBB' },
      })
    uploadAvatar.mockResolvedValue({ data: { email: 'user@x.com', content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z' } })

    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    const file = new File(['png-bytes'], 'me.png', { type: 'image/png' })
    await user.upload(fileInput('Upload avatar photo'), file)

    expect(uploadAvatar).not.toHaveBeenCalled()
    await finishCrop(user)

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1))
    const sent = uploadAvatar.mock.calls[0][0] as File
    expect(sent).toBeInstanceOf(File)
    expect(sent.name).toBe('avatar.png')
    expect(sent.type).toBe('image/png')
    expect(await screen.findByText('Avatar updated')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByAltText('Your avatar')).toHaveAttribute('src', 'data:image/png;base64,BBBB')
  })

  it('opens the editor on a chosen photo before anything is uploaded, and sends nothing when it is cancelled', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    await user.upload(fileInput('Upload avatar photo'), new File(['png-bytes'], 'me.png', { type: 'image/png' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit your photo' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Up and down')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadAvatar).not.toHaveBeenCalled()
  })

  it('offers Edit Photo only when there is a photo', async () => {
    getAvatar.mockResolvedValue({ data: { configured: false } })
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')
    expect(screen.queryByRole('button', { name: /Edit Photo/ })).not.toBeInTheDocument()
  })

  it('edits the photo that is already there and saves the adjusted one', async () => {
    const user = userEvent.setup()
    getAvatar.mockResolvedValue({
      data: { configured: true, content_type: 'image/jpeg', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'AAAA' },
    })
    uploadAvatar.mockResolvedValue({ data: {} })
    render(<ProfilePage />)
    await screen.findByAltText('Your avatar')

    await user.click(screen.getByRole('button', { name: /Edit Photo/ }))
    expect(await screen.findByAltText('Photo being edited')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA')
    expect(uploadAvatar).not.toHaveBeenCalled()

    await finishCrop(user)
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1))
    const sent = uploadAvatar.mock.calls[0][0] as File
    expect(sent.name).toBe('avatar.jpg')
    expect(sent.type).toBe('image/jpeg')
    expect(await screen.findByText('Avatar updated')).toBeInTheDocument()
  })

  it('removes the avatar and falls back to the initial circle', async () => {
    const user = userEvent.setup()
    getAvatar.mockResolvedValue({
      data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'AAAA' },
    })
    deleteAvatar.mockResolvedValue({ data: { message: 'Deleted' } })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<ProfilePage />)
    await screen.findByAltText('Your avatar')

    await user.click(screen.getByText('Remove'))

    await waitFor(() => expect(deleteAvatar).toHaveBeenCalled())
    expect(await screen.findByText('Avatar removed')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.queryByAltText('Your avatar')).not.toBeInTheDocument()
    expect(useAuthStore.getState().avatarDataUrl).toBeNull()

    vi.unstubAllGlobals()
  })

  it('does not remove the avatar when the confirmation is declined', async () => {
    const user = userEvent.setup()
    getAvatar.mockResolvedValue({
      data: { configured: true, content_type: 'image/png', uploaded_at: '2026-01-01T10:00:00Z', image_base64: 'AAAA' },
    })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    render(<ProfilePage />)
    await screen.findByAltText('Your avatar')
    await user.click(screen.getByText('Remove'))

    expect(deleteAvatar).not.toHaveBeenCalled()
    expect(screen.getByAltText('Your avatar')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('rejects an oversized file client-side without calling the upload endpoint', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'me.png', { type: 'image/png' })
    await user.upload(fileInput('Upload avatar photo'), oversized)

    expect(await screen.findByText(/too large/)).toBeInTheDocument()
    expect(uploadAvatar).not.toHaveBeenCalled()
  })

  it('rejects a non-PNG/JPEG file client-side without calling the upload endpoint', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    const file = new File(['gif-bytes'], 'me.gif', { type: 'image/gif' })
    await user.upload(fileInput('Upload avatar photo'), file)

    expect(await screen.findByText(/must be a PNG or JPEG/)).toBeInTheDocument()
    expect(uploadAvatar).not.toHaveBeenCalled()
  })

  it('surfaces the backend detail message when an upload fails server-side', async () => {
    const user = userEvent.setup()
    uploadAvatar.mockRejectedValue({ response: { data: { detail: 'Avatar image is too large (max 2MB)' } } })

    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    const file = new File(['png-bytes'], 'me.png', { type: 'image/png' })
    await user.upload(fileInput('Upload avatar photo'), file)
    await finishCrop(user)

    expect(await screen.findByText('Avatar image is too large (max 2MB)')).toBeInTheDocument()
  })

  it.each([
    [400, 'The file is empty or not an image'],
    [413, 'The image is too large'],
  ])('shows the server %s refusal next to the photo, not in a fading toast', async (status, detail) => {
    const user = userEvent.setup()
    uploadAvatar.mockRejectedValue(httpError(status, detail))
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    await user.upload(fileInput('Upload avatar photo'), new File(['x'], 'me.png', { type: 'image/png' }))
    await finishCrop(user)

    const alert = await screen.findByText(detail)
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.closest('[role="dialog"]')).not.toBeNull()
    expect(alert.closest('.profile-toast')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeEnabled()
  })

  it('clears the refusal on the next attempt', async () => {
    const user = userEvent.setup()
    uploadAvatar.mockRejectedValueOnce(httpError(413, 'The image is too large'))
    uploadAvatar.mockResolvedValueOnce({ data: {} })
    render(<ProfilePage />)
    await screen.findByText('Upload Photo')

    await user.upload(fileInput('Upload avatar photo'), new File(['x'], 'me.png', { type: 'image/png' }))
    await finishCrop(user)
    await screen.findByText('The image is too large')
    await user.click(screen.getByRole('button', { name: 'Save photo' }))

    await waitFor(() => expect(screen.queryByText('The image is too large')).not.toBeInTheDocument())
    expect(await screen.findByText('Avatar updated')).toBeInTheDocument()
  })
})

describe('ProfilePage, change password', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: { ...baseMe(), role: 'standard', email: 'user@x.com' } })
    changePassword.mockReset()
    useAuthStore.setState({ token: 'test-token', user: { role: 'standard', email: 'user@x.com' } })
  })

  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, current = 'old-password') {
    await user.type(await screen.findByPlaceholderText('Enter your current password'), current)
    await user.type(screen.getByPlaceholderText('Enter a new password'), 'new-password-1')
    await user.type(screen.getByPlaceholderText('Repeat new password'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Update Password' }))
  }

  it('shows the server detail inline for a wrong current password, and stays signed in', async () => {
    const user = userEvent.setup()
    changePassword.mockRejectedValue({ response: { status: 400, data: { detail: 'Current password is incorrect' } } })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect')
    expect(changePassword).toHaveBeenCalledWith({ current_password: 'old-password', new_password: 'new-password-1' })
    expect(useAuthStore.getState().token).toBe('test-token')
    expect(useAuthStore.getState().user).toMatchObject({ email: 'user@x.com' })
    expect(screen.getByPlaceholderText('Enter your current password')).toHaveValue('old-password')
    expect(screen.queryByText('Password changed successfully')).not.toBeInTheDocument()
  })

  it('clears the error as soon as any password field is edited', async () => {
    const user = userEvent.setup()
    changePassword.mockRejectedValue({ response: { status: 400, data: { detail: 'Current password is incorrect' } } })
    render(<ProfilePage />)
    await fillAndSubmit(user)
    await screen.findByRole('alert')

    await user.type(screen.getByPlaceholderText('Enter your current password'), 'x')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries no string detail', async () => {
    const user = userEvent.setup()
    changePassword.mockRejectedValue({ response: { status: 422, data: { detail: [{ msg: 'bad' }] } } })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to change password')
  })

  it('clears the form and says so on success', async () => {
    const user = userEvent.setup()
    changePassword.mockResolvedValue({ data: {} })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter your current password')).toHaveValue('')
  })

  it('swaps in the fresh token the server sends, so the session carries on, and keeps the user', async () => {
    const user = userEvent.setup()
    changePassword.mockResolvedValue({ data: { message: 'Password changed', access_token: 'fresh-token', token_type: 'bearer' } })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('fresh-token')
    expect(useAuthStore.getState().user).toMatchObject({ email: 'user@x.com', role: 'standard' })
  })

  it('keeps the current token when the answer carries none', async () => {
    const user = userEvent.setup()
    changePassword.mockResolvedValue({ data: { message: 'Password changed' } })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('test-token')
  })

  it('does not swap a token that is not text', async () => {
    const user = userEvent.setup()
    changePassword.mockResolvedValue({ data: { access_token: { not: 'a token' } } })
    render(<ProfilePage />)

    await fillAndSubmit(user)

    expect(await screen.findByText('Password changed successfully')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('test-token')
  })

  it('does not call the server when the confirmation does not match', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)

    await user.type(await screen.findByPlaceholderText('Enter your current password'), 'old-password')
    await user.type(screen.getByPlaceholderText('Enter a new password'), 'new-password-1')
    await user.type(screen.getByPlaceholderText('Repeat new password'), 'different')

    expect(screen.getByRole('button', { name: 'Update Password' })).toBeDisabled()
    expect(changePassword).not.toHaveBeenCalled()
  })
})

const PROFILE = {
  email: 'bob@x.com',
  name: 'Bob Recruiter',
  role: 'standard',
  otp_required: false,
  is_active: true,
  created_at: '2025-01-05T10:00:00Z',
  last_login_at: '2025-02-01T09:30:00Z',
  has_password: true,
  otp_enabled: false,
  otp_enforced: false,
  job_title: 'Sourcer',
  timezone: 'Asia/Karachi',
  department_id: null,
}

async function ready() {
  await screen.findByLabelText('Full Name')
}

describe('ProfilePage, profile details', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: PROFILE })
    changePassword.mockReset()
    getMySignature.mockReset()
    useAuthStore.setState({ token: 't', user: { role: 'standard', email: 'bob@x.com', name: 'Bob Recruiter' } })
  })

  it('shows the stored name, job title and timezone', async () => {
    render(<ProfilePage />)
    await ready()

    expect(screen.getByLabelText('Full Name')).toHaveValue('Bob Recruiter')
    expect(screen.getByLabelText('Job Title')).toHaveValue('Sourcer')
    expect(screen.getByLabelText('Timezone')).toHaveValue('Asia/Karachi')
  })

  it('keeps Save disabled until something changes', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)
    await ready()

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Job Title'), ' II')
    expect(save).toBeEnabled()
  })

  it('sends only the fields that changed, then shows them as saved', async () => {
    const user = userEvent.setup()
    updateMe.mockResolvedValue({ data: { ...PROFILE, job_title: 'Talent Lead', timezone: 'Europe/London' } })
    render(<ProfilePage />)
    await ready()

    await user.clear(screen.getByLabelText('Job Title'))
    await user.type(screen.getByLabelText('Job Title'), 'Talent Lead')
    await user.clear(screen.getByLabelText('Timezone'))
    await user.type(screen.getByLabelText('Timezone'), ' Europe/London ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ job_title: 'Talent Lead', timezone: 'Europe/London' }))
    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('refuses a timezone name the browser does not know, before asking the server', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)
    await ready()

    await user.clear(screen.getByLabelText('Timezone'))
    await user.type(screen.getByLabelText('Timezone'), 'Mars/Olympus')

    expect(screen.getByText('Use a timezone name such as Europe/London')).toBeInTheDocument()
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(updateMe).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Timezone'))
    await user.type(screen.getByLabelText('Timezone'), 'UTC')
    expect(screen.queryByText('Use a timezone name such as Europe/London')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('suggests common zones, the saved one among them, without listing every zone', async () => {
    render(<ProfilePage />)
    await ready()

    const input = screen.getByLabelText('Timezone')
    const list = document.getElementById(input.getAttribute('list') as string) as HTMLElement
    const zones = Array.from(list.querySelectorAll('option')).map(o => o.getAttribute('value'))
    expect(zones).toContain('Asia/Karachi')
    expect(zones).toContain('Europe/London')
    expect(zones.length).toBeLessThan(60)
  })

  it('carries a new name into the signed-in user the sidebar reads', async () => {
    const user = userEvent.setup()
    updateMe.mockResolvedValue({ data: { ...PROFILE, name: 'Robert Recruiter' } })
    render(<ProfilePage />)
    await ready()

    await user.clear(screen.getByLabelText('Full Name'))
    await user.type(screen.getByLabelText('Full Name'), 'Robert Recruiter')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe('Robert Recruiter'))
    expect(updateMe).toHaveBeenCalledWith({ name: 'Robert Recruiter' })
  })

  it('shows the server refusal at the form and keeps the typed value', async () => {
    const user = userEvent.setup()
    updateMe.mockRejectedValue(httpError(422, 'Name cannot be blank'))
    render(<ProfilePage />)
    await ready()

    await user.clear(screen.getByLabelText('Full Name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name cannot be blank')
    expect(screen.getByLabelText('Full Name')).toHaveValue('')
    expect(screen.queryByText('Profile saved')).not.toBeInTheDocument()
  })

  it('reads a list of validation errors as words, not as an object', async () => {
    const user = userEvent.setup()
    updateMe.mockRejectedValue(httpError(422, [{ type: 'string_too_short', loc: ['body', 'name'], msg: 'String should have at least 1 character' }]))
    render(<ProfilePage />)
    await ready()

    await user.type(screen.getByLabelText('Job Title'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('String should have at least 1 character')
  })

  it('shows an error with Retry instead of an empty form when the profile cannot be read', async () => {
    const user = userEvent.setup()
    me.mockRejectedValueOnce(httpError(500, 'boom'))
    render(<ProfilePage />)

    expect(await screen.findByText('Could not load your profile.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full Name')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Full Name')).toHaveValue('Bob Recruiter')
  })
})

describe('ProfilePage, OTP', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: PROFILE })
    useAuthStore.setState({ token: 't', user: { role: 'standard', email: 'bob@x.com', name: 'Bob Recruiter' } })
  })

  const otpToggle = () => screen.getByRole('checkbox', { name: /^(On|Off)$/ })

  it('turns on and reflects what the server answered', async () => {
    const user = userEvent.setup()
    render(<ProfilePage />)
    await ready()

    const toggle = otpToggle()
    expect(toggle).not.toBeChecked()
    await user.click(toggle)

    await waitFor(() => expect(setOtp).toHaveBeenCalledWith(true))
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('cannot be turned off when an administrator enforces it', async () => {
    const user = userEvent.setup()
    me.mockResolvedValue({ data: { ...PROFILE, otp_enabled: true, otp_enforced: true } })
    render(<ProfilePage />)
    await ready()

    const toggle = otpToggle()
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
    expect(screen.getByText('Required by your administrator')).toBeInTheDocument()
    await user.click(toggle)
    expect(setOtp).not.toHaveBeenCalled()
  })

  it('shows no help line when nothing is enforced', async () => {
    render(<ProfilePage />)
    await ready()

    expect(screen.queryByText('Required by your administrator')).not.toBeInTheDocument()
  })

  it('says why when the server refuses to turn it off, and leaves it on', async () => {
    const user = userEvent.setup()
    me.mockResolvedValue({ data: { ...PROFILE, otp_enabled: true } })
    setOtp.mockRejectedValue(httpError(403, 'OTP is required by your administrator'))
    render(<ProfilePage />)
    await ready()

    const toggle = otpToggle()
    await user.click(toggle)

    expect(await screen.findByText('OTP is required by your administrator')).toBeInTheDocument()
    expect(toggle).toBeChecked()
  })
})

describe('ProfilePage, password rules', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: PROFILE })
    changePassword.mockReset()
    useAuthStore.setState({ token: 't', user: { role: 'standard', email: 'bob@x.com', name: 'Bob Recruiter' } })
  })

  it('shows the rules the server enforces, not a fixed length', async () => {
    passwordPolicy.mockResolvedValue({ data: { min_length: 12, require_uppercase: true, require_digit: true, require_special: true } })
    render(<ProfilePage />)
    await ready()

    expect(await screen.findByText('At least 12 characters, with an uppercase letter, a number and a symbol')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Min 8 characters')).not.toBeInTheDocument()
  })

  it('shows no rule line when the policy cannot be read', async () => {
    passwordPolicy.mockRejectedValue(httpError(500, 'boom'))
    render(<ProfilePage />)
    await ready()

    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
    expect(screen.queryByText(/At least \d+ characters/)).not.toBeInTheDocument()
  })

  it('refuses a password shorter than the policy minimum before asking the server', async () => {
    const user = userEvent.setup()
    passwordPolicy.mockResolvedValue({ data: { min_length: 12 } })
    render(<ProfilePage />)
    await ready()
    await screen.findByText('At least 12 characters')

    await user.type(screen.getByLabelText('Current Password'), 'old-password')
    await user.type(screen.getByLabelText('New Password'), 'short-pw')
    await user.type(screen.getByLabelText('Confirm New Password'), 'short-pw')
    await user.click(screen.getByRole('button', { name: 'Update Password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('New password must be at least 12 characters')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('offers no password form to an account that has no password', async () => {
    me.mockResolvedValue({ data: { ...PROFILE, has_password: false } })
    render(<ProfilePage />)
    await ready()

    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update Password' })).not.toBeInTheDocument()
    expect(screen.queryByText('Change Password')).not.toBeInTheDocument()
  })

  it('still offers the form when the server does not say either way', async () => {
    const withoutFlag: Record<string, unknown> = { ...PROFILE }
    delete withoutFlag.has_password
    me.mockResolvedValue({ data: withoutFlag })
    render(<ProfilePage />)
    await ready()

    expect(screen.getByLabelText('Current Password')).toBeInTheDocument()
  })
})

describe('ProfilePage, two-step verification and sessions', () => {
  beforeEach(() => {
    me.mockReset().mockResolvedValue({ data: PROFILE })
    getMySignature.mockReset()
    useAuthStore.setState({ token: 'old-token', user: { role: 'standard', email: 'bob@x.com', name: 'Bob Recruiter' } })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows the two-step verification card, with its status read from the server', async () => {
    render(<ProfilePage />)
    await ready()

    expect(await screen.findByText('Authenticator app')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument()
    expect(totpStatus).toHaveBeenCalledTimes(1)
  })

  it('offers no authenticator card to an account that has no password', async () => {
    me.mockResolvedValue({ data: { ...PROFILE, has_password: false } })
    render(<ProfilePage />)
    await ready()

    expect(screen.queryByText('Authenticator app')).not.toBeInTheDocument()
    expect(totpStatus).not.toHaveBeenCalled()
  })

  it('signs out everywhere after a confirmation, keeps this session with the fresh token, and says so', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    signOutEverywhere.mockResolvedValue({ data: { access_token: 'fresh-token', token_type: 'bearer' } })
    const user = userEvent.setup({ delay: null })
    render(<ProfilePage />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))

    expect(await screen.findByText('Signed out everywhere else')).toBeInTheDocument()
    expect(signOutEverywhere).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().token).toBe('fresh-token')
    expect(useAuthStore.getState().user?.email).toBe('bob@x.com')
  })

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup({ delay: null })
    render(<ProfilePage />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    expect(signOutEverywhere).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe('old-token')
  })

  it('keeps the old token when the answer carries none', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    signOutEverywhere.mockResolvedValue({ data: {} })
    const user = userEvent.setup({ delay: null })
    render(<ProfilePage />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    await screen.findByText('Signed out everywhere else')
    expect(useAuthStore.getState().token).toBe('old-token')
  })

  it('shows the server sentence when it cannot sign out everywhere', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    signOutEverywhere.mockRejectedValue(httpError(500, 'Could not end the other sessions.'))
    const user = userEvent.setup({ delay: null })
    render(<ProfilePage />)
    await ready()

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    expect(await screen.findByText('Could not end the other sessions.')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBe('old-token')
  })

  it('is offered to an account with no password too, since sessions are not about passwords', async () => {
    me.mockResolvedValue({ data: { ...PROFILE, has_password: false } })
    render(<ProfilePage />)
    await ready()
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument()
  })
})
