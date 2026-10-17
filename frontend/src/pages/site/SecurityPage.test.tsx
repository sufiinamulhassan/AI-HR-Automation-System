import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SITE } from '../../lib/site'
import SecurityPage from './SecurityPage'
import {
  expectHeadingOrder,
  expectMeta,
  expectNoEmDash,
  expectValidInternalLinks,
  renderPage,
  sectionOf,
} from './siteTestKit'

const SECTION_HEADINGS = [
  'Controls at a glance',
  'Who can sign in and what they can do',
  'Companies are kept apart',
  'Protecting what unlocks other systems',
  'Protecting the parts anyone can reach',
  'A record of what changed',
  'What candidates see is limited',
  'Keeping data only as long as needed',
  'Where data lives and who processes it',
  'What we do and what you configure',
  'What we have not published',
  'Report a vulnerability',
  'Frequently asked questions',
]

const originalSecurityEmail = SITE.securityEmail

afterEach(() => {
  SITE.securityEmail = originalSecurityEmail
})

describe('SecurityPage', () => {
  it('has a single h1 and ordered headings', () => {
    const { container } = renderPage(<SecurityPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Security at Hirely.ai' })).toBeInTheDocument()
    expectHeadingOrder(container)
  })

  it('shows the main section headings', () => {
    renderPage(<SecurityPage />)
    SECTION_HEADINGS.forEach(name => {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    })
  })

  it('summarises controls in a two column table', () => {
    renderPage(<SecurityPage />)
    const table = screen.getByRole('table', { name: 'Security controls by area' })
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Area', 'What we do'])
    const areas = within(table).getAllByRole('rowheader').map(cell => cell.textContent)
    ;['Passwords', 'Two-step sign-in', 'Company isolation', 'Stored credentials', 'Start-up checks', 'Rate limiting', 'Audit log'].forEach(area => {
      expect(areas).toContain(area)
    })
    expect(within(table).getByText(/Hashed with bcrypt/)).toBeInTheDocument()
  })

  it('states what has not been published', () => {
    renderPage(<SecurityPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'What we have not published' }))
    expect(within(section).getByText(/not published third-party certifications, audit reports, penetration test results or uptime figures/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'the contact form' })).toHaveAttribute('href', '/contact?topic=security')
  })

  it('explains how to report a vulnerability', () => {
    renderPage(<SecurityPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'Report a vulnerability' }))
    expect(within(section).getByText(/steps to reproduce/i)).toBeInTheDocument()
    expect(within(section).getByText(/do not test against other people.s data/i)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'the contact form' })).toHaveAttribute('href', '/contact?topic=security')
  })

  it('shows the security email only when one is configured', () => {
    SITE.securityEmail = ''
    const first = renderPage(<SecurityPage />)
    expect(first.container.querySelector('a[href^="mailto:"]')).toBeNull()
    first.unmount()

    SITE.securityEmail = 'security@example.test'
    renderPage(<SecurityPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'Report a vulnerability' }))
    expect(within(section).getByRole('link', { name: 'security@example.test' })).toHaveAttribute('href', 'mailto:security@example.test')
  })

  it('links to the legal pages it relies on', () => {
    const { container } = renderPage(<SecurityPage />)
    ;['/privacy', '/candidate-privacy', '/subprocessors', '/cookies'].forEach(path => {
      expect(container.querySelector(`a[href="${path}"]`), path).not.toBeNull()
    })
  })

  it('has an FAQ of five to seven questions', () => {
    const { container } = renderPage(<SecurityPage />)
    const count = container.querySelectorAll('.xv-faq-item').length
    expect(count).toBeGreaterThanOrEqual(5)
    expect(count).toBeLessThanOrEqual(7)
  })

  it('ends with a call to action', () => {
    renderPage(<SecurityPage />)
    const band = sectionOf(screen.getByRole('heading', { level: 2, name: 'Need more detail?' }))
    expect(within(band).getAllByRole('link')).toHaveLength(2)
  })

  it('links only to routes that exist', () => {
    const { container } = renderPage(<SecurityPage />)
    expectValidInternalLinks(container)
  })

  it('sets page metadata', () => {
    renderPage(<SecurityPage />)
    expectMeta('Security')
  })

  it('contains no em dash', () => {
    const { container } = renderPage(<SecurityPage />)
    expectNoEmDash(container)
  })
})
