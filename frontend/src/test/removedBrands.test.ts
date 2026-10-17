import { describe, expect, it } from 'vitest'

const files = import.meta.glob(
  ['/src/**/*.{ts,tsx,css}', '!/src/test/removedBrands.test.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const PARENT_BRAND = new RegExp(['xo', 'vo'].join(''), 'i')
const DEMO_PHRASES = /book(ing)? a demo|request a demo|ask for a demo|demo request|\/demo\b|topic=demo/i

const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file)

describe('removed from the website and the repo', () => {
  it('scans the whole source tree', () => {
    expect(Object.keys(files).length).toBeGreaterThan(200)
  })

  it('mentions no parent company, its address or its links anywhere', () => {
    const found = Object.entries(files).flatMap(([file, source]) =>
      source.split('\n').flatMap((line, i) => (PARENT_BRAND.test(line) ? [`${file}:${i + 1}`] : [])),
    )
    expect(found, found.join('\n')).toEqual([])
  })

  it('has no book a demo or request a demo wording or links in the app', () => {
    const found = Object.entries(files)
      .filter(([file]) => !isTest(file))
      .flatMap(([file, source]) =>
        source.split('\n').flatMap((line, i) => (DEMO_PHRASES.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 80)}`] : [])),
      )
    expect(found, found.join('\n')).toEqual([])
  })
})
