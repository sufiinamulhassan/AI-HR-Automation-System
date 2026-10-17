export type Block =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][]; caption?: string }
  | { type: 'note'; text: string }

export interface DocSection {
  id: string
  title: string
  blocks: Block[]
}

export interface LegalDoc {
  slug: string
  title: string
  description: string
  intro: string
  sections: DocSection[]
  related: string[]
}

export const p = (text: string): Block => ({ type: 'p', text })
export const h3 = (text: string): Block => ({ type: 'h3', text })
export const ul = (items: string[]): Block => ({ type: 'ul', items })
export const ol = (items: string[]): Block => ({ type: 'ol', items })
export const note = (text: string): Block => ({ type: 'note', text })
export const table = (head: string[], rows: string[][], caption?: string): Block => ({ type: 'table', head, rows, caption })

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/

export function isSafeHref(href: string): boolean {
  return /^(\/[^/\\]|\/$|https:\/\/|mailto:|#)/.test(href)
}

export function tokenizeInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = []
  for (const part of source.split(INLINE)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      tokens.push({ kind: 'bold', text: part.slice(2, -2) })
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      tokens.push({ kind: 'code', text: part.slice(1, -1) })
    } else {
      const link = LINK.exec(part)
      if (link && isSafeHref(link[2])) tokens.push({ kind: 'link', text: link[1], href: link[2] })
      else if (link) tokens.push({ kind: 'text', text: link[1] })
      else tokens.push({ kind: 'text', text: part })
    }
  }
  return tokens
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
