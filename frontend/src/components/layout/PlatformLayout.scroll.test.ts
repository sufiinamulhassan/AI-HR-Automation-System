import { beforeAll, describe, expect, it } from 'vitest'

declare const process: { cwd(): string }

let css = ''

beforeAll(async () => {
  const fs = await import('node:fs')
  css = `
${fs.readFileSync(`${process.cwd()}/src/components/layout/PlatformLayout.css`, 'utf8')}`
})

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} is styled`).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('the platform console page does not over-scroll', () => {
  it('reads the stylesheet (a blank read would make the checks below pass for nothing)', () => {
    expect(css.length).toBeGreaterThan(1000)
  })

  it('clips its own overflow at the viewport height', () => {
    const shell = rule('.plat-shell')
    expect(shell).toMatch(/height:\s*100vh/)
    expect(shell).toMatch(/overflow:\s*hidden/)
  })

  it('positions the shell and the scrolling panel, so a hidden absolutely placed child stays inside them', () => {
    expect(rule('.plat-shell')).toMatch(/position:\s*relative/)
    expect(rule('.plat-main')).toMatch(/position:\s*relative/)
  })

  it('scrolls the panel, not the page', () => {
    expect(rule('.plat-main')).toMatch(/overflow-y:\s*auto/)
  })
})
