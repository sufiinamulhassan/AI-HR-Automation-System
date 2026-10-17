import { describe, expect, it } from 'vitest'
import { h3, isSafeHref, note, ol, p, slugify, table, tokenizeInline, ul } from './blockModel'

describe('tokenizeInline', () => {
  it('keeps plain text as one token', () => {
    expect(tokenizeInline('Just words.')).toEqual([{ kind: 'text', text: 'Just words.' }])
  })

  it('reads bold, code, internal links and external links in order', () => {
    const tokens = tokenizeInline('Read **this** and `that` in [the policy](/privacy) or [the site](https://example.com) now.')
    expect(tokens.map(t => t.kind)).toEqual(['text', 'bold', 'text', 'code', 'text', 'link', 'text', 'link', 'text'])
    expect(tokens[1]).toEqual({ kind: 'bold', text: 'this' })
    expect(tokens[3]).toEqual({ kind: 'code', text: 'that' })
    expect(tokens[5]).toEqual({ kind: 'link', text: 'the policy', href: '/privacy' })
    expect(tokens[7]).toEqual({ kind: 'link', text: 'the site', href: 'https://example.com' })
  })

  it('accepts mailto links and in-page anchors', () => {
    const tokens = tokenizeInline('[mail us](mailto:hi@example.com) or [jump](#top)')
    expect(tokens.filter(t => t.kind === 'link').map(t => (t as { href: string }).href)).toEqual(['mailto:hi@example.com', '#top'])
  })

  it('never turns an unsafe address into a link', () => {
    const tokens = tokenizeInline('[click](javascript:alert) and [plain](http://example.com) and [proto](//evil.example)')
    expect(tokens.some(t => t.kind === 'link')).toBe(false)
    expect(tokens.map(t => t.text).join('')).toContain('click')
  })

  it('leaves unfinished markers as text', () => {
    expect(tokenizeInline('a **b and `c')).toEqual([{ kind: 'text', text: 'a **b and `c' }])
  })

  it('does not treat an empty marker pair as bold', () => {
    expect(tokenizeInline('****')).toEqual([{ kind: 'text', text: '****' }])
  })
})

describe('isSafeHref', () => {
  it.each(['/', '/privacy', '/contact?topic=sales', 'https://example.com', 'mailto:a@b.co', '#top'])('allows %s', href => {
    expect(isSafeHref(href)).toBe(true)
  })

  it.each(['http://example.com', '//evil.example', '/\\evil', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x', ''])('refuses %s', href => {
    expect(isSafeHref(href)).toBe(false)
  })
})

describe('slugify', () => {
  it('makes a url safe id', () => {
    expect(slugify('Your rights & how to use them')).toBe('your-rights-how-to-use-them')
    expect(slugify('  --Hello, World!--  ')).toBe('hello-world')
  })
})

describe('block constructors', () => {
  it('build the matching block shapes', () => {
    expect(p('a')).toEqual({ type: 'p', text: 'a' })
    expect(h3('b')).toEqual({ type: 'h3', text: 'b' })
    expect(ul(['x', 'y'])).toEqual({ type: 'ul', items: ['x', 'y'] })
    expect(ol(['x'])).toEqual({ type: 'ol', items: ['x'] })
    expect(note('n')).toEqual({ type: 'note', text: 'n' })
    expect(table(['h'], [['r']], 'cap')).toEqual({ type: 'table', head: ['h'], rows: [['r']], caption: 'cap' })
  })
})
