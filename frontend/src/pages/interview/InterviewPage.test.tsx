import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandContext, DEFAULT_BRAND } from '../../lib/brand'

const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

type FakeProctoringProps = { enabled?: boolean; onStatusChange?: (s: string) => void }
const proctoringMonitorProps: FakeProctoringProps[] = []
vi.mock('../../modules/m1-hrbot/components/ProctoringMonitor', () => ({
  default: (props: FakeProctoringProps) => {
    proctoringMonitorProps.push(props)
    return null
  },
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

async function startInterview(
  consent: 'enable' | 'decline' = 'decline',
  wrap: (ui: ReactElement) => ReactElement = ui => ui,
) {
  proctoringMonitorProps.length = 0
  render(wrap(<InterviewPage />))
  const consentButton = await screen.findByRole('button', {
    name: consent === 'enable' ? /enable camera monitoring/i : /continue without monitoring/i,
  })
  await userEvent.click(consentButton)
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

  describe('branding', () => {
    const acme = (ui: ReactElement) => (
      <BrandContext.Provider value={{ ...DEFAULT_BRAND, name: 'Acme Corp', companyName: 'Acme Corp', logoUrl: 'https://cdn.acme.test/logo.png' }}>
        {ui}
      </BrandContext.Provider>
    )

    it('names the product, with its mark, when no company is known', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview()

      const brand = document.querySelector('.iv-brand')!
      expect(brand).toHaveTextContent('Hirely.ai Interview')
      expect(brand.querySelector('svg')).not.toBeNull()
      expect(brand.querySelector('img')).toBeNull()
    })

    it('names the company, with its logo, when the link came from one', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('decline', acme)

      const brand = document.querySelector('.iv-brand')!
      expect(brand).toHaveTextContent('Acme Corp Interview')
      expect(brand).not.toHaveTextContent('Hirely')
      expect(brand.querySelector('img')).toHaveAttribute('src', 'https://cdn.acme.test/logo.png')
      expect(brand.querySelector('svg')).toBeNull()
    })
  })

  describe('legal links', () => {
    it('shows the company Terms and Privacy links on the screens before and after the interview', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
      render(
        <BrandContext.Provider value={{ ...DEFAULT_BRAND, termsUrl: 'https://acme.test/terms', privacyUrl: 'https://acme.test/privacy' }}>
          <InterviewPage />
        </BrandContext.Provider>,
      )
      expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://acme.test/terms')
      expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('shows none when the company has set none', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
      render(<InterviewPage />)
      expect(screen.queryByRole('navigation', { name: 'Legal' })).not.toBeInTheDocument()
    })
  })

  it('shows the interviewer and the candidate as participants', async () => {
    mockBackend({ codingAssigned: false })
    await startInterview()

    await waitFor(() => {
      expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Sara Khan').length).toBeGreaterThan(0)
    })
  })

  describe('optional self-ID step (MVP2 §4)', () => {
    it('shows the self-ID step after ending the interview, then completes on skip', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview()

      await userEvent.click(screen.getByRole('button', { name: /end interview/i }))

      expect(await screen.findByText(/one optional question before you go/i)).toBeInTheDocument()
      expect(screen.queryByText('Interview complete')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /skip.*prefer not to answer/i }))

      expect(await screen.findByText('Interview complete')).toBeInTheDocument()
      expect(calls.some(u => u.includes('/demographics'))).toBe(false)
    })

    it('submits the self-ID answer to the token endpoint exactly once, then completes', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview()

      await userEvent.click(screen.getByRole('button', { name: /end interview/i }))
      await screen.findByText(/one optional question before you go/i)

      await userEvent.click(screen.getByRole('button', { name: /^submit$/i }))

      expect(await screen.findByText('Interview complete')).toBeInTheDocument()
      expect(calls.filter(u => u.includes('/demographics')).length).toBe(1)
    })
  })

  describe('camera consent for CV integrity monitoring (MVP2 §3)', () => {
    it('shows the consent screen before the existing Start Interview card', async () => {
      mockBackend({ codingAssigned: false })
      render(<InterviewPage />)

      expect(await screen.findByText(/camera-based integrity monitoring/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /start interview/i })).not.toBeInTheDocument()
    })

    it('declining still lets the interview proceed normally, with monitoring disabled', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('decline')

      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))
      expect(proctoringMonitorProps[proctoringMonitorProps.length - 1]?.enabled).toBe(false)
    })

    it('enabling reaches ProctoringMonitor as enabled', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('enable')

      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))
      expect(proctoringMonitorProps[proctoringMonitorProps.length - 1]?.enabled).toBe(true)
    })
  })

  describe('"Securing your session…" indicator while the CV model bundle loads', () => {
    it('shows the indicator once monitoring is enabled, before the monitor reports ready', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('enable')

      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))
      expect(screen.getByText(/securing your session/i)).toBeInTheDocument()
    })

    it('hides the indicator once the monitor reports ready', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('enable')
      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))
      expect(screen.getByText(/securing your session/i)).toBeInTheDocument()

      const { onStatusChange } = proctoringMonitorProps[proctoringMonitorProps.length - 1]
      onStatusChange?.('ready')

      await waitFor(() => expect(screen.queryByText(/securing your session/i)).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: /end interview/i })).toBeInTheDocument()
    })

    it('also hides the indicator if the monitor ends up unavailable, never a stuck message', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('enable')
      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))

      const { onStatusChange } = proctoringMonitorProps[proctoringMonitorProps.length - 1]
      onStatusChange?.('unavailable')

      await waitFor(() => expect(screen.queryByText(/securing your session/i)).not.toBeInTheDocument())
    })

    it('never shows the indicator at all when the candidate declined monitoring', async () => {
      mockBackend({ codingAssigned: false })
      await startInterview('decline')

      await waitFor(() => expect(screen.getAllByText('AI Interviewer').length).toBeGreaterThan(0))
      expect(screen.queryByText(/securing your session/i)).not.toBeInTheDocument()
    })
  })
})
