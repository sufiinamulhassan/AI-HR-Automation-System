import { describe, expect, it } from 'vitest'
import { isSiteIcon } from '../../../components/site/siteIcons'
import { PUBLIC_PATHS, CONTACT_TOPICS } from '../../../lib/site'
import type { Explainer } from '../../../lib/siteContent'
import {
  COMPARE_NAV, COMPARISON_SLUGS, INTEGRATION_NAV, INTEGRATION_SLUGS,
} from '../../../lib/siteNav'
import { CANDIDATE_GUIDE } from './candidates'
import { COMPARISONS } from './comparisons'
import { FAQ_GROUPS } from './faqs'
import { INTEGRATIONS } from './integrations'
import { TRUST } from './trust'

const VALID_PATHS = new Set([...PUBLIC_PATHS, '/careers', '/login'])
const TOPICS = new Set<string>(CONTACT_TOPICS.map(topic => topic.value))
const EXPLAINER_SETS: [string, Explainer[]][] = [
  ['integrations', INTEGRATIONS],
]
const HYPE = /cutting[- ]edge|seamless|\brobust\b|revolutionary|game[- ]chang|\bunlock|\bleverag|\bempower|supercharge|best[- ]in[- ]class|world[- ]class/i
const CERTIFICATIONS = /SOC ?2|ISO ?27001|HIPAA|PCI[- ]DSS|FedRAMP/i
const NEGATION = /\bnot\b|\bno\b|n't|\bnever\b|\bwithout\b/i
const EN_DASH = String.fromCharCode(0x2013)
const EM_DASH = String.fromCharCode(0x2014)

function collect(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(item => collect(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, out))
  return out
}

const EVERYTHING: [string, string][] = [
  ...EXPLAINER_SETS.flatMap(([name, items]) => items.flatMap(item => collect(item).map(text => [`${name}/${item.slug}`, text] as [string, string]))),
  ...COMPARISONS.flatMap(item => collect(item).map(text => [`compare/${item.slug}`, text] as [string, string])),
  ...collect(FAQ_GROUPS).map(text => ['faq', text] as [string, string]),
  ...collect(CANDIDATE_GUIDE).map(text => ['candidates', text] as [string, string]),
  ...collect(TRUST).map(text => ['trust', text] as [string, string]),
]

function linksIn(text: string): string[] {
  return Array.from(text.matchAll(/\]\((\/[^)\s]*)\)/g), match => match[1])
}

function expectValidTarget(target: string, where: string) {
  const url = new URL(target, 'http://site.test')
  expect(VALID_PATHS.has(url.pathname), `${where}: unknown route ${target}`).toBe(true)
  if (url.pathname === '/contact' && url.search) {
    expect(TOPICS.has(url.searchParams.get('topic') ?? ''), `${where}: unknown topic ${target}`).toBe(true)
  }
}

describe('content order and names', () => {
  it('keeps every collection in the order of the navigation slugs', () => {
    expect(INTEGRATIONS.map(item => item.slug)).toEqual([...INTEGRATION_SLUGS])
    expect(COMPARISONS.map(item => item.slug)).toEqual([...COMPARISON_SLUGS])
  })

  it('names pages the same way in the menus and on the pages', () => {
    expect(INTEGRATIONS.map(item => item.title)).toEqual(INTEGRATION_NAV.map(item => item.label))
    COMPARISONS.forEach((item, i) => {
      expect(COMPARE_NAV[i].label.toLowerCase()).toContain(item.title.toLowerCase().replace(/^a /, ''))
    })
  })
})

describe('explainer pages', () => {
  EXPLAINER_SETS.forEach(([name, items]) => {
    describe(name, () => {
      items.forEach(page => {
        it(`${page.slug} has a complete, well sized page`, () => {
          expect(page.metaTitle.length, 'metaTitle').toBeLessThanOrEqual(60)
          expect(page.metaTitle).not.toMatch(/Hirely/)
          expect(page.metaDescription.length, 'metaDescription').toBeGreaterThanOrEqual(120)
          expect(page.metaDescription.length, 'metaDescription').toBeLessThanOrEqual(160)
          expect(page.headline.trim().length).toBeGreaterThan(0)
          expect(page.accent.trim().length).toBeGreaterThan(0)
          expect(page.lead.trim().length).toBeGreaterThan(40)
          expect([3, 4]).toContain(page.steps.length)
          expect([4, 6]).toContain(page.features.length)
          expect(page.sections.length).toBeGreaterThanOrEqual(1)
          expect(page.sections.length).toBeLessThanOrEqual(3)
          expect(page.faqs.length).toBeGreaterThanOrEqual(3)
          expect(page.faqs.length).toBeLessThanOrEqual(5)
          expect(page.related.length).toBeGreaterThanOrEqual(3)
          expect(page.related.length).toBeLessThanOrEqual(4)
          expect((page.stats ?? []).length).toBeLessThanOrEqual(3)
          expect(page.ctaTitle.split(/\s+/).length).toBeLessThanOrEqual(8)
        })

        it(`${page.slug} uses real icons, unique section ids and valid related pages`, () => {
          expect(isSiteIcon(page.icon), `icon ${page.icon}`).toBe(true)
          page.features.forEach(feature => expect(isSiteIcon(feature.icon), `icon ${feature.icon}`).toBe(true))
          const ids = page.sections.map(section => section.id)
          expect(new Set(ids).size).toBe(ids.length)
          ids.forEach(id => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/))
          page.related.forEach(path => expectValidTarget(path, `${page.slug} related`))
          expect(page.related).not.toContain(`/${name}/${page.slug}`)
        })
      })
    })
  })
})

describe('comparisons', () => {
  COMPARISONS.forEach(page => {
    it(`${page.slug} is fair and complete`, () => {
      expect(page.metaTitle.length).toBeLessThanOrEqual(60)
      expect(page.metaDescription.length).toBeGreaterThanOrEqual(120)
      expect(page.metaDescription.length).toBeLessThanOrEqual(160)
      expect(page.columns).toHaveLength(3)
      expect(page.columns[2]).toBe('Hirely.ai')
      expect(page.rows.length).toBeGreaterThanOrEqual(7)
      expect(page.rows.length).toBeLessThanOrEqual(9)
      page.rows.forEach(row => expect(row).toHaveLength(3))
      expect(page.chooseOther.length).toBeGreaterThanOrEqual(3)
      expect(page.chooseOther.length).toBeLessThanOrEqual(5)
      expect(page.chooseHirely.length).toBeGreaterThanOrEqual(3)
      expect(page.chooseHirely.length).toBeLessThanOrEqual(5)
      expect(page.faqs.length).toBeGreaterThanOrEqual(2)
      expect(page.faqs.length).toBeLessThanOrEqual(3)
      expect(page.related).toHaveLength(3)
      page.related.forEach(path => expectValidTarget(path, `${page.slug} related`))
    })
  })
})

describe('faq, candidate and trust content', () => {
  it('has the six question groups in order', () => {
    expect(FAQ_GROUPS.map(group => group.id)).toEqual([
      'getting-started', 'ai-and-decisions', 'candidates', 'security-and-privacy', 'plans-and-setup', 'integrations',
    ])
    FAQ_GROUPS.forEach(group => {
      expect(group.items.length, group.id).toBeGreaterThanOrEqual(5)
      expect(group.items.length, group.id).toBeLessThanOrEqual(7)
    })
    const questions = FAQ_GROUPS.flatMap(group => group.items.map(item => item.q))
    expect(new Set(questions).size).toBe(questions.length)
  })

  it('gives candidates a journey, guide sections and questions', () => {
    expect(CANDIDATE_GUIDE.steps).toHaveLength(4)
    expect(CANDIDATE_GUIDE.sections.length).toBeGreaterThanOrEqual(5)
    expect(CANDIDATE_GUIDE.sections.length).toBeLessThanOrEqual(6)
    expect(CANDIDATE_GUIDE.faqs.length).toBeGreaterThanOrEqual(6)
    expect(CANDIDATE_GUIDE.faqs.length).toBeLessThanOrEqual(8)
    const ids = CANDIDATE_GUIDE.sections.map(section => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links every trust pillar to a real page', () => {
    expect(TRUST.pillars).toHaveLength(6)
    TRUST.pillars.forEach(pillar => {
      expect(isSiteIcon(pillar.icon)).toBe(true)
      expect(pillar.to, pillar.title).toBeTruthy()
      expectValidTarget(pillar.to as string, `trust ${pillar.title}`)
    })
    expect(TRUST.commitments).toHaveLength(4)
    expect(TRUST.faqs.length).toBeGreaterThanOrEqual(4)
    expect(TRUST.faqs.length).toBeLessThanOrEqual(5)
  })
})

describe('house rules across all copy', () => {
  it('mentions no page that has been removed', () => {
    EVERYTHING.forEach(([where, text]) => {
      expect(text, where).not.toMatch(/\]\(\/(insights|product|solutions)/)
    })
  })

  it('links only to real pages and real contact topics', () => {
    EVERYTHING.forEach(([where, text]) => {
      linksIn(text).forEach(target => expectValidTarget(target, where))
    })
  })

  it('has no em dash, no en dash and no comment markers', () => {
    EVERYTHING.forEach(([where, text]) => {
      expect(text, where).not.toContain(EM_DASH)
      expect(text, where).not.toContain(EN_DASH)
    })
  })

  it('avoids hype words', () => {
    EVERYTHING.forEach(([where, text]) => {
      expect(text, where).not.toMatch(HYPE)
    })
  })

  it('has no prices, contact details, uptime figures or customer claims', () => {
    EVERYTHING.forEach(([where, text]) => {
      expect(text, where).not.toMatch(/[$€£]\s?\d/)
      expect(text, where).not.toMatch(/\bper (user|seat|month)\b.*\d/i)
      expect(text, where).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
      expect(text, where).not.toMatch(/\+\d[\d\s()-]{7,}/)
      expect(text, where).not.toMatch(/\b9\d(\.\d+)?\s?%/)
      expect(text, where).not.toMatch(/trusted by|our customers include|thousands of (companies|teams)/i)
    })
  })

  it('mentions certifications only to say none are claimed', () => {
    EVERYTHING.forEach(([where, text]) => {
      if (CERTIFICATIONS.test(text)) expect(text, where).toMatch(NEGATION)
    })
  })

  it('never claims the platform rejects candidates by itself', () => {
    EVERYTHING.forEach(([where, text]) => {
      expect(text, where).not.toMatch(/automatically (rejects|screens out|eliminates)/i)
    })
  })

  it('never says an admin controls auto-invite or the score thresholds', () => {
    EVERYTHING.forEach(([where, text]) => {
      text.split(/(?<=[.!?])\s+/).filter(sentence => /auto-invite|automatic invit/i.test(sentence)).forEach(sentence => {
        expect(sentence, where).not.toMatch(/\badmin/i)
      })
    })
  })

  it('uses sentence-case page headings', () => {
    const headings = EXPLAINER_SETS.flatMap(([, items]) => items.flatMap(item => [item.stepsTitle, item.featuresTitle, ...item.sections.map(s => s.title)]))
    headings.forEach(heading => {
      const words = heading.split(/\s+/).slice(1).filter(word => /^[A-Z][a-z]+$/.test(word))
      expect(words.length, heading).toBeLessThanOrEqual(2)
    })
  })
})
