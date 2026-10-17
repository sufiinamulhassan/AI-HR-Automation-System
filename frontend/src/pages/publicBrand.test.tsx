import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND, type Brand } from '../lib/brand'

vi.mock('../components/coding/useCodingSession', () => ({
  useCodingSession: () => ({
    session: { difficulty: 'medium' },
    status: 'active',
    errorMsg: '',
    result: null,
    submit: vi.fn(),
    runStatus: 'idle',
    runResult: null,
    runErrorMsg: '',
    run: vi.fn(),
    flag: vi.fn(),
    autosave: vi.fn(),
  }),
}))
vi.mock('../components/coding/CodingWorkspace', () => ({ default: () => null }))

const { default: OfferAcceptance } = await import('./OfferAcceptance')
const { default: SharedReportPage } = await import('./SharedReportPage')
const { default: PublicReviewPage } = await import('./performance/PublicReviewPage')
const { default: InterviewerScorecardPage } = await import('./interview/InterviewerScorecardPage')
const { default: CodingAssessment } = await import('./CodingAssessment')
const { interviewerScorecardApi } = await import('../lib/api')

const ACME: Brand = { ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp', logoUrl: 'https://cdn.acme.test/logo.png' }
const NAME_ONLY: Brand = { ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp' }

interface PageCase {
  label: string
  path: string
  route: string
  element: ReactNode
  brandClass: string
  suffix: string
}

const PAGES: PageCase[] = [
  { label: 'offer', path: '/offer/tok_1', route: '/offer/:token', element: <OfferAcceptance />, brandClass: '.offer-brand', suffix: '' },
  { label: 'shared report', path: '/report/shared/tok_1', route: '/report/shared/:token', element: <SharedReportPage />, brandClass: '.shr-brand', suffix: '' },
  { label: 'performance review', path: '/performance-review/tok_1', route: '/performance-review/:token', element: <PublicReviewPage />, brandClass: '.pr-brand', suffix: '' },
  { label: 'interviewer scorecard', path: '/interviewer/tok_1', route: '/interviewer/:token', element: <InterviewerScorecardPage />, brandClass: '.isp-brand', suffix: '' },
  { label: 'coding assessment', path: '/coding/tok_1', route: '/coding/:token', element: <CodingAssessment />, brandClass: '.ca-brand', suffix: ', Coding Assessment' },
]

function renderPage(page: PageCase, brand?: Brand) {
  const tree = (
    <MemoryRouter initialEntries={[page.path]}>
      <Routes><Route path={page.route} element={page.element} /></Routes>
    </MemoryRouter>
  )
  return render(brand ? <BrandContext.Provider value={brand}>{tree}</BrandContext.Provider> : tree)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(interviewerScorecardApi, 'get').mockReturnValue(new Promise(() => {}) as never)
})

describe.each(PAGES)('$label page', page => {
  const brandLine = () => document.querySelector(page.brandClass)!

  it('prints the product name and mark when no company is known', () => {
    renderPage(page)
    expect(brandLine()).toHaveTextContent(`Hirely.ai${page.suffix}`)
    expect(brandLine().querySelector('svg')).not.toBeNull()
    expect(brandLine().querySelector('img')).toBeNull()
  })

  it('prints the company name in its place', () => {
    renderPage(page, NAME_ONLY)
    expect(brandLine()).toHaveTextContent(`Acme Corp${page.suffix}`)
    expect(brandLine()).not.toHaveTextContent('Hirely')
    expect(brandLine().querySelector('svg')).not.toBeNull()
  })

  it('shows the company logo in the slot of the mark', () => {
    renderPage(page, ACME)
    const img = brandLine().querySelector('img')!
    expect(img).toHaveAttribute('src', 'https://cdn.acme.test/logo.png')
    expect(img).toHaveAttribute('alt', '')
    expect(brandLine().querySelector('svg')).toBeNull()
    expect(brandLine()).toHaveTextContent(`Acme Corp${page.suffix}`)
  })
})

describe('the wordmark on a page that is mid-way through its work', () => {
  it('stays the company\'s while the offer loads', () => {
    renderPage(PAGES[0], ACME)
    expect(screen.getByText('Loading your offer…')).toBeInTheDocument()
    expect(document.querySelector('.offer-brand')).toHaveTextContent('Acme Corp')
  })
})

describe.each(PAGES)('$label page: legal links', page => {
  const LEGAL: Brand = { ...NAME_ONLY, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' }

  it('shows the company Terms and Privacy links, each in a new tab', () => {
    renderPage(page, LEGAL)
    const nav = screen.getByRole('navigation', { name: 'Legal' })
    const terms = within(nav).getByRole('link', { name: 'Terms' })
    const privacy = within(nav).getByRole('link', { name: 'Privacy' })
    expect(terms).toHaveAttribute('href', 'https://acme.test/terms')
    expect(privacy).toHaveAttribute('href', 'https://acme.test/privacy')
    expect(terms).toHaveAttribute('target', '_blank')
    expect(terms).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows no legal row when the company has set neither', () => {
    renderPage(page, NAME_ONLY)
    expect(screen.queryByRole('navigation', { name: 'Legal' })).not.toBeInTheDocument()
  })

  it('shows only the link that is set', () => {
    renderPage(page, { ...NAME_ONLY, privacyUrl: 'https://acme.test/privacy' })
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument()
  })
})
