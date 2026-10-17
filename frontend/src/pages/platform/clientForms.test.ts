import { describe, expect, it } from 'vitest'
import {
  EMPTY_NEW_CLIENT, EMPTY_NEW_COMPANY, FALLBACK_PLAN_FEATURES, MAX_REASON_LENGTH, buildAdminInput, buildClientPatch,
  buildNewClientInput, buildNewCompanyInput, buildOwnerInput, clientFieldsFrom, completeFeatures, fieldsFromTier,
  firstBadDomain, parseDomains, validateAdminForm, validateClientEdit, validateNewClient, validateNewCompany,
  validatePassword, validateReason,
  type NewClientForm,
} from './clientForms'
import { clientRow } from '../../test/platformFixtures'

const filled = (over: Partial<NewClientForm> = {}): NewClientForm => ({ ...EMPTY_NEW_CLIENT, name: 'Acme', ...over })
const admin = { adminName: 'Sam Lee', adminEmail: 'sam@acme.test', adminPassword: 'S3cur3P@ssword!' }

describe('validateNewClient', () => {
  it('needs only a name', () => {
    expect(validateNewClient(filled())).toEqual({})
    expect(validateNewClient(EMPTY_NEW_CLIENT)).toEqual({ name: "Enter the client's name." })
    expect(validateNewClient(filled({ name: '   ' }))).toHaveProperty('name')
  })

  it('checks the contact email only when there is one', () => {
    expect(validateNewClient(filled({ contactEmail: '' }))).toEqual({})
    expect(validateNewClient(filled({ contactEmail: 'dana@acme.test' }))).toEqual({})
    expect(validateNewClient(filled({ contactEmail: 'dana@' }))).toHaveProperty('contactEmail')
  })

  it('wants whole numbers of 1 or more for the plan limits, and an amount of 0 or more for the budget', () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      expect(validateNewClient(filled({ maxCompanies: bad }))).toHaveProperty('maxCompanies')
      expect(validateNewClient(filled({ maxUsers: bad }))).toHaveProperty('maxUsers')
    }
    expect(validateNewClient(filled({ maxCompanies: '3', maxUsers: '50' }))).toEqual({})
    expect(validateNewClient(filled({ aiBudget: '0' }))).toEqual({})
    expect(validateNewClient(filled({ aiBudget: '12.5' }))).toEqual({})
    expect(validateNewClient(filled({ aiBudget: '-1' }))).toHaveProperty('aiBudget')
    expect(validateNewClient(filled({ aiBudget: 'lots' }))).toHaveProperty('aiBudget')
  })

  it('leaves the administrator alone until a first company is asked for', () => {
    expect(validateNewClient(filled({ withCompany: false, adminEmail: 'nonsense' }))).toEqual({})
  })

  it('needs a name and an email for the administrator once a first company is asked for, and no password', () => {
    const errors = validateNewClient(filled({ withCompany: true }))
    expect(Object.keys(errors).sort()).toEqual(['adminEmail', 'adminName'])
    expect(validateNewClient(filled({ withCompany: true, ...admin }))).toEqual({})
    expect(validateNewClient(filled({ withCompany: true, ...admin, adminPassword: '' }))).toEqual({})
  })

  it('wants a password of at least 8 characters when one is typed', () => {
    expect(validateNewClient(filled({ withCompany: true, ...admin, adminPassword: '1234567' }))).toHaveProperty('adminPassword')
    expect(validateNewClient(filled({ withCompany: true, ...admin, adminPassword: '12345678' }))).toEqual({})
  })

  it('does not check a password that will not be sent because an invitation was chosen', () => {
    expect(validateNewClient(filled({ withCompany: true, ...admin, adminPassword: 'short', adminInvite: true }))).toEqual({})
  })
})

describe('buildNewClientInput', () => {
  it('sends just the trimmed name when nothing else is set', () => {
    expect(buildNewClientInput(filled({ name: '  Acme  ' }))).toEqual({ name: 'Acme' })
  })

  it('leaves out the plan when no plan field is set, and out any blank field', () => {
    const body = buildNewClientInput(filled({ planName: '  ', maxCompanies: '', contactName: ' ', notes: '' }))
    expect(body).toEqual({ name: 'Acme' })
    expect(body).not.toHaveProperty('plan')
  })

  it('turns the plan strings into numbers', () => {
    expect(buildNewClientInput(filled({ planName: 'growth', maxCompanies: '3', maxUsers: '50', aiBudget: '100.5' }))).toEqual({
      name: 'Acme',
      plan: { name: 'growth', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 100.5 },
    })
  })

  it('sends a plan with only the fields that were filled in', () => {
    expect(buildNewClientInput(filled({ maxUsers: '10' })).plan).toEqual({ max_users_per_company: 10 })
    expect(buildNewClientInput(filled({ aiBudget: '0' })).plan).toEqual({ monthly_ai_budget_usd: 0 })
  })

  it('sends the contact details trimmed', () => {
    expect(buildNewClientInput(filled({ contactName: ' Dana ', contactEmail: ' dana@acme.test ', notes: ' Pilot ' }))).toEqual({
      name: 'Acme', contact_name: 'Dana', contact_email: 'dana@acme.test', notes: 'Pilot',
    })
  })

  it('adds the first company only when asked, naming it after the client when it has no name', () => {
    expect(buildNewClientInput(filled({ withCompany: false, companyName: 'Ignored', ...admin }))).not.toHaveProperty('company')
    expect(buildNewClientInput(filled({ withCompany: true, ...admin })).company).toEqual({
      name: 'Acme',
      admin: { name: 'Sam Lee', email: 'sam@acme.test', password: 'S3cur3P@ssword!' },
    })
    expect(buildNewClientInput(filled({ withCompany: true, companyName: ' Acme Corp ', companySlug: ' acme-corp ', ...admin })).company).toEqual({
      name: 'Acme Corp',
      slug: 'acme-corp',
      admin: { name: 'Sam Lee', email: 'sam@acme.test', password: 'S3cur3P@ssword!' },
    })
  })

  it('never trims a password', () => {
    const body = buildNewClientInput(filled({ withCompany: true, ...admin, adminPassword: ' padded pass ' }))
    expect(body.company?.admin.password).toBe(' padded pass ')
  })
})

describe('company, administrator and password forms', () => {
  it('needs a company name and an administrator with a name and an email', () => {
    expect(Object.keys(validateNewCompany(EMPTY_NEW_COMPANY)).sort()).toEqual(['adminEmail', 'adminName', 'name'])
    expect(validateNewCompany({ ...EMPTY_NEW_COMPANY, name: 'Acme East', ...admin })).toEqual({})
  })

  it('builds the company request with the slug only when given', () => {
    expect(buildNewCompanyInput({ ...EMPTY_NEW_COMPANY, name: ' Acme East ', ...admin })).toEqual({
      name: 'Acme East',
      admin: { name: 'Sam Lee', email: 'sam@acme.test', password: 'S3cur3P@ssword!' },
    })
    expect(buildNewCompanyInput({ ...EMPTY_NEW_COMPANY, name: 'Acme East', slug: 'east', ...admin }).slug).toBe('east')
  })

  it('names the person in the messages', () => {
    const empty = { adminName: '', adminEmail: '', adminPassword: '' }
    expect(validateAdminForm(empty).adminName).toBe("Enter the administrator's name.")
    expect(validateAdminForm(empty, 'owner').adminName).toBe("Enter the owner's name.")
    expect(validateAdminForm(empty, 'owner').adminEmail).toBe("Enter the owner's email.")
  })

  it('builds an administrator request from the form', () => {
    expect(buildAdminInput({ adminName: ' Sam ', adminEmail: ' sam@acme.test ', adminPassword: 'S3cur3P@ssword!' })).toEqual({
      name: 'Sam', email: 'sam@acme.test', password: 'S3cur3P@ssword!',
    })
  })

  it('checks a lone password', () => {
    expect(validatePassword('')).toBe('Enter a password.')
    expect(validatePassword('short')).toBe('Use at least 8 characters.')
    expect(validatePassword('long enough')).toBe('')
  })
})

describe('SSO domains', () => {
  it('splits on lines, commas, semicolons and spaces, lower-cases, drops @, and removes repeats', () => {
    expect(parseDomains('ACME.test, @Other.com\nacme.test;third.io  fourth.co')).toEqual(['acme.test', 'other.com', 'third.io', 'fourth.co'])
  })

  it('is empty for nothing', () => {
    expect(parseDomains('')).toEqual([])
    expect(parseDomains(' \n , ')).toEqual([])
  })

  it('accepts hostnames and finds the first thing that is not one', () => {
    expect(firstBadDomain(['acme.test', 'mail.acme.co.uk', 'a-b.io'])).toBeNull()
    expect(firstBadDomain([])).toBeNull()
    expect(firstBadDomain(['acme.test', 'localhost', 'x.y'])).toBe('localhost')
    expect(firstBadDomain(['-bad.com'])).toBe('-bad.com')
    expect(firstBadDomain(['has space.com'])).toBe('has space.com')
    expect(firstBadDomain(['acme.t'])).toBe('acme.t')
  })
})

describe('an administrator who is invited', () => {
  it('sends no password when none was typed', () => {
    expect(buildAdminInput({ adminName: 'Sam', adminEmail: 'sam@acme.test', adminPassword: '' })).toEqual({ name: 'Sam', email: 'sam@acme.test' })
  })

  it('sends no password when the invitation was chosen, whatever was typed first', () => {
    expect(buildAdminInput({ adminName: 'Sam', adminEmail: 'sam@acme.test', adminPassword: 'S3cur3P@ssword!', adminInvite: true })).toEqual({
      name: 'Sam', email: 'sam@acme.test',
    })
  })

  it('sends the password, as typed, when there is one and no invitation was chosen', () => {
    expect(buildAdminInput({ adminName: 'Sam', adminEmail: 'sam@acme.test', adminPassword: ' S3cur3 ', adminInvite: false })).toEqual({
      name: 'Sam', email: 'sam@acme.test', password: ' S3cur3 ',
    })
  })

  it('reaches the company and the client requests', () => {
    expect(buildNewCompanyInput({ ...EMPTY_NEW_COMPANY, name: 'Acme East', ...admin, adminInvite: true }).admin).toEqual({
      name: 'Sam Lee', email: 'sam@acme.test',
    })
    expect(buildNewClientInput(filled({ withCompany: true, ...admin, adminPassword: '' })).company?.admin).toEqual({
      name: 'Sam Lee', email: 'sam@acme.test',
    })
  })

  it('still needs a name and a valid email', () => {
    expect(Object.keys(validateAdminForm({ adminName: '', adminEmail: 'nope', adminPassword: '', adminInvite: true })).sort()).toEqual(['adminEmail', 'adminName'])
  })

  it('wants a typed password to be 8 characters or more, unless the invitation was chosen', () => {
    const form = { adminName: 'Sam', adminEmail: 'sam@acme.test', adminPassword: 'short' }
    expect(validateAdminForm(form)).toHaveProperty('adminPassword')
    expect(validateAdminForm({ ...form, adminInvite: true })).toEqual({})
    expect(validateAdminForm({ ...form, adminPassword: '' })).toEqual({})
  })
})

describe('a platform owner', () => {
  const owner = { adminName: 'Olive', adminEmail: 'olive@hirely.test', adminPassword: '' }

  it('always needs a password of at least 8 characters', () => {
    expect(validateAdminForm(owner, 'owner', true).adminPassword).toBe('Enter a password.')
    expect(validateAdminForm({ ...owner, adminPassword: 'short' }, 'owner', true).adminPassword).toBe('Use at least 8 characters.')
    expect(validateAdminForm({ ...owner, adminPassword: '12345678' }, 'owner', true)).toEqual({})
  })

  it('cannot be invited instead: the choice is ignored for a required password', () => {
    expect(validateAdminForm({ ...owner, adminInvite: true }, 'owner', true).adminPassword).toBe('Enter a password.')
  })

  it('is sent with its password, trimmed name and email', () => {
    expect(buildOwnerInput({ adminName: ' Olive ', adminEmail: ' olive@hirely.test ', adminPassword: 'S3cur3P@ssword!' })).toEqual({
      name: 'Olive', email: 'olive@hirely.test', password: 'S3cur3P@ssword!',
    })
  })
})

describe('editing a client', () => {
  const plan = { name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120.5 }
  const client = clientRow({ plan, contact_name: 'Dana', contact_email: 'dana@acme.test', notes: 'Pilot' })

  it('fills the form from the client, and a missing limit is blank', () => {
    expect(clientFieldsFrom(client)).toEqual({
      name: 'Acme Holdings', planName: 'scale', maxCompanies: '3', maxUsers: '50', aiBudget: '120.5',
      contactName: 'Dana', contactEmail: 'dana@acme.test', notes: 'Pilot',
      tier: '', maxStorage: '', price: '', trialEnds: '', features: {},
    })
    expect(clientFieldsFrom(clientRow({ plan: null, contact_name: null, contact_email: null, notes: null }))).toEqual({
      name: 'Acme Holdings', planName: '', maxCompanies: '', maxUsers: '', aiBudget: '', contactName: '', contactEmail: '', notes: '',
      tier: '', maxStorage: '', price: '', trialEnds: '', features: {},
    })
    expect(clientFieldsFrom(clientRow({ plan: { monthly_ai_budget_usd: 0, max_users_per_company: null } })).aiBudget).toBe('0')
  })

  it('sends nothing when nothing changed', () => {
    expect(buildClientPatch(client, clientFieldsFrom(client))).toEqual({})
  })

  it('does not take surrounding spaces for a change', () => {
    expect(buildClientPatch(client, { ...clientFieldsFrom(client), name: ' Acme Holdings ', notes: ' Pilot ' })).toEqual({})
  })

  it('sends only the fields that changed', () => {
    const f = clientFieldsFrom(client)
    expect(buildClientPatch(client, { ...f, name: 'Acme Group' })).toEqual({ name: 'Acme Group' })
    expect(buildClientPatch(client, { ...f, contactEmail: 'ops@acme.test' })).toEqual({ contact_email: 'ops@acme.test' })
    expect(buildClientPatch(client, { ...f, notes: 'Live' })).toEqual({ notes: 'Live' })
  })

  it('sends the whole plan when any one of its fields changed, with a blank limit as null', () => {
    const f = clientFieldsFrom(client)
    expect(buildClientPatch(client, { ...f, maxUsers: '75' })).toEqual({
      plan: { name: 'scale', max_companies: 3, max_users_per_company: 75, monthly_ai_budget_usd: 120.5 },
    })
    expect(buildClientPatch(client, { ...f, maxCompanies: '' })).toEqual({
      plan: { name: 'scale', max_companies: null, max_users_per_company: 50, monthly_ai_budget_usd: 120.5 },
    })
    expect(buildClientPatch(client, { ...f, planName: '' }).plan?.name).toBeNull()
  })

  it('treats a budget of nothing as a budget, not as unlimited', () => {
    const f = clientFieldsFrom(client)
    expect(buildClientPatch(client, { ...f, aiBudget: '0' }).plan?.monthly_ai_budget_usd).toBe(0)
  })

  it('clears a contact with an empty string', () => {
    expect(buildClientPatch(client, { ...clientFieldsFrom(client), contactName: '  ' })).toEqual({ contact_name: '' })
  })

  it('does not call a client with no plan at all changed when the plan stays blank', () => {
    const bare = clientRow({ plan: null })
    expect(buildClientPatch(bare, clientFieldsFrom(bare))).toEqual({})
  })

  it('validates what an edit can get wrong', () => {
    const f = clientFieldsFrom(client)
    expect(validateClientEdit(f)).toEqual({})
    expect(validateClientEdit({ ...f, name: ' ' })).toHaveProperty('name')
    expect(validateClientEdit({ ...f, maxCompanies: '0' })).toHaveProperty('maxCompanies')
    expect(validateClientEdit({ ...f, maxUsers: '2.5' })).toHaveProperty('maxUsers')
    expect(validateClientEdit({ ...f, aiBudget: '-1' })).toHaveProperty('aiBudget')
    expect(validateClientEdit({ ...f, contactEmail: 'dana@' })).toHaveProperty('contactEmail')
  })
})

describe('validateReason', () => {
  it('needs something other than spaces', () => {
    expect(validateReason('')).toBe('Enter a reason.')
    expect(validateReason('   ')).toBe('Enter a reason.')
    expect(validateReason('Unpaid invoice')).toBe('')
  })

  it('takes up to 500 characters, counted after trimming', () => {
    expect(validateReason('x'.repeat(MAX_REASON_LENGTH))).toBe('')
    expect(validateReason(` ${'x'.repeat(MAX_REASON_LENGTH)} `)).toBe('')
    expect(validateReason('x'.repeat(MAX_REASON_LENGTH + 1))).toBe('Use at most 500 characters.')
  })
})

describe('the plan: tier, storage, price, trial and features', () => {
  const FEATURE_KEYS = FALLBACK_PLAN_FEATURES.map(f => f.key)

  it('offers the eight flags the server knows, in case the catalog cannot be read', () => {
    expect(FEATURE_KEYS).toEqual(['coding', 'performance', 'webhooks', 'workflows', 'custom_smtp', 'oidc_sso', 'custom_domain', 'integrations'])
  })

  it('fills the form from a tier, leaving the trial and the contact alone', () => {
    const growth = {
      tier: 'growth', label: 'Growth',
      plan: {
        name: 'growth', max_companies: 3, max_users_per_company: 25, monthly_ai_budget_usd: 50, max_storage_mb: 5000,
        price_monthly_usd: 99, features: { webhooks: false, oidc_sso: false }, trial_ends_at: null,
      },
    }
    const filledForm = fieldsFromTier(growth, FEATURE_KEYS)
    expect(filledForm).toEqual({
      tier: 'growth', planName: 'growth', maxCompanies: '3', maxUsers: '25', aiBudget: '50', maxStorage: '5000', price: '99',
      features: { coding: true, performance: true, webhooks: false, workflows: true, custom_smtp: true, oidc_sso: false, custom_domain: true, integrations: true },
    })
    expect(filledForm).not.toHaveProperty('trialEnds')
    expect(filledForm).not.toHaveProperty('contactName')
  })

  it('fills a blank for a limit the tier does not set', () => {
    const standard = { tier: 'standard', label: 'Standard', plan: { name: 'standard', max_companies: null, features: {} } }
    expect(fieldsFromTier(standard, ['coding'])).toMatchObject({ maxCompanies: '', maxUsers: '', maxStorage: '', price: '', features: { coding: true } })
  })

  it('completes a partial set of flags, a flag it does not name being on', () => {
    expect(completeFeatures({ webhooks: false }, ['webhooks', 'coding'])).toEqual({ webhooks: false, coding: true })
    expect(completeFeatures(undefined, ['coding'])).toEqual({ coding: true })
  })

  describe('a new client', () => {
    it('sends storage, price and the trial date as typed', () => {
      expect(buildNewClientInput(filled({ maxStorage: '2000', price: '49.5', trialEnds: '2026-11-30' })).plan).toEqual({
        max_storage_mb: 2000, price_monthly_usd: 49.5, trial_ends_at: '2026-11-30',
      })
    })

    it('sends the tier, with a limit left blank as null so it beats the preset', () => {
      const body = buildNewClientInput(filled({ tier: 'growth', planName: 'growth', maxCompanies: '3' }))
      expect(body.plan).toEqual({
        tier: 'growth', name: 'growth', max_companies: 3, max_users_per_company: null, monthly_ai_budget_usd: null,
        max_storage_mb: null, price_monthly_usd: null, trial_ends_at: null,
      })
    })

    it('sends the flags only for a tier or when one is off', () => {
      const all = { coding: true, webhooks: true }
      expect(buildNewClientInput(filled({ features: all })).plan).toBeUndefined()
      expect(buildNewClientInput(filled({ features: { ...all, webhooks: false } })).plan).toEqual({ features: { coding: true, webhooks: false } })
      expect(buildNewClientInput(filled({ tier: 'growth', features: all })).plan?.features).toEqual(all)
    })

    it('leaves the flags out when none are known yet', () => {
      expect(buildNewClientInput(filled({ tier: 'growth', features: {} })).plan).not.toHaveProperty('features')
    })

    it.each([['maxStorage', '0'], ['maxStorage', '1.5'], ['maxStorage', 'big'], ['price', '-1'], ['price', 'free'], ['trialEnds', '30/11/2026'], ['trialEnds', '2026-02-30']])(
      'refuses %s of %j', (field, value) => {
        expect(validateNewClient(filled({ [field]: value }))).toHaveProperty(field)
      },
    )

    it('accepts a price of nothing, a plain date and a whole number of megabytes', () => {
      expect(validateNewClient(filled({ price: '0', trialEnds: '2026-11-30', maxStorage: '500' }))).toEqual({})
    })
  })

  describe('editing a client', () => {
    const plan = {
      name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120.5,
      max_storage_mb: 4000, price_monthly_usd: 199, trial_ends_at: '2026-11-30T23:59:59+00:00', features: { webhooks: false },
    }
    const client = clientRow({ plan })

    it('fills storage, price, the trial day and the flags from the plan', () => {
      expect(clientFieldsFrom(client)).toMatchObject({
        maxStorage: '4000', price: '199', trialEnds: '2026-11-30', features: { webhooks: false }, tier: '',
      })
    })

    it('sends nothing when nothing changed, however much the plan holds', () => {
      expect(buildClientPatch(client, clientFieldsFrom(client))).toEqual({})
    })

    it('sends the whole plan, flags included, when the storage changed', () => {
      expect(buildClientPatch(client, { ...clientFieldsFrom(client), maxStorage: '8000' })).toEqual({
        plan: {
          name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120.5,
          max_storage_mb: 8000, price_monthly_usd: 199, trial_ends_at: '2026-11-30T23:59:59+00:00', features: { webhooks: false },
        },
      })
    })

    it('clears storage and price with null, and a trial with null', () => {
      const f = { ...clientFieldsFrom(client), maxStorage: '', price: '', trialEnds: '' }
      expect(buildClientPatch(client, f).plan).toMatchObject({ max_storage_mb: null, price_monthly_usd: null, trial_ends_at: null })
    })

    it('sends a new trial day as the bare date, and keeps the stored time when the day did not change', () => {
      const f = clientFieldsFrom(client)
      expect(buildClientPatch(client, { ...f, trialEnds: '2026-12-15' }).plan?.trial_ends_at).toBe('2026-12-15')
      expect(buildClientPatch(client, { ...f, maxUsers: '75' }).plan?.trial_ends_at).toBe('2026-11-30T23:59:59+00:00')
    })

    it('counts a flag turned on or off as a change, and sends every flag the form knows', () => {
      const f = clientFieldsFrom(client)
      const patch = buildClientPatch(client, { ...f, features: { ...completeFeatures(f.features, ['webhooks', 'coding']), coding: false } })
      expect(patch.plan?.features).toEqual({ webhooks: false, coding: false })
    })

    it('does not count a flag that is on by default being written down as on', () => {
      const f = clientFieldsFrom(client)
      expect(buildClientPatch(client, { ...f, features: { ...f.features, coding: true } })).toEqual({})
    })

    it('sends the tier chosen this session, which always counts as a change', () => {
      const f = clientFieldsFrom(client)
      expect(buildClientPatch(client, { ...f, tier: 'growth' }).plan?.tier).toBe('growth')
    })

    it('gives a client with no new plan fields the same plan as before', () => {
      const old = clientRow({ plan: { name: 'scale', max_companies: 3, max_users_per_company: 50, monthly_ai_budget_usd: 120.5 } })
      expect(buildClientPatch(old, { ...clientFieldsFrom(old), maxUsers: '75' })).toEqual({
        plan: { name: 'scale', max_companies: 3, max_users_per_company: 75, monthly_ai_budget_usd: 120.5 },
      })
    })

    it('validates the new fields on an edit too', () => {
      const f = clientFieldsFrom(client)
      expect(validateClientEdit({ ...f, maxStorage: '0' })).toHaveProperty('maxStorage')
      expect(validateClientEdit({ ...f, price: '-5' })).toHaveProperty('price')
      expect(validateClientEdit({ ...f, trialEnds: 'soon' })).toHaveProperty('trialEnds')
    })
  })
})
