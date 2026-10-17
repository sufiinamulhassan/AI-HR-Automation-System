import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandContext, DEFAULT_BRAND, type Brand } from '../lib/brand'
import LegalLinks from './LegalLinks'

function renderWith(brand: Brand) {
  return render(<BrandContext.Provider value={brand}><LegalLinks /></BrandContext.Provider>)
}

describe('LegalLinks', () => {
  it('shows nothing when the company has set neither link', () => {
    const { container } = renderWith(DEFAULT_BRAND)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('navigation', { name: 'Legal' })).not.toBeInTheDocument()
  })

  it('shows both links, each opening in a new tab without handing over the opener', () => {
    renderWith({ ...DEFAULT_BRAND, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' })
    const terms = screen.getByRole('link', { name: 'Terms' })
    const privacy = screen.getByRole('link', { name: 'Privacy' })
    expect(terms).toHaveAttribute('href', 'https://acme.test/terms')
    expect(privacy).toHaveAttribute('href', 'https://acme.test/privacy')
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('shows only the one that is set', () => {
    renderWith({ ...DEFAULT_BRAND, privacyUrl: 'https://acme.test/privacy' })
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument()
  })
})
