
export type GuideRole = 'superadmin' | 'admin' | 'standard'

export interface GuideControl {
  name: string
  kind?: 'button' | 'filter' | 'field' | 'toggle' | 'tab' | 'menu' | 'column' | 'badge' | 'link'
  what: string
  how?: string
  access?: string
}

export interface GuideSubsection {
  id: string
  title: string
  body?: string[]
  steps?: string[]
  controls?: GuideControl[]
  tips?: string[]
  warnings?: string[]
  faqs?: { q: string; a: string }[]
}

export interface GuideSection {
  id: string
  title: string
  path?: string
  summary: string
  access?: string
  subsections: GuideSubsection[]
}

export interface GuideChapter {
  id: string
  title: string
  blurb?: string
  sections: GuideSection[]
}

export interface RoleGuide {
  role: GuideRole
  label: string
  tagline: string
  intro: string[]
  chapters: GuideChapter[]
}

export const ROLE_RANK: Record<GuideRole, number> = {
  standard: 1,
  admin: 2,
  superadmin: 3,
}
