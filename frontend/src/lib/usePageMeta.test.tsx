import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pageTitle, usePageMeta, type PageMeta } from './usePageMeta'

function Harness(props: PageMeta) {
  usePageMeta(props)
  return null
}

function view(path: string, props: PageMeta) {
  return render(<MemoryRouter initialEntries={[path]}><Harness {...props} /></MemoryRouter>)
}

const meta = (selector: string) => document.head.querySelector(selector)

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="Original description" />'
  document.title = 'Original title'
})

afterEach(() => {
  document.head.innerHTML = ''
})

describe('pageTitle', () => {
  it('adds the product name, or gives the default for the home page', () => {
    expect(pageTitle('Pricing')).toBe('Pricing | Hirely.ai')
    expect(pageTitle()).toBe('Hirely.ai - AI Recruitment Platform')
  })
})

describe('usePageMeta', () => {
  it('sets the title, description, canonical address and share tags', () => {
    view('/pricing', { title: 'Pricing', description: 'Plans and limits for Hirely.ai.' })
    expect(document.title).toBe('Pricing | Hirely.ai')
    expect(meta('meta[name="description"]')?.getAttribute('content')).toBe('Plans and limits for Hirely.ai.')
    expect(meta('link[rel="canonical"]')?.getAttribute('href')).toBe(`${window.location.origin}/pricing`)
    expect(meta('meta[property="og:title"]')?.getAttribute('content')).toBe('Pricing | Hirely.ai')
    expect(meta('meta[property="og:description"]')?.getAttribute('content')).toBe('Plans and limits for Hirely.ai.')
    expect(meta('meta[property="og:url"]')?.getAttribute('content')).toBe(`${window.location.origin}/pricing`)
    expect(meta('meta[property="og:site_name"]')?.getAttribute('content')).toBe('Hirely.ai')
    expect(meta('meta[name="robots"]')).toBeNull()
  })

  it('gives the home page a canonical address without a trailing slash', () => {
    view('/', { description: 'Home description.' })
    expect(document.title).toBe('Hirely.ai - AI Recruitment Platform')
    expect(meta('link[rel="canonical"]')?.getAttribute('href')).toBe(window.location.origin)
  })

  it('asks search engines to skip a page when told to', () => {
    view('/nowhere', { title: 'Page not found', description: 'Missing.', noindex: true })
    expect(meta('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })

  it('adds structured data for the page and removes it when the page goes away', () => {
    const data = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] }
    const { unmount } = view('/faq', { title: 'FAQ', description: 'Answers.', jsonLd: [data] })
    const script = meta('script[type="application/ld+json"]')
    expect(script).not.toBeNull()
    expect(JSON.parse(script?.textContent ?? '')).toEqual(data)
    unmount()
    expect(meta('script[type="application/ld+json"]')).toBeNull()
  })

  it('joins several structured data blocks into one list', () => {
    view('/faq', { title: 'FAQ', description: 'Answers.', jsonLd: [{ '@type': 'A' }, { '@type': 'B' }] })
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0].textContent ?? '').map((item: { '@type': string }) => item['@type'])).toEqual(['A', 'B'])
  })

  it('adds no structured data when none is given', () => {
    view('/about', { title: 'About', description: 'About us.', jsonLd: [] })
    expect(meta('script[type="application/ld+json"]')).toBeNull()
  })

  it('uses the page type for sharing, website unless told otherwise', () => {
    const first = view('/a', { title: 'A', description: 'One.' })
    expect(meta('meta[property="og:type"]')?.getAttribute('content')).toBe('website')
    first.unmount()
    view('/b', { title: 'B', description: 'Two.', ogType: 'article' })
    expect(meta('meta[property="og:type"]')?.getAttribute('content')).toBe('article')
  })

  it('puts everything back when the page goes away', () => {
    const { unmount } = view('/pricing', { title: 'Pricing', description: 'Plans.' })
    unmount()
    expect(document.title).toBe('Original title')
    expect(meta('meta[name="description"]')?.getAttribute('content')).toBe('Original description')
    expect(meta('link[rel="canonical"]')).toBeNull()
    expect(meta('meta[property="og:title"]')).toBeNull()
  })

  it('updates in place when the page changes without leaving duplicates', () => {
    const { rerender } = view('/a', { title: 'First', description: 'One.' })
    rerender(<MemoryRouter initialEntries={['/a']}><Harness title="Second" description="Two." /></MemoryRouter>)
    expect(document.title).toBe('Second | Hirely.ai')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(meta('meta[name="description"]')?.getAttribute('content')).toBe('Two.')
  })
})
