import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  instances: [] as {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }[],
}))

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => {
      const inst = {
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        get: vi.fn().mockResolvedValue({ data: {} }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        put: vi.fn().mockResolvedValue({ data: {} }),
        patch: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      }
      h.instances.push(inst)
      return inst
    }),
  },
}))

const { attentionApi, candidatesApi, interviewApi, jobsApi } = await import('./api')

const [authed, publicClient] = h.instances

beforeEach(() => {
  for (const inst of h.instances) {
    for (const fn of [inst.get, inst.post, inst.put, inst.patch, inst.delete]) fn.mockClear()
  }
})

describe('attentionApi', () => {
  it('reads the queue from /attention through the authenticated client', async () => {
    await attentionApi.get()
    expect(authed.get).toHaveBeenCalledWith('/attention')
    expect(publicClient.get).not.toHaveBeenCalled()
  })

  it('reads the candidates behind one row from /attention/{key}, with the key encoded', async () => {
    await attentionApi.detail('external_awaiting_scorecard')
    expect(authed.get).toHaveBeenLastCalledWith('/attention/external_awaiting_scorecard')
    await attentionApi.detail('a/b?c')
    expect(authed.get).toHaveBeenLastCalledWith('/attention/a%2Fb%3Fc')
    expect(publicClient.get).not.toHaveBeenCalled()
  })
})

describe('jobsApi.comparison', () => {
  it('asks for a job\'s comparison with the stage and the rejected switch as query parameters', async () => {
    await jobsApi.comparison('job_1', { stage: 'completed', include_rejected: true })
    expect(authed.get).toHaveBeenCalledWith('/jobs/job_1/comparison', { params: { stage: 'completed', include_rejected: true } })
  })

  it('sends no parameters when none are given', async () => {
    await jobsApi.comparison('job_1')
    expect(authed.get).toHaveBeenCalledWith('/jobs/job_1/comparison', { params: undefined })
  })
})

describe('candidatesApi.decision', () => {
  it('sends the reason with a rejection', async () => {
    await candidatesApi.decision('c1', 'reject', undefined, 'salary')
    expect(authed.post).toHaveBeenCalledWith('/candidates/c1/decision', { decision: 'reject', notes: undefined, reason: 'salary' })
  })

  it('sends no reason key at all when there is none, as for a hire', async () => {
    await candidatesApi.decision('c1', 'hire')
    const body = authed.post.mock.calls[0][1] as Record<string, unknown>
    expect(body).toEqual({ decision: 'hire', notes: undefined })
    expect(body).not.toHaveProperty('reason')
  })

  it('still takes notes as the third argument', async () => {
    await candidatesApi.decision('c1', 'hold', 'Waiting on references')
    expect(authed.post).toHaveBeenCalledWith('/candidates/c1/decision', { decision: 'hold', notes: 'Waiting on references' })
  })
})

describe('candidatesApi: editing the guide', () => {
  it('adds a question', async () => {
    const body = { text: 'What would you change?', dimension: 'problem_solving' as const, listen_for: 'Specific ideas' }
    await candidatesApi.addGuideQuestion('c1', body)
    expect(authed.post).toHaveBeenCalledWith('/candidates/c1/interview-guide/questions', body)
  })

  it('removes a question by id, encoded so it cannot change the path', async () => {
    await candidatesApi.removeGuideQuestion('c1', 'q4')
    expect(authed.delete).toHaveBeenLastCalledWith('/candidates/c1/interview-guide/questions/q4')
    await candidatesApi.removeGuideQuestion('c1', 'a/b?c')
    expect(authed.delete).toHaveBeenLastCalledWith('/candidates/c1/interview-guide/questions/a%2Fb%3Fc')
  })

  it('puts the whole new order', async () => {
    await candidatesApi.reorderGuideQuestions('c1', ['q2', 'q1', 'q3'])
    expect(authed.put).toHaveBeenCalledWith('/candidates/c1/interview-guide/order', { ids: ['q2', 'q1', 'q3'] })
  })
})

describe('interviewApi.scheduleIcs', () => {
  it('fetches the calendar file as a blob through the authenticated client', async () => {
    await interviewApi.scheduleIcs('c1')
    expect(authed.get).toHaveBeenCalledWith('/interview/c1/schedule.ics', { responseType: 'blob' })
  })
})
