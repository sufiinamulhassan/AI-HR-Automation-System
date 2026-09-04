import { useEffect, type ReactNode } from 'react'
import { brandingApi } from '../lib/api'


const DEFAULT_PRIMARY = '#4778f3'
const DEFAULT_ACCENT = '#222022'

interface PublicBranding {
  company_logo_url?: string
  primary_color?: string
  accent_color?: string
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function darken(hex: string, amount = 0.12): string {
  if (!HEX_RE.test(hex)) return hex
  const num = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)))
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)))
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function applyTheme(primary: string, accent: string, logoUrl?: string) {
  const safePrimary = HEX_RE.test(primary) ? primary : DEFAULT_PRIMARY
  const safeAccent = HEX_RE.test(accent) ? accent : DEFAULT_ACCENT
  const root = document.documentElement.style

  root.setProperty('--primary', safePrimary)
  root.setProperty('--primary-dark', darken(safePrimary))
  root.setProperty('--secondary', safeAccent)

  root.setProperty('--brand-primary', safePrimary)
  root.setProperty('--brand-primary-dark', darken(safePrimary))
  root.setProperty('--brand-accent', safeAccent)

  if (logoUrl) {
    root.setProperty('--brand-logo-url', `url("${logoUrl.replace(/"/g, '\\"')}")`)
  } else {
    root.removeProperty('--brand-logo-url')
  }
}

export default function BrandingProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false

    brandingApi.getPublic()
      .then(r => {
        if (cancelled) return
        const data = (r.data || {}) as PublicBranding
        applyTheme(data.primary_color || DEFAULT_PRIMARY, data.accent_color || DEFAULT_ACCENT, data.company_logo_url)
      })
      .catch(() => {
        if (!cancelled) applyTheme(DEFAULT_PRIMARY, DEFAULT_ACCENT)
      })

    return () => { cancelled = true }
  }, [])

  return <>{children}</>
}
