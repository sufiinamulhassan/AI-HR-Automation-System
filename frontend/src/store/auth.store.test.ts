import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bulkUpload = vi.fn()
const batchStatus = vi.fn()

vi.mock('../lib/api', () => ({
  intelApi: {
    bulkUpload: (...a: unknown[]) => bulkUpload(...a),
    batchStatus: (...a: unknown[]) => batchStatus(...a),
  },
}))

const { useAuthStore } = await import('./auth.store')
const { useUploadStore } = await import('./upload.store')

const ACME_ADMIN = {
  email: 'sam@acme.test',
  name: 'Sam Lee',
  role: 'superadmin',
  company_id: 'cmp_acme',
  company_name: 'Acme Corp',
  client_id: 'cli_acme',
  client_name: 'Acme Holdings',
  workspace_kind: 'workspace' as const,
  is_platform_admin: false,
}

function signInAndLeaveTraces() {
  useAuthStore.getState().login('tok_acme', ACME_ADMIN)
  useUploadStore.setState({
    batch: { batchId: 'b1', totalFiles: 40, status: 'processing', processed: 12, skippedDuplicates: 0, failed: 0, autoInvited: 0 },
  })
}

beforeEach(() => {
  localStorage.clear()
  bulkUpload.mockReset()
  batchStatus.mockReset()
  useAuthStore.setState({ token: null, user: null, avatarDataUrl: undefined })
  useUploadStore.setState({ batch: null, uploading: false, error: '' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('auth store', () => {
  it('keeps the workspace fields of the signed-in user, and persists them', () => {
    useAuthStore.getState().login('tok_acme', ACME_ADMIN)

    expect(useAuthStore.getState().token).toBe('tok_acme')
    expect(useAuthStore.getState().user?.company_name).toBe('Acme Corp')
    const saved = JSON.parse(localStorage.getItem('hr-bot-auth')!)
    expect(saved.state.user).toMatchObject({ company_id: 'cmp_acme', workspace_kind: 'workspace', is_platform_admin: false })
    expect(saved.state.token).toBe('tok_acme')
  })

  it('accepts a minimal user, as older sessions and many tests have', () => {
    useAuthStore.getState().login('tok', { email: 'a@x.test', role: 'admin' })
    expect(useAuthStore.getState().user).toEqual({ email: 'a@x.test', role: 'admin' })
  })

  it('does not touch the other stores on login', () => {
    useUploadStore.setState({
      batch: { batchId: 'b1', totalFiles: 1, status: 'queued', processed: 0, skippedDuplicates: 0, failed: 0, autoInvited: 0 },
    })
    useAuthStore.getState().login('tok', ACME_ADMIN)

    expect(useUploadStore.getState().batch?.batchId).toBe('b1')
  })
})

describe('logout', () => {
  it('forgets the token, the user and the avatar', () => {
    signInAndLeaveTraces()
    useAuthStore.getState().setAvatarDataUrl('data:image/png;base64,AAAA')
    useAuthStore.getState().logout()

    const s = useAuthStore.getState()
    expect(s.token).toBeNull()
    expect(s.user).toBeNull()
    expect(s.avatarDataUrl).toBeUndefined()
  })

  it('drops the upload batch and removes its saved copy', () => {
    signInAndLeaveTraces()
    expect(localStorage.getItem('hr-bot-upload')).not.toBeNull()

    useAuthStore.getState().logout()

    expect(useUploadStore.getState().batch).toBeNull()
    expect(localStorage.getItem('hr-bot-upload')).toBeNull()
  })

  it('removes the saved session too, leaving nothing of the account in localStorage', () => {
    signInAndLeaveTraces()
    useAuthStore.getState().logout()

    const saved = JSON.parse(localStorage.getItem('hr-bot-auth')!)
    expect(saved.state).toEqual({ token: null, user: null })
    expect(localStorage.getItem('hr-bot-upload')).toBeNull()
  })

  it('stops polling a batch that was still processing', async () => {
    vi.useFakeTimers()
    bulkUpload.mockResolvedValue({ data: { batch_id: 'b1', total_files: 2, status: 'processing' } })
    batchStatus.mockResolvedValue({ data: { status: 'processing', processed: 1 } })
    await useUploadStore.getState().startUpload([new File(['x'], 'a.pdf')])

    await vi.advanceTimersByTimeAsync(2000)
    expect(batchStatus).toHaveBeenCalledTimes(1)

    useAuthStore.getState().logout()
    await vi.advanceTimersByTimeAsync(10000)
    expect(batchStatus).toHaveBeenCalledTimes(1)
  })

  it('leaves the next sign-in with a clean slate', () => {
    signInAndLeaveTraces()
    useAuthStore.getState().logout()
    useAuthStore.getState().login('tok_other', { email: 'pat@other.test', role: 'admin', company_id: 'cmp_other' })

    expect(useUploadStore.getState().batch).toBeNull()
    expect(useAuthStore.getState().user?.company_id).toBe('cmp_other')
  })

  it('is safe to call when nobody is signed in', () => {
    expect(() => useAuthStore.getState().logout()).not.toThrow()
    expect(useAuthStore.getState().token).toBeNull()
  })
})
