import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { CostBars, GrowthChart } from './PlatformCharts'

declare const process: { cwd(): string }

describe('CostBars', () => {
  it('says "1 call" for one and "calls" for the rest, in the row and in its label', () => {
    render(<CostBars rows={[
      { source: 'interview_tts', cost_usd: 0.0047, calls: 2 },
      { source: 'interview_evaluation', cost_usd: 0.0039, calls: 1 },
      { source: 'offer_letter', cost_usd: 0, calls: 0 },
    ]} />)
    expect(screen.getByText('2 calls')).toBeInTheDocument()
    expect(screen.getByText('1 call')).toBeInTheDocument()
    expect(screen.getByText('0 calls')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'interview evaluation: $0.0039 over 1 call' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'interview tts: $0.0047 over 2 calls' })).toBeInTheDocument()
  })

  it('names the estimated email line and counts it in emails, not calls', () => {
    render(<CostBars rows={[
      { source: 'job_parse', cost_usd: 0.3022, calls: 55 },
      { source: 'email_estimated', cost_usd: 0.0009, calls: 9, unit: 'emails' },
      { source: 'single', cost_usd: 0.0001, calls: 1, unit: 'emails' },
    ]} />)
    expect(screen.getByText('email (estimated)')).toBeInTheDocument()
    expect(screen.getByText('9 emails')).toBeInTheDocument()
    expect(screen.getByText('1 email')).toBeInTheDocument()
    expect(screen.getByText('55 calls')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'email (estimated): $0.0009 over 9 emails' })).toBeInTheDocument()
  })
})

describe('GrowthChart hidden data table', () => {
  const points = [
    { month: '2026-08', clients: 1, companies: 2 },
    { month: '2026-09', clients: 2, companies: 3 },
    { month: '2026-10', clients: 3, companies: 5 },
  ]
  let css = ''

  beforeAll(async () => {
    const fs = await import('node:fs')
    css = fs.readFileSync(`${process.cwd()}/src/pages/platform/PlatformUi.css`, 'utf8')
  })

  it('keeps the table for screen readers inside a clipped box, never as the clipped element itself', () => {
    const { container } = render(<GrowthChart points={points} />)
    const table = screen.getByRole('table', { name: 'Clients and companies per month' })
    expect(table.classList.contains('pco-sr')).toBe(false)
    expect(table.closest('.pco-sr')).not.toBeNull()
    expect(container.querySelectorAll('table.pco-sr')).toHaveLength(0)
  })

  it('clips that box to one pixel, so its rows cannot make the page scroll further than its content', () => {
    const at = css.indexOf('\n.pco-sr {')
    expect(at).toBeGreaterThanOrEqual(0)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/width:\s*1px/)
    expect(rule).toMatch(/height:\s*1px/)
    expect(rule).toMatch(/overflow:\s*hidden/)
  })
})
