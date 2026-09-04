import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'


const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

vi.mock('../../modules/m1-hrbot/components/ProctoringMonitor', () => ({
  default: () => null,
}))

vi.mock('../../modules/m1-hrbot/lib/lockdown', () => ({
  enterFullscreen: vi.fn().mockResolvedValue(undefined),
  exitFullscreen: vi.fn().mockResolvedValue(undefined),
  isFullscreen: () => true,
  hasMultipleDisplays: () => false,
  watchScreenCapture: () => () => {},
}))

function fakeStream() {
  const track = { stop: vi.fn(), kind: 'audio' }
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

vi.mock('../../modules/m1-hrbot/lib/voice', () => ({
  ANSWER_BITRATE: 32000,
  pickAudioMimeType: () => 'audio/webm',
  extensionForMimeType: () => 'webm',
  describeMediaError: () => 'media error',
  requestInterviewMedia: vi.fn(async () => fakeStream()),
}))

const { default: InterviewPage } = await import('./InterviewPage')

const CODING_QUESTION = {
  question_id: 'q1',
  title: 'Reverse a linked list',
  description: 'Given the head of a list, reverse it in place.',
  difficulty: 'medium',
  job_domain: 'software_engineering',
  language_templates: { python: 'def solve():\n    pass' },
  test_cases: [{ input: '[1,2]', expected_output: '[2,1]', is_hidden: false }],
}

const calls: string[] = []

function mockBackend({ codingAssigned }: { codingAssigned: boolean }) {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))

    if (String(url).endsWith(`/interview/session/${TOKEN}`)) {
      return {
        ok: true, status: 200,
        json: async () => ({
          candidate_name: 'Sara Khan',
          duration_minutes: 30,
          questions: ['Tell me about a project you are proud of.'],
          coding_assigned: codingAssigned,
        }),
      }
    }
    if (String(url).includes('/speak')) {
      return { ok: true, status: 200, blob: async () => new Blob(['audio']) }
    }
    if (String(url).includes(`/coding/session/${TOKEN}`)) {
      return { ok: true, status: 200, json: async () => CODING_QUESTION }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
}

async function startInterview() {
  render(<InterviewPage />)
  const start = await screen.findByRole('button', { name: /start interview/i })
  await userEvent.click(start)
  await screen.findByRole('tab', { name: /transcript/i })
}

describe('InterviewPage', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: () => {},
    })
  })

  it('hosts the coding workspace in the Code Screening tab, on the interview token', async () => {
    mockBackend({ codingAssigned: true })
    await startInterview()

    const codeTab = await screen.findByRole('tab', { name: /code screening/i })
    await userEvent.click(codeTab)

    expect(await screen.findByText('Reverse a linked list')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /transcript/i })).toBeInTheDocument()

    expect(calls.some(u => u.includes(`/coding/session/${TOKEN}`))).toBe(true)
  })

  it('costs nothing when no coding question is assigned', async () => {
    mockBackend({ codingAssigned: false })
    await startInterview()

    await userEvent.click(await screen.findByRole('tab', { name: /code screening/i }))
    expect(screen.getByText(/scratchpad only/i)).toBeInTheDocument()
    expect(calls.some(u => u.includes('/coding/session/'))).toBe(false)
  })

  it('keeps the interview running while the candidate is in the editor', async () => {
    mockBackend({ codingAssigned: true })
    await startInterview()

    await userEvent.click(await screen.findByRole('tab', { name: /code screening/i }))
    await screen.findByText('Reverse a linked list')

    expect(screen.getByText('AI Interviewer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end interview/i })).toBeInTheDocument()
  })

  it('keeps the turn controls outside the scrolling tab panel', async () => {
    mockBackend({ codingAssigned: false })
    await startInterview()

    const scroller = document.querySelector('.iv-panel-body')
    const turnBar = document.querySelector('.turn-bar')
    const side = document.querySelector('.iv-side')

    expect(scroller).not.toBeNull()
    expect(turnBar).not.toBeNull()
    expect(scroller!.contains(turnBar!)).toBe(false)
    expect(side!.contains(turnBar!)).toBe(true)
  })

  it('shows the interviewer and the candidate as participants', async () => {
    mockBackend({ codingAssigned: false })
    await startInterview()

    await waitFor(() => {
      expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Sara Khan').length).toBeGreaterThan(0)
    })
  })
})
