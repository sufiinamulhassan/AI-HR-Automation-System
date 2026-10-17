import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const EM_DASH = String.fromCharCode(0x2014)
const ENTITY = /&mdash;|&#8212;|&#x2014;/i

const files = import.meta.glob(
  ['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/test/**'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const offends = (text: string) => text.includes(EM_DASH) || ENTITY.test(text)

function codeViolations(file: string, source: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    if (isText && offends(node.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      const shown = node.text.split('\n').find(offends)!.trim().slice(0, 90)
      found.push(`${file}:${line + 1}: ${shown}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function cssViolations(file: string, source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  return stripped
    .split('\n')
    .flatMap((line, i) => (offends(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 90)}`] : []))
}

declare const process: { cwd(): string }

async function readStylesheets(): Promise<Record<string, string>> {
  const fs = await import('node:fs')
  const srcDir = `${process.cwd()}/src`
  const out: Record<string, string> = {}
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        walk(next, `${rel}${entry.name}/`)
      } else if (entry.name.endsWith('.css')) {
        out[`/src/${rel}${entry.name}`] = fs.readFileSync(next, 'utf8')
      }
    }
  }
  walk(srcDir.replace(/[\\/]+$/, ''), '')
  return out
}

describe('writing rule: no em dash in anything shown', () => {
  it('scans the app source', async () => {
    expect(Object.keys(files).length).toBeGreaterThan(50)
    expect(Object.keys(await readStylesheets()).length).toBeGreaterThan(50)
  })

  it('has no em dash in any string or JSX text', () => {
    const found = Object.entries(files).flatMap(([file, source]) => codeViolations(file, source))
    expect(found, `Rewrite these sentences:\n${found.join('\n')}`).toEqual([])
  })

  it('has no em dash in any CSS content', async () => {
    const found = Object.entries(await readStylesheets()).flatMap(([file, source]) =>
      cssViolations(file, source),
    )
    expect(found, `Rewrite these rules:\n${found.join('\n')}`).toEqual([])
  })
})
