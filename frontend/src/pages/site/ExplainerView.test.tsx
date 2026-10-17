import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { p, ul } from '../../components/site/blockModel'
import type { Explainer } from '../../lib/siteContent'
import ExplainerRoute from './ExplainerRoute'
import ExplainerView from './ExplainerView'
import {
  expectHeadingOrder, expectMeta, expectNoEmDash, expectValidInternalLinks, renderPage,
} from './siteTestKit'

const PAGE: Explainer = {
  slug: 'resume-screening',
  title: 'Resume screening',
  icon: 'resume',
  metaTitle: 'Resume screening that ranks every applicant',
  metaDescription: 'Parse, score and rank every resume against every open role, with a person making each decision. Bulk upload up to 500 files.',
  eyebrow: 'Screening',
  headline: 'Rank every resume',
  accent: 'against every role',
  lead: 'Hirely.ai reads each resume and scores it against your open roles.',
  stats: [{ value: '500', label: 'Resumes in one bulk upload' }],
  stepsEyebrow: 'How it works',
  stepsTitle: 'From file to ranked list',
  steps: [
    { title: 'Upload', description: 'Add PDF, DOC or DOCX files in bulk.' },
    { title: 'Parse', description: 'Text is extracted and classified.' },
    { title: 'Score', description: 'Each resume is scored against every open role.' },
  ],
  featuresEyebrow: 'Capabilities',
  featuresTitle: 'What it does',
  features: [
    { icon: 'resume', title: 'Bulk upload', text: 'Up to **500** files at once.' },
    { icon: 'filter', title: 'Duplicate detection', text: 'Matches by content hash.' },
    { icon: 'target', title: 'Two-way matching', text: 'Resume to roles and role to resumes.' },
  ],
  sections: [
    {
      id: 'formats',
      eyebrow: 'Formats',
      title: 'Supported formats',
      lead: 'What you can upload.',
      blocks: [p('PDF, DOC and DOCX are accepted.'), ul(['PDF', 'DOC', 'DOCX'])],
    },
  ],
  plan: 'Included on every plan. See [pricing](/pricing).',
  faqs: [{ q: 'Which formats work?', a: 'PDF, DOC and DOCX. See the [features](/features) page.' }],
  related: ['/integrations/zoom', '/compare/manual-screening', '/not-a-real-page'],
  ctaTitle: 'See it on your roles',
  ctaText: 'Talk to us and bring a job description.',
}

describe('ExplainerView', () => {
  it('shows the headline in two lines and the lead, with no buttons or breadcrumbs in the hero', () => {
    const { container } = renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Rank every resume against every role')
    expect(h1.querySelector('.xv-page-accent')).toHaveTextContent('against every role')
    expect(screen.getByText(PAGE.lead)).toBeInTheDocument()
    const hero = container.querySelector('.xv-page-hero') as HTMLElement
    expect(hero.querySelectorAll('a, button')).toHaveLength(0)
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
    expectHeadingOrder(container)
  })

  it('shows the stats, steps, features, sections, plan and questions in order', () => {
    renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    expect(screen.getByText('Resumes in one bulk upload')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').some(item => item.textContent?.includes('Upload'))).toBe(true)
    PAGE.features.forEach(feature => expect(screen.getByRole('heading', { level: 3, name: feature.title })).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Supported formats' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Which plans include it' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Resume screening: common questions' })).toBeInTheDocument()
    expect(screen.getByText('Which formats work?')).toBeInTheDocument()
  })

  it('renders inline markup in features and the plan note as real links and bold text', () => {
    renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    expect(screen.getByText('500', { selector: 'strong' })).toBeInTheDocument()
    const plan = screen.getByRole('heading', { level: 2, name: 'Which plans include it' }).closest('section') as HTMLElement
    expect(within(plan).getAllByRole('link', { name: /pricing/i }).every(link => link.getAttribute('href') === '/pricing')).toBe(true)
  })

  it('links related pages that exist and skips ones the site does not know', () => {
    renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    const related = screen.getByRole('heading', { level: 2, name: 'Related pages' }).closest('section') as HTMLElement
    expect(within(related).getByRole('link', { name: /^Zoom/ })).toHaveAttribute('href', '/integrations/zoom')
    expect(within(related).getByRole('link', { name: /^Hirely.ai vs manual screening/ })).toHaveAttribute('href', '/compare/manual-screening')
    expect(within(related).getAllByRole('link')).toHaveLength(2)
  })

  it('ends with the stepped call to action with sales and pricing buttons', () => {
    const { container } = renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    const band = screen.getByRole('heading', { level: 2, name: 'See it on your roles' }).closest('section') as HTMLElement
    expect(within(band).getByRole('link', { name: 'Talk to sales' })).toHaveAttribute('href', '/contact?topic=sales')
    expect(within(band).getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '/pricing')
    expect(container.querySelector('.xv-step-graphic')).not.toBeNull()
  })

  it('omits the stats and questions sections when the page has none', () => {
    renderPage(<ExplainerView page={{ ...PAGE, stats: undefined, faqs: [], related: [] }} parent={{ label: 'Integrations', to: '/integrations' }} />)
    expect(screen.queryByText('Resumes in one bulk upload')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /common questions/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Related pages' })).not.toBeInTheDocument()
  })

  it('sets the title, description and structured data', () => {
    const { container } = renderPage(<ExplainerView page={PAGE} parent={{ label: 'Integrations', to: '/integrations' }} />)
    expectMeta(PAGE.metaTitle)
    const types = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap(script => JSON.parse(script.textContent ?? '[]'))
      .map(item => item['@type'])
    expect(types).toEqual(['BreadcrumbList', 'FAQPage'])
    expectNoEmDash(container)
    expectValidInternalLinks(container)
  })
})

describe('ExplainerRoute', () => {
  function route(slug: string) {
    return render(
      <MemoryRouter initialEntries={[`/integrations/${slug}`]}>
        <Routes>
          <Route path="/integrations/:slug" element={<ExplainerRoute items={[PAGE]} parent={{ label: 'Integrations', to: '/integrations' }} />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('shows the page that matches the address', () => {
    route('resume-screening')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rank every resume against every role')
  })

  it('shows the not found page for an unknown address', () => {
    route('unknown')
    expect(screen.getByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
  })
})
