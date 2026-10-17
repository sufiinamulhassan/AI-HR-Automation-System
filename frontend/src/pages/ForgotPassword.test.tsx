import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND } from '../lib/brand'

const forgotPassword = vi.fn()

vi.mock('../lib/api', () => ({
  authApi: { forgotPassword: (...a: unknown[]) => forgotPassword(...a) },
}))

const { default: ForgotPassword } = await import('./ForgotPassword')

const GENERIC = 'If that address has an account, we have sent a link.'

function renderPage(brand = DEFAULT_BRAND) {
  return render(
    <BrandContext.Provider value={brand}>
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/login" element={<div>Sign-in page</div>} />
        </Routes>
      </MemoryRouter>
    </BrandContext.Provider>,
  )
}

const user = () => userEvent.setup({ delay: null })

beforeEach(() => {
  forgotPassword.mockReset().mockResolvedValue({ data: { message: GENERIC } })
})

describe('ForgotPassword', () => {
  it('asks for an email address and nothing else', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Forgot your password?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email')
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('names the company and not the product when the page knows the company', () => {
    renderPage({ ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp' })
    expect(document.querySelector('.login-brand-name')).toHaveTextContent('Acme Corp')
  })

  it('sends the address, trimmed, and shows the answer the server gave in place of the form', async () => {
    const u = user()
    renderPage()
    await u.type(screen.getByLabelText('Email address'), '  ann@acme.test ')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC)
    expect(forgotPassword).toHaveBeenCalledWith('ann@acme.test')
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('shows the same answer for an address that has no account, because the server answers the same', async () => {
    const u = user()
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'nobody@nowhere.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC)
  })

  it('uses the generic sentence itself if the server sends no text', async () => {
    const u = user()
    forgotPassword.mockResolvedValue({ data: {} })
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'ann@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC)
  })

  it('waits while the request is out and cannot be sent twice', async () => {
    const u = user()
    let resolve!: (v: unknown) => void
    forgotPassword.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'ann@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled()
    resolve({ data: { message: GENERIC } })
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(forgotPassword).toHaveBeenCalledTimes(1)
  })

  it('says to try again later when the server refuses for too many requests, and keeps the form', async () => {
    const u = user()
    forgotPassword.mockRejectedValue({ response: { status: 429, data: { detail: 'Too many requests for ann@acme.test.' } } })
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'ann@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.')
    expect(screen.getByLabelText('Email address')).toHaveValue('ann@acme.test')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled())
  })

  it('says the same thing about any other failure, whatever detail it carries', async () => {
    const u = user()
    forgotPassword.mockRejectedValue({ response: { status: 500, data: { detail: 'No such account' } } })
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'ann@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the link. Try again in a moment.')
    expect(screen.queryByText('No such account')).not.toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries none', async () => {
    const u = user()
    forgotPassword.mockRejectedValue(new Error('Network Error'))
    renderPage()
    await u.type(screen.getByLabelText('Email address'), 'ann@acme.test')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the link. Try again in a moment.')
  })

  it('goes back to the sign-in page', async () => {
    const u = user()
    renderPage()
    await u.click(screen.getByRole('link', { name: 'Back to sign in' }))
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument()
  })

  it('has no subtitle or footnote', () => {
    const { container } = renderPage()
    expect(container.querySelector('.login-sub')).toBeNull()
    expect(container.querySelector('p')).toBeNull()
  })
})

describe('ForgotPassword: legal links', () => {
  it('shows the company Terms and Privacy links under the form, each in a new tab', () => {
    renderPage({ ...DEFAULT_BRAND, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' })
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://acme.test/terms')
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows no such links when the company has set none', () => {
    renderPage()
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
  })
})
