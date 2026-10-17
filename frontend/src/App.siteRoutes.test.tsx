import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

configure({ asyncUtilTimeout: 10000 })

vi.mock('./components/BrandingProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { siteApi } = await import('./lib/api')
const { useAuthStore } = await import('./store/auth.store')
const { LEGAL_LINKS, PUBLIC_PATHS } = await import('./lib/site')
const { default: App } = await import('./App')

function open(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(siteApi, 'plans').mockResolvedValue({ data: { plans: [] } } as never)
  useAuthStore.setState({ token: null, user: null })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

describe('public site routes', () => {
  it.each(PUBLIC_PATHS)('serves %s inside the shared header and footer', async path => {
    open(path)
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
  })

  it.each(LEGAL_LINKS)('shows $label at $to', async ({ to, label }) => {
    open(to)
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
    expect(document.title).toBe(`${label} | Hirely.ai`)
  })

  it('gives every other page its own title', async () => {
    open('/pricing')
    await screen.findByRole('heading', { level: 1 })
    expect(document.title).toBe('Pricing | Hirely.ai')
  })
})

describe('unknown addresses', () => {
  it('show the not found page and keep the address, instead of redirecting home', async () => {
    open('/no/such/page')
    expect(await screen.findByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/no/such/page')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })
})

describe('moving around', () => {
  it('goes from the home page to pricing with the header link', async () => {
    const u = userEvent.setup()
    open('/')
    await screen.findByRole('heading', { level: 1 })
    await u.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Pricing' }))
    expect(await screen.findByRole('heading', { level: 1, name: /Plans that grow with your hiring/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/pricing')
  })

  it('goes to a legal document with a footer link', async () => {
    const u = userEvent.setup()
    open('/')
    await screen.findByRole('heading', { level: 1 })
    await u.click(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Privacy Policy' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('opens the contact form with the topic from a footer link', async () => {
    const u = userEvent.setup()
    open('/')
    await screen.findByRole('heading', { level: 1 })
    await u.click(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Report a security issue' }))
    expect(await screen.findByRole('combobox', { name: 'What is this about?' })).toHaveValue('security')
  })

  it('goes to the contact form from the Contact Us link in the header', async () => {
    const u = userEvent.setup()
    open('/')
    await screen.findByRole('heading', { level: 1 })
    await u.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Contact Us' }))
    expect(await screen.findByRole('heading', { level: 1, name: /Talk to us/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/contact')
  })

  it('goes to the login page from the Login button in the header', async () => {
    const u = userEvent.setup()
    open('/')
    await screen.findByRole('heading', { level: 1 })
    await u.click(within(screen.getByRole('banner')).getAllByRole('link', { name: 'Login' })[0])
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })

  it.each(['/product', '/product/resume-screening', '/solutions', '/solutions/recruiters', '/insights', '/insights/using-ai-in-hiring-responsibly'])('has no page at %s', async path => {
    open(path)
    expect(await screen.findByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
  })

  it.each(PUBLIC_PATHS.filter(path => path !== '/'))('keeps the hero of %s free of buttons, links and breadcrumbs', async path => {
    const { container } = open(path)
    await screen.findByRole('heading', { level: 1 })
    const hero = container.querySelector('.xv-page-hero') as HTMLElement
    expect(hero, 'hero').not.toBeNull()
    expect(hero.querySelectorAll('a, button')).toHaveLength(0)
    expect(hero.querySelector('nav')).toBeNull()
  })
})

describe('pages outside the public site', () => {
  it('keeps sign in out of the marketing header and footer', async () => {
    open('/login')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Skip to content' })).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('keeps the password reset page out of it too', async () => {
    open('/forgot-password')
    await screen.findByRole('heading')
    expect(screen.queryByRole('link', { name: 'Skip to content' })).not.toBeInTheDocument()
  })
})
