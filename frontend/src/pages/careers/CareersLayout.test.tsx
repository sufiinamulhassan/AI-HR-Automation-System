import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import SiteLayout from '../../components/site/SiteLayout'
import { NAV_MENUS } from '../../lib/siteNav'
import CareersLayout from './CareersLayout'

function renderCareers(path = '/careers') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<div>Home content</div>} />
          <Route path="/careers" element={<CareersLayout />}>
            <Route index element={<div>List content</div>} />
            <Route path=":jobId" element={<div>Job content</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('CareersLayout', () => {
  it('shows the page inside the main region of the shared site shell', () => {
    renderCareers()
    expect(within(screen.getByRole('main')).getByText('List content')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText('List content').closest('.cr')).not.toBeNull()
  })

  it('has the same navbar as the home page', () => {
    const careers = renderCareers()
    const careersLinks = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map(a => a.textContent)
    careers.unmount()

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route path="/" element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const homeLinks = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link').map(a => a.textContent)
    expect(careersLinks).toEqual(homeLinks)
    expect(careersLinks).toEqual(expect.arrayContaining(NAV_MENUS.filter(menu => !menu.items).map(menu => menu.label)))
  })

  it('keeps the Careers link current on the list and on a job page', () => {
    const list = renderCareers('/careers')
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Careers' })).toHaveAttribute('aria-current', 'page')
    list.unmount()

    renderCareers('/careers/job-1')
    expect(within(screen.getByRole('main')).getByText('Job content')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Careers' })).toHaveAttribute('aria-current', 'page')
  })

  it('uses the site footer and draws no header or footer of its own', () => {
    renderCareers()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})
