import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import CostOverview, { type CostCategory, type CostSummary } from './CostOverview'

declare const process: { cwd(): string }

const AREAS: CostCategory[] = [
  { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.48, calls: 200, items: 200, avg_item_usd: 0.0024 },
  { key: 'interviews', label: 'Interviews', cost_usd: 0.3, calls: 12 },
  { key: 'reports', label: 'Report generation', cost_usd: 0.0117, calls: 3, items: 3, avg_item_usd: 0.0039 },
  { key: 'voice', label: 'Interview voice', cost_usd: 0.4, calls: 8 },
  { key: 'job_descriptions', label: 'Job descriptions', cost_usd: 0.05, calls: 1 },
  { key: 'coding', label: 'Coding assessments', cost_usd: 0.0, calls: 0 },
  { key: 'offers', label: 'Offers', cost_usd: 0.02, calls: 3 },
  { key: 'matching', label: 'Matching', cost_usd: 0.0004, calls: 2 },
  { key: 'email', label: 'Email', cost_usd: 0.2345, calls: 2345 },
  { key: 'other', label: 'Other', cost_usd: 0.0, calls: 0 },
]

const READY: CostSummary = {
  status: 'ready',
  total_cost_usd: 1.4966,
  categories: AREAS,
  llm: { total_cost_usd: 0.85, total_calls: 218, prompt_tokens: 120000, completion_tokens: 45000, embedding_tokens: 2_500_000, by_feature: {} },
  email: { estimated_cost_usd: 0.2345, sent_count: 2345, cost_per_email_usd: 0.0001, note: 'Estimated from a configurable per-email cost.' },
  voice: {
    estimated_cost_usd: 0.4,
    tts: { cost_usd: 0.1, calls: 3, characters: 1200 },
    stt: { cost_usd: 0.3, calls: 5, duration_minutes: 12.5, estimated_calls: 2 },
    note: 'TTS cost is approximated.',
  },
  code_execution: { trackable: false, note: 'Judge0/Piston usage is not currently cost-trackable.' },
}

const area = (key: string) => document.querySelector(`[data-area="${key}"]`) as HTMLElement

describe('the overall price', () => {
  it('is one widget with the total, and the totals that explain it', () => {
    render(<CostOverview summary={READY} />)
    const total = screen.getByLabelText('Total cost')
    expect(within(total).getByText('Total cost')).toBeInTheDocument()
    expect(total).toHaveTextContent('$1.50USD est.')
    const stat = (label: string) => within(total).getByText(label).closest('.dv-spend-stat') as HTMLElement
    expect(stat('Avg / Résumé')).toHaveTextContent('$0.0024')
    expect(stat('Résumés')).toHaveTextContent('200')
    expect(stat('AI calls')).toHaveTextContent('218')
    expect(stat('Prompt')).toHaveTextContent('120.0K')
    expect(stat('Completion')).toHaveTextContent('45.0K')
    expect(stat('Embedding')).toHaveTextContent('2.5M')
  })

  it('prints four decimals under a dollar, so a small spend does not round away', () => {
    render(<CostOverview summary={{ ...READY, total_cost_usd: 0.0123, categories: [] }} />)
    expect(screen.getByLabelText('Total cost')).toHaveTextContent('$0.0123')
  })
})

describe('the price of each area', () => {
  it('has one card per active area, in order, each with its own price', () => {
    render(<CostOverview summary={READY} />)
    const titles = Array.from(document.querySelectorAll('.cst-card .cst-card-title')).map(e => e.textContent)
    expect(titles).toEqual([
      'Résumé parsing', 'Interviews', 'Report generation', 'Interview voice', 'Job descriptions',
      'Offers', 'Matching', 'Email',
    ])
    const price = (key: string) => area(key).querySelector('.cst-price')?.textContent
    expect(price('resume_parsing')).toBe('$0.4800')
    expect(price('interviews')).toBe('$0.3000')
    expect(price('reports')).toBe('$0.0117')
    expect(price('voice')).toBe('$0.4000')
    expect(area('coding')).toBeNull()
    expect(price('email')).toBe('$0.2345')
  })

  it('says what the money bought under each price', () => {
    render(<CostOverview summary={READY} />)
    const detail = (key: string) => area(key).querySelector('.cst-detail')?.textContent
    expect(detail('resume_parsing')).toBe('200 résumés · $0.0024 each')
    expect(detail('interviews')).toBe('12 AI calls')
    expect(detail('reports')).toBe('3 reports · $0.0039 each')
    expect(detail('job_descriptions')).toBe('1 AI call')
    expect(detail('voice')).toBe('3 TTS · 5 STT (12.5 min)')
    expect(detail('email')).toBe('2,345 emails sent · $0.0001 / email')
  })

  it('falls back to the call count for résumé parsing when no résumé was counted, and to voice calls without a voice section', () => {
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.01, calls: 4, items: 0, avg_item_usd: 0 }
    const voice: CostCategory = { key: 'voice', label: 'Interview voice', cost_usd: 0.1, calls: 1 }
    render(<CostOverview summary={{ ...READY, voice: undefined, categories: [parsing, voice] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('4 AI calls')
    expect(area('voice').querySelector('.cst-detail')?.textContent).toBe('1 voice call')
  })

  it('shows one report in the singular, and falls back to the call count when no report was counted', () => {
    const one: CostCategory = { key: 'reports', label: 'Report generation', cost_usd: 0.0039, calls: 1, items: 1, avg_item_usd: 0.0039 }
    const none: CostCategory = { key: 'reports', label: 'Report generation', cost_usd: 0.0002, calls: 2, items: 0, avg_item_usd: 0 }
    const { rerender } = render(<CostOverview summary={{ ...READY, categories: [one] }} />)
    expect(area('reports').querySelector('.cst-detail')?.textContent).toBe('1 report · $0.0039 each')
    rerender(<CostOverview summary={{ ...READY, categories: [none] }} />)
    expect(area('reports').querySelector('.cst-detail')?.textContent).toBe('2 AI calls')
  })

  it('shows one résumé in the singular', () => {
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.0024, calls: 1, items: 1, avg_item_usd: 0.0024 }
    render(<CostOverview summary={{ ...READY, categories: [parsing] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('1 résumé · $0.0024 each')
  })

  it('keeps enough digits on a very small average for it to multiply back to the price', () => {
    const total = 0.0202
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: total, calls: 77, items: 77 }
    render(<CostOverview summary={{ ...READY, categories: [parsing] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('77 résumés · $0.000262 each')
    expect(screen.getByLabelText('Total cost')).toHaveTextContent('$0.000262')
    expect(77 * 0.000262).toBeCloseTo(total, 3)
  })

  it('works the average out from the price and the count on the card, ignoring any average the server sent', () => {
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.6, calls: 300, items: 300, avg_item_usd: 0.5 }
    const report: CostCategory = { key: 'reports', label: 'Report generation', cost_usd: 0.012, calls: 6, items: 6, avg_item_usd: 9 }
    const { rerender } = render(<CostOverview summary={{ ...READY, categories: [parsing, report] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('300 résumés · $0.0020 each')
    expect(area('reports').querySelector('.cst-detail')?.textContent).toBe('6 reports · $0.0020 each')
    expect(screen.getByLabelText('Total cost').querySelector('.dv-spend-stat-key b')?.textContent).toBe('$0.0020')
    rerender(<CostOverview summary={{ ...READY, categories: [{ ...parsing, cost_usd: 0.9, items: 450, calls: 450 }, report] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('450 résumés · $0.0020 each')
    rerender(<CostOverview summary={{ ...READY, categories: [{ ...parsing, cost_usd: 0.9, items: 300, calls: 300 }, report] }} />)
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('300 résumés · $0.0030 each')
    expect(screen.getByLabelText('Total cost').querySelector('.dv-spend-stat-key b')?.textContent).toBe('$0.0030')
  })

  it('shows zero rather than dividing by nothing when no résumé was counted', () => {
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.01, calls: 4, items: 0 }
    render(<CostOverview summary={{ ...READY, categories: [parsing] }} />)
    expect(screen.getByLabelText('Total cost').querySelector('.dv-spend-stat-key b')?.textContent).toBe('$0.0000')
    expect(area('resume_parsing').querySelector('.cst-detail')?.textContent).toBe('4 AI calls')
  })

  it.each([
    [0.0024, '$0.0024'],
    [0.001, '$0.0010'],
    [0.00099, '$0.00099'],
    [0.000262337, '$0.000262'],
    [0.0001, '$0.0001'],
    [0.0000005, '$0.0000005'],
    [0, '$0.0000'],
  ])('prints an average of %s as %s', (avg, shown) => {
    const parsing: CostCategory = { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: avg, calls: 1, items: 1 }
    render(<CostOverview summary={{ ...READY, categories: [parsing] }} />)
    expect(screen.getByLabelText('Total cost').querySelector('.dv-spend-stat-key b')?.textContent).toBe(shown)
  })

  it("shows each area's share of the total, with a bar as wide", () => {
    render(<CostOverview summary={READY} />)
    const share = (key: string) => area(key).querySelector('.cst-share')?.textContent
    expect(share('resume_parsing')).toBe('32%')
    expect(share('voice')).toBe('27%')
    expect(share('matching')).toBe('<1%')
    const bar = (key: string) => (area(key).querySelector('.cst-bar span') as HTMLElement).style.width
    expect(bar('resume_parsing')).toMatch(/^32\.07/)
    expect(parseFloat(bar('matching'))).toBeGreaterThanOrEqual(1)
  })

  it('shows 0% for everything while nothing has been spent, once all areas are shown', async () => {
    render(<CostOverview summary={{ ...READY, total_cost_usd: 0, categories: AREAS.map(a => ({ ...a, cost_usd: 0, calls: 0 })) }} />)
    expect(screen.getByText('No AI spend recorded yet.')).toBeInTheDocument()
    expect(document.querySelector('.cst-card')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 9 areas' }))
    expect(Array.from(document.querySelectorAll('.cst-share')).every(e => e.textContent === '0%')).toBe(true)
  })

  it('hides an area with no spend and no calls until Show all is pressed, and hides it again after', async () => {
    const user = userEvent.setup()
    render(<CostOverview summary={READY} />)
    expect(area('coding')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show all 9 areas' }))
    expect(area('coding').querySelector('.cst-price')?.textContent).toBe('$0.0000')
    expect(area('coding').querySelector('.cst-share')?.textContent).toBe('0%')
    expect((area('coding').querySelector('.cst-bar span') as HTMLElement).style.width).toBe('0%')
    await user.click(screen.getByRole('button', { name: 'Show active areas only' }))
    expect(area('coding')).toBeNull()
  })

  it('offers no toggle when every area is active', () => {
    render(<CostOverview summary={{ ...READY, categories: AREAS.filter(a => a.cost_usd > 0) }} />)
    expect(screen.queryByRole('button', { name: /Show/ })).not.toBeInTheDocument()
  })

  it('keeps Other off the page until something lands in it, then shows it like the rest', () => {
    const { rerender } = render(<CostOverview summary={READY} />)
    expect(area('other')).toBeNull()

    rerender(<CostOverview summary={{ ...READY, categories: AREAS.map(a => (a.key === 'other' ? { ...a, cost_usd: 0.25, calls: 3 } : a)) }} />)
    expect(area('other').querySelector('.cst-price')?.textContent).toBe('$0.2500')
    expect(area('other').querySelector('.cst-detail')?.textContent).toBe('3 AI calls')
  })

  it('shows Other when it has calls but the spend rounds to nothing', () => {
    render(<CostOverview summary={{ ...READY, categories: AREAS.map(a => (a.key === 'other' ? { ...a, cost_usd: 0, calls: 2 } : a)) }} />)
    expect(area('other')).not.toBeNull()
  })
})

describe('when the server has no figures to show', () => {
  it('shows the server note in one small card, and no prices, for a status that is not ready', () => {
    render(<CostOverview summary={{ ...READY, status: 'insufficient_data', note: 'No AI usage has been cost-tracked yet, or you do not have the `cost:read` permission required to view this section.', categories: [] }} />)
    expect(screen.getByRole('heading', { name: 'Cost' })).toBeInTheDocument()
    expect(screen.getByText(/No AI usage has been cost-tracked yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Total cost')).not.toBeInTheDocument()
    expect(document.querySelector('.cst-card')).toBeNull()
  })

  it('says the figures are not available yet when the server gave no note', () => {
    render(<CostOverview summary={{ ...READY, status: 'insufficient_data', note: undefined }} />)
    expect(screen.getByText("Cost data isn't available yet.")).toBeInTheDocument()
  })

  it('shows the overall price alone for an answer from a server that sends no areas', () => {
    const { categories: _omitted, ...older } = READY
    render(<CostOverview summary={older as CostSummary} />)
    expect(screen.getByLabelText('Total cost')).toHaveTextContent('$1.50')
    expect(document.querySelector('.cst-card')).toBeNull()
  })
})

describe('writing rules', () => {
  it('shows labels, prices and what they bought only: no notes, no captions, no em dash', () => {
    const { container } = render(<CostOverview summary={READY} />)
    expect(screen.queryByText(/Estimated from a configurable/)).not.toBeInTheDocument()
    expect(screen.queryByText(/TTS cost is approximated/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Judge0/)).not.toBeInTheDocument()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('CostOverview layout', () => {
  let css = ''

  beforeAll(async () => {
    const fs = await import('node:fs')
    css = fs.readFileSync(`${process.cwd()}/src/modules/m1-hrbot/components/CostOverview.css`, 'utf8')
  })

  it('lays the area cards out five to a row on a wide screen', () => {
    const at = css.indexOf('.cst-grid {')
    expect(at).toBeGreaterThanOrEqual(0)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('uses fewer columns on narrower screens', () => {
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*?repeat\(3,/)
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?repeat\(2,/)
  })
})
