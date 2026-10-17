import { describe, expect, it } from 'vitest'
import { tokenizeInline, type Block, type LegalDoc } from '../../components/site/blockModel'
import { CONTACT_TOPICS, LEGAL_LINKS, PUBLIC_PATHS, SITE } from '../../lib/site'
import { LEGAL_DOCS } from './docs'

const DOCS = Object.entries(LEGAL_DOCS)
const KNOWN = new Set([...PUBLIC_PATHS, '/login', '/careers'])
const TOPICS = new Set<string>(CONTACT_TOPICS.map(t => t.value))
const EM_DASH = String.fromCharCode(0x2014)

function blockStrings(block: Block): string[] {
  switch (block.type) {
    case 'p':
    case 'h3':
    case 'note':
      return [block.text]
    case 'ul':
    case 'ol':
      return block.items
    case 'table':
      return [...block.head, ...block.rows.flat(), ...(block.caption ? [block.caption] : [])]
  }
}

function allStrings(doc: LegalDoc): string[] {
  return [doc.title, doc.description, doc.intro, ...doc.sections.flatMap(s => [s.title, ...s.blocks.flatMap(blockStrings)])]
}

const textOf = (doc: LegalDoc) => allStrings(doc).join('\n')

describe('legal documents: registry', () => {
  it('has all eight documents, keyed by the page address', () => {
    expect(Object.keys(LEGAL_DOCS).sort()).toEqual(LEGAL_LINKS.map(l => l.to.slice(1)).sort())
  })

  it.each(DOCS)('%s uses its own slug and the title shown in the footer', (key, doc) => {
    expect(doc.slug).toBe(key)
    expect(LEGAL_LINKS.find(l => l.to === `/${key}`)?.label).toBe(doc.title)
  })
})

describe.each(DOCS)('legal document %s', (_key, doc) => {
  it('has a clear description and introduction', () => {
    expect(doc.description.length).toBeGreaterThan(60)
    expect(doc.description.length).toBeLessThan(160)
    expect(doc.intro.trim().length).toBeGreaterThan(40)
  })

  it('is substantial and every section has content', () => {
    expect(doc.sections.length).toBeGreaterThanOrEqual(5)
    doc.sections.forEach(section => {
      expect(section.title.trim(), section.id).not.toBe('')
      expect(section.blocks.length, section.id).toBeGreaterThan(0)
    })
  })

  it('has unique, address-safe section ids', () => {
    const ids = doc.sections.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach(id => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/))
  })

  it('keeps every table rectangular', () => {
    doc.sections.flatMap(s => s.blocks).forEach(block => {
      if (block.type !== 'table') return
      expect(block.head.length).toBeGreaterThan(1)
      block.rows.forEach(row => expect(row).toHaveLength(block.head.length))
    })
  })

  it('has no empty list items, paragraphs or cells', () => {
    allStrings(doc).forEach(text => expect(text.trim()).not.toBe(''))
  })

  it('links only to real pages and real contact topics', () => {
    const hrefs = allStrings(doc)
      .flatMap(text => tokenizeInline(text))
      .flatMap(token => (token.kind === 'link' ? [token.href] : []))
    expect(hrefs.length).toBeGreaterThan(0)
    hrefs.filter(h => h.startsWith('/')).forEach(href => {
      const url = new URL(href, 'http://site.test')
      expect(KNOWN.has(url.pathname), `unknown page ${href}`).toBe(true)
      if (url.pathname === '/contact' && url.search) expect(TOPICS.has(url.searchParams.get('topic') ?? ''), href).toBe(true)
    })
  })

  it('relates only to other legal documents', () => {
    const legal = LEGAL_LINKS.map(l => l.to)
    expect(doc.related.length).toBeGreaterThan(0)
    doc.related.forEach(to => {
      expect(legal).toContain(to)
      expect(to).not.toBe(`/${doc.slug}`)
    })
  })

  it('follows the writing rules and invents nothing we have not published', () => {
    const text = textOf(doc)
    expect(text).not.toContain(EM_DASH)
    expect(text).not.toMatch(/\bSOC ?2\b|ISO ?27001|HIPAA|PCI[- ]DSS/i)
    expect(text).not.toMatch(/\b9\d(\.\d+)?\s?% (uptime|availability)/i)
    const allowed = [SITE.contactEmail, SITE.privacyEmail, SITE.securityEmail].filter(Boolean).map(email => email.toLowerCase())
    ;(text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? []).forEach(email => expect(allowed).toContain(email.toLowerCase()))
    expect(text).not.toMatch(/\btemplate\b/i)
  })
})

describe('legal documents: auto-invite', () => {
  it('is never described as something a company administrator controls', () => {
    Object.values(LEGAL_DOCS).forEach(doc => {
      textOf(doc).split(/(?<=[.!?])\s+/).filter(sentence => /auto-invite|automatic (interview )?invit/i.test(sentence)).forEach(sentence => {
        expect(sentence, doc.slug).not.toMatch(/\badministrator|\badmin\b/i)
      })
    })
  })

  it('is described as off by default in the privacy policy and the terms', () => {
    expect(textOf(LEGAL_DOCS.privacy)).toMatch(/auto-invite[\s\S]{0,200}off by default|off by default[\s\S]{0,200}auto-invite/i)
    expect(textOf(LEGAL_DOCS.terms)).toMatch(/auto-invite[\s\S]{0,200}off by default/i)
  })
})

describe('legal documents: facts that must stay true', () => {
  const text = (key: string) => textOf(LEGAL_DOCS[key])

  it('terms explain plans, AI outputs and refer to the contact form', () => {
    expect(LEGAL_DOCS.terms.sections.length).toBeGreaterThanOrEqual(14)
    expect(text('terms')).toMatch(/AI budget|AI usage/i)
    expect(text('terms')).toContain('/responsible-ai')
    expect(text('terms')).toContain('/dpa')
    expect(text('terms')).toContain('(/contact')
  })

  it('the privacy policy and candidate notice state that no video is recorded or stored', () => {
    expect(text('candidate-privacy')).toMatch(/not record or store video/i)
    expect(text('privacy')).toContain('/responsible-ai')
    expect(text('privacy')).toContain('/subprocessors')
    expect(text('privacy')).toContain('/cookies')
  })

  it('the cookie policy lists what the app really stores and no tracking', () => {
    const cookies = text('cookies')
    expect(cookies).toContain('hr-bot-auth')
    expect(cookies).toContain('hr-bot-upload')
    expect(cookies).toContain('hr_oidc_binding')
    expect(cookies).not.toContain('`theme`')
    expect(cookies).toMatch(/no (advertising|analytics)|not use (advertising|analytics)|strictly necessary/i)
  })

  it('the subprocessor list names every provider the product sends data to', () => {
    const list = text('subprocessors')
    ;['Vercel', 'MongoDB', 'Pinecone', 'OpenAI', 'Anthropic', 'Amazon SES', 'Judge0', 'Piston'].forEach(name => {
      expect(list, name).toContain(name)
    })
  })

  it('the processing addendum points to the subprocessor list and the terms', () => {
    expect(text('dpa')).toContain('/subprocessors')
    expect(text('dpa')).toContain('/terms')
  })

  it('the accessibility statement sets a target without claiming conformance', () => {
    const statement = text('accessibility')
    expect(statement).toMatch(/WCAG 2\.2/)
    expect(statement).not.toMatch(/fully conform|is conformant|certified/i)
  })

  it('the acceptable use policy covers candidates as well as customers', () => {
    expect(text('acceptable-use')).toMatch(/candidate/i)
    expect(text('acceptable-use')).toContain('/contact?topic=security')
  })
})
