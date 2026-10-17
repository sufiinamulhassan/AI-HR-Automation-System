import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { PRODUCT_NAME } from './brand'
import { claimPageTitle } from './pageTitle'

export interface PageMeta {
  title?: string
  description: string
  noindex?: boolean
  ogType?: 'website' | 'article'
  jsonLd?: object[]
}

type Restore = () => void

function upsert(tag: 'meta' | 'link', match: Record<string, string>, set: Record<string, string>): Restore {
  const selector = `${tag}${Object.entries(match).map(([k, v]) => `[${k}="${v}"]`).join('')}`
  let el = document.head.querySelector<HTMLElement>(selector)
  const created = !el
  if (!el) {
    el = document.createElement(tag)
    Object.entries(match).forEach(([k, v]) => el!.setAttribute(k, v))
    document.head.appendChild(el)
  }
  const target = el
  const previous = Object.fromEntries(Object.keys(set).map(k => [k, target.getAttribute(k)]))
  Object.entries(set).forEach(([k, v]) => target.setAttribute(k, v))
  return () => {
    if (created) {
      target.remove()
      return
    }
    Object.entries(previous).forEach(([k, v]) => {
      if (v === null) target.removeAttribute(k)
      else target.setAttribute(k, v)
    })
  }
}

export function pageTitle(title?: string): string {
  return title ? `${title} | ${PRODUCT_NAME}` : `${PRODUCT_NAME} - AI Recruitment Platform`
}

export function usePageMeta({ title, description, noindex, ogType = 'website', jsonLd }: PageMeta): void {
  const { pathname } = useLocation()
  const ldKey = jsonLd && jsonLd.length > 0 ? JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd) : ''

  useEffect(() => {
    const releaseTitle = claimPageTitle()
    const full = pageTitle(title)
    const url = `${window.location.origin}${pathname === '/' ? '' : pathname}`
    const previousTitle = document.title
    document.title = full

    const restores: Restore[] = [
      upsert('meta', { name: 'description' }, { content: description }),
      upsert('link', { rel: 'canonical' }, { href: url }),
      upsert('meta', { property: 'og:title' }, { content: full }),
      upsert('meta', { property: 'og:description' }, { content: description }),
      upsert('meta', { property: 'og:type' }, { content: ogType }),
      upsert('meta', { property: 'og:url' }, { content: url }),
      upsert('meta', { property: 'og:site_name' }, { content: PRODUCT_NAME }),
      upsert('meta', { name: 'twitter:card' }, { content: 'summary' }),
    ]
    if (noindex) restores.push(upsert('meta', { name: 'robots' }, { content: 'noindex, nofollow' }))
    let ld: HTMLScriptElement | null = null
    if (ldKey) {
      ld = document.createElement('script')
      ld.type = 'application/ld+json'
      ld.setAttribute('data-site-ld', '')
      ld.textContent = ldKey
      document.head.appendChild(ld)
    }

    return () => {
      releaseTitle()
      document.title = previousTitle
      restores.forEach(restore => restore())
      ld?.remove()
    }
  }, [title, description, noindex, ogType, ldKey, pathname])
}
