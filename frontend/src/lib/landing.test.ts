import { describe, expect, it } from 'vitest'
import { landingPathFor } from './landing'

describe('landingPathFor', () => {
  it('sends a platform owner to the console, whichever workspace the account is filed under', () => {
    expect(landingPathFor({ is_platform_admin: true, workspace_kind: 'workspace' })).toBe('/platform')
    expect(landingPathFor({ is_platform_admin: true, workspace_kind: 'platform' })).toBe('/platform')
    expect(landingPathFor({ is_platform_admin: true })).toBe('/platform')
  })

  it('sends an account in the internal platform workspace to the console', () => {
    expect(landingPathFor({ workspace_kind: 'platform' })).toBe('/platform')
  })

  it("sends a customer's people to their own dashboard", () => {
    expect(landingPathFor({ workspace_kind: 'workspace', is_platform_admin: false })).toBe('/dashboard')
    expect(landingPathFor({ workspace_kind: 'workspace' })).toBe('/dashboard')
  })

  it('sends a session with no workspace fields, or none at all, to the dashboard', () => {
    expect(landingPathFor({})).toBe('/dashboard')
    expect(landingPathFor(null)).toBe('/dashboard')
    expect(landingPathFor(undefined)).toBe('/dashboard')
  })

  it('does not take anything but true for a platform owner', () => {
    expect(landingPathFor({ is_platform_admin: 'yes' as unknown as boolean })).toBe('/dashboard')
  })
})
