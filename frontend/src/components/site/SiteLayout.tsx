import '../../pages/Landing.css'
import './SiteLayout.css'
import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { prefetchChunksWhenIdle } from '../../lib/prefetch'
import SiteFooter from './SiteFooter'
import SiteHeader from './SiteHeader'

function scrollToHash(hash: string): () => void {
  let tries = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = () => {
    const id = decodeURIComponent(hash.slice(1))
    const el = id ? document.getElementById(id) : null
    if (el) {
      el.scrollIntoView()
      return
    }
    if (tries++ < 20) timer = setTimeout(attempt, 50)
  }
  attempt()
  return () => clearTimeout(timer)
}

function PageLoading() {
  return (
    <div className="xv-page-loading" role="status" aria-live="polite">
      <span className="xv-page-loading-bar" aria-hidden="true" />
      <span className="xv-sr-only">Loading</span>
    </div>
  )
}

export default function SiteLayout() {
  const { pathname, hash } = useLocation()

  useEffect(() => prefetchChunksWhenIdle(['/careers', '/pricing', '/contact']), [])

  useEffect(() => {
    if (hash) return scrollToHash(hash)
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return (
    <div className="xv">
      <a href="#main" className="xv-skip">Skip to content</a>
      <SiteHeader />
      <main id="main" className="xv-main" tabIndex={-1}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  )
}
