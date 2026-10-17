import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const totpStatus = vi.fn()
const totpSetup = vi.fn()
const totpEnable = vi.fn()
const totpDisable = vi.fn()
const totpRecoveryCodes = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: {
    totpStatus: (...a: unknown[]) => totpStatus(...a),
    totpSetup: (...a: unknown[]) => totpSetup(...a),
    totpEnable: (...a: unknown[]) => totpEnable(...a),
    totpDisable: (...a: unknown[]) => totpDisable(...a),
    totpRecoveryCodes: (...a: unknown[]) => totpRecoveryCodes(...a),
  },
}))

const { default: TwoStepCard } = await import('./TwoStepCard')
const { useAuthStore } = await import('../store/auth.store')

const SECRET = 'JBSWY3DPEHPK3PXP'
const URI = 'otpauth://totp/Hirely:sam%40acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Hirely'
const CODES = ['aaaaa-11111', 'bbbbb-22222', 'ccccc-33333', 'ddddd-44444', 'eeeee-55555', 'fffff-66666', 'ggggg-77777', 'hhhhh-88888']

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

const onToast = vi.fn()
const user = () => userEvent.setup({ delay: null })

function renderCard() {
  return render(<TwoStepCard onToast={onToast} />)
}

beforeEach(() => {
  for (const fn of [totpStatus, totpSetup, totpEnable, totpDisable, totpRecoveryCodes, onToast]) fn.mockReset()
  totpStatus.mockResolvedValue({ data: { enabled: false, pending: false, recovery_codes_remaining: 0 } })
  totpSetup.mockResolvedValue({ data: { secret: SECRET, otpauth_uri: URI } })
  totpEnable.mockResolvedValue({ data: { recovery_codes: CODES } })
  totpDisable.mockResolvedValue({ data: { enabled: false } })
  totpRecoveryCodes.mockResolvedValue({ data: { recovery_codes: CODES } })
  localStorage.clear()
})

afterEach(() => { vi.restoreAllMocks() })

async function setUpToCodes(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('button', { name: 'Set up' }))
  await u.type(await screen.findByLabelText('Code from the app'), '123456')
  await u.click(screen.getByRole('button', { name: 'Turn on' }))
  await screen.findByRole('group', { name: 'Recovery codes' })
}

describe('TwoStepCard: status', () => {
  it('reads the status and offers to set up when it is off', async () => {
    renderCard()
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    expect(totpStatus).toHaveBeenCalledTimes(1)
  })

  it('shows it on, with the recovery codes left, and offers to regenerate or turn off', async () => {
    totpStatus.mockResolvedValue({ data: { enabled: true, pending: false, recovery_codes_remaining: 5 } })
    renderCard()
    expect(await screen.findByText('On')).toBeInTheDocument()
    expect(screen.getByText('5 recovery codes left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate recovery codes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument()
  })

  it('says one code left in the singular', async () => {
    totpStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 1 } })
    renderCard()
    expect(await screen.findByText('1 recovery code left')).toBeInTheDocument()
  })

  it('shows a failed read with a retry that reads again', async () => {
    totpStatus.mockRejectedValueOnce(new Error('Network Error'))
    renderCard()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the status.')

    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument()
    expect(totpStatus).toHaveBeenCalledTimes(2)
  })
})

describe('TwoStepCard: setting up', () => {
  it('shows the key in a read-only field and a link that opens the authenticator app', async () => {
    renderCard()
    await user().click(await screen.findByRole('button', { name: 'Set up' }))

    const secret = await screen.findByLabelText('Setup key')
    expect(secret).toHaveValue(SECRET)
    expect(secret).toHaveAttribute('readonly')
    expect(secret.className).toMatch(/mono/)
    expect(screen.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', URI)
  })

  it('offers no link for an address that does not open an authenticator app', async () => {
    totpSetup.mockResolvedValue({ data: { secret: SECRET, otpauth_uri: 'javascript:alert(1)' } })
    renderCard()
    await user().click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByLabelText('Setup key')
    expect(screen.queryByRole('link', { name: 'Open in authenticator app' })).not.toBeInTheDocument()
  })

  it('copies the key', async () => {
    const u = user()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Set up' }))
    await u.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith(SECRET)
    expect(onToast).toHaveBeenCalledWith('Setup key copied')
  })

  it('wants six digits before it will turn on, and sends them without the space an app prints', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Set up' }))
    const code = await screen.findByLabelText('Code from the app')
    const turnOn = screen.getByRole('button', { name: 'Turn on' })

    expect(turnOn).toBeDisabled()
    await u.type(code, '12345')
    expect(turnOn).toBeDisabled()
    await u.type(code, '6')
    expect(turnOn).toBeEnabled()

    await u.clear(code)
    await u.type(code, '123 456')
    await u.click(turnOn)
    await screen.findByRole('group', { name: 'Recovery codes' })
    expect(totpEnable).toHaveBeenCalledWith('123456')
  })

  it('shows the sentence for a wrong code and stays on the step', async () => {
    totpEnable.mockRejectedValue(httpError(400, 'That code is not right.'))
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Set up' }))
    await u.type(await screen.findByLabelText('Code from the app'), '000000')
    await u.click(screen.getByRole('button', { name: 'Turn on' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right.')
    expect(screen.getByLabelText('Setup key')).toHaveValue(SECRET)
    expect(screen.queryByRole('group', { name: 'Recovery codes' })).not.toBeInTheDocument()
  })

  it('drops the key when setup is cancelled', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByLabelText('Setup key')
    await u.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Setup key')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument()
  })

  it('shows why a setup could not start, and re-reads the status when it is already on', async () => {
    totpSetup.mockRejectedValue(httpError(409, 'Two-step verification is already on.'))
    totpStatus.mockResolvedValueOnce({ data: { enabled: false } }).mockResolvedValueOnce({ data: { enabled: true, recovery_codes_remaining: 8 } })
    renderCard()
    await user().click(await screen.findByRole('button', { name: 'Set up' }))

    expect(await screen.findByText('On')).toBeInTheDocument()
    expect(totpStatus).toHaveBeenCalledTimes(2)
  })
})

describe('TwoStepCard: the recovery codes', () => {
  it('shows all eight once, and nothing else of the card, until they are confirmed saved', async () => {
    const u = user()
    renderCard()
    await setUpToCodes(u)

    const panel = screen.getByRole('group', { name: 'Recovery codes' })
    for (const c of CODES) expect(within(panel).getByText(c)).toBeInTheDocument()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Setup key')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('shown once')
    expect(onToast).toHaveBeenCalledWith('Two-step verification is on')
  })

  it('cannot be dismissed until the person says they saved the codes', async () => {
    const u = user()
    renderCard()
    await setUpToCodes(u)

    const done = screen.getByRole('button', { name: 'Done' })
    expect(done).toBeDisabled()
    await u.click(screen.getByLabelText('I have saved these codes'))
    expect(done).toBeEnabled()
    await u.click(done)

    expect(screen.queryByRole('group', { name: 'Recovery codes' })).not.toBeInTheDocument()
    for (const c of CODES) expect(screen.queryByText(c)).not.toBeInTheDocument()
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByText('8 recovery codes left')).toBeInTheDocument()
  })

  it('copies every code at once', async () => {
    const u = user()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    renderCard()
    await setUpToCodes(u)
    await u.click(screen.getByRole('button', { name: 'Copy all' }))

    expect(write).toHaveBeenCalledWith(CODES.join('\n'))
    expect(onToast).toHaveBeenCalledWith('Recovery codes copied')
  })

  it('downloads them as a text file made in the browser', async () => {
    const u = user()
    let blob: Blob | null = null
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => { blob = b; return 'blob:codes' },
      revokeObjectURL: vi.fn(),
    })
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download} ${this.href}`)
    })
    renderCard()
    await setUpToCodes(u)
    await u.click(screen.getByRole('button', { name: 'Download as .txt' }))

    expect(clicked).toEqual(['recovery-codes.txt blob:codes'])
    expect(await readBlob(blob!)).toBe(`${CODES.join('\n')}\n`)
    vi.unstubAllGlobals()
  })

  it('is not written to storage, to the auth store or to the console', async () => {
    const u = user()
    const logged = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByLabelText('Setup key')
    await u.type(screen.getByLabelText('Code from the app'), '123456')
    await u.click(screen.getByRole('button', { name: 'Turn on' }))
    await screen.findByRole('group', { name: 'Recovery codes' })

    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify(sessionStorage) + JSON.stringify(useAuthStore.getState())
    expect(everything).not.toContain(SECRET)
    for (const c of CODES) expect(everything).not.toContain(c)
    for (const spy of logged) {
      const text = JSON.stringify(spy.mock.calls)
      expect(text).not.toContain(SECRET)
      for (const c of CODES) expect(text).not.toContain(c)
    }
  })
})

describe('TwoStepCard: regenerating the recovery codes', () => {
  beforeEach(() => totpStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 2 } }))

  it('asks for an authenticator code, then shows the new set in the same panel', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Regenerate recovery codes' }))
    await u.type(screen.getByLabelText('Code from the app'), '654321')
    await u.click(screen.getByRole('button', { name: 'Make new codes' }))

    expect(await screen.findByRole('group', { name: 'Recovery codes' })).toBeInTheDocument()
    expect(totpRecoveryCodes).toHaveBeenCalledWith('654321')
    expect(onToast).toHaveBeenCalledWith('New recovery codes made. The old ones no longer work')
    await u.click(screen.getByLabelText('I have saved these codes'))
    await u.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('8 recovery codes left')).toBeInTheDocument()
  })

  it('shows the server sentence for a wrong code', async () => {
    totpRecoveryCodes.mockRejectedValue(httpError(400, 'That code is not right.'))
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Regenerate recovery codes' }))
    await u.type(screen.getByLabelText('Code from the app'), '000000')
    await u.click(screen.getByRole('button', { name: 'Make new codes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right.')
    expect(screen.queryByRole('group', { name: 'Recovery codes' })).not.toBeInTheDocument()
  })
})

describe('TwoStepCard: turning it off', () => {
  beforeEach(() => totpStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 8 } }))

  it('needs the password and a code before it will go', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Turn off' }))

    const submit = within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Turn off' })
    expect(submit).toBeDisabled()
    await u.type(screen.getByLabelText('Password'), 'S3cur3P@ssword!')
    expect(submit).toBeDisabled()
    await u.type(screen.getByLabelText('Code from the app'), '123456')
    expect(submit).toBeEnabled()
    await u.click(submit)

    await waitFor(() => expect(totpDisable).toHaveBeenCalledWith('S3cur3P@ssword!', '123456'))
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(onToast).toHaveBeenCalledWith('Two-step verification is off')
  })

  it('takes a recovery code in place of an app code', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Turn off' }))
    await u.type(screen.getByLabelText('Password'), 'S3cur3P@ssword!')
    await u.type(screen.getByLabelText('Code from the app'), 'abcde-12345')
    await u.click(within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(totpDisable).toHaveBeenCalledWith('S3cur3P@ssword!', 'abcde-12345'))
  })

  it('keeps it on and says why when the password or the code is wrong', async () => {
    totpDisable.mockRejectedValue(httpError(400, 'The password or the code is wrong.'))
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Turn off' }))
    await u.type(screen.getByLabelText('Password'), 'nope')
    await u.type(screen.getByLabelText('Code from the app'), '123456')
    await u.click(within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Turn off' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The password or the code is wrong.')
    expect(screen.getByText('On')).toBeInTheDocument()
  })

  it('can be cancelled without a request', async () => {
    const u = user()
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Turn off' }))
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(totpDisable).not.toHaveBeenCalled()
  })
})
