import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SiteLayout from '../components/site/SiteLayout'
import Landing from './Landing'

function renderLanding() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Landing />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Landing: shared site shell', () => {
  it('links to the careers page from the top bar menu', () => {
    renderLanding()
    const header = screen.getByRole('banner')
    expect(within(header).getAllByRole('link', { name: /^Careers/ }).some(link => link.getAttribute('href') === '/careers')).toBe(true)
  })

  it('links to the careers page from the footer', () => {
    renderLanding()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Careers' })).toHaveAttribute('href', '/careers')
  })

  it('links to pricing, security and contact from the top bar', () => {
    renderLanding()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing')
    expect(within(header).getByRole('link', { name: /^Security/ })).toHaveAttribute('href', '/security')
    expect(within(header).getByRole('link', { name: 'Contact Us' })).toHaveAttribute('href', '/contact')
  })

  it('has one Login button in the top bar instead of a demo button', () => {
    renderLanding()
    const header = screen.getByRole('banner')
    expect(within(header).getAllByRole('link', { name: 'Login' })[0]).toHaveAttribute('href', '/login')
    expect(within(header).queryByRole('link', { name: /Book a demo/i })).not.toBeInTheDocument()
  })

  it('has no second header or footer of its own', () => {
    renderLanding()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })
})

describe('Landing: content', () => {
  it('sends people to sign in from the hero and the closing call to action', () => {
    renderLanding()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Sign in to the platform' })).toHaveAttribute('href', '/login')
    expect(within(main).getByRole('link', { name: 'Sign in to Hirely.ai' })).toHaveAttribute('href', '/login')
  })

  it('puts Candidate help first and Sign in second in the hero', () => {
    const { container } = renderLanding()
    const hero = container.querySelector('.xv-hero') as HTMLElement
    const buttons = Array.from(hero.querySelectorAll('.xv-hero-cta a'))
    expect(buttons.map(button => button.textContent)).toEqual(['Candidate help', 'Sign in to the platform'])
    expect(buttons.map(button => button.getAttribute('href'))).toEqual(['/candidates', '/login'])
  })

  it('gives the hero one heading that reads We Rank You Hire, with both phrases on their own line on a phone', () => {
    const { container } = renderLanding()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toContain('We Rank')
    expect(h1.textContent).toContain('You Hire')
    const mobile = container.querySelector('.xv-hero-title-mobile') as HTMLElement
    expect(mobile).toHaveTextContent('We Rank You Hire')
    expect(Array.from(mobile.querySelectorAll('span')).map(span => span.textContent)).toEqual(['We Rank', 'You Hire'])
  })

  it('shows the first questions people ask and no solutions section', () => {
    renderLanding()
    const main = screen.getByRole('main')
    expect(within(main).queryByRole('heading', { level: 2, name: 'Built for every hiring team' })).not.toBeInTheDocument()
    const faq = within(main).getByRole('heading', { level: 2, name: 'Questions people ask first' }).closest('section') as HTMLElement
    expect(within(faq).getAllByText(/\?$/).length).toBeGreaterThanOrEqual(5)
    expect(within(faq).getByRole('link', { name: 'All questions' })).toHaveAttribute('href', '/faq')
  })

  it('offers a way to talk to sales from the closing call to action', () => {
    renderLanding()
    const main = screen.getByRole('main')
    const band = within(main).getByRole('heading', { level: 2, name: 'Run your first pipeline' }).closest('section') as HTMLElement
    expect(within(band).getByRole('link', { name: 'Talk to sales' })).toHaveAttribute('href', '/contact?topic=sales')
  })

  it('does not say that candidates are invited without anyone turning that on', () => {
    renderLanding()
    const text = screen.getByRole('main').textContent ?? ''
    expect(text).not.toMatch(/no recruiter action/i)
    expect(text).toMatch(/off by default/i)
  })

  it('no longer claims the old test and router counts', () => {
    renderLanding()
    const text = screen.getByRole('main').textContent ?? ''
    expect(text).not.toMatch(/\b470\b/)
    expect(text).not.toMatch(/\b84 frontend\b/)
    expect(text).not.toMatch(/\b23\b.*Mounted API routers/)
    expect(text).toContain('Automated tests passing')
    expect(text).toContain('Mounted API routers')
  })

  it('sets its own page description', () => {
    renderLanding()
    const description = document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
    expect(description).toContain('Hirely.ai')
    expect(document.title).toBe('Hirely.ai - AI Recruitment Platform')
  })
})
