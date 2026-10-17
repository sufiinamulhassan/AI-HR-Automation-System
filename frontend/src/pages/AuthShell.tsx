import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import LegalLinks from '../components/LegalLinks'
import { PRODUCT_NAME, useBrand } from '../lib/brand'
import './Login.css'

export default function AuthShell({ children }: { children: ReactNode }) {
  const brand = useBrand()
  return (
    <div className="login-page">
      <div aria-hidden="true" className="login-grid" />

      <div className="login-card">
        <span aria-hidden="true" className="login-corner login-corner-tl" />
        <span aria-hidden="true" className="login-corner login-corner-tr" />
        <span aria-hidden="true" className="login-corner login-corner-bl" />
        <span aria-hidden="true" className="login-corner login-corner-br" />

        <Link to="/" className="login-brand">
          <BrandLogo size={36}>
            <span className="login-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m16 11 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </BrandLogo>
          <span className="login-brand-text">
            <span className="login-brand-name">{brand.companyName || PRODUCT_NAME}</span>
          </span>
        </Link>

        {children}

        <Link to="/" className="login-back">Back to home</Link>
        <LegalLinks />
      </div>
    </div>
  )
}
