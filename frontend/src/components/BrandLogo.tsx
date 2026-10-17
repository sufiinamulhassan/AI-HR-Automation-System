import type { ReactNode } from 'react'
import { useBrand } from '../lib/brand'
import './BrandLogo.css'

export default function BrandLogo({ size = 18, children }: { size?: number; children: ReactNode }) {
  const { logoUrl } = useBrand()
  if (!logoUrl) return <>{children}</>
  return <img className="brand-logo-img" src={logoUrl} alt="" width={size} height={size} />
}
