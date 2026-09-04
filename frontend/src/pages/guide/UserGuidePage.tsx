import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../store/auth.store'
import { userGuideApi } from '../../lib/api'
import { GUIDES } from './content'
import {
  ROLE_RANK,
  type GuideChapter,
  type GuideControl,
  type GuideRole,
  type GuideSection,
  type GuideSubsection,
  type RoleGuide,
} from './types'
import './UserGuidePage.css'

const OVERVIEW = 'overview'


function isGuideLike(v: unknown): v is RoleGuide {
  if (!v || typeof v !== 'object') return false
  const g = v as Partial<RoleGuide>
  return typeof g.role === 'string' && g.role in ROLE_RANK && Array.isArray(g.chapters) && g.chapters.length > 0
}

function unwrap(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc
  const d = doc as Record<string, unknown>
  if (Array.isArray(d.chapters)) return d
  if (d.guide && typeof d.guide === 'object') {
    const inner = d.guide as Record<string, unknown>
    return { ...inner, role: inner.role ?? d.role }
  }
  return d
}

function extractGuides(payload: unknown): RoleGuide[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  const raw: unknown[] = Array.isArray(payload) ? payload
    : Array.isArray(p.guides) ? p.guides
    : Array.isArray(p.items) ? p.items
    : Object.values(p)
  return raw.map(unwrap).filter(isGuideLike)
}

function mergeGuides(bundled: RoleGuide[], fromServer: RoleGuide[]): RoleGuide[] {
  if (fromServer.length === 0) return bundled
  const byRole = new Map<GuideRole, RoleGuide>()
  for (const g of bundled) byRole.set(g.role, g)
  for (const g of fromServer) byRole.set(g.role, g)
  return [...byRole.values()].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])
}


interface FlatSection {
  key: string
  chapter: GuideChapter
  section: GuideSection
  haystack: string
}

function sectionText(chapter: GuideChapter, s: GuideSection): string {
  const parts: string[] = [chapter.title, chapter.blurb || '', s.title, s.summary, s.access || '', s.path || '']
  for (const sub of s.subsections || []) {
    parts.push(sub.title, ...(sub.body || []), ...(sub.steps || []), ...(sub.tips || []), ...(sub.warnings || []))
    for (const c of sub.controls || []) parts.push(c.name, c.kind || '', c.what, c.how || '', c.access || '')
    for (const f of sub.faqs || []) parts.push(f.q, f.a)
  }
  return parts.join(' • ').toLowerCase()
}

function flatten(guide: RoleGuide | undefined): FlatSection[] {
  if (!guide) return []
  const out: FlatSection[] = []
  for (const chapter of guide.chapters || []) {
    for (const section of chapter.sections || []) {
      out.push({ key: `${chapter.id}/${section.id}`, chapter, section, haystack: sectionText(chapter, section) })
    }
  }
  return out
}

function toGuideRole(raw: unknown): GuideRole {
  return raw === 'superadmin' || raw === 'admin' ? raw : 'standard'
}


const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
)

const ListIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
)

const ChevronLeftIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)


function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))
}

function ControlTable({ controls }: { controls: GuideControl[] }) {
  return (
    <div className="guide-table-wrap">
      <table className="guide-table">
        <thead>
          <tr>
            <th>Control</th>
            <th>Type</th>
            <th>What it does</th>
            <th>How to use it</th>
          </tr>
        </thead>
        <tbody>
          {controls.map((c, i) => (
            <tr key={`${c.name}-${i}`}>
              <td data-label="Control">
                <span className="guide-ctl-name">{c.name}</span>
                {c.access && <span className="guide-badge guide-badge-restricted">{c.access}</span>}
              </td>
              <td data-label="Type">
                {c.kind ? <span className="guide-kind">{c.kind}</span> : <span className="guide-dash">-</span>}
              </td>
              <td data-label="What it does">{renderInline(c.what)}</td>
              <td data-label="How to use it">{c.how ? renderInline(c.how) : <span className="guide-dash">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Subsection({ sub }: { sub: GuideSubsection }) {
  return (
    <section className="guide-sub" id={sub.id}>
      <h3 className="guide-sub-title">{sub.title}</h3>

      {sub.body?.map((p, i) => <p key={i} className="guide-p">{renderInline(p)}</p>)}

      {sub.steps && sub.steps.length > 0 && (
        <ol className="guide-steps">
          {sub.steps.map((s, i) => <li key={i}>{renderInline(s)}</li>)}
        </ol>
      )}

      {sub.controls && sub.controls.length > 0 && <ControlTable controls={sub.controls} />}

      {sub.tips && sub.tips.length > 0 && (
        <div className="guide-callout guide-callout-tip">
          <div className="guide-callout-title">Tips</div>
          <ul>{sub.tips.map((t, i) => <li key={i}>{renderInline(t)}</li>)}</ul>
        </div>
      )}

      {sub.warnings && sub.warnings.length > 0 && (
        <div className="guide-callout guide-callout-warn">
          <div className="guide-callout-title">Take care</div>
          <ul>{sub.warnings.map((w, i) => <li key={i}>{renderInline(w)}</li>)}</ul>
        </div>
      )}

      {sub.faqs && sub.faqs.length > 0 && (
        <div className="guide-faqs">
          <div className="guide-faqs-title">Questions</div>
          {sub.faqs.map((f, i) => (
            <div key={i} className="guide-faq">
              <div className="guide-faq-q">{renderInline(f.q)}</div>
              <div className="guide-faq-a">{renderInline(f.a)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SectionView({ chapter, section }: { chapter: GuideChapter; section: GuideSection }) {
  const isRoute = !!section.path && section.path.startsWith('/')
  return (
    <article className="guide-article">
      <div className="guide-crumb">{chapter.title}</div>
      <h2 className="guide-article-title">{section.title}</h2>
      <div className="guide-article-meta">
        {section.access && <span className="guide-badge">{section.access}</span>}
        {section.path && (isRoute
          ? <Link className="guide-path" to={section.path}>{section.path} →</Link>
          : <span className="guide-path guide-path-static">{section.path}</span>
        )}
      </div>
      <p className="guide-summary">{renderInline(section.summary)}</p>
      {(section.subsections || []).map(sub => <Subsection key={sub.id} sub={sub} />)}
    </article>
  )
}

function OverviewView({ guide, onOpen }: { guide: RoleGuide; onOpen: (key: string) => void }) {
  return (
    <article className="guide-article">
      <h2 className="guide-article-title">{guide.label} guide</h2>
      <p className="guide-summary">{renderInline(guide.tagline)}</p>
      {(guide.intro || []).map((p, i) => <p key={i} className="guide-p">{renderInline(p)}</p>)}

      <div className="guide-chapter-grid">
        {(guide.chapters || []).map(ch => (
          <div key={ch.id} className="guide-chapter-card">
            <h3 className="guide-chapter-card-title">{ch.title}</h3>
            {ch.blurb && <p className="guide-chapter-card-blurb">{renderInline(ch.blurb)}</p>}
            <ul className="guide-chapter-card-list">
              {(ch.sections || []).map(s => (
                <li key={s.id}>
                  <button type="button" className="guide-jump" onClick={() => onOpen(`${ch.id}/${s.id}`)}>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </article>
  )
}


export default function UserGuidePage() {
  const user = useAuthStore(s => s.user) as Record<string, unknown> | null
  const viewerRole = toGuideRole(user?.role)

  const [guides, setGuides] = useState<RoleGuide[]>(GUIDES)
  const [checking, setChecking] = useState(true)
  const [search, setSearch] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await userGuideApi.list()
        const fromServer = extractGuides(res?.data)
        if (!cancelled && fromServer.length > 0) setGuides(g => mergeGuides(g, fromServer))
      } catch {
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const visibleGuides = useMemo(
    () => guides.filter(g => ROLE_RANK[g.role] <= ROLE_RANK[viewerRole]),
    [guides, viewerRole]
  )

  const requestedRole = searchParams.get('role')
  const activeRole: GuideRole = useMemo(() => {
    if (requestedRole && visibleGuides.some(g => g.role === requestedRole)) return requestedRole as GuideRole
    if (visibleGuides.some(g => g.role === viewerRole)) return viewerRole
    return visibleGuides[0]?.role ?? viewerRole
  }, [requestedRole, visibleGuides, viewerRole])

  const activeGuide = useMemo(
    () => visibleGuides.find(g => g.role === activeRole),
    [visibleGuides, activeRole]
  )

  const flat = useMemo(() => flatten(activeGuide), [activeGuide])

  const requestedSection = searchParams.get('section')
  const activeKey = useMemo(() => {
    if (!requestedSection || requestedSection === OVERVIEW) return OVERVIEW
    const hit = flat.find(f => f.key === requestedSection) || flat.find(f => f.section.id === requestedSection)
    return hit ? hit.key : OVERVIEW
  }, [requestedSection, flat])

  const active = flat.find(f => f.key === activeKey)

  const openSection = useCallback((key: string, role: GuideRole = activeRole) => {
    const next = new URLSearchParams(searchParams)
    next.set('role', role)
    if (key === OVERVIEW) next.delete('section')
    else next.set('section', key)
    setSearchParams(next)
    setRailOpen(false)
    const shell = document.querySelector('.dashboard-main')
    if (shell && typeof shell.scrollTo === 'function') shell.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeRole, searchParams, setSearchParams])

  function switchRole(role: GuideRole) {
    const target = flatten(visibleGuides.find(g => g.role === role))
    const keep = target.some(f => f.key === activeKey)
    openSection(keep ? activeKey : OVERVIEW, role)
  }

  const terms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  )
  const results = useMemo(
    () => terms.length === 0 ? flat : flat.filter(f => terms.every(t => f.haystack.includes(t))),
    [flat, terms]
  )
  const searching = terms.length > 0

  const railChapters = useMemo(() => {
    const out: { chapter: GuideChapter; items: FlatSection[] }[] = []
    for (const f of results) {
      const last = out[out.length - 1]
      if (last && last.chapter.id === f.chapter.id) last.items.push(f)
      else out.push({ chapter: f.chapter, items: [f] })
    }
    return out
  }, [results])

  if (!activeGuide) {
    return (
      <div className="guide-page">
        <div className="guide-header"><h1>User Guide</h1></div>
        <div className="guide-blank">
          {checking ? 'Loading the guide…' : 'No guide has been published for your role yet. Ask a Super Admin to publish one.'}
        </div>
      </div>
    )
  }

  const idx = active ? flat.indexOf(active) : -1
  const prev = idx > 0 ? flat[idx - 1] : null
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : (idx === -1 ? flat[0] : null)

  return (
    <div className="guide-page">
      <div className="guide-header">
        <h1>User Guide</h1>
        <div className="guide-tabs" role="group" aria-label="Guide audience">
          {visibleGuides.map(g => (
            <button
              key={g.role}
              type="button"
              className={`guide-tab${g.role === activeRole ? ' active' : ''}`}
              aria-pressed={g.role === activeRole}
              onClick={() => switchRole(g.role)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="guide-tagline">{renderInline(activeGuide.tagline)}</p>
      </div>

      <div className="guide-body">
        <button
          type="button"
          className="guide-rail-toggle"
          aria-expanded={railOpen}
          onClick={() => setRailOpen(o => !o)}
        >
          <ListIcon />
          <span>{railOpen ? 'Hide contents' : 'Contents'}</span>
          <span className="guide-rail-toggle-current">{active ? active.section.title : 'Overview'}</span>
        </button>

        <aside className={`guide-rail${railOpen ? ' open' : ''}`} aria-label="Guide contents">
          <div className="guide-search-wrap">
            <span className="guide-search-icon"><SearchIcon /></span>
            <input
              className="guide-search"
              type="search"
              placeholder="Search this guide…"
              aria-label="Search this guide"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="guide-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>✕</button>
            )}
          </div>

          {searching && (
            <div className="guide-result-count">
              {results.length === 0
                ? 'No matches'
                : `${results.length} of ${flat.length} section${flat.length === 1 ? '' : 's'}`}
            </div>
          )}

          <nav className="guide-rail-nav">
            {!searching && (
              <button
                type="button"
                className={`guide-rail-item guide-rail-overview${activeKey === OVERVIEW ? ' active' : ''}`}
                onClick={() => openSection(OVERVIEW)}
              >
                Overview
              </button>
            )}

            {railChapters.map(({ chapter, items }) => (
              <div key={chapter.id} className="guide-rail-chapter">
                <div className="guide-rail-chapter-title">{chapter.title}</div>
                {items.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    className={`guide-rail-item${f.key === activeKey ? ' active' : ''}`}
                    onClick={() => openSection(f.key)}
                  >
                    {f.section.title}
                  </button>
                ))}
              </div>
            ))}

            {searching && results.length === 0 && (
              <div className="guide-rail-empty">
                Nothing in the {activeGuide.label} guide matches “{search.trim()}”.
                {visibleGuides.length > 1 && ' Try another audience above.'}
              </div>
            )}
          </nav>
        </aside>

        <main className="guide-content">
          {active
            ? <SectionView chapter={active.chapter} section={active.section} />
            : <OverviewView guide={activeGuide} onOpen={openSection} />}

          {(prev || next) && (
            <nav className="guide-pager" aria-label="Previous and next section">
              {prev ? (
                <button type="button" className="guide-pager-btn guide-pager-prev" onClick={() => openSection(prev.key)}>
                  <span className="guide-pager-arrow"><ChevronLeftIcon /></span>
                  <span className="guide-pager-text">
                    <span className="guide-pager-dir">Previous</span>
                    <span className="guide-pager-title">{prev.section.title}</span>
                  </span>
                </button>
              ) : <span className="guide-pager-spacer" />}
              {next ? (
                <button type="button" className="guide-pager-btn guide-pager-next" onClick={() => openSection(next.key)}>
                  <span className="guide-pager-text">
                    <span className="guide-pager-dir">Next</span>
                    <span className="guide-pager-title">{next.section.title}</span>
                  </span>
                  <span className="guide-pager-arrow"><ChevronRightIcon /></span>
                </button>
              ) : <span className="guide-pager-spacer" />}
            </nav>
          )}
        </main>
      </div>
    </div>
  )
}
