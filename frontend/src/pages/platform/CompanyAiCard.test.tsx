import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CompanyAi } from '../../lib/platformTypes'
import { COMPANY_AI, aiJob } from '../../test/platformFixtures'
import CompanyAiCard from './CompanyAiCard'

const renderCard = (ai: CompanyAi = COMPANY_AI) => render(<CompanyAiCard ai={ai} />)
const rowOf = (name: string) => screen.getByRole('rowheader', { name }).closest('tr')!

describe('CompanyAiCard', () => {
  it('is titled AI models and names the company\'s default', () => {
    renderCard()
    expect(screen.getByRole('heading', { level: 2, name: 'AI models' })).toBeInTheDocument()
    expect(screen.getByText('Default Claude Haiku 4.5')).toBeInTheDocument()
  })

  it('shows both platform keys by name and mask, without the count of companies', () => {
    renderCard()
    const anthropic = screen.getByRole('region', { name: 'Anthropic key' })
    expect(within(anthropic).getByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(within(anthropic).getByText('********FAAA')).toBeInTheDocument()
    expect(within(anthropic).queryByText('Companies')).toBeNull()
    expect(anthropic).toHaveTextContent('Calls310')
    expect(within(anthropic).getByRole('heading', { level: 3, name: 'Anthropic' })).toBeInTheDocument()
  })

  it('lists each job with its model, provider and key, and who chose the model', () => {
    renderCard()
    const own = within(rowOf('Interview questions, follow-ups and scoring')).getAllByRole('cell').map(c => c.textContent)
    expect(own).toEqual(['GPT-5 Mini', 'OpenAI', 'OPENAI_API_KEY********Sv4A', 'Company'])

    const followed = within(rowOf('Job description parsing')).getAllByRole('cell').map(c => c.textContent)
    expect(followed).toEqual(['Claude Haiku 4.5', 'Anthropic', 'ANTHROPIC_API_KEY********FAAA', 'Default'])
  })

  it('warns, in words, about a job whose provider has no key', () => {
    renderCard({
      ...COMPANY_AI,
      keys: COMPANY_AI.keys.map(k => (k.id === 'openai' ? { ...k, configured: false, mask: null } : k)),
      jobs: [aiJob({ key: 'speech', label: 'Interviewer voice (text to speech)', provider: 'openai', key_env: 'OPENAI_API_KEY', ready: false })],
    })
    const cells = within(rowOf('Interviewer voice (text to speech)')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('OPENAI_API_KEY')
    expect(cells[2]).toHaveTextContent('No key')
  })

  it('shows what ran in the period, with tokens where there are any', () => {
    renderCard()
    const usedTable = screen.getByRole('table', { name: 'Used in this period' })
    const rows = within(usedTable).getAllByRole('row').slice(1).map(r => [
      within(r).getByRole('rowheader').textContent, ...within(r).getAllByRole('cell').map(c => c.textContent),
    ])
    expect(rows).toEqual([
      ['Claude Haiku 4.5', 'Chat', 'Anthropic', '250', '300,000', '90,000', '$1.10'],
      ['GPT-5 Mini', 'Chat', 'OpenAI', '40', '12,000', '8,000', '$0.0400'],
      ['Text Embedding 3 Small', 'Embeddings', 'OpenAI', '52', '20,000', '-', '$0.0004'],
    ])
  })

  it('lists the models behind each key', () => {
    renderCard()
    const anthropic = screen.getByRole('region', { name: 'Anthropic key' })
    const openai = screen.getByRole('region', { name: 'OpenAI key' })
    expect(within(anthropic).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Claude Haiku 4.5 310'])
    expect(within(openai).getAllByRole('listitem').map(li => li.textContent)).toEqual(['GPT-5 Mini 40', 'Text Embedding 3 Small 52'])
  })

  it('shows the embedding model and that it is reached through the OpenAI key', () => {
    renderCard()
    const cells = within(rowOf('Embeddings for CV and job matching')).getAllByRole('cell').map(c => c.textContent)
    expect(cells).toEqual(['Text Embedding 3 Large', 'OpenAI', 'OPENAI_API_KEY********Sv4A', 'Company'])
  })

  it('says so when nothing ran in the period', () => {
    renderCard({ ...COMPANY_AI, used: [] })
    expect(screen.getByText('No AI calls in this period.')).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })
})
