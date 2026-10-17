import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectHeadingOrder, expectNoEmDash, expectValidInternalLinks, renderPage } from './site/siteTestKit'
import NotFoundPage from './NotFoundPage'

describe('NotFoundPage', () => {
  it('says the page does not exist and offers a way out', () => {
    renderPage(<NotFoundPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
  })

  it('keeps search engines away from it', () => {
    renderPage(<NotFoundPage />)
    expect(document.title).toBe('Page not found | Hirely.ai')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })

  it('follows the site rules', () => {
    const { container } = renderPage(<NotFoundPage />)
    expectHeadingOrder(container)
    expectValidInternalLinks(container)
    expectNoEmDash(container)
  })
})
