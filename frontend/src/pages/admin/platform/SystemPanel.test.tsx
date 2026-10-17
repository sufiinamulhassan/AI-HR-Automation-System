import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const health = vi.fn()
const liveCheck = vi.fn()

vi.mock('../../../lib/api', () => ({
  systemApi: {
    health: (...a: unknown[]) => health(...a),
    liveCheck: (...a: unknown[]) => liveCheck(...a),
  },
  modelTasksApi: {
    list: vi.fn().mockResolvedValue({ data: { tasks: [], options: { chat: [], embedding: [], speech: [], transcription: [] }, default_model: '' } }),
    embeddingStatus: vi.fn().mockResolvedValue({ data: { model: 'm', platform_default: 'm', stale_jobs: 0, stale_resumes: 0, stale_total: 0 } }),
    set: vi.fn(),
    reindex: vi.fn(),
  },
  intelApi: { stats: vi.fn().mockResolvedValue({ data: { total: 0, invite_funnel: {} } }) },
  jobsApi: { stats: vi.fn().mockResolvedValue({ data: { total: 0 } }) },
}))

const { default: SystemPanel } = await import('./SystemPanel')

const showToast = vi.fn()

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

function envRow(key: string) {
  return screen.getByText(key).closest('.ss-env-row') as HTMLElement
}

const RESULT = {
  checked_at: '2026-10-08T12:00:00Z',
  results: [
    { key: 'mongo', label: 'Database', ok: true, detail: 'Ping answered', latency_ms: 12 },
    { key: 'llm', label: 'Language model', ok: false, detail: 'Key rejected', latency_ms: 480 },
  ],
}

beforeEach(() => {
  health.mockReset().mockResolvedValue({ data: { status: 'ok', version: '4.2.1', modules: ['hr_module'] } })
  liveCheck.mockReset().mockResolvedValue({ data: RESULT })
  showToast.mockReset()
})

describe('model settings', () => {
  it('shows Models by Job as the only model control: no default-model cards, no current-model row', async () => {
    render(<SystemPanel showToast={showToast} />)

    expect(await screen.findByText('Models by Job')).toBeInTheDocument()
    expect(screen.queryByText('AI Model Configuration')).not.toBeInTheDocument()
    expect(screen.queryByText('Default LLM Model')).not.toBeInTheDocument()
    expect(screen.queryByText('Current Model')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Claude Haiku 4.5$/)).not.toBeInTheDocument()
  })
})

describe('platform version', () => {
  it('shows the version /health reports, not a fixed one', async () => {
    render(<SystemPanel showToast={showToast} />)

    await waitFor(() => expect(within(envRow('Platform Version')).getByText('4.2.1')).toBeInTheDocument())
    expect(screen.queryByText('v3.0')).not.toBeInTheDocument()
  })

  it('shows the empty-value placeholder when /health carries no version', async () => {
    health.mockResolvedValue({ data: { status: 'ok', modules: ['hr_module'] } })
    render(<SystemPanel showToast={showToast} />)

    await screen.findByText('✓ Online')
    expect(within(envRow('Platform Version')).getByText('-')).toBeInTheDocument()
  })

  it('shows the placeholder when the backend cannot be reached', async () => {
    health.mockRejectedValue(new Error('Network Error'))
    render(<SystemPanel showToast={showToast} />)

    await screen.findByText('✗ Offline')
    expect(within(envRow('Platform Version')).getByText('-')).toBeInTheDocument()
  })
})

describe('live check', () => {
  it('runs nothing until asked', async () => {
    render(<SystemPanel showToast={showToast} />)

    await screen.findByText('✓ Online')
    expect(liveCheck).not.toHaveBeenCalled()
    expect(screen.queryByText('Database')).not.toBeInTheDocument()
  })

  it('shows one row per result with its label, outcome, latency and detail', async () => {
    const user = userEvent.setup()
    render(<SystemPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Run live check' }))

    const db = (await screen.findByText('Database')).closest('li') as HTMLElement
    expect(within(db).getByText('OK')).toBeInTheDocument()
    expect(within(db).getByText('12 ms')).toBeInTheDocument()
    expect(within(db).getByText('Ping answered')).toBeInTheDocument()

    const llm = screen.getByText('Language model').closest('li') as HTMLElement
    expect(within(llm).getByText('Failed')).toBeInTheDocument()
    expect(within(llm).getByText('480 ms')).toBeInTheDocument()
    expect(within(llm).getByText('Key rejected')).toBeInTheDocument()

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(liveCheck).toHaveBeenCalledTimes(1)
  })

  it('disables the button while a check is running', async () => {
    const user = userEvent.setup()
    let finish: (v: unknown) => void = () => {}
    liveCheck.mockReturnValue(new Promise(res => { finish = res }))
    render(<SystemPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Run live check' }))

    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    finish({ data: RESULT })
    expect(await screen.findByRole('button', { name: 'Run live check' })).toBeEnabled()
  })

  it('shows the rate-limit detail and keeps the last results on screen', async () => {
    const user = userEvent.setup()
    render(<SystemPanel showToast={showToast} />)
    await user.click(await screen.findByRole('button', { name: 'Run live check' }))
    await screen.findByText('Database')

    liveCheck.mockRejectedValueOnce(httpError(429, 'Live check can run once every 30 seconds'))
    await user.click(screen.getByRole('button', { name: 'Run live check' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Live check can run once every 30 seconds')
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run live check' })).toBeEnabled()
  })

  it('clears the message when the next run succeeds', async () => {
    const user = userEvent.setup()
    liveCheck.mockRejectedValueOnce(httpError(429, 'Slow down'))
    render(<SystemPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Run live check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down')

    await user.click(screen.getByRole('button', { name: 'Run live check' }))
    expect(await screen.findByText('Database')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('falls back to a plain message when the failure carries no detail', async () => {
    const user = userEvent.setup()
    liveCheck.mockRejectedValue(new Error('Network Error'))
    render(<SystemPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Run live check' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The live check could not run.')
  })

  it('falls back to a rate-limit message when a 429 carries no text', async () => {
    const user = userEvent.setup()
    liveCheck.mockRejectedValue(httpError(429, undefined))
    render(<SystemPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Run live check' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many checks. Try again shortly.')
  })
})
