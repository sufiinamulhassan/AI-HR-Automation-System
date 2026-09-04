import type { RoleGuide } from '../types'
import { superAdminGuide } from './superAdminGuide'
import { hrAdminGuide } from './hrAdminGuide'
import { recruiterGuide } from './recruiterGuide'

export const GUIDES: RoleGuide[] = [superAdminGuide, hrAdminGuide, recruiterGuide]

export { superAdminGuide, hrAdminGuide, recruiterGuide }
