import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const set = vi.fn()
const embeddingStatus = vi.fn()
const reindex = vi.fn()

vi.mock('../../../lib/api', () => ({
  modelTasksApi: {
    list: (...a: unknown[]) => list(...a),
    set: (...a: unknown[]) => set(...a),
    embeddingStatus: (...a: unknown[]) => embeddingStatus(...a),
    reindex: (...a: unknown[]) => reindex(...a),
  },
}))

const { default: ModelTasksSection } = await import('./ModelTasksSection')

const showToast = vi.fn()

const CHAT = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'anthropic', price_label: '$0.10 / $0.50 per 1M tokens', available: true },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', price_label: '$2.50 / $15 per 1M tokens', available: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', price_label: '$2.50 / $10 per 1M tokens', available: false },
]
const EMBEDDING = [
  { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', provider: 'openai', price_label: '$0.02 per 1M tokens', available: true },
  { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', provider: 'openai', price_label: '$0.13 per 1M tokens', available: true },
]

function task(over: Record<string, unknown>) {
  return {
    key: 'interview', label: 'Interview questions, follow-ups and scoring', group: 'Interview', kind: 'chat',
    model: 'claude-haiku-5-5', model_name: 'Claude Haiku 5.5', price_label: '$0.10 / $0.50 per 1M tokens',
    override: null, default_model: 'claude-haiku-5-5', default_name: 'Claude Haiku 5.5', ...over,
  }
}

const TASKS = [
  task({}),
  task({ key: 'resume', label: 'CV classification', group: 'Hiring' }),
  task({
    key: 'embedding', label: 'Embeddings for CV and job matching', group: 'Hiring', kind: 'embedding',
    model: 'text-embedding-3-small', model_name: 'Text Embedding 3 Small', price_label: '$0.02 per 1M tokens',
    default_model: 'text-embedding-3-small', default_name: 'Text Embedding 3 Small',
  }),
  task({ key: 'code_quality', label: 'Code quality review', group: 'Coding' }),
]

const NO_STALE = { model: 'text-embedding-3-small', platform_default: 'text-embedding-3-small', stale_jobs: 0, stale_resumes: 0, stale_total: 0 }

function respond(tasks = TASKS, status = NO_STALE) {
  list.mockResolvedValue({ data: { tasks, options: { chat: CHAT, embedding: EMBEDDING, speech: [], transcription: [] }, default_model: 'claude-haiku-5-5' } })
  embeddingStatus.mockResolvedValue({ data: status })
}

function row(label: string): HTMLElement {
  return screen.getByLabelText(label).closest('.mt-row') as HTMLElement
}

beforeEach(() => {
  list.mockReset()
  set.mockReset()
  embeddingStatus.mockReset()
  reindex.mockReset()
  showToast.mockReset()
  respond()
})

describe('Models by Job', () => {
  it('lists the jobs under their group headings, each on the model it runs on', async () => {
    render(<ModelTasksSection showToast={showToast} />)

    expect(await screen.findByLabelText('CV classification')).toBeInTheDocument()
    expect(Array.from(document.querySelectorAll('.mt-group-title')).map(e => e.textContent)).toEqual(['Interview', 'Hiring', 'Coding'])
    const resume = row('CV classification')
    expect(within(resume).getByRole('combobox')).toHaveValue('')
    expect(within(resume).getByRole('option', { name: 'Default (Claude Haiku 5.5)' })).toBeInTheDocument()
    expect(within(resume).getByText('$0.10 / $0.50 per 1M tokens')).toBeInTheDocument()
  })

  it('offers each provider as its own block and marks a provider with no key as not set up', async () => {
    render(<ModelTasksSection showToast={showToast} />)

    await screen.findByLabelText('CV classification')
    const select = within(row('CV classification')).getByRole('combobox')
    const groups = Array.from(select.querySelectorAll('optgroup')).map(g => g.getAttribute('label'))
    expect(groups).toEqual(['Anthropic', 'OpenAI'])
    const unavailable = within(select).getByRole('option', { name: 'GPT-4o (not set up)' })
    expect(unavailable).toBeDisabled()
    expect(within(select).getByRole('option', { name: 'GPT-5.4' })).toBeEnabled()
    const embedding = within(row('Embeddings for CV and job matching')).getByRole('combobox')
    expect(within(embedding).queryByRole('option', { name: 'GPT-5.4' })).not.toBeInTheDocument()
    expect(within(embedding).getByRole('option', { name: 'Text Embedding 3 Large' })).toBeInTheDocument()
  })

  it('saves a choice and shows the model it now runs on', async () => {
    set.mockResolvedValue({ data: task({ key: 'resume', label: 'CV classification', group: 'Hiring', model: 'gpt-5.4', model_name: 'GPT-5.4', price_label: '$2.50 / $15 per 1M tokens', override: 'gpt-5.4' }) })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    await user.selectOptions(await screen.findByLabelText('CV classification'), 'gpt-5.4')

    await waitFor(() => expect(set).toHaveBeenCalledWith('resume', 'gpt-5.4'))
    await waitFor(() => expect(within(row('CV classification')).getByText('$2.50 / $15 per 1M tokens')).toBeInTheDocument())
    expect(within(row('CV classification')).getByRole('combobox')).toHaveValue('gpt-5.4')
    expect(showToast).toHaveBeenCalledWith('CV classification: GPT-5.4')
    expect(within(row('Code quality review')).getByRole('combobox')).toHaveValue('')
  })

  it('returns a job to its default with the first option', async () => {
    respond([task({ key: 'resume', label: 'CV classification', group: 'Hiring', override: 'gpt-5.4', model: 'gpt-5.4', model_name: 'GPT-5.4' })])
    set.mockResolvedValue({ data: task({ key: 'resume', label: 'CV classification', group: 'Hiring' }) })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    await user.selectOptions(await screen.findByLabelText('CV classification'), '')

    await waitFor(() => expect(set).toHaveBeenCalledWith('resume', null))
    expect(showToast).toHaveBeenCalledWith('CV classification: back to the default')
    expect(within(row('CV classification')).getByRole('combobox')).toHaveValue('')
  })

  it("shows the server's own reason when a choice is refused, and keeps the old one", async () => {
    set.mockRejectedValue({ response: { status: 400, data: { detail: 'OpenAI is not set up on this platform, so GPT-5.4 cannot be used yet' } } })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    await user.selectOptions(await screen.findByLabelText('CV classification'), 'gpt-5.4')

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('OpenAI is not set up on this platform, so GPT-5.4 cannot be used yet'))
    expect(within(row('CV classification')).getByRole('combobox')).toHaveValue('')
  })

  it('keeps a saved choice visible even when it is no longer on offer', async () => {
    respond([task({ key: 'resume', label: 'CV classification', group: 'Hiring', override: 'gpt-4-turbo', model: 'gpt-4-turbo', model_name: 'GPT-4 Turbo' })])
    render(<ModelTasksSection showToast={showToast} />)

    const select = await screen.findByLabelText('CV classification')
    expect(select).toHaveValue('gpt-4-turbo')
    expect(within(select).getByRole('option', { name: 'GPT-4 Turbo' })).toBeInTheDocument()
  })

  it('says so, with a retry, when the models cannot be loaded', async () => {
    list.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Database unavailable' } } })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    respond()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('CV classification')).toBeInTheDocument()
  })
})

describe('changing the embedding model', () => {
  const STALE = { model: 'text-embedding-3-large', platform_default: 'text-embedding-3-small', stale_jobs: 2, stale_resumes: 3, stale_total: 5 }

  it('offers nothing to re-embed while every document was made by the model in use', async () => {
    render(<ModelTasksSection showToast={showToast} />)
    await screen.findByLabelText('CV classification')
    expect(screen.queryByRole('button', { name: 'Re-embed now' })).not.toBeInTheDocument()
  })

  it('shows how many documents are waiting after the model is switched', async () => {
    set.mockResolvedValue({ data: task({ key: 'embedding', label: 'Embeddings for CV and job matching', group: 'Hiring', kind: 'embedding', model: 'text-embedding-3-large', model_name: 'Text Embedding 3 Large', override: 'text-embedding-3-large' }) })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)
    await screen.findByLabelText('Embeddings for CV and job matching')

    embeddingStatus.mockResolvedValue({ data: STALE })
    await user.selectOptions(screen.getByLabelText('Embeddings for CV and job matching'), 'text-embedding-3-large')

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('5 documents with no embedding from the model in use (2 jobs, 3 CVs) do not match until re-embedded')
    expect(within(notice).getByRole('button', { name: 'Re-embed now' })).toBeEnabled()
  })

  it('walks the cursor until the server says it is done, then reports the count', async () => {
    respond(TASKS, STALE)
    reindex
      .mockResolvedValueOnce({ data: { model: 'x', processed: 2, failed: 0, remaining: 3, next_cursor: 'jobs:j2', done: false } })
      .mockResolvedValueOnce({ data: { model: 'x', processed: 2, failed: 1, remaining: 1, next_cursor: 'resumes:', done: false } })
      .mockResolvedValueOnce({ data: { model: 'x', processed: 0, failed: 0, remaining: 1, next_cursor: null, done: true } })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    embeddingStatus.mockResolvedValue({ data: { ...STALE, stale_jobs: 0, stale_resumes: 1, stale_total: 1 } })
    await user.click(await screen.findByRole('button', { name: 'Re-embed now' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Re-embedded 4, 1 could not be re-embedded'))
    expect(reindex.mock.calls.map(c => c[0] ?? null)).toEqual([null, 'jobs:j2', 'resumes:'])
    expect(await screen.findByRole('status')).toHaveTextContent('1 document with no embedding from the model in use')
  })

  it('stops with the server reason when the budget is spent', async () => {
    respond(TASKS, STALE)
    reindex.mockRejectedValue({ response: { status: 402, data: { detail: 'The monthly AI budget is spent.' } } })
    const user = userEvent.setup()
    render(<ModelTasksSection showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Re-embed now' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('The monthly AI budget is spent.'))
    expect(screen.getByRole('button', { name: 'Re-embed now' })).toBeEnabled()
  })
})
