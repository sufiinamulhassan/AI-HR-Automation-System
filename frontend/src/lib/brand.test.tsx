import { render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { API_BASE } from './config'
import {
  BrandContext, DEFAULT_BRAND, PRODUCT_NAME, brandContextFor, brandFromResponse, isUploadedLogo, resolveLogoUrl, useBrand, type Brand,
} from './brand'

describe('useBrand', () => {
  it('falls back to the product defaults outside a provider', () => {
    const { result } = renderHook(() => useBrand())
    expect(result.current).toEqual(DEFAULT_BRAND)
    expect(result.current.name).toBe('Hirely.ai')
    expect(result.current.companyName).toBe('')
    expect(result.current.logoUrl).toBe('')
  })

  it('returns whatever the nearest provider holds', () => {
    const acme: Brand = {
      name: 'Acme Corp', companyName: 'Acme Corp', companySlug: 'acme', termsUrl: '', privacyUrl: '',
      logoUrl: 'https://x.test/l.png', primaryColor: '#112233', accentColor: '#445566',
    }
    function Probe() {
      const b = useBrand()
      return <span data-testid="p">{b.name}|{b.logoUrl}|{b.primaryColor}</span>
    }
    render(<BrandContext.Provider value={acme}><Probe /></BrandContext.Provider>)
    expect(screen.getByTestId('p')).toHaveTextContent('Acme Corp|https://x.test/l.png|#112233')
  })
})

describe('resolveLogoUrl', () => {
  it('turns the path of an uploaded logo into an address on the API', () => {
    expect(resolveLogoUrl('/api/v1/branding/logo/cmp_a?v=abc123')).toBe(`${API_BASE}/api/v1/branding/logo/cmp_a?v=abc123`)
    expect(isUploadedLogo('/api/v1/branding/logo/cmp_a?v=abc123')).toBe(true)
  })

  it('leaves any other logo exactly as it is', () => {
    expect(resolveLogoUrl('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png')
    expect(resolveLogoUrl('  https://cdn.example.com/logo.png  ')).toBe('https://cdn.example.com/logo.png')
    expect(isUploadedLogo('https://cdn.example.com/api/v1/branding/logo/x')).toBe(false)
  })

  it('answers empty for nothing', () => {
    expect(resolveLogoUrl('')).toBe('')
    expect(resolveLogoUrl(undefined)).toBe('')
    expect(isUploadedLogo(undefined)).toBe(false)
  })

  it('is what the brand carries for an uploaded logo', () => {
    expect(brandFromResponse({ company_logo_url: '/api/v1/branding/logo/cmp_a?v=1' }).logoUrl)
      .toBe(`${API_BASE}/api/v1/branding/logo/cmp_a?v=1`)
  })
})

describe('brandFromResponse', () => {
  it('uses the product defaults for an empty answer, which is what an unconfigured company gets', () => {
    expect(brandFromResponse({ company_name: '', company_logo_url: '', primary_color: '#4778f3', accent_color: '#222022' })).toEqual({
      name: PRODUCT_NAME, companyName: '', companySlug: '', termsUrl: '', privacyUrl: '',
      logoUrl: '', primaryColor: '#4778f3', accentColor: '#222022',
    })
    expect(brandFromResponse({})).toEqual(DEFAULT_BRAND)
    expect(brandFromResponse(null)).toEqual(DEFAULT_BRAND)
    expect(brandFromResponse(undefined)).toEqual(DEFAULT_BRAND)
  })

  it('takes the company name as the name to print, and its logo and colours', () => {
    expect(brandFromResponse({
      company_name: '  Acme Corp ', company_logo_url: ' https://cdn.acme.test/logo.png ', primary_color: '#112233', accent_color: '#445566',
    })).toEqual({
      name: 'Acme Corp', companyName: 'Acme Corp', companySlug: '', termsUrl: '', privacyUrl: '',
      logoUrl: 'https://cdn.acme.test/logo.png', primaryColor: '#112233', accentColor: '#445566',
    })
  })

  it('keeps the product name when only the colours are set', () => {
    const b = brandFromResponse({ primary_color: '#112233' })
    expect(b.name).toBe('Hirely.ai')
    expect(b.primaryColor).toBe('#112233')
    expect(b.accentColor).toBe(DEFAULT_BRAND.accentColor)
  })

  it('treats a whitespace-only name as no name', () => {
    expect(brandFromResponse({ company_name: '   ' }).name).toBe('Hirely.ai')
  })

  it('reads the company slug and the two legal links', () => {
    const b = brandFromResponse({
      company_name: 'Acme Corp', company_slug: ' acme ',
      terms_url: ' https://acme.test/terms ', privacy_url: 'https://acme.test/privacy',
    })
    expect(b.companySlug).toBe('acme')
    expect(b.termsUrl).toBe('https://acme.test/terms')
    expect(b.privacyUrl).toBe('https://acme.test/privacy')
  })

  it('has no slug and no legal links for the product defaults', () => {
    const b = brandFromResponse({ company_name: '', company_slug: '', terms_url: '', privacy_url: '' })
    expect([b.companySlug, b.termsUrl, b.privacyUrl]).toEqual(['', '', ''])
  })

  it('drops a legal link that is not a full https address, so a page never links to a script or a plain http page', () => {
    for (const bad of ['javascript:alert(1)', 'http://acme.test/terms', '/terms', 'acme.test/terms', 'data:text/html,hi', 'not a url']) {
      expect(brandFromResponse({ terms_url: bad, privacy_url: bad })).toMatchObject({ termsUrl: '', privacyUrl: '' })
    }
  })
})

describe('brandContextFor', () => {
  it.each([
    ['/interview/tok_1', 'candidate'],
    ['/coding/tok_2', 'candidate'],
    ['/offer/tok_3', 'offer'],
    ['/performance-review/tok_4', 'review'],
    ['/report/shared/tok_5', 'share'],
    ['/interviewer/tok_6', 'interviewer'],
  ])('maps %s to the %s kind and carries the token', (path, kind) => {
    const token = path.split('/').pop()
    expect(brandContextFor(path, '')).toEqual({ kind, token })
  })

  it('takes the company slug from the login page', () => {
    expect(brandContextFor('/login', '?company=acme')).toEqual({ company: 'acme' })
    expect(brandContextFor('/login/', '?company=acme')).toEqual({ company: 'acme' })
    expect(brandContextFor('/login', '?company=%20acme%20&x=1')).toEqual({ company: 'acme' })
  })

  it('asks for nothing on the login page without a company', () => {
    expect(brandContextFor('/login', '')).toBeUndefined()
    expect(brandContextFor('/login', '?company=')).toBeUndefined()
    expect(brandContextFor('/login', '?company=%20')).toBeUndefined()
    expect(brandContextFor('/login', '?other=acme')).toBeUndefined()
  })

  it('decodes a token that was percent-encoded in the path', () => {
    expect(brandContextFor('/offer/a%2Fb', '')).toEqual({ kind: 'offer', token: 'a/b' })
  })

  it('keeps a token whose encoding is broken as it came', () => {
    expect(brandContextFor('/offer/100%', '')).toEqual({ kind: 'offer', token: '100%' })
  })

  it('uses the first segment after the prefix and ignores any trailing path', () => {
    expect(brandContextFor('/interview/tok_1/extra', '')).toEqual({ kind: 'candidate', token: 'tok_1' })
  })

  it('ignores a company slug anywhere but the login page', () => {
    expect(brandContextFor('/offer/tok_3', '?company=acme')).toEqual({ kind: 'offer', token: 'tok_3' })
    expect(brandContextFor('/dashboard', '?company=acme')).toBeUndefined()
  })

  it('asks for nothing on any signed-in or unrelated page', () => {
    for (const path of ['/', '/dashboard', '/dashboard/users', '/platform', '/platform/clients/cli_1', '/sso-callback', '/report/abc', '/login-help']) {
      expect(brandContextFor(path, '')).toBeUndefined()
    }
  })

  it('asks for nothing when a public route has no token', () => {
    for (const path of ['/interview/', '/interview', '/offer/', '/coding/', '/report/shared/', '/interviewer/']) {
      expect(brandContextFor(path, '')).toBeUndefined()
    }
  })
})
