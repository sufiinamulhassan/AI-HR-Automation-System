import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FeaturesPage from './FeaturesPage'
import {
  expectHeadingOrder,
  expectMeta,
  expectNoEmDash,
  expectValidInternalLinks,
  renderPage,
  sectionOf,
} from './siteTestKit'

const SECTION_HEADINGS = [
  'From job description to ranked candidates',
  'Voice interviews with a scored report',
  'Test code, and check how it was written',
  'Move candidates forward and close the loop',
  'A public page for your open roles',
  'Control who does what, and see what changed',
  'Platform, client, company',
  'What each plan includes',
  'Frequently asked questions',
]

const EXPECTED_PLAN_ROWS: Record<string, string[]> = {
  'Coding assessments': ['Included', 'Included', 'Included', 'Included'],
  'Performance reviews': ['Not included', 'Not included', 'Included', 'Included'],
  'Outbound webhooks': ['Not included', 'Included', 'Included', 'Included'],
  'Workflow automation': ['Not included', 'Included', 'Included', 'Included'],
  'Custom SMTP': ['Not included', 'Included', 'Included', 'Included'],
  'SSO with your own identity provider': ['Not included', 'Not included', 'Not included', 'Included'],
  'Custom domain': ['Not included', 'Not included', 'Not included', 'Included'],
  'HRMS, Zoom and Teams integrations': ['Not included', 'Included', 'Included', 'Included'],
}

describe('FeaturesPage', () => {
  it('has a single h1 and ordered headings', () => {
    const { container } = renderPage(<FeaturesPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Everything from job post to offer' })).toBeInTheDocument()
    expectHeadingOrder(container)
  })

  it('shows the main section headings', () => {
    renderPage(<FeaturesPage />)
    SECTION_HEADINGS.forEach(name => {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    })
  })

  it('covers the feature areas', () => {
    renderPage(<FeaturesPage />)
    ;[
      'Job descriptions',
      'Resume ingest',
      'Matching in both directions',
      'Auto-invite',
      'Voice interviews',
      'Integrity signals',
      'Scored report',
      'Pipeline stages',
      'Offer letters',
      'Performance reviews',
      'Roles and departments',
      'Single sign-on',
      'Audit log and activity',
      'Platform',
      'Client',
      'Company',
    ].forEach(name => {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument()
    })
    expect(screen.getByText(/off by default, and it is switched on only in the deployment settings/i)).toBeInTheDocument()
  })

  it('compares plans with four plan columns and the right values', () => {
    renderPage(<FeaturesPage />)
    const table = screen.getByRole('table', { name: 'Features by plan' })
    const headers = within(table).getAllByRole('columnheader').map(cell => cell.textContent)
    expect(headers).toEqual(['Feature', 'Starter', 'Growth', 'Max', 'Enterprise'])
    expect(headers.slice(1)).toHaveLength(4)

    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(Object.keys(EXPECTED_PLAN_ROWS).length)
    rows.forEach(row => {
      const feature = row.querySelector('th')?.textContent ?? ''
      const cells = Array.from(row.querySelectorAll('td')).map(cell => cell.textContent)
      expect(cells, feature).toEqual(EXPECTED_PLAN_ROWS[feature])
    })
  })

  it('points to pricing for limits', () => {
    renderPage(<FeaturesPage />)
    const plans = sectionOf(screen.getByRole('heading', { level: 2, name: 'What each plan includes' }))
    expect(within(plans).getByText(/for limits/)).toBeInTheDocument()
    expect(within(plans).getByRole('link', { name: 'pricing' })).toHaveAttribute('href', '/pricing')
  })

  it('has an FAQ of five to seven questions', () => {
    const { container } = renderPage(<FeaturesPage />)
    const count = container.querySelectorAll('.xv-faq-item').length
    expect(count).toBeGreaterThanOrEqual(5)
    expect(count).toBeLessThanOrEqual(7)
  })

  it('ends with a call to action with two buttons', () => {
    renderPage(<FeaturesPage />)
    const band = sectionOf(screen.getByRole('heading', { level: 2, name: 'See it with your own roles' }))
    const demo = within(band).getByRole('link', { name: 'Talk to sales' })
    const pricing = within(band).getByRole('link', { name: 'See pricing' })
    expect(demo).toHaveAttribute('href', '/contact?topic=sales')
    expect(demo).toHaveClass('xv-btn-white')
    expect(pricing).toHaveAttribute('href', '/pricing')
    expect(pricing).toHaveClass('xv-btn-ghost')
  })

  it('links only to routes that exist', () => {
    const { container } = renderPage(<FeaturesPage />)
    expectValidInternalLinks(container)
  })

  it('sets page metadata', () => {
    renderPage(<FeaturesPage />)
    expectMeta('Features')
  })

  it('contains no em dash', () => {
    const { container } = renderPage(<FeaturesPage />)
    expectNoEmDash(container)
  })
})
