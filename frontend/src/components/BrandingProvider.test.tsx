import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPublic = vi.fn()

vi.mock('../lib/api', () => ({
  brandingApi: { getPublic: (...a: unknown[]) => getPublic(...a) },
}))

const { default: BrandingProvider } = await import('./BrandingProvider')
const { useBrand } = await import('../lib/brand')
const { useAuthStore } = await import('../store/auth.store')
const { usePageMeta } = await import('../lib/usePageMeta')

const ACME = { company_name: 'Acme Corp', company_logo_url: 'https://cdn.acme.test/logo.png', primary_color: '#112233', accent_color: '#445566' }
const OTHER = { company_name: 'Other Ltd', company_logo_url: '', primary_color: '#aabbcc', accent_color: '#ddeeff' }
const DEFAULTS = { company_name: '', company_logo_url: '', primary_color: '#4778f3', accent_color: '#222022' }

function Probe() {
  const b = useBrand()
  return <div data-testid="brand">{b.name}|{b.logoUrl}|{b.primaryColor}</div>
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>go {to}</button>
}

function renderAt(path: string, ...links: string[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BrandingProvider>
        <Probe />
        {links.map(l => <GoTo key={l} to={l} />)}
      </BrandingProvider>
    </MemoryRouter>,
  )
}

const root = () => document.documentElement.style

beforeEach(() => {
  getPublic.mockReset().mockResolvedValue({ data: DEFAULTS })
  useAuthStore.setState({ token: null, user: null })
  for (const p of ['--primary', '--primary-dark', '--secondary', '--brand-primary', '--brand-primary-dark', '--brand-accent', '--brand-logo-url']) {
    root().removeProperty(p)
  }
})

describe('BrandingProvider', () => {
  it('shares the product defaults until the answer arrives', () => {
    getPublic.mockReturnValue(new Promise(() => {}))
    renderAt('/dashboard')
    expect(screen.getByTestId('brand')).toHaveTextContent('Hirely.ai||#4778f3')
  })

  it('shares the company\'s name, logo and colours once the answer arrives', async () => {
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/dashboard')

    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Acme Corp|https://cdn.acme.test/logo.png|#112233'))
  })

  it('writes the colours and the logo onto the document', async () => {
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/dashboard')

    await waitFor(() => expect(root().getPropertyValue('--primary')).toBe('#112233'))
    expect(root().getPropertyValue('--secondary')).toBe('#445566')
    expect(root().getPropertyValue('--brand-primary')).toBe('#112233')
    expect(root().getPropertyValue('--brand-accent')).toBe('#445566')
    expect(root().getPropertyValue('--primary-dark')).toBe('#0f1e2d')
    expect(root().getPropertyValue('--brand-logo-url')).toBe('url("https://cdn.acme.test/logo.png")')
  })

  it('removes the logo property again for a company without a logo', async () => {
    getPublic.mockResolvedValue({ data: ACME })
    const user = userEvent.setup({ delay: null })
    renderAt('/login?company=acme', '/login?company=other')
    await waitFor(() => expect(root().getPropertyValue('--brand-logo-url')).not.toBe(''))

    getPublic.mockResolvedValue({ data: OTHER })
    await user.click(screen.getByRole('button', { name: 'go /login?company=other' }))
    await waitFor(() => expect(root().getPropertyValue('--primary')).toBe('#aabbcc'))
    expect(root().getPropertyValue('--brand-logo-url')).toBe('')
  })

  it('falls back to the defaults for a colour that is not a six-digit hex', async () => {
    getPublic.mockResolvedValue({ data: { ...ACME, primary_color: 'red', accent_color: '#12' } })
    renderAt('/dashboard')

    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Acme Corp'))
    expect(root().getPropertyValue('--primary')).toBe('#4778f3')
    expect(root().getPropertyValue('--secondary')).toBe('#222022')
  })

  it('falls back to the product defaults when the request fails', async () => {
    getPublic.mockRejectedValue(new Error('Network Error'))
    renderAt('/dashboard')

    await waitFor(() => expect(root().getPropertyValue('--primary')).toBe('#4778f3'))
    expect(screen.getByTestId('brand')).toHaveTextContent('Hirely.ai||#4778f3')
  })
})

describe('the browser tab', () => {
  beforeEach(() => { document.title = '' })

  it('names the product until the page knows its company', () => {
    getPublic.mockReturnValue(new Promise(() => {}))
    renderAt('/dashboard')
    expect(document.title).toBe('Hirely.ai')
  })

  it('leaves the title alone while a page names itself', async () => {
    function Titled() {
      usePageMeta({ title: 'Pricing', description: 'Plans and limits for Hirely.ai.' })
      return null
    }
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <BrandingProvider><Titled /></BrandingProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(getPublic).toHaveBeenCalled())
    expect(document.title).toBe('Pricing | Hirely.ai')
  })

  it('names the company alone, with no product beside it', async () => {
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/dashboard')

    await waitFor(() => expect(document.title).toBe('Acme Corp'))
    expect(document.title).not.toContain('Hirely')
    expect(document.title).not.toContain('|')
  })

  it('names the product when the answer is the defaults', async () => {
    renderAt('/dashboard')
    await waitFor(() => expect(getPublic).toHaveBeenCalled())
    expect(document.title).toBe('Hirely.ai')
  })

  it('names the product when the request fails', async () => {
    getPublic.mockRejectedValue(new Error('Network Error'))
    renderAt('/dashboard')
    await waitFor(() => expect(root().getPropertyValue('--primary')).toBe('#4778f3'))
    expect(document.title).toBe('Hirely.ai')
  })

  it('follows the company the sign-in page names', async () => {
    const user = userEvent.setup({ delay: null })
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/login?company=acme', '/login?company=other')
    await waitFor(() => expect(document.title).toBe('Acme Corp'))

    getPublic.mockResolvedValue({ data: OTHER })
    await user.click(screen.getByRole('button', { name: 'go /login?company=other' }))
    await waitFor(() => expect(document.title).toBe('Other Ltd'))
  })

  it('takes the signed-in company\'s name on sign-in', async () => {
    renderAt('/login')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))
    expect(document.title).toBe('Hirely.ai')

    getPublic.mockResolvedValue({ data: ACME })
    act(() => { useAuthStore.getState().login('tok_acme', { email: 'sam@acme.test', company_name: 'Acme Corp' }) })
    await waitFor(() => expect(document.title).toBe('Acme Corp'))
  })

  it('goes back to the product at once on sign-out, before the next answer arrives', async () => {
    useAuthStore.setState({ token: 'tok_acme', user: { email: 'sam@acme.test' } })
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/dashboard')
    await waitFor(() => expect(document.title).toBe('Acme Corp'))

    getPublic.mockReturnValue(new Promise(() => {}))
    act(() => { useAuthStore.getState().logout() })
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(2))
    expect(document.title).toBe('Hirely.ai')
  })
})

describe('what it asks for', () => {
  it('asks for nothing in particular on a signed-in page', async () => {
    renderAt('/dashboard')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))
    expect(getPublic).toHaveBeenCalledWith(undefined)
  })

  it('names the company on the login page', async () => {
    renderAt('/login?company=acme')
    await waitFor(() => expect(getPublic).toHaveBeenCalledWith({ company: 'acme' }))
  })

  it('asks for nothing in particular on the login page without a company', async () => {
    renderAt('/login')
    await waitFor(() => expect(getPublic).toHaveBeenCalledWith(undefined))
  })

  it.each([
    ['/interview/tok_1', 'candidate'],
    ['/coding/tok_2', 'candidate'],
    ['/offer/tok_3', 'offer'],
    ['/performance-review/tok_4', 'review'],
    ['/report/shared/tok_5', 'share'],
    ['/interviewer/tok_6', 'interviewer'],
  ])('sends the kind and token of %s', async (path, kind) => {
    renderAt(path)
    await waitFor(() => expect(getPublic).toHaveBeenCalledWith({ kind, token: path.split('/').pop() }))
  })

  it('asks again for another public link', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('/offer/tok_a', '/interview/tok_b')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'go /interview/tok_b' }))
    await waitFor(() => expect(getPublic).toHaveBeenLastCalledWith({ kind: 'candidate', token: 'tok_b' }))
    expect(getPublic).toHaveBeenCalledTimes(2)
  })

  it('asks again when the login page names another company', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('/login?company=acme', '/login?company=other')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'go /login?company=other' }))
    await waitFor(() => expect(getPublic).toHaveBeenLastCalledWith({ company: 'other' }))
  })

  it('does not ask again when moving between pages that need no context', async () => {
    const user = userEvent.setup({ delay: null })
    renderAt('/dashboard', '/dashboard/users', '/dashboard/settings')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'go /dashboard/users' }))
    await user.click(screen.getByRole('button', { name: 'go /dashboard/settings' }))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(getPublic).toHaveBeenCalledTimes(1)
  })
})

describe('who is signed in', () => {
  it('asks again when somebody signs in, and shows that company\'s brand', async () => {
    renderAt('/login')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('brand')).toHaveTextContent('Hirely.ai')

    getPublic.mockResolvedValue({ data: ACME })
    act(() => { useAuthStore.getState().login('tok_acme', { email: 'sam@acme.test', company_name: 'Acme Corp' }) })

    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Acme Corp'))
  })

  it('asks once for a sign-in that sets the user twice, as single sign-on does', async () => {
    renderAt('/sso-callback')
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(1))

    act(() => { useAuthStore.getState().login('tok_sso', {}) })
    act(() => { useAuthStore.getState().login('tok_sso', { email: 'sam@acme.test' }) })
    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(2))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(getPublic).toHaveBeenCalledTimes(2)
  })

  it('asks again when they sign out, and drops the company\'s brand at once', async () => {
    useAuthStore.setState({ token: 'tok_acme', user: { email: 'sam@acme.test' } })
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/dashboard')
    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Acme Corp'))
    expect(root().getPropertyValue('--primary')).toBe('#112233')

    getPublic.mockReturnValue(new Promise(() => {}))
    act(() => { useAuthStore.getState().logout() })

    await waitFor(() => expect(getPublic).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('brand')).toHaveTextContent('Hirely.ai||#4778f3')
    expect(root().getPropertyValue('--primary')).toBe('#4778f3')
    expect(root().getPropertyValue('--brand-logo-url')).toBe('')
  })

  it('shows the login page\'s company after a sign-out, once the answer is in', async () => {
    useAuthStore.setState({ token: 'tok_acme', user: { email: 'sam@acme.test' } })
    getPublic.mockResolvedValue({ data: ACME })
    renderAt('/login?company=other')
    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Acme Corp'))

    getPublic.mockResolvedValue({ data: OTHER })
    act(() => { useAuthStore.getState().logout() })
    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Other Ltd'))
    expect(getPublic).toHaveBeenLastCalledWith({ company: 'other' })
  })

  it('ignores an answer that arrives after a newer question was asked', async () => {
    const user = userEvent.setup({ delay: null })
    let resolveFirst!: (v: unknown) => void
    getPublic.mockReturnValueOnce(new Promise(r => { resolveFirst = r }))
    getPublic.mockResolvedValueOnce({ data: OTHER })
    renderAt('/login?company=acme', '/login?company=other')

    await user.click(screen.getByRole('button', { name: 'go /login?company=other' }))
    await waitFor(() => expect(screen.getByTestId('brand')).toHaveTextContent('Other Ltd'))

    await act(async () => { resolveFirst({ data: ACME }) })
    expect(screen.getByTestId('brand')).toHaveTextContent('Other Ltd')
    expect(root().getPropertyValue('--primary')).toBe('#aabbcc')
  })
})

describe('the company slug and the legal links', () => {
  function LegalProbe() {
    const b = useBrand()
    return <div data-testid="legal">{b.companySlug}|{b.termsUrl}|{b.privacyUrl}</div>
  }

  function renderLegal(path = '/dashboard') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <BrandingProvider><LegalProbe /></BrandingProvider>
      </MemoryRouter>,
    )
  }

  it('shares the slug of the company whose own domain the page is, and its Terms and Privacy addresses', async () => {
    getPublic.mockResolvedValue({
      data: { ...ACME, company_slug: 'acme', terms_url: 'https://acme.test/terms', privacy_url: 'https://acme.test/privacy' },
    })
    renderLegal()
    await waitFor(() => expect(screen.getByTestId('legal')).toHaveTextContent('acme|https://acme.test/terms|https://acme.test/privacy'))
  })

  it('shares nothing for the product defaults, and again nothing when the request fails', async () => {
    renderLegal()
    await waitFor(() => expect(getPublic).toHaveBeenCalled())
    expect(screen.getByTestId('legal').textContent).toBe('||')
  })

  it('drops an address that is not https rather than sharing it', async () => {
    getPublic.mockResolvedValue({ data: { ...ACME, company_slug: 'acme', terms_url: 'javascript:alert(1)', privacy_url: 'http://acme.test/p' } })
    renderLegal()
    await waitFor(() => expect(screen.getByTestId('legal')).toHaveTextContent('acme||'))
  })

  it('asks the login page for the company in its address, and shares the slug of the answer', async () => {
    getPublic.mockResolvedValue({ data: { ...ACME, company_slug: 'acme' } })
    renderLegal('/login?company=acme')
    await waitFor(() => expect(getPublic).toHaveBeenCalledWith({ company: 'acme' }))
    await waitFor(() => expect(screen.getByTestId('legal').textContent).toBe('acme||'))
  })
})
