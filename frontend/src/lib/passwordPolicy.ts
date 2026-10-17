import { useEffect, useState } from 'react'
import { authApi } from './api'

export interface PasswordPolicy {
  min_length?: number
  [rule: string]: unknown
}

const RULE_PHRASES: Record<string, string> = {
  uppercase: 'an uppercase letter',
  upper: 'an uppercase letter',
  lowercase: 'a lowercase letter',
  lower: 'a lowercase letter',
  digit: 'a number',
  digits: 'a number',
  number: 'a number',
  numeric: 'a number',
  special: 'a symbol',
  symbol: 'a symbol',
  punctuation: 'a symbol',
}

const RULE_KEY = /^(?:password_)?require[sd]?_(.+)$/

export function policyMinLength(policy: PasswordPolicy | null | undefined): number | null {
  if (!policy) return null
  const raw = policy.min_length ?? policy.password_min_length
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : null
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function describePasswordPolicy(policy: PasswordPolicy | null | undefined): string {
  if (!policy) return ''
  const required: string[] = []
  for (const [key, value] of Object.entries(policy)) {
    if (value !== true) continue
    const match = RULE_KEY.exec(key)
    if (!match) continue
    const name = match[1]
    const words = name.replace(/_/g, ' ')
    const phrase = RULE_PHRASES[name] ?? (/^no(t)?_/.test(name) ? words : `a ${words}`)
    if (!required.includes(phrase)) required.push(phrase)
  }

  const min = policyMinLength(policy)
  const length = min !== null && min > 1 ? `At least ${min} characters` : ''
  if (length && required.length) return `${length}, with ${joinList(required)}`
  if (length) return length
  if (required.length) return `Must include ${joinList(required)}`
  return ''
}

export function usePasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null)

  useEffect(() => {
    let live = true
    Promise.resolve()
      .then(() => authApi.passwordPolicy())
      .then(r => {
        const data = r?.data
        if (live && data && typeof data === 'object') setPolicy(data as PasswordPolicy)
      })
      .catch(() => { })
    return () => { live = false }
  }, [])

  return { policy, hint: describePasswordPolicy(policy), minLength: policyMinLength(policy) }
}
