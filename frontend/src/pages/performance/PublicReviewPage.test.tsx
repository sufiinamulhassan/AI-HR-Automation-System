import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

const { default: PublicReviewPage } = await import('./PublicReviewPage')

const RATING_CONFIG = {
  scale_min: 1,
  scale_max: 5,
  dimensions: [{ dimension_id: 'd1', name: 'Communication', description: 'How well they communicate' }],
}

const SELF_REVIEW = {
  review_id: 'rev-1',
  cycle_id: 'cyc-1',
  cycle_name: 'Q3 2026 Review',
  reviewer_type: 'self',
  employee_name: 'Jane Doe',
  reviewer_name: null,
  status: 'pending',
  ratings: {},
  comments: null,
  rating_config: RATING_CONFIG,
  goals: [{
    goal_id: 'g1', owner_id: 'emp-1', title: 'Ship X', description: 'Ship the migration',
    due_date: '2026-12-01', progress_pct: 40, parent_goal_id: null, status: 'active',
  }],
}

const PEER_REVIEW = {
  ...SELF_REVIEW,
  review_id: 'rev-2',
  reviewer_type: 'peer',
  employee_name: 'Bob Smith',
  reviewer_name: 'Jane Doe',
  goals: null,
}

const SUBMITTED_REVIEW = {
  ...SELF_REVIEW,
  status: 'submitted',
  ratings: { Communication: 4 },
  comments: 'Great job this quarter.',
}

function mockFetch(review: unknown | 'invalid', opts: { submitOk?: boolean; goalOk?: boolean } = {}) {
  const { submitOk = true, goalOk = true } = opts
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith(`/performance/public/${TOKEN}/submit`)) {
      if (!submitOk) return { ok: false, status: 500, json: async () => ({ detail: 'Something broke' }) }
      const body = JSON.parse(init!.body as string)
      return { ok: true, status: 200, json: async () => ({ ...(review as object), status: 'submitted', ratings: body.ratings, comments: body.comments }) }
    }
    if (u.includes('/goals/')) {
      const goalId = u.split('/goals/')[1]
      if (!goalOk) return { ok: false, status: 500, json: async () => ({ detail: 'Failed to update progress.' }) }
      const body = JSON.parse(init!.body as string)
      return { ok: true, status: 200, json: async () => ({ goal_id: goalId, owner_id: 'emp-1', title: 'Ship X', progress_pct: body.progress_pct, status: 'active' }) }
    }
    if (u.endsWith(`/performance/public/${TOKEN}`)) {
      if (review === 'invalid') return { ok: false, status: 404, json: async () => ({ detail: 'Invalid review link' }) }
      return { ok: true, status: 200, json: async () => review }
    }
    throw new Error(`Unexpected fetch call: ${u} ${JSON.stringify(init)}`)
  }))
}

describe('PublicReviewPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders an editable form and submits ratings + comments', async () => {
    mockFetch(SELF_REVIEW)
    const user = userEvent.setup()
    render(<PublicReviewPage />)

    expect(await screen.findByText('Self Review: Jane Doe')).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    expect(submitBtn).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Communication'), '4')
    await user.type(screen.getByPlaceholderText('Optional comments'), 'Great job this quarter.')
    expect(submitBtn).not.toBeDisabled()
    await user.click(submitBtn)

    await waitFor(() => {
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/submit'))
      expect(call).toBeTruthy()
    })
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/submit'))!
    const [, init] = call
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ ratings: { Communication: 4 }, comments: 'Great job this quarter.' })

    expect(await screen.findByText('Submitted')).toBeInTheDocument()
  })

  it('shows an already-submitted review read-only, with no editable controls', async () => {
    mockFetch(SUBMITTED_REVIEW)
    render(<PublicReviewPage />)

    expect(await screen.findByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
    expect(screen.getByText('Great job this quarter.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit review/i })).not.toBeInTheDocument()
  })

  it("shows a clear 'link isn't valid' state for an unknown token, not a crash", async () => {
    mockFetch('invalid')
    render(<PublicReviewPage />)

    expect(await screen.findByText(/this link isn.t valid/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows a generic error state on a non-404 failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    render(<PublicReviewPage />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('renders goals with an editable progress control for a self review', async () => {
    mockFetch(SELF_REVIEW)
    const user = userEvent.setup()
    render(<PublicReviewPage />)

    expect(await screen.findByText('Your Goals')).toBeInTheDocument()
    expect(screen.getByText('Ship X')).toBeInTheDocument()

    const progressInput = screen.getByLabelText('Progress for Ship X') as HTMLInputElement
    expect(progressInput.value).toBe('40')
    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    expect(saveBtn).toBeDisabled()

    await user.clear(progressInput)
    await user.type(progressInput, '60')
    expect(saveBtn).not.toBeDisabled()
    await user.click(saveBtn)

    await waitFor(() => {
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).includes('/goals/g1'))
      expect(call).toBeTruthy()
    })
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).includes('/goals/g1'))!
    const [, init] = call
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ progress_pct: 60 })
  })

  it('never renders goals, or a way to edit them, on a peer review, even though the payload could technically carry them', async () => {
    mockFetch(PEER_REVIEW)
    render(<PublicReviewPage />)

    expect(await screen.findByText('Peer Review of Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Signed in as Jane Doe')).toBeInTheDocument()
    expect(screen.queryByText('Your Goals')).not.toBeInTheDocument()
    expect(screen.queryByText('Ship X')).not.toBeInTheDocument()
  })
})
