import { fireEvent, render, screen, within } from '@testing-library/react'
import { lazy } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOOTER_GROUPS, SITE } from '../../lib/site'
import { NAV_LOGIN, NAV_MENUS } from '../../lib/siteNav'
import SiteLayout from './SiteLayout'

function page(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<><h1>Home page</h1><Link to="/features">Go to features</Link></>} />
          <Route path="/features" element={<h1>Features page</h1>} />
          <Route path="/pricing" element={<h1>Pricing page</h1>} />
          <Route path="/long" element={<><h1>Long page</h1><h2 id="target">Target</h2></>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

let scrollTo: ReturnType<typeof vi.spyOn>
const originalContactEmail = SITE.contactEmail

beforeEach(() => {
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  SITE.contactEmail = originalContactEmail
})

describe('SiteLayout header', () => {
  it('has the brand link and every top level item in order', () => {
    page()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Hirely.ai home' })).toHaveAttribute('href', '/')
    const nav = within(header).getByRole('navigation', { name: 'Primary' })
    const menus = NAV_MENUS.filter(menu => menu.items)
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(menus.map(menu => menu.label))
    const direct = NAV_MENUS.filter(menu => !menu.items)
    direct.forEach(menu => {
      expect(within(nav).getByRole('link', { name: menu.label })).toHaveAttribute('href', menu.to)
    })
  })

  it('has one Login button and no demo button in the top bar', () => {
    page()
    const header = screen.getByRole('banner')
    const logins = within(header).getAllByRole('link', { name: NAV_LOGIN.label })
    expect(logins.length).toBeGreaterThanOrEqual(1)
    logins.forEach(link => {
      expect(link).toHaveAttribute('href', NAV_LOGIN.to)
      expect(link).toHaveClass('xv-btn')
    })
    expect(within(header).queryByRole('link', { name: /Book a demo/i })).not.toBeInTheDocument()
  })

  it('marks the page you are on', () => {
    page('/pricing')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens and closes the menu on a small screen, and closes it after a choice', () => {
    page()
    const burger = screen.getByRole('button', { name: 'Open menu' })
    expect(burger).toHaveAttribute('aria-expanded', 'false')
    expect(burger).toHaveAttribute('aria-controls', 'site-drawer')
    const drawer = document.getElementById('site-drawer') as HTMLElement
    expect(drawer).not.toHaveClass('is-open')

    fireEvent.click(burger)
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(drawer).toHaveClass('is-open')

    const mobile = within(drawer).getByRole('navigation', { name: 'Mobile' })
    fireEvent.click(within(mobile).getByRole('link', { name: 'Pricing' }))
    expect(drawer).not.toHaveClass('is-open')
    expect(screen.getByRole('heading', { name: 'Pricing page' })).toBeInTheDocument()
  })
})

describe('SiteLayout page area', () => {
  it('has a skip link to the main area', () => {
    page()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('shows the page inside the main area', () => {
    page()
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Home page' })).toBeInTheDocument()
  })

  it('scrolls to the top when the page changes', () => {
    page()
    scrollTo.mockClear()
    fireEvent.click(screen.getByRole('link', { name: 'Go to features' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('scrolls to a heading named in the address instead', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    page('/long#target')
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('shows a loading status while a lazy page is on its way', () => {
    const Slow = lazy(() => new Promise<{ default: () => null }>(() => {}))
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<Slow />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent('Loading')
  })
})

describe('SiteLayout footer', () => {
  it('lists every group and link with the right address', () => {
    page()
    const footer = screen.getByRole('contentinfo')
    const nav = within(footer).getByRole('navigation', { name: 'Footer' })
    FOOTER_GROUPS.forEach(group => {
      expect(within(footer).getByRole('heading', { name: group.title })).toBeInTheDocument()
      group.links.forEach(link => {
        const found = within(nav).getAllByRole('link', { name: link.label }).find(a => a.getAttribute('href') === link.to)
        expect(found, `${group.title}: ${link.label}`).toBeDefined()
      })
    })
  })

  it('has one careers link and a way to send a message', () => {
    page()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getAllByRole('link', { name: 'Careers' })).toHaveLength(1)
    expect(within(footer).getByRole('link', { name: 'Send a message' })).toHaveAttribute('href', '/contact')
  })

  it('names the product and the year and says nothing about who owns it', () => {
    page()
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent(`${new Date().getFullYear()} Hirely.ai. All rights reserved.`)
    expect(footer.textContent).not.toMatch(/a .* product$/i)
  })

  it('shows the sales address as the contact email', () => {
    page()
    const footer = screen.getByRole('contentinfo')
    expect(SITE.contactEmail).toBe('sales@hirely.ai')
    expect(within(footer).getByRole('link', { name: 'sales@hirely.ai' })).toHaveAttribute('href', 'mailto:sales@hirely.ai')
  })

  it('uses a configured contact address instead of the default', () => {
    SITE.contactEmail = 'hello@example.com'
    page()
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'hello@example.com' })).toHaveAttribute('href', 'mailto:hello@example.com')
  })

  it('has no phone number, offices, social links or outside links', () => {
    page()
    const footer = screen.getByRole('contentinfo')
    expect(footer.querySelectorAll('a[target="_blank"]')).toHaveLength(0)
    expect(footer.querySelectorAll('a[href^="tel:"]')).toHaveLength(0)
    expect(within(footer).queryByRole('heading', { name: 'Offices' })).not.toBeInTheDocument()
    expect(within(footer).queryByRole('link', { name: /Book a demo/i })).not.toBeInTheDocument()
  })
})
