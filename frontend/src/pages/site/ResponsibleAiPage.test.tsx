import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResponsibleAiPage from './ResponsibleAiPage'
import {
  expectHeadingOrder,
  expectMeta,
  expectNoEmDash,
  expectValidInternalLinks,
  renderPage,
  sectionOf,
} from './siteTestKit'

const SECTION_HEADINGS = [
  'How we approach AI in hiring',
  'Where AI is used',
  'A person stays in charge',
  'What customers can control',
  'What candidates are told',
  'What AI cannot do for you',
  'Your obligations as an employer',
  'Which providers process AI requests',
  'Frequently asked questions',
]

const PRINCIPLES = ['People decide', 'Transparency', 'Control', 'Minimal data', 'Accountability']

const AI_TASKS = [
  'Resume classification',
  'Matching and scoring',
  'Interview question generation',
  'Speech to text and text to speech',
  'Answer scoring and report summaries',
  'Integrity signals',
  'Code evaluation',
]

describe('ResponsibleAiPage', () => {
  it('has a single h1 and ordered headings', () => {
    const { container } = renderPage(<ResponsibleAiPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'People decide. AI does the groundwork.' })).toBeInTheDocument()
    expectHeadingOrder(container)
  })

  it('shows the main section headings', () => {
    renderPage(<ResponsibleAiPage />)
    SECTION_HEADINGS.forEach(name => {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    })
  })

  it('lists the five principles', () => {
    renderPage(<ResponsibleAiPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'How we approach AI in hiring' }))
    PRINCIPLES.forEach(name => {
      expect(within(section).getByRole('heading', { level: 3, name })).toBeInTheDocument()
    })
  })

  it('maps every AI task to what it sees, produces and who decides', () => {
    renderPage(<ResponsibleAiPage />)
    const table = screen.getByRole('table', { name: 'Where AI is used in Hirely.ai' })
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
      'Task',
      'What the AI sees',
      'What it produces',
      'Who decides',
    ])
    expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(AI_TASKS)
    within(table).getAllByRole('row').slice(1).forEach(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent ?? '').trim())
      expect(cells).toHaveLength(3)
      cells.forEach(text => expect(text.length).toBeGreaterThan(0))
    })
    expect(within(table).getByText(/No video is recorded or stored/)).toBeInTheDocument()
  })

  it('states that there is no automatic rejection', () => {
    renderPage(<ResponsibleAiPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'A person stays in charge' }))
    expect(within(section).getByRole('heading', { level: 3, name: 'No automatic rejection' })).toBeInTheDocument()
    expect(within(section).getByText(/does not automatically reject candidates/)).toBeInTheDocument()
    expect(within(section).getByRole('heading', { level: 3, name: 'Auto-invite is off by default' })).toBeInTheDocument()
    expect(within(section).getByText(/repeated tab switches/)).toBeInTheDocument()
  })

  it('is honest about limits', () => {
    renderPage(<ResponsibleAiPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'What AI cannot do for you' }))
    expect(within(section).getByText(/AI scores can be wrong/)).toBeInTheDocument()
    expect(within(section).getByText(/Check for bias in your own process/)).toBeInTheDocument()
    expect(within(section).getByText(/only basis for a decision/)).toBeInTheDocument()
    expect(within(section).getByText(/have not published a bias audit/)).toBeInTheDocument()
  })

  it('gives legal information without citing statutes', () => {
    renderPage(<ResponsibleAiPage />)
    const section = sectionOf(screen.getByRole('heading', { level: 2, name: 'Your obligations as an employer' }))
    const text = section.textContent ?? ''
    expect(text).toMatch(/the EU, the UK and some US states/)
    expect(text).toMatch(/not legal advice/)
    expect(text).not.toMatch(/Article \d|Section \d|Local Law \d|\d{4}\/\d{2,4}|Act of \d{4}/)
  })

  it('links to the candidate notice and the subprocessor list', () => {
    const { container } = renderPage(<ResponsibleAiPage />)
    expect(container.querySelector('a[href="/candidate-privacy"]')).not.toBeNull()
    expect(container.querySelector('a[href="/subprocessors"]')).not.toBeNull()
    const providers = sectionOf(screen.getByRole('heading', { level: 2, name: 'Which providers process AI requests' }))
    expect(within(providers).getByText(/does not train models on customer data/)).toBeInTheDocument()
    expect(within(providers).getByRole('link', { name: 'subprocessors' })).toHaveAttribute('href', '/subprocessors')
  })

  it('has an FAQ of five to seven questions', () => {
    const { container } = renderPage(<ResponsibleAiPage />)
    const count = container.querySelectorAll('.xv-faq-item').length
    expect(count).toBeGreaterThanOrEqual(5)
    expect(count).toBeLessThanOrEqual(7)
  })

  it('ends with a call to action', () => {
    renderPage(<ResponsibleAiPage />)
    const band = sectionOf(screen.getByRole('heading', { level: 2, name: 'Questions about AI in your hiring process?' }))
    expect(within(band).getAllByRole('link')).toHaveLength(2)
  })

  it('links only to routes that exist', () => {
    const { container } = renderPage(<ResponsibleAiPage />)
    expectValidInternalLinks(container)
  })

  it('sets page metadata', () => {
    renderPage(<ResponsibleAiPage />)
    expectMeta('Responsible AI')
  })

  it('contains no em dash', () => {
    const { container } = renderPage(<ResponsibleAiPage />)
    expectNoEmDash(container)
  })
})
