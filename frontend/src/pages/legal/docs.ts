import type { LegalDoc } from '../../components/site/blockModel'
import { TERMS } from './content/terms'
import { PRIVACY } from './content/privacy'
import { CANDIDATE_PRIVACY } from './content/candidatePrivacy'
import { COOKIES } from './content/cookies'
import { ACCEPTABLE_USE } from './content/acceptableUse'
import { DPA } from './content/dpa'
import { SUBPROCESSORS } from './content/subprocessors'
import { ACCESSIBILITY } from './content/accessibility'

export const LEGAL_DOCS: Record<string, LegalDoc> = {
  'terms': TERMS,
  'privacy': PRIVACY,
  'candidate-privacy': CANDIDATE_PRIVACY,
  'cookies': COOKIES,
  'acceptable-use': ACCEPTABLE_USE,
  'dpa': DPA,
  'subprocessors': SUBPROCESSORS,
  'accessibility': ACCESSIBILITY,
}
