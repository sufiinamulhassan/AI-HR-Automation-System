import { useEffect, useState } from 'react'
import { resolveLogoUrl } from '../../lib/brand'
import { companyInitial } from './careersFormat'

interface Props {
  name: string
  logoUrl?: string | null
  size?: 'md' | 'lg'
}

export default function CompanyLogo({ name, logoUrl, size = 'md' }: Props) {
  const src = resolveLogoUrl(logoUrl ?? undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setFailed(false) }, [src])

  return (
    <span className={`cr-logo cr-logo-${size}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="cr-logo-initial" aria-hidden="true">{companyInitial(name)}</span>
      )}
    </span>
  )
}
