import { useBrand } from '../lib/brand'
import './LegalLinks.css'

export default function LegalLinks() {
  const { termsUrl, privacyUrl } = useBrand()
  if (!termsUrl && !privacyUrl) return null
  return (
    <nav className="legal-links" aria-label="Legal">
      {termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer">Terms</a>}
      {privacyUrl && <a href={privacyUrl} target="_blank" rel="noopener noreferrer">Privacy</a>}
    </nav>
  )
}
