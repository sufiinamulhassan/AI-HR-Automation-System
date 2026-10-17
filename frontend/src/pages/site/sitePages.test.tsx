import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TRUST_NAV } from '../../lib/siteNav'
import CandidatesPage from './CandidatesPage'
import { CANDIDATE_GUIDE } from './content/candidates'
import { COMPARISONS } from './content/comparisons'
import { FAQ_GROUPS } from './content/faqs'
import { TRUST } from './content/trust'
import { ComparisonDetail, CompareHub } from './CompareSection'
import FaqPage from './FaqPage'
import HubView from './HubView'
import { COMPARE_HUB, INTEGRATIONS_HUB } from './hubConfigs'
import {
  expectHeadingOrder, expectMeta, expectNoEmDash, expectValidInternalLinks, renderPage,
} from './siteTestKit'
import TrustPage from './TrustPage'

function ldTypes(): string[] {
  return Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).flatMap(script => {
    const data = JSON.parse(script.textContent ?? '{}')
    return (Array.isArray(data) ? data : [data]).map(item => item['@type'] as string)
  })
}

describe('hub pages', () => {
  const hubs = [
    ['integrations', INTEGRATIONS_HUB],
    ['compare', COMPARE_HUB],
  ] as const

  hubs.forEach(([name, hub]) => {
    describe(name, () => {
      it('has one h1 built from the headline and accent, with ordered headings', () => {
        const { container } = renderPage(<HubView hub={hub} />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${hub.headline} ${hub.accent}`)
        expectHeadingOrder(container)
      })

      it('links to every item and has a plain hero with no buttons or breadcrumbs', () => {
        const { container } = renderPage(<HubView hub={hub} />)
        expect((container.querySelector('.xv-page-hero') as HTMLElement).querySelectorAll('a, button')).toHaveLength(0)
        expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
        const section = screen.getByRole('heading', { level: 2, name: hub.itemsTitle }).closest('section') as HTMLElement
        hub.items.forEach(item => {
          const link = within(section).getByRole('link', { name: new RegExp(item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
          expect(link).toHaveAttribute('href', item.to)
        })
      })

      it('offers the sales call to action, valid links, metadata and breadcrumb data', () => {
        const { container } = renderPage(<HubView hub={hub} />)
        expect(screen.queryByRole('link', { name: /demo/i })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Talk to sales/ })).toHaveAttribute('href', '/contact?topic=sales')
        expectValidInternalLinks(container)
        expectMeta(hub.metaTitle)
        expectNoEmDash(container)
        expect(ldTypes()).toContain('BreadcrumbList')
      })
    })
  })

  it('states plan availability on the integrations hub', () => {
    renderPage(<HubView hub={INTEGRATIONS_HUB} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Which plans include them' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'pricing page' })).toHaveAttribute('href', '/pricing')
  })
})

describe('FaqPage', () => {
  it('lists every group with its questions and a jump link for each', () => {
    const { container } = renderPage(<FaqPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Questions, answered plainly')
    const chips = screen.getByRole('navigation', { name: 'Question topics' })
    FAQ_GROUPS.forEach(group => {
      expect(within(chips).getByRole('link', { name: group.title })).toHaveAttribute('href', `#${group.id}`)
      const heading = screen.getByRole('heading', { level: 2, name: group.title })
      expect(heading.closest('section')).toHaveAttribute('id', group.id)
      group.items.forEach(item => expect(container.textContent).toContain(item.q))
    })
    expectHeadingOrder(container)
  })

  it('publishes the questions as structured data and links only to real pages', () => {
    const { container } = renderPage(<FaqPage />)
    expect(ldTypes()).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage']))
    const faqData = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap(script => JSON.parse(script.textContent ?? '[]'))
      .find(item => item['@type'] === 'FAQPage')
    expect(faqData.mainEntity).toHaveLength(FAQ_GROUPS.flatMap(group => group.items).length)
    expect(JSON.stringify(faqData)).not.toMatch(/\*\*|\]\(/)
    expectValidInternalLinks(container)
    expectMeta('Frequently asked questions')
    expectNoEmDash(container)
  })
})

describe('CandidatesPage', () => {
  it('walks through the journey, the guide sections and the questions', () => {
    const { container } = renderPage(<CandidatesPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Taking an AI interview? Here is what to expect')
    CANDIDATE_GUIDE.steps.forEach(step => expect(screen.getByRole('heading', { level: 3, name: step.title })).toBeInTheDocument())
    CANDIDATE_GUIDE.sections.forEach(section => expect(screen.getByRole('heading', { level: 2, name: section.title })).toBeInTheDocument())
    CANDIDATE_GUIDE.faqs.forEach(item => expect(container.textContent).toContain(item.q))
    expectHeadingOrder(container)
  })

  it('points to open roles, the privacy notice and the privacy request form', () => {
    const { container } = renderPage(<CandidatesPage />)
    expect(screen.getAllByRole('link', { name: /privacy notice|Read the notice/i }).some(link => link.getAttribute('href') === '/candidate-privacy')).toBe(true)
    expect((container.querySelector('.xv-page-hero') as HTMLElement).querySelectorAll('a, button')).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Make a privacy request' })).toHaveAttribute('href', '/contact?topic=privacy')
    expectValidInternalLinks(container)
    expectMeta('Candidate help: taking an AI interview')
    expectNoEmDash(container)
  })
})

describe('TrustPage', () => {
  it('shows the pillars, the commitments and every document', () => {
    const { container } = renderPage(<TrustPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('How we protect your data and your decisions')
    TRUST.pillars.forEach(pillar => expect(screen.getByRole('heading', { level: 3, name: pillar.title })).toBeInTheDocument())
    TRUST.commitments.forEach(group => expect(screen.getByRole('heading', { level: 3, name: group.title })).toBeInTheDocument())
    const documents = screen.getByRole('heading', { level: 2, name: 'Every policy and notice' }).closest('section') as HTMLElement
    TRUST_NAV.forEach(item => {
      expect(within(documents).getByRole('link', { name: new RegExp(item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toHaveAttribute('href', item.to)
    })
    expectHeadingOrder(container)
  })

  it('offers a way to report a security issue and links only to real pages', () => {
    const { container } = renderPage(<TrustPage />)
    expect((container.querySelector('.xv-page-hero') as HTMLElement).querySelectorAll('a, button')).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Contact security' })).toHaveAttribute('href', '/contact?topic=security')
    expectValidInternalLinks(container)
    expectMeta('Trust center')
    expectNoEmDash(container)
  })
})

describe('comparison pages', () => {
  function renderComparison(slug: string) {
    return render(
      <MemoryRouter initialEntries={[`/compare/${slug}`]}>
        <Routes>
          <Route path="/compare" element={<CompareHub />} />
          <Route path="/compare/:slug" element={<ComparisonDetail />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  COMPARISONS.forEach(page => {
    it(`${page.slug} shows the table, both sides and the questions`, () => {
      const { container } = renderComparison(page.slug)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${page.headline} ${page.accent}`)
      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(page.rows.length + 1)
      page.columns.forEach(column => expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument())
      page.chooseOther.concat(page.chooseHirely).forEach(item => expect(container.textContent).toContain(item.replace(/\*\*/g, '').slice(0, 30)))
      page.faqs.forEach(item => expect(container.textContent).toContain(item.q))
      expectHeadingOrder(container)
      expectValidInternalLinks(container)
      expectMeta(page.metaTitle)
      expectNoEmDash(container)
      expect(ldTypes()).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage']))
    })
  })

  it('says it compares approaches, not named products', () => {
    renderComparison('manual-screening')
    expect(screen.getByText(/This compares approaches in general/)).toBeInTheDocument()
  })

  it('shows the not found page for an unknown comparison', () => {
    renderComparison('nothing-here')
    expect(screen.getByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
  })
})
