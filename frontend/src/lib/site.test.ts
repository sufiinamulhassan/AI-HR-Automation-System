import { describe, expect, it } from 'vitest'
import { CONTACT_TOPICS, FOOTER_GROUPS, LEGAL_LINKS, LEGAL_UPDATED, PUBLIC_PATHS, SITE } from './site'
import { CONTENT_PATHS, NAV_LOGIN, NAV_MENUS } from './siteNav'

const KNOWN = new Set([...PUBLIC_PATHS, '/login', '/careers'])
const HEADER_LINKS = [
  ...NAV_MENUS.flatMap(menu => [
    ...(menu.to ? [{ label: menu.label, to: menu.to }] : []),
    ...(menu.all ? [menu.all] : []),
    ...(menu.items ?? []).map(item => ({ label: item.label, to: item.to })),
    ...(menu.featured ?? []).map(card => ({ label: card.cta, to: card.to })),
  ]),
  NAV_LOGIN,
]

describe('site map', () => {
  it('lists every public page exactly once', () => {
    expect(new Set(PUBLIC_PATHS).size).toBe(PUBLIC_PATHS.length)
    expect(PUBLIC_PATHS).toEqual(expect.arrayContaining([
      '/', '/features', '/pricing', '/security', '/responsible-ai', '/about', '/contact',
      '/terms', '/privacy', '/candidate-privacy', '/cookies', '/acceptable-use', '/dpa', '/subprocessors', '/accessibility',
      '/faq', '/trust', '/candidates', '/integrations', '/compare', '/roi-calculator',
    ]))
  })

  it('has no product or solutions pages', () => {
    PUBLIC_PATHS.forEach(path => expect(path).not.toMatch(/^\/(product|solutions)(\/|$)/))
    FOOTER_GROUPS.flatMap(group => group.links).forEach(link => expect(link.to).not.toMatch(/^\/(product|solutions)(\/|$)/))
  })

  it('includes every content page in the public paths', () => {
    CONTENT_PATHS.forEach(path => expect(PUBLIC_PATHS).toContain(path))
  })

  it('points every header and footer link at a real page', () => {
    const links = [...HEADER_LINKS, ...FOOTER_GROUPS.flatMap(group => group.links)]
    links.forEach(link => {
      const url = new URL(link.to, 'http://site.test')
      expect(KNOWN.has(url.pathname), `${link.label} -> ${link.to}`).toBe(true)
    })
  })

  it('only offers contact topics that the form knows', () => {
    const topics = new Set<string>(CONTACT_TOPICS.map(t => t.value))
    FOOTER_GROUPS.flatMap(group => group.links).forEach(link => {
      const topic = new URL(link.to, 'http://site.test').searchParams.get('topic')
      if (topic) expect(topics.has(topic), link.to).toBe(true)
    })
  })

  it('keeps every legal document reachable from the footer', () => {
    const footerLegal = FOOTER_GROUPS.find(group => group.title === 'Legal')
    expect(footerLegal?.links).toEqual(LEGAL_LINKS)
    expect(LEGAL_LINKS).toHaveLength(8)
  })

  it('has unique link labels within each footer group', () => {
    FOOTER_GROUPS.forEach(group => {
      const labels = group.links.map(link => link.label)
      expect(new Set(labels).size, group.title).toBe(labels.length)
    })
  })
})

describe('site details', () => {
  it('names the product and the company', () => {
    expect(SITE.name).toBe('Hirely.ai')
    expect(SITE.entity).toBe('Hirely.ai')
  })

  it('keeps every optional detail as a trimmed string, empty unless configured', () => {
    const optional = [SITE.contactEmail, SITE.privacyEmail, SITE.securityEmail, SITE.address, SITE.governingLaw]
    optional.forEach(value => {
      expect(typeof value).toBe('string')
      expect(value).toBe(value.trim())
    })
  })

  it('dates the legal documents with a matching label and iso date', () => {
    expect(new Date(LEGAL_UPDATED.iso).toISOString().slice(0, 10)).toBe(LEGAL_UPDATED.iso)
    expect(LEGAL_UPDATED.label).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  })
})
