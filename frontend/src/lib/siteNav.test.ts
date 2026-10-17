import { describe, expect, it } from 'vitest'
import { isSiteIcon } from '../components/site/siteIcons'
import { PAGE_INDEX, pageEntry } from './siteIndex'
import {
  COMPANY_NAV, COMPARE_NAV, COMPARISON_SLUGS, CONTENT_PATHS, INTEGRATION_NAV,
  INTEGRATION_SLUGS, NAV_LOGIN, NAV_MENUS, RESOURCE_NAV, TRUST_NAV, type NavItem,
} from './siteNav'

const LISTS: [string, NavItem[]][] = [
  ['integrations', INTEGRATION_NAV],
  ['compare', COMPARE_NAV],
  ['resources', RESOURCE_NAV],
  ['trust', TRUST_NAV],
  ['company', COMPANY_NAV],
]

describe('navigation data', () => {
  it('has one menu entry for every slug, in the same order, at the right address', () => {
    expect(INTEGRATION_NAV.map(item => item.to)).toEqual(INTEGRATION_SLUGS.map(slug => `/integrations/${slug}`))
    expect(COMPARE_NAV.map(item => item.to)).toEqual(COMPARISON_SLUGS.map(slug => `/compare/${slug}`))
  })

  LISTS.forEach(([name, items]) => {
    it(`${name}: every item has a real icon, a short description and a unique address`, () => {
      items.forEach(item => {
        expect(isSiteIcon(item.icon), `${item.label} icon ${item.icon}`).toBe(true)
        expect(item.label.trim().length).toBeGreaterThan(0)
        expect(item.description.length, item.label).toBeGreaterThan(15)
        expect(item.description.length, item.label).toBeLessThanOrEqual(80)
        expect(item.to.startsWith('/')).toBe(true)
      })
      expect(new Set(items.map(item => item.to)).size).toBe(items.length)
    })
  })

  it('lists every content page once', () => {
    expect(new Set(CONTENT_PATHS).size).toBe(CONTENT_PATHS.length)
    expect(CONTENT_PATHS).toEqual(expect.arrayContaining(['/integrations', '/compare', '/faq', '/trust', '/candidates', '/roi-calculator']))
    CONTENT_PATHS.forEach(path => expect(PAGE_INDEX.has(path), path).toBe(true))
  })

  it('keeps every dropdown description short enough for one line', () => {
    NAV_MENUS.flatMap(menu => menu.items ?? []).forEach(item => {
      expect(item.description.length, `${item.label}: ${item.description}`).toBeLessThanOrEqual(34)
    })
  })

  it('keeps the top menu to a handful of items with one box on Resources and two on Trust', () => {
    expect(NAV_MENUS.length).toBeGreaterThanOrEqual(5)
    expect(NAV_MENUS.length).toBeLessThanOrEqual(7)
    expect(new Set(NAV_MENUS.map(menu => menu.label)).size).toBe(NAV_MENUS.length)
    NAV_MENUS.forEach(menu => {
      expect(Boolean(menu.items) || Boolean(menu.to), menu.label).toBe(true)
      if (menu.label === 'Resources') expect(menu.featured, menu.label).toHaveLength(1)
      else if (menu.label === 'Trust') expect(menu.featured, menu.label).toHaveLength(2)
      else expect(menu.featured).toBeUndefined()
      menu.featured?.forEach(card => {
        expect(card.cta.length).toBeLessThanOrEqual(30)
        expect(card.to.startsWith('/')).toBe(true)
        expect(card.title.length).toBeLessThanOrEqual(32)
      })
      const targets = (menu.featured ?? []).map(card => card.to)
      expect(new Set(targets).size).toBe(targets.length)
    })
  })

  it('lists the top level items in the agreed order', () => {
    expect(NAV_MENUS.map(menu => menu.label)).toEqual(['About Us', 'Careers', 'Resources', 'Trust', 'Pricing', 'Contact Us'])
    expect(NAV_MENUS.filter(menu => !menu.items).map(menu => menu.to)).toEqual(['/about', '/careers', '/pricing', '/contact'])
    expect(NAV_MENUS.filter(menu => menu.items).map(menu => menu.label)).toEqual(['Resources', 'Trust'])
  })

  it('has no product or solutions pages anywhere in the navigation', () => {
    const everything = [...LISTS.flatMap(([, items]) => items.map(item => item.to)), ...CONTENT_PATHS, ...NAV_MENUS.flatMap(menu => [menu.to ?? '', ...(menu.featured ?? []).map(card => card.to)])]
    everything.forEach(path => expect(path).not.toMatch(/^\/(product|solutions)(\/|$)/))
    expect(NAV_MENUS.map(menu => menu.label)).not.toContain('Product')
    expect(NAV_MENUS.map(menu => menu.label)).not.toContain('Solutions')
  })

  it('has a login button and no insights pages', () => {
    expect(NAV_LOGIN).toEqual({ label: 'Login', to: '/login' })
    const everything = [...LISTS.flatMap(([, items]) => items.map(item => item.to)), ...CONTENT_PATHS]
    everything.forEach(path => expect(path).not.toMatch(/^\/insights/))
    expect(RESOURCE_NAV.map(item => item.label)).not.toContain('Insights')
    expect(PAGE_INDEX.has('/insights')).toBe(false)
  })
})

describe('page index', () => {
  it('finds a page by address and gives nothing for an unknown one', () => {
    expect(pageEntry('/integrations/zoom')?.label).toBe('Zoom')
    expect(pageEntry('/pricing')?.label).toBe('Pricing')
    expect(pageEntry('/nowhere')).toBeUndefined()
  })

  it('indexes every menu list', () => {
    LISTS.forEach(([, items]) => items.forEach(item => expect(PAGE_INDEX.get(item.to)?.to).toBe(item.to)))
  })
})
