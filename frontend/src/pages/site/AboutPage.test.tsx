import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SITE } from '../../lib/site'
import AboutPage from './AboutPage'
import {
  expectHeadingOrder,
  expectMeta,
  expectNoEmDash,
  expectValidInternalLinks,
  renderPage,
  sectionOf,
} from './siteTestKit'

const SECTION_HEADINGS = [
  'What Hirely.ai is, and why',
  'What we build',
  'How it is built',
  'Practices we hold ourselves to',
  'Who is responsible for data',
  'Careers on Hirely.ai',
  'Get in touch',
  'Talk to us',
]

const originalContactEmail = SITE.contactEmail

afterEach(() => {
  SITE.contactEmail = originalContactEmail
})

describe('AboutPage', () => {
  it('has a single h1 and ordered headings', () => {
    const { container } = renderPage(<AboutPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Hiring software where the recruiter decides' })).toBeInTheDocument()
    expectHeadingOrder(container)
  })

  it('shows the main section headings', () => {
    renderPage(<AboutPage />)
    SECTION_HEADINGS.forEach(name => {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    })
  })

  it('lists the stack', () => {
    renderPage(<AboutPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'How it is built' }))
    ;['FastAPI and Python', 'React and TypeScript', 'MongoDB', 'Pinecone', 'LangGraph', 'Vercel'].forEach(item => {
      expect(within(section).getByText(new RegExp(item))).toBeInTheDocument()
    })
  })

  it('states the working practices', () => {
    renderPage(<AboutPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'Practices we hold ourselves to' }))
    ;[
      'It refuses to boot insecurely',
      'Nothing fails silently',
      'Tested, not just demoed',
      'Candidate data stays scoped',
    ].forEach(name => {
      expect(within(section).getByRole('heading', { level: 3, name })).toBeInTheDocument()
    })
  })

  it('does not invent company facts', () => {
    const { container } = renderPage(<AboutPage />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\d[\d,]*\+?\s+(automated\s+)?tests/i)
    expect(text).not.toMatch(/since (19|20)\d\d|headquarter|our team of|\d+ employees|customers include/i)
    expect(text).not.toMatch(/founded/i)
  })

  it('links to careers and the contact topics', () => {
    const { container } = renderPage(<AboutPage />)
    const careers = sectionOf(screen.getByRole('heading', { level: 2, name: 'Careers on Hirely.ai' }))
    expect(within(careers).getByRole('link', { name: 'careers page' })).toHaveAttribute('href', '/careers')
    expect(container.querySelector('a[href="/contact"]')).not.toBeNull()
    expect(container.querySelector('a[href="/contact?topic=sales"]')).not.toBeNull()
  })

  it('shows the contact email only when one is configured', () => {
    SITE.contactEmail = ''
    const first = renderPage(<AboutPage />)
    expect(first.container.querySelector('a[href^="mailto:"]')).toBeNull()
    first.unmount()

    SITE.contactEmail = 'hello@example.test'
    renderPage(<AboutPage />)
    expect(screen.getByRole('link', { name: 'hello@example.test' })).toHaveAttribute('href', 'mailto:hello@example.test')
  })

  it('ends with a call to action with two buttons', () => {
    renderPage(<AboutPage />)
    const band = sectionOf(screen.getByRole('heading', { level: 2, name: 'Talk to us' }))
    expect(within(band).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(within(band).getByRole('link', { name: 'Talk to sales' })).toHaveAttribute('href', '/contact?topic=sales')
  })

  it('links only to routes that exist', () => {
    const { container } = renderPage(<AboutPage />)
    expectValidInternalLinks(container)
  })

  it('sets page metadata', () => {
    renderPage(<AboutPage />)
    expectMeta('About')
  })

  it('contains no em dash', () => {
    const { container } = renderPage(<AboutPage />)
    expectNoEmDash(container)
  })
})
