import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND } from '../lib/brand'

const resetPassword = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: { resetPassword: (...a: unknown[]) => resetPassword(...a) },
}))

const { default: ResetPassword } = await import('./ResetPassword')

function Landed() {
  const location = useLocation()
  return <div data-testid="landed">{location.pathname}{location.search}</div>
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<Landed />} />
        <Route path="/forgot-password" element={<div>Forgot page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })

async function fill(u: ReturnType<typeof user>, password = 'N3w-passw0rd', confirm = password) {
  await u.type(screen.getByLabelText('New password'), password)
  await u.type(screen.getByLabelText('Confirm password'), confirm)
}

beforeEach(() => {
  resetPassword.mockReset().mockResolvedValue({ data: { message: 'Password updated' } })
})

describe('a reset link', () => {
  it('says what it is for, with a new password and a confirmation', () => {
    renderAt('?token=tok_abc')
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument()
  })

  it('sends the token from the link with the new password, then goes to sign-in with a notice', async () => {
    const u = user()
    renderAt('?token=tok_abc')
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByTestId('landed')).toHaveTextContent('/login?reset=1')
    expect(resetPassword).toHaveBeenCalledWith('tok_abc', 'N3w-passw0rd')
  })

  it('reads a token that carries characters a URL escapes', async () => {
    const u = user()
    renderAt(`?token=${encodeURIComponent('a/b+c=d')}`)
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Update password' }))
    await screen.findByTestId('landed')
    expect(resetPassword).toHaveBeenCalledWith('a/b+c=d', 'N3w-passw0rd')
  })

  it('does not call the server when the two entries differ', async () => {
    const u = user()
    renderAt('?token=tok_abc')
    await fill(u, 'N3w-passw0rd', 'N3w-passw0rd!')
    await u.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('shows the server message for a link that is dead, and offers a new one', async () => {
    const u = user()
    resetPassword.mockRejectedValue({ response: { status: 400, data: { detail: 'This link is invalid or has expired.' } } })
    renderAt('?token=tok_old')
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid or has expired.')
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument()
    await u.click(screen.getByRole('link', { name: 'Request a new link' }))
    expect(await screen.findByText('Forgot page')).toBeInTheDocument()
  })

  it("shows the company's password rule as the server states it, and lets the person try again", async () => {
    const u = user()
    resetPassword.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Password must be at least 12 characters and include a number.' } } })
    renderAt('?token=tok_abc')
    await fill(u, 'short')
    await u.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at least 12 characters and include a number.')

    await u.clear(screen.getByLabelText('New password'))
    await u.clear(screen.getByLabelText('Confirm password'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await fill(u, 'Longer-passw0rd-ok')
    await u.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByTestId('landed')).toHaveTextContent('/login?reset=1')
    expect(resetPassword).toHaveBeenLastCalledWith('tok_abc', 'Longer-passw0rd-ok')
  })

  it('falls back to a plain message when the failure carries none', async () => {
    const u = user()
    resetPassword.mockRejectedValue(new Error('Network Error'))
    renderAt('?token=tok_abc')
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not set the password. Try again.')
  })

  it('shows and hides both entries together', async () => {
    const u = user()
    renderAt('?token=tok_abc')
    await u.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text')
    await u.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
  })
})

describe('an invitation link', () => {
  it('only changes the wording', () => {
    renderAt('?token=tok_abc&invite=1')
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set your password' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update password' })).not.toBeInTheDocument()
  })

  it('sends the same request and says so on the sign-in page', async () => {
    const u = user()
    renderAt('?token=tok_abc&invite=1')
    await fill(u)
    await u.click(screen.getByRole('button', { name: 'Set your password' }))

    expect(await screen.findByTestId('landed')).toHaveTextContent('/login?reset=invite')
    expect(resetPassword).toHaveBeenCalledWith('tok_abc', 'N3w-passw0rd')
  })

  it('treats any other value of invite as a plain reset', () => {
    renderAt('?token=tok_abc&invite=0')
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument()
  })
})

describe('a link with no token', () => {
  it('says the link is no good and offers a new one, with no form', () => {
    renderAt('')
    expect(screen.getByRole('alert')).toHaveTextContent('This link is invalid or has expired.')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(resetPassword).not.toHaveBeenCalled()
  })
})

describe('writing rules', () => {
  it('has no subtitle or footnote', () => {
    const { container } = renderAt('?token=tok_abc')
    expect(container.querySelector('.login-sub')).toBeNull()
    expect(container.querySelector('p')).toBeNull()
  })
})

describe('a reset link: legal links', () => {
  it('shows the company Terms and Privacy links, each in a new tab', () => {
    render(
      <BrandContext.Provider value={{ ...DEFAULT_BRAND, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' }}>
        <MemoryRouter initialEntries={['/reset-password?token=tok_abc']}>
          <Routes><Route path="/reset-password" element={<ResetPassword />} /></Routes>
        </MemoryRouter>
      </BrandContext.Provider>,
    )
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', 'https://acme.test/privacy')
  })
})
