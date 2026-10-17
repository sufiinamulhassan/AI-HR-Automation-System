import { createContext, useContext } from 'react'
import type { PublicBranding, PublicBrandingContext, PublicBrandingKind } from './api'
import { API_BASE } from './config'

export const PRODUCT_NAME = 'Hirely.ai'
export const DEFAULT_PRIMARY = '#4778f3'
export const DEFAULT_ACCENT = '#222022'

export interface Brand {
  name: string
  companyName: string
  companySlug: string
  termsUrl: string
  privacyUrl: string
  logoUrl: string
  primaryColor: string
  accentColor: string
}

export const DEFAULT_BRAND: Brand = {
  name: PRODUCT_NAME,
  companyName: '',
  companySlug: '',
  termsUrl: '',
  privacyUrl: '',
  logoUrl: '',
  primaryColor: DEFAULT_PRIMARY,
  accentColor: DEFAULT_ACCENT,
}

function httpsUrl(value: string | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).protocol === 'https:' ? raw : ''
  } catch {
    return ''
  }
}

export const UPLOADED_LOGO_PREFIX = '/api/v1/branding/logo/'

export const isUploadedLogo = (value: string | undefined): boolean => (value ?? '').trim().startsWith(UPLOADED_LOGO_PREFIX)

export function resolveLogoUrl(value: string | undefined): string {
  const raw = (value ?? '').trim()
  return isUploadedLogo(raw) ? `${API_BASE}${raw}` : raw
}

export function brandFromResponse(data: PublicBranding | null | undefined): Brand {
  const companyName = (data?.company_name ?? '').trim()
  return {
    name: companyName || PRODUCT_NAME,
    companyName,
    companySlug: (data?.company_slug ?? '').trim(),
    termsUrl: httpsUrl(data?.terms_url),
    privacyUrl: httpsUrl(data?.privacy_url),
    logoUrl: resolveLogoUrl(data?.company_logo_url),
    primaryColor: data?.primary_color || DEFAULT_PRIMARY,
    accentColor: data?.accent_color || DEFAULT_ACCENT,
  }
}

export const BrandContext = createContext<Brand>(DEFAULT_BRAND)

export function useBrand(): Brand {
  return useContext(BrandContext)
}

const PUBLIC_ROUTES: { prefix: string; kind: PublicBrandingKind }[] = [
  { prefix: '/interview/', kind: 'candidate' },
  { prefix: '/coding/', kind: 'candidate' },
  { prefix: '/offer/', kind: 'offer' },
  { prefix: '/performance-review/', kind: 'review' },
  { prefix: '/report/shared/', kind: 'share' },
  { prefix: '/interviewer/', kind: 'interviewer' },
]

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

export function brandContextFor(pathname: string, search: string): PublicBrandingContext | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === '/login') {
    const company = new URLSearchParams(search).get('company')?.trim()
    return company ? { company } : undefined
  }
  for (const route of PUBLIC_ROUTES) {
    if (!path.startsWith(route.prefix)) continue
    const token = decode(path.slice(route.prefix.length).split('/')[0])
    if (token) return { kind: route.kind, token }
  }
  return undefined
}
