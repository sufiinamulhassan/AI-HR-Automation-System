import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  instances: [] as {
    interceptors: { request: { use: ReturnType<typeof vi.fn> }; response: { use: ReturnType<typeof vi.fn> } }
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

const {
  authApi, candidatesApi, careersApi, companySettingsApi, interviewerScorecardApi, notificationSettingsApi, oidcLoginUrl, rbacApi, resumesApi, savedFiltersApi, ssoApi,
} = await import('./api')
const { useAuthStore } = await import('../store/auth.store')

const [authed, publicClient] = h.instances

beforeEach(() => {
  for (const inst of h.instances) {
    for (const fn of [inst.get, inst.post, inst.put, inst.patch, inst.delete]) fn.mockClear()
  }
})

describe('clients', () => {
  it('has two: the authenticated one with its interceptors, and a public one with none', () => {
    expect(h.instances).toHaveLength(2)
    expect(authed.interceptors.request.use).toHaveBeenCalledTimes(1)
    expect(authed.interceptors.response.use).toHaveBeenCalledTimes(1)
    expect(publicClient.interceptors.request.use).not.toHaveBeenCalled()
    expect(publicClient.interceptors.response.use).not.toHaveBeenCalled()
  })
})

describe('demo answers', () => {
  const [onSuccess] = authed.interceptors.response.use.mock.calls[0] as [(r: { data: unknown }) => { data: unknown }]

  it('announces an answer that says the change was only simulated, and passes the answer on unchanged', () => {
    const seen: string[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
    window.addEventListener('hirely:demo-notice', listener)
    const response = { data: { demo: true, message: 'Demo mode: this action was simulated and nothing was changed.', success: true } }
    expect(onSuccess(response)).toBe(response)
    window.removeEventListener('hirely:demo-notice', listener)
    expect(seen).toEqual(['Demo mode: this action was simulated and nothing was changed.'])
  })

  it('says nothing about an ordinary answer', () => {
    const seen: string[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
    window.addEventListener('hirely:demo-notice', listener)
    onSuccess({ data: { message: 'Saved' } })
    onSuccess({ data: null })
    window.removeEventListener('hirely:demo-notice', listener)
    expect(seen).toEqual([])
  })
})

describe('authApi: self-service credentials', () => {
  it('asks for a reset link through the public client, with the address as typed', async () => {
    await authApi.forgotPassword('ann@acme.test')
    expect(publicClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'ann@acme.test' })
    expect(authed.post).not.toHaveBeenCalled()
  })

  it('sets a new password from the token in the link, through the public client', async () => {
    await authApi.resetPassword('tok_abc', 'N3w-passw0rd')
    expect(publicClient.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'tok_abc', new_password: 'N3w-passw0rd' })
    expect(authed.post).not.toHaveBeenCalled()
  })

  it('sends an invitation again with the email encoded in the path', async () => {
    await authApi.inviteUser('ann+hr@acme.test')
    expect(authed.post).toHaveBeenCalledWith('/auth/users/ann%2Bhr%40acme.test/invite')
  })

  it('keeps the administrator reset on its own method', async () => {
    await authApi.adminResetPassword({ email: 'ann@acme.test', new_password: 'N3w-passw0rd' })
    expect(authed.post).toHaveBeenCalledWith('/auth/admin/reset-password', { email: 'ann@acme.test', new_password: 'N3w-passw0rd' })
  })
})

describe('companySettingsApi: plan, usage and the checklist', () => {
  it('reads usage and the checklist, and dismisses the checklist', async () => {
    await companySettingsApi.usage()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/usage')
    await companySettingsApi.onboarding()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/onboarding')
    await companySettingsApi.dismissOnboarding()
    expect(authed.post).toHaveBeenLastCalledWith('/company-settings/onboarding/dismiss')
  })
})

describe('the response interceptor', () => {
  const rejected = authed.interceptors.response.use.mock.calls[0][1] as (err: unknown) => Promise<unknown>
  const SUSPENDED = 'This workspace is suspended. Contact your administrator.'

  beforeEach(() => {
    useAuthStore.setState({ token: 'tok', user: { email: 'sam@acme.test' } })
    vi.stubGlobal('location', { href: '/dashboard' })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('ends the session and goes to the sign-in page for a suspended workspace', async () => {
    const err = { response: { status: 403, data: { detail: SUSPENDED } } }
    await expect(rejected(err)).rejects.toBe(err)
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
    expect(window.location.href).toBe('/login?blocked=suspended')
  })

  it('goes by how the sentence starts, so a reason added after it still counts', async () => {
    await expect(rejected({ response: { status: 403, data: { detail: 'This workspace is suspended: unpaid invoice' } } })).rejects.toBeDefined()
    expect(window.location.href).toBe('/login?blocked=suspended')
  })

  it('ends the session for an ended trial and names the reason', async () => {
    const detail = "This workspace's trial has ended. Ask your administrator to subscribe."
    await expect(rejected({ response: { status: 403, data: { detail } } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBeNull()
    expect(window.location.href).toBe('/login?blocked=trial')
  })

  it('ends the session for an ended subscription and names the reason', async () => {
    const detail = "This workspace's subscription has ended. Ask your administrator to renew."
    await expect(rejected({ response: { status: 403, data: { detail } } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBeNull()
    expect(window.location.href).toBe('/login?blocked=subscription')
  })

  it('leaves a trial or subscription refusal for somebody who is not signed in to the sign-in form', async () => {
    useAuthStore.setState({ token: null, user: null })
    for (const detail of ["This workspace's trial has ended. Ask your administrator to subscribe.", "This workspace's subscription has ended. Ask your administrator to renew."]) {
      const err = { response: { status: 403, data: { detail } } }
      await expect(rejected(err)).rejects.toBe(err)
    }
    expect(window.location.href).toBe('/dashboard')
  })

  it('does not take other sentences about a workspace for a block', async () => {
    for (const detail of ['This workspace has a new owner', 'Your plan does not include Integrations.']) {
      await expect(rejected({ response: { status: 403, data: { detail } } })).rejects.toBeDefined()
    }
    expect(useAuthStore.getState().token).toBe('tok')
    expect(window.location.href).toBe('/dashboard')
  })

  it('leaves a refused sign-in to the form: a wrong password or code is a 401 that ends nothing', async () => {
    for (const url of ['/auth/login', '/auth/verify-otp', '/auth/token']) {
      const err = { config: { url }, response: { status: 401, data: { detail: 'Invalid or expired OTP' } } }
      await expect(rejected(err)).rejects.toBe(err)
    }
    expect(useAuthStore.getState().token).toBe('tok')
    expect(window.location.href).toBe('/dashboard')
  })

  it('still ends the session on a 401 from any other call', async () => {
    await expect(rejected({ config: { url: '/auth/me' }, response: { status: 401, data: { detail: 'Token expired' } } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('leaves a sign-in attempt alone, since nobody is signed in to end', async () => {
    useAuthStore.setState({ token: null, user: null })
    const err = { response: { status: 403, data: { detail: SUSPENDED } } }
    await expect(rejected(err)).rejects.toBe(err)
    expect(window.location.href).toBe('/dashboard')
  })

  it('leaves any other 403 to the page that asked', async () => {
    const err = { response: { status: 403, data: { detail: 'You do not have permission to do this' } } }
    await expect(rejected(err)).rejects.toBe(err)
    expect(useAuthStore.getState().token).toBe('tok')
    expect(window.location.href).toBe('/dashboard')
  })

  it('leaves a 403 whose detail is not text alone', async () => {
    await expect(rejected({ response: { status: 403, data: { detail: [{ msg: SUSPENDED }] } } })).rejects.toBeDefined()
    await expect(rejected({ response: { status: 403 } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBe('tok')
    expect(window.location.href).toBe('/dashboard')
  })

  it('does not take a suspended-sounding 400 for a suspension', async () => {
    await expect(rejected({ response: { status: 400, data: { detail: SUSPENDED } } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBe('tok')
  })

  it('still ends the session on a 401, with no suspension notice', async () => {
    await expect(rejected({ response: { status: 401, data: { detail: 'Token expired' } } })).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('passes a failure with no response, such as a dropped connection, straight through', async () => {
    const err = new Error('Network Error')
    await expect(rejected(err)).rejects.toBe(err)
    expect(useAuthStore.getState().token).toBe('tok')
  })
})

describe('interviewerScorecardApi (public)', () => {
  it('reads the scorecard for a token through the public client only', async () => {
    await interviewerScorecardApi.get('tok_1')
    expect(publicClient.get).toHaveBeenCalledWith('/interviewer-scorecard/tok_1')
    expect(authed.get).not.toHaveBeenCalled()
  })

  it('saves the whole scorecard with a PUT through the public client only', async () => {
    const body = {
      interviewer_name: 'Priya Nair',
      interviewer_role: 'engineer' as const,
      questions: [{ question_id: 'q1', rating: 4 }],
      ratings: { technical: 4, communication: 4, problem_solving: 4, cultural_fit: 4, confidence: 4 },
      recommendation: 'hire' as const,
      summary: 'Clear thinker, explained trade-offs well.',
    }
    await interviewerScorecardApi.save('tok_1', body)
    expect(publicClient.put).toHaveBeenCalledWith('/interviewer-scorecard/tok_1', body)
    expect(authed.put).not.toHaveBeenCalled()
  })

  it('encodes the token so it cannot change the path', async () => {
    await interviewerScorecardApi.get('a/b?c')
    expect(publicClient.get).toHaveBeenCalledWith('/interviewer-scorecard/a%2Fb%3Fc')
  })
})

describe('candidatesApi: guide, scorecard and links (admin)', () => {
  it('reads the guide', async () => {
    await candidatesApi.getInterviewGuide('c1')
    expect(authed.get).toHaveBeenCalledWith('/candidates/c1/interview-guide')
  })

  it('generates a guide without regenerating unless asked', async () => {
    await candidatesApi.generateInterviewGuide('c1')
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/interview-guide', { regenerate: false })
    await candidatesApi.generateInterviewGuide('c1', true)
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/interview-guide', { regenerate: true })
  })

  it('posts the scorecard to external-review', async () => {
    await candidatesApi.submitExternalReview('c1', { attended: false, summary: 'No show' })
    expect(authed.post).toHaveBeenCalledWith('/candidates/c1/external-review', { attended: false, summary: 'No show' })
  })

  it('asks for a drafted summary', async () => {
    const input = { questions: [{ question_id: 'q1', rating: 4 }], ratings: { technical: 4 } }
    await candidatesApi.draftReviewSummary('c1', input)
    expect(authed.post).toHaveBeenCalledWith('/candidates/c1/external-review/draft-summary', input)
  })

  it('creates, lists and revokes interviewer links', async () => {
    await candidatesApi.createInterviewerLink('c1', { interviewer_name: 'Priya', interviewer_role: 'engineer', expires_in_days: 7 })
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/interviewer-links', { interviewer_name: 'Priya', interviewer_role: 'engineer', expires_in_days: 7 })
    await candidatesApi.listInterviewerLinks('c1')
    expect(authed.get).toHaveBeenLastCalledWith('/candidates/c1/interviewer-links')
    await candidatesApi.revokeInterviewerLink('c1', 'l1')
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/interviewer-links/l1/revoke')
  })
})

describe('own account, roles and notifications', () => {
  it('patches the own profile with only the fields given', async () => {
    await authApi.updateMe({ job_title: 'Talent Lead' })
    expect(authed.patch).toHaveBeenCalledWith('/auth/me', { job_title: 'Talent Lead' })
  })

  it('patches the own OTP switch', async () => {
    await authApi.setOtp(true)
    expect(authed.patch).toHaveBeenCalledWith('/auth/me/otp', { enabled: true })
  })

  it('reads the password policy', async () => {
    await authApi.passwordPolicy()
    expect(authed.get).toHaveBeenCalledWith('/auth/password-policy')
  })

  it('deletes a role with no reassignment parameter unless one is given', async () => {
    await rbacApi.deleteRole('qa_lead')
    expect(authed.delete).toHaveBeenLastCalledWith('/rbac/roles/qa_lead', { params: undefined })
    await rbacApi.deleteRole('qa lead', 'standard')
    expect(authed.delete).toHaveBeenLastCalledWith('/rbac/roles/qa%20lead', { params: { reassign_to: 'standard' } })
  })

  it('posts a test notification', async () => {
    await notificationSettingsApi.test()
    expect(authed.post).toHaveBeenCalledWith('/notification-settings/test')
  })
})

describe('authApi: the user list', () => {
  it('asks with no query at all by default, and with the paging and search given', async () => {
    await authApi.listUsers()
    expect(authed.get).toHaveBeenLastCalledWith('/auth/users')
    await authApi.listUsers({ limit: 100, skip: 0, search: 'ann' })
    expect(authed.get).toHaveBeenLastCalledWith('/auth/users', { params: { limit: 100, skip: 0, search: 'ann' } })
  })

  it('hands back the list as it came, with the X-Total-Count header read into total', async () => {
    authed.get.mockResolvedValueOnce({ data: [{ email: 'a@x.test' }], headers: { 'x-total-count': '230' } })
    const r = await authApi.listUsers({ limit: 1 })
    expect(r.data).toEqual([{ email: 'a@x.test' }])
    expect(r.total).toBe(230)
  })

  it('falls back to the length of the list when the header is missing or not a number', async () => {
    authed.get.mockResolvedValueOnce({ data: [{ email: 'a@x.test' }, { email: 'b@x.test' }], headers: {} })
    expect((await authApi.listUsers()).total).toBe(2)
    authed.get.mockResolvedValueOnce({ data: [{ email: 'a@x.test' }], headers: { 'x-total-count': 'many' } })
    expect((await authApi.listUsers()).total).toBe(1)
    authed.get.mockResolvedValueOnce({ data: [] })
    expect((await authApi.listUsers()).total).toBe(0)
  })
})

describe('authApi: the authenticator app and sign out everywhere', () => {
  it('reads the status and starts setup', async () => {
    await authApi.totpStatus()
    expect(authed.get).toHaveBeenLastCalledWith('/auth/me/totp')
    await authApi.totpSetup()
    expect(authed.post).toHaveBeenLastCalledWith('/auth/me/totp/setup')
  })

  it('enables with the code, disables with the password and a code, and makes new recovery codes with a code', async () => {
    await authApi.totpEnable('123456')
    expect(authed.post).toHaveBeenLastCalledWith('/auth/me/totp/enable', { code: '123456' })
    await authApi.totpDisable('S3cur3P@ss', '654321')
    expect(authed.post).toHaveBeenLastCalledWith('/auth/me/totp/disable', { password: 'S3cur3P@ss', code: '654321' })
    await authApi.totpRecoveryCodes('111222')
    expect(authed.post).toHaveBeenLastCalledWith('/auth/me/totp/recovery-codes', { code: '111222' })
  })

  it('resets another account with the email encoded in the path', async () => {
    await authApi.resetUserTotp('ann+hr@acme.test')
    expect(authed.post).toHaveBeenLastCalledWith('/auth/users/ann%2Bhr%40acme.test/totp/reset')
  })

  it('signs out everywhere', async () => {
    await authApi.signOutEverywhere()
    expect(authed.post).toHaveBeenLastCalledWith('/auth/me/sign-out-everywhere')
  })
})

describe('company single sign-on, public half', () => {
  it('reads the config of a company through the public client, with the slug as a query', async () => {
    await ssoApi.oidcConfig('acme')
    expect(publicClient.get).toHaveBeenCalledWith('/sso/oidc/config', { params: { company: 'acme' } })
    expect(authed.get).not.toHaveBeenCalled()
  })

  it('builds the login address as a plain link the browser follows', () => {
    expect(oidcLoginUrl('acme')).toMatch(/\/api\/v1\/sso\/oidc\/login\?company=acme$/)
    expect(oidcLoginUrl('a b&c')).toMatch(/\?company=a%20b%26c$/)
  })
})

describe('companySettingsApi: mail, sign-in, integrations and retention', () => {
  it('reads and saves the company mail, verifies it and sends a test message', async () => {
    await companySettingsApi.getMail()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/mail')
    await companySettingsApi.updateMail({ mode: 'smtp', host: 'smtp.acme.test', port: 587, password: 'secret' })
    expect(authed.put).toHaveBeenLastCalledWith('/company-settings/mail', { mode: 'smtp', host: 'smtp.acme.test', port: 587, password: 'secret' })
    await companySettingsApi.verifyMail()
    expect(authed.post).toHaveBeenLastCalledWith('/company-settings/mail/verify')
    await companySettingsApi.testMail('me@acme.test')
    expect(authed.post).toHaveBeenLastCalledWith('/company-settings/mail/test-send', { to: 'me@acme.test' })
  })

  it('reads and saves the single sign-on settings, and tests them with an issuer only when one is typed', async () => {
    await companySettingsApi.getSso()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/sso')
    await companySettingsApi.updateSso({ enabled: true, issuer: 'https://login.acme.test' })
    expect(authed.put).toHaveBeenLastCalledWith('/company-settings/sso', { enabled: true, issuer: 'https://login.acme.test' })
    await companySettingsApi.testSso()
    expect(authed.post).toHaveBeenLastCalledWith('/company-settings/sso/test', {})
    await companySettingsApi.testSso('https://login.acme.test')
    expect(authed.post).toHaveBeenLastCalledWith('/company-settings/sso/test', { issuer: 'https://login.acme.test' })
  })

  it('lists the integrations and saves one by name', async () => {
    await companySettingsApi.listIntegrations()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/integrations')
    await companySettingsApi.updateIntegration('zoom', { account_id: 'acc', clear_secret: true })
    expect(authed.put).toHaveBeenLastCalledWith('/company-settings/integrations/zoom', { account_id: 'acc', clear_secret: true })
  })

  it('reads and changes the retention periods', async () => {
    await companySettingsApi.getRetention()
    expect(authed.get).toHaveBeenLastCalledWith('/company-settings/retention')
    await companySettingsApi.updateRetention({ candidate_days: 365, resume_days: null })
    expect(authed.patch).toHaveBeenLastCalledWith('/company-settings/retention', { candidate_days: 365, resume_days: null })
  })
})

describe('candidatesApi: erasure', () => {
  it('erases one person with a POST that carries the reason, and the confirmation when given', async () => {
    await candidatesApi.erase('c1', { reason: 'Asked to be forgotten' })
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/erase', { reason: 'Asked to be forgotten' })
    await candidatesApi.erase('c1', { reason: 'Asked to be forgotten', include_employment: true })
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/c1/erase', { reason: 'Asked to be forgotten', include_employment: true })
  })

  it('erases by email', async () => {
    await candidatesApi.eraseByEmail({ email: 'ann@x.test', reason: 'Request' })
    expect(authed.post).toHaveBeenLastCalledWith('/candidates/erase-by-email', { email: 'ann@x.test', reason: 'Request' })
  })
})

describe('careersApi: the public careers site', () => {
  it('lists jobs with the filters as query parameters, through the public client', async () => {
    const params = { q: 'react', company: 'acme', remote: true, page: 2, limit: 12 }
    await careersApi.jobs(params)
    expect(publicClient.get).toHaveBeenLastCalledWith('/careers/jobs', { params })
    expect(authed.get).not.toHaveBeenCalled()
  })

  it('reads the filter options', async () => {
    await careersApi.filters()
    expect(publicClient.get).toHaveBeenLastCalledWith('/careers/filters')
  })

  it('reads one job with its id encoded', async () => {
    await careersApi.job('job 1/2')
    expect(publicClient.get).toHaveBeenLastCalledWith('/careers/jobs/job%201%2F2')
  })

  it('posts an application as the form data it is given', async () => {
    const body = new FormData()
    body.append('name', 'Ada Lovelace')
    await careersApi.apply('job-1', body)
    expect(publicClient.post).toHaveBeenLastCalledWith('/careers/jobs/job-1/apply', body)
    expect(authed.post).not.toHaveBeenCalled()
  })
})

describe('resumesApi: the filtered list, the options, the folders and the search by meaning', () => {
  const filters = {
    search: 'java', skill: 'Java,Kafka', business_domain: 'it_software',
    seniority: 'senior', status: 'processed', experience_min: 3, experience_max: 8, department: 'Java Developer',
    education_level: 'master', industry: 'fintech',
    salary_expectation_min: 50000, salary_expectation_max: 90000, worked_at_company: 'Acme',
  }

  it('lists with every filter as a query parameter, untouched', async () => {
    const params = { page: 2, limit: 20, ...filters }
    await resumesApi.list(params)
    expect(authed.get).toHaveBeenLastCalledWith('/resumes', { params })
  })

  it('lists with no parameters at all', async () => {
    await resumesApi.list()
    expect(authed.get).toHaveBeenLastCalledWith('/resumes', { params: undefined })
  })

  it('reads the filter options from /resumes/filters/options', async () => {
    await resumesApi.options()
    expect(authed.get).toHaveBeenLastCalledWith('/resumes/filters/options')
  })

  it('reads the domain folders with the other filters as query parameters', async () => {
    const params = { search: 'java', skill: 'Java', status: 'processed', seniority: 'senior' }
    await resumesApi.domains(params)
    expect(authed.get).toHaveBeenLastCalledWith('/resumes/domains', { params })
  })

  it('reads the domain folders with no filters', async () => {
    await resumesApi.domains()
    expect(authed.get).toHaveBeenLastCalledWith('/resumes/domains', { params: undefined })
  })

  it('searches by meaning with the query, the filters and a limit', async () => {
    const params = { q: 'senior backend engineer', limit: 50, ...filters }
    await resumesApi.semantic(params)
    expect(authed.get).toHaveBeenLastCalledWith('/resumes/search/semantic', { params })
  })

  it('returns the answer for the caller to read', async () => {
    authed.get.mockResolvedValueOnce({ data: { resumes: [{ resume_id: 'r1', match_score: 0.9 }], total: 1, query: 'x' } })
    const r = await resumesApi.semantic({ q: 'x' })
    expect(r.data.resumes[0].match_score).toBe(0.9)
  })

  it('passes a failed answer on, so the page can show the server message', async () => {
    const failure = { response: { status: 503, data: { detail: 'Semantic search is not available right now' } } }
    authed.get.mockRejectedValueOnce(failure)
    await expect(resumesApi.semantic({ q: 'x' })).rejects.toBe(failure)
  })

  it('does not use the public client for any of it', async () => {
    await resumesApi.options()
    await resumesApi.domains({})
    await resumesApi.semantic({ q: 'x' })
    expect(publicClient.get).not.toHaveBeenCalled()
  })
})

describe('savedFiltersApi: the saved searches of the resume page', () => {
  it('lists the ones of a scope', async () => {
    await savedFiltersApi.list('resumes')
    expect(authed.get).toHaveBeenLastCalledWith('/saved-filters', { params: { scope: 'resumes' } })
  })

  it('lists all of them when no scope is given', async () => {
    await savedFiltersApi.list()
    expect(authed.get).toHaveBeenLastCalledWith('/saved-filters', { params: undefined })
  })

  it('creates one with its name, filters and scope', async () => {
    const body = { name: 'Senior Java', filter_params: { skill: 'Java', seniority: 'senior' }, scope: 'resumes' }
    await savedFiltersApi.create(body)
    expect(authed.post).toHaveBeenLastCalledWith('/saved-filters', body)
  })

  it('deletes one by id', async () => {
    await savedFiltersApi.delete('t-1')
    expect(authed.delete).toHaveBeenLastCalledWith('/saved-filters/t-1')
  })
})
