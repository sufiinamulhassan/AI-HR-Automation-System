import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { brandingApi, type PublicBrandingContext } from '../lib/api'
import { pageTitleClaimed } from '../lib/pageTitle'
import {
  BrandContext, DEFAULT_ACCENT, DEFAULT_BRAND, DEFAULT_PRIMARY, brandContextFor, brandFromResponse,
  type Brand,
} from '../lib/brand'
import { useAuthStore } from '../store/auth.store'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function darken(hex: string, amount = 0.12): string {
  if (!HEX_RE.test(hex)) return hex
  const num = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)))
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)))
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function applyTheme(brand: Brand) {
  const primary = HEX_RE.test(brand.primaryColor) ? brand.primaryColor : DEFAULT_PRIMARY
  const accent = HEX_RE.test(brand.accentColor) ? brand.accentColor : DEFAULT_ACCENT
  const root = document.documentElement.style

  root.setProperty('--primary', primary)
  root.setProperty('--primary-dark', darken(primary))
  root.setProperty('--secondary', accent)

  root.setProperty('--brand-primary', primary)
  root.setProperty('--brand-primary-dark', darken(primary))
  root.setProperty('--brand-accent', accent)

  if (brand.logoUrl) {
    root.setProperty('--brand-logo-url', `url("${brand.logoUrl.replace(/"/g, '\\"')}")`)
  } else {
    root.removeProperty('--brand-logo-url')
  }
}

export default function BrandingProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore(s => s.token)
  const { pathname, search } = useLocation()
  const contextKey = JSON.stringify(brandContextFor(pathname, search) ?? null)
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND)
  const hadToken = useRef(!!token)

  useEffect(() => {
    let cancelled = false

    if (hadToken.current && !token) {
      setBrand(DEFAULT_BRAND)
      applyTheme(DEFAULT_BRAND)
    }
    hadToken.current = !!token

    const context = JSON.parse(contextKey) as PublicBrandingContext | null
    brandingApi.getPublic(context ?? undefined)
      .then(r => {
        if (cancelled) return
        const next = brandFromResponse(r.data)
        setBrand(next)
        applyTheme(next)
      })
      .catch(() => {
        if (cancelled) return
        setBrand(DEFAULT_BRAND)
        applyTheme(DEFAULT_BRAND)
      })

    return () => { cancelled = true }
  }, [token, contextKey])

  useEffect(() => {
    if (!pageTitleClaimed()) document.title = brand.name
  }, [brand.name])

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}
