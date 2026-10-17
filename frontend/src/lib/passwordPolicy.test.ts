import { describe, expect, it } from 'vitest'
import { describePasswordPolicy, policyMinLength, type PasswordPolicy } from './passwordPolicy'

describe('describePasswordPolicy', () => {
  it('says nothing without a policy', () => {
    expect(describePasswordPolicy(null)).toBe('')
    expect(describePasswordPolicy(undefined)).toBe('')
    expect(describePasswordPolicy({})).toBe('')
  })

  it('says nothing for the permissive default of one character and no rules', () => {
    expect(describePasswordPolicy({ min_length: 1, require_uppercase: false, require_digit: false })).toBe('')
  })

  it('states the length alone', () => {
    expect(describePasswordPolicy({ min_length: 8 })).toBe('At least 8 characters')
  })

  it('lists every rule that is on, in the order the server sent them', () => {
    expect(describePasswordPolicy({
      min_length: 12, require_uppercase: true, require_lowercase: true, require_digit: true, require_special: true,
    })).toBe('At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol')
  })

  it('leaves out a rule that is off', () => {
    expect(describePasswordPolicy({ min_length: 10, require_uppercase: false, require_digit: true }))
      .toBe('At least 10 characters, with a number')
  })

  it('reads the names the security policy itself uses', () => {
    expect(describePasswordPolicy({ password_min_length: 9, password_require_number: true, password_require_symbol: true }))
      .toBe('At least 9 characters, with a number and a symbol')
  })

  it('does not say a number twice when two flags mean it', () => {
    expect(describePasswordPolicy({ min_length: 8, require_digit: true, require_number: true }))
      .toBe('At least 8 characters, with a number')
  })

  it('describes a rule it has no wording for from its own name', () => {
    expect(describePasswordPolicy({ min_length: 8, require_no_spaces: true }))
      .toBe('At least 8 characters, with no spaces')
    expect(describePasswordPolicy({ min_length: 8, require_mixed_case: true }))
      .toBe('At least 8 characters, with a mixed case')
  })

  it('states the rules alone when there is no length worth stating', () => {
    expect(describePasswordPolicy({ min_length: 1, require_digit: true })).toBe('Must include a number')
    expect(describePasswordPolicy({ require_digit: true, require_special: true })).toBe('Must include a number and a symbol')
  })

  it('ignores flags that are not rules and values that are not true', () => {
    expect(describePasswordPolicy({ min_length: 8, lockout: true, require_digit: 'yes', require_special: 1 })).toBe('At least 8 characters')
  })
})

describe('policyMinLength', () => {
  it('reads the length, whichever name carries it', () => {
    expect(policyMinLength({ min_length: 12 })).toBe(12)
    expect(policyMinLength({ password_min_length: 6 })).toBe(6)
  })

  it('is null when the policy does not say or says something unusable', () => {
    expect(policyMinLength(null)).toBeNull()
    expect(policyMinLength({})).toBeNull()
    expect(policyMinLength({ min_length: 0 })).toBeNull()
    expect(policyMinLength({ min_length: '8' } as unknown as PasswordPolicy)).toBeNull()
    expect(policyMinLength({ min_length: Number.NaN })).toBeNull()
  })
})
