import { describe, expect, it } from 'vitest'

declare const process: { cwd(): string }

const fs = await import('node:fs')

function find(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      const inner = find(next, name)
      if (inner) return inner
    } else if (entry.name === name) {
      return next
    }
  }
  return null
}

function read(name: string): string {
  const path = find(`${process.cwd()}/src`, name)
  expect(path, name).not.toBeNull()
  return fs.readFileSync(path as string, 'utf8').split(String.fromCharCode(13)).join('')
}

const dropdownCss = read('FilterDropdown.css')
const filtersCss = read('ResumeFilters.css')
const foldersCss = read('ResumeFolders.css')
const savedCss = read('SavedSearches.css')

const REM = 16

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(found, `rule ${selector}`).not.toBeNull()
  return found![1]
}

function declared(css: string, selector: string, property: string): string {
  const found = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(rule(css, selector))
  expect(found, `${selector} ${property}`).not.toBeNull()
  return found![1].trim()
}

function px(value: string): number {
  const n = parseFloat(value)
  return value.endsWith('rem') ? n * REM : n
}

function token(name: string): number {
  const found = new RegExp(`${name}:\\s*([^;]+);`).exec(rule(filtersCss, '.rf'))
  expect(found, name).not.toBeNull()
  return px(found![1].trim())
}

describe('compact toolbar sizing', () => {
  it('sets the control height to 30px, the text to 12px and the gap to 6px', () => {
    expect(token('--rf-h')).toBe(30)
    expect(token('--rf-font')).toBe(12)
    expect(token('--rf-gap')).toBe(6)
  })

  it('keeps the horizontal padding between 10px and 12px', () => {
    expect(token('--rf-pad-x')).toBeGreaterThanOrEqual(10)
    expect(token('--rf-pad-x')).toBeLessThanOrEqual(12)
  })

  it('sizes every filter control from the same height', () => {
    for (const selector of ['.rf-pill', '.rf-more', '.rf-range', '.rf-worked', '.rf-search-input', '.rf-panel-head']) {
      expect(declared(filtersCss, selector, 'min-height'), selector).toBe('var(--rf-h)')
    }
    expect(declared(dropdownCss, '.fd-btn', 'min-height')).toBe('var(--rf-h, 1.875rem)')
  })

  it('uses the 12px token for the text of the buttons', () => {
    for (const selector of ['.rf-pill', '.rf-more', '.rf-seg-btn', '.rf-range-input', '.rf-worked']) {
      expect(declared(filtersCss, selector, 'font-size'), selector).toBe('var(--rf-font)')
    }
    expect(declared(dropdownCss, '.fd-btn', 'font-size')).toBe('var(--rf-font, .75rem)')
    expect(declared(dropdownCss, '.fd-btn', 'text-transform')).toBe('uppercase')
  })

  it('makes the segmented control 30px tall with 28px buttons', () => {
    expect(px(declared(filtersCss, '.rf-seg-btn', 'min-height'))).toBe(28)
    expect(declared(filtersCss, '.rf-seg', 'border')).toBe('1px solid var(--gray-300)')
  })

  it('never lets a control drop below 28px, on touch screens either', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(filtersCss)
    expect(coarse).not.toBeNull()
    const height = /--rf-h:\s*([^;]+);/.exec(coarse![1])
    expect(px(height![1].trim())).toBeGreaterThanOrEqual(28)
    const heights = [...(filtersCss + dropdownCss + savedCss).matchAll(/min-height:\s*([\d.]+rem)/g)].map(m => px(m[1]))
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(28)
  })

  it('keeps the dropdown and saved search lists compact as well', () => {
    expect(px(declared(dropdownCss, '.fd-opt', 'min-height'))).toBeLessThanOrEqual(30)
    expect(px(declared(dropdownCss, '.fd-opt', 'font-size'))).toBe(12)
    expect(px(declared(savedCss, '.ss-apply', 'min-height'))).toBeLessThanOrEqual(30)
  })
})

describe('compact folder tiles', () => {
  it('uses a dense grid with tiles 150px to 180px wide at least', () => {
    const columns = declared(foldersCss, '.rfo-grid,\n.rfo-skeleton', 'grid-template-columns')
    const min = /minmax\(([\d.]+rem),/.exec(columns)
    expect(px(min![1])).toBeGreaterThanOrEqual(150)
    expect(px(min![1])).toBeLessThanOrEqual(180)
  })

  it('uses 10 to 12px padding, a 13px name, a 20px count and 11px role chips', () => {
    expect(px(declared(foldersCss, '.rfo-tile', 'padding'))).toBeGreaterThanOrEqual(10)
    expect(px(declared(foldersCss, '.rfo-tile', 'padding'))).toBeLessThanOrEqual(12)
    expect(px(declared(foldersCss, '.rfo-name', 'font-size'))).toBe(13)
    expect(px(declared(foldersCss, '.rfo-count', 'font-size'))).toBe(20)
    expect(px(declared(foldersCss, '.rfo-role', 'font-size'))).toBe(11)
  })

  it('puts two tiles across on a phone', () => {
    expect(foldersCss).toMatch(/@media \(max-width: 480px\) \{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/)
  })
})

describe('narrow screens and reading order', () => {
  it('lets the dropdown lists fill the row on a phone so they cannot run off the screen', () => {
    expect(dropdownCss).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.fd \{ position: static; \}/)
    expect(filtersCss).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.rf-row \{ position: relative; \}/)
    expect(savedCss).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.ss \{ position: static; \}/)
  })

  it('never reorders anything with CSS, so the tab order is the reading order at every width', () => {
    for (const css of [filtersCss, dropdownCss, savedCss, foldersCss]) {
      expect(css).not.toMatch(/(^|[\s;{])order\s*:/)
      expect(css).not.toMatch(/row-reverse|column-reverse/)
    }
  })

  it('honours reduced motion', () => {
    for (const css of [filtersCss, dropdownCss, savedCss, foldersCss]) {
      expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    }
  })

  it('has no comments and no em dash', () => {
    for (const css of [filtersCss, dropdownCss, savedCss, foldersCss]) {
      expect(css).not.toContain(String.fromCharCode(47, 42))
      expect(css).not.toContain(String.fromCharCode(0x2014))
    }
  })

  it('keeps text white on the solid blue controls', () => {
    expect(declared(filtersCss, '.rf-seg-on', 'color')).toBe('#fff')
    expect(declared(filtersCss, '.rf-badge', 'color')).toBe('#fff')
    expect(declared(dropdownCss, '.fd-check-on', 'color')).toBe('#fff')
    expect(filtersCss).toMatch(/\.rf-pill-on \.rf-state \{ background: var\(--primary\); color: #fff; \}/)
  })
})
