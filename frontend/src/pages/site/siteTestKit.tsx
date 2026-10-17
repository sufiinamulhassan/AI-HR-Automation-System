import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { expect } from 'vitest'
import { PUBLIC_PATHS } from '../../lib/site'

export const VALID_PATHS = [...new Set([...PUBLIC_PATHS, '/careers', '/login'])]

export const VALID_TOPICS = ['demo', 'sales', 'support', 'privacy', 'security', 'other']

const EM_DASH = String.fromCharCode(0x2014)

export function renderPage(page: ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

export function internalHrefs(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('a'))
    .map(anchor => anchor.getAttribute('href') ?? '')
    .filter(href => href.startsWith('/'))
}

export function expectValidInternalLinks(root: HTMLElement) {
  const hrefs = internalHrefs(root)
  expect(hrefs.length).toBeGreaterThan(0)
  hrefs.forEach(href => {
    const url = new URL(href, 'http://site.test')
    expect(VALID_PATHS, `unknown route ${href}`).toContain(url.pathname)
    if (url.pathname === '/contact' && url.search) {
      expect(VALID_TOPICS, `unknown topic ${href}`).toContain(url.searchParams.get('topic'))
    }
  })
}

export function expectHeadingOrder(root: HTMLElement) {
  const levels = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(heading =>
    Number(heading.tagName.slice(1)),
  )
  expect(levels.filter(level => level === 1)).toHaveLength(1)
  expect(levels[0]).toBe(1)
  levels.slice(1).forEach((level, i) => {
    expect(level, `heading level jumps after level ${levels[i]}`).toBeLessThanOrEqual(levels[i] + 1)
  })
}

export function expectNoEmDash(root: HTMLElement) {
  expect(root.textContent ?? '').not.toContain(EM_DASH)
  expect(document.title).not.toContain(EM_DASH)
  expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').not.toContain(EM_DASH)
}

export function expectMeta(title: string) {
  expect(document.title).toBe(`${title} | Hirely.ai`)
  const description = document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
  expect(description.length).toBeGreaterThan(40)
  expect(description.length).toBeLessThanOrEqual(160)
}

export function sectionOf(heading: HTMLElement): HTMLElement {
  const section = heading.closest('section')
  if (!section) throw new Error('heading is not inside a section')
  return section
}
