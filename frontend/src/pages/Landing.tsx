import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import './Landing.css'

import centerHeroImg from '../assets/images/center-hero.webp'
import stepPostImg from '../assets/images/process-steps/discover.webp'
import stepIngestImg from '../assets/images/process-steps/strategy.webp'
import stepInterviewImg from '../assets/images/process-steps/build.webp'
import stepReviewImg from '../assets/images/process-steps/launch.webp'

import bannerShape01 from '../assets/graphics/shapes/banner-shape-01.svg'
import bannerShape02 from '../assets/graphics/shapes/banner-shape-02.svg'
import whyChooseShape from '../assets/graphics/shapes/why-choose-shape.svg'
import bannerArrowLeft from '../assets/graphics/icons/banner-arrow-left.svg'
import bannerArrowRight from '../assets/graphics/icons/banner-arrow-right.svg'
import ctaArrowLeft from '../assets/graphics/icons/cta-arrow-left.svg'
import ctaArrowRight from '../assets/graphics/icons/cta-arrow-right.svg'
import aboutIcon01 from '../assets/graphics/icons/about-01.svg'
import aboutIcon02 from '../assets/graphics/icons/about-02.svg'
import aboutIcon03 from '../assets/graphics/icons/about-03.svg'


const STACK = [
  { label: 'Python', logo: '/tech-logos/python.webp' },
  { label: 'FastAPI', logo: '/tech-logos/fastapi.webp' },
  { label: 'Uvicorn', logo: '/tech-logos/uvicorn.webp' },
  { label: 'Pydantic', logo: '/tech-logos/pydantic.webp' },
  { label: 'MongoDB', logo: '/tech-logos/mongodb.webp' },
  { label: 'Pinecone', logo: '/tech-logos/pinecone.webp' },
  { label: 'LangGraph', logo: '/tech-logos/langgraph.webp' },
  { label: 'LangChain', logo: '/tech-logos/langchain.webp' },
  { label: 'OpenAI', logo: '/tech-logos/openai.webp' },
  { label: 'Anthropic', logo: '/tech-logos/anthropic.webp' },
  { label: 'JWT', logo: '/tech-logos/jsonwebtokens.webp' },
  { label: 'bcrypt', logo: '/tech-logos/bcrypt.webp' },
  { label: 'pdfplumber', logo: '/tech-logos/pdfplumber.webp' },
  { label: 'ReportLab', logo: '/tech-logos/reportlab.webp' },
  { label: 'APScheduler', logo: '/tech-logos/apscheduler.webp' },
  { label: 'React 18', logo: '/tech-logos/react.webp' },
  { label: 'TypeScript', logo: '/tech-logos/typescript.webp' },
  { label: 'Vite 6', logo: '/tech-logos/vite.webp' },
  { label: 'Node.js', logo: '/tech-logos/nodedotjs.webp' },
  { label: 'Zustand', logo: '/tech-logos/zustand.webp' },
  { label: 'MediaPipe', logo: '/tech-logos/mediapipe.webp' },
  { label: 'Vitest', logo: '/tech-logos/vitest.webp' },
  { label: 'ESLint', logo: '/tech-logos/eslint.webp' },
  { label: 'Vercel', logo: '/tech-logos/vercel.webp' },
]

const ABOUT_STATS = [
  { value: '500', label: 'Resumes per batch', icon: aboutIcon01 },
  { value: '470', label: 'Backend tests passing', icon: aboutIcon02 },
  { value: '23', label: 'Mounted API routers', icon: aboutIcon03 },
]

const PROCESS_STEPS = [
  {
    title: 'Post & parse the role',
    description:
      'Paste or import a job description. It is parsed into structured targeting criteria - skills, seniority, location, must-haves - then embedded so it can be matched against the pool.',
    image: stepPostImg,
    alt: '',
  },
  {
    title: 'Ingest & score resumes',
    description:
      'Drop up to 500 PDF or DOCX files at once. Each runs the ResumeAgent graph, is de-duplicated and classified, then scored against every open role.',
    image: stepIngestImg,
    alt: '',
  },
  {
    title: 'Interview & screen',
    description:
      'Strong matches are invited automatically. A voice interview runs from the candidate resume and the role, with proctoring, and a coding assessment screens their code in a sandbox.',
    image: stepInterviewImg,
    alt: '',
  },
  {
    title: 'Review & decide',
    description:
      'A scored report lands per candidate - per-question marks, transcript, integrity flags, recommendation. Move them down the pipeline or send an offer from the same screen.',
    image: stepReviewImg,
    alt: '',
  },
]

const PIPELINE = [
  { title: 'Extract', body: 'Text is pulled from the PDF or DOCX and normalised before anything else runs.' },
  { title: 'Check duplicate', body: 'A content hash stops the same person being processed twice across batches.' },
  { title: 'Classify', body: 'The resume is structured into skills, seniority, domain and experience.' },
  { title: 'Embed', body: 'A 1536-dimension vector is written to Pinecone for similarity search.' },
  { title: 'Match JDs', body: 'The vector is scored against every open role, both directions.' },
  { title: 'Auto invite', body: 'Anything over the threshold triggers an interview invite with no recruiter action.' },
]

const CAPABILITIES = [
  {
    tag: 'Matching',
    title: 'Bidirectional matching',
    description: 'Resume-to-role and role-to-resume, both automatic',
    features: ['Vector similarity on Pinecone', 'Seniority flex window', 'Threshold-gated auto-invite', 'Cross-domain scoring'],
  },
  {
    tag: 'Interview',
    title: 'Voice interviews',
    description: 'Generated questions, spoken turns, live proctoring',
    features: ['Resume-aware question generation', 'Live transcription', 'Proctoring integrity flags', 'Scored evaluation report'],
  },
  {
    tag: 'Screening',
    title: 'Coding assessment',
    description: 'Sandboxed execution with integrity checks',
    features: ['Hidden test cases', 'Paste-blocked editor', 'Typing ratio analysis', 'Plagiarism comparison'],
  },
  {
    tag: 'Platform',
    title: 'Admin & control',
    description: 'Roles, workflows and configuration without a redeploy',
    features: ['Per-endpoint RBAC matrix', 'Department scoping', 'Editable prompts and templates', 'Signed outbound webhooks'],
  },
]

const WHY = [
  { title: 'It refuses to boot insecure', body: 'The API audits its own configuration at startup and will not start on a shipped default secret or admin password.' },
  { title: 'Nothing fails silently', body: 'Every disabled capability is logged by name at startup rather than surfacing as a confusing error on first use.' },
  { title: 'Tested, not just demoed', body: '470 backend tests and 84 frontend tests run against the same code path the platform serves.' },
  { title: 'Candidate data stays scoped', body: 'Candidate-facing email can never carry scores or report content, and department scoping limits who sees whom.' },
]

const FOOTER_COLUMNS = [
  {
    title: 'Platform',
    links: ['Job descriptions', 'Resume pipeline', 'Candidate matching', 'Voice interviews', 'Coding assessment'],
  },
  {
    title: 'Administration',
    links: ['Users and roles', 'Departments', 'Workflow rules', 'Email templates', 'Prompt configuration'],
  },
  {
    title: 'Reporting',
    links: ['Analytics overview', 'Candidate reports', 'Audit log', 'Activity feed', 'Saved filters'],
  },
]

function Btn({
  to, href, variant = 'primary', size = 'md', children,
}: {
  to?: string
  href?: string
  variant?: 'primary' | 'outline' | 'white' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}) {
  const cls = `xv-btn xv-btn-${variant} xv-btn-${size}`
  const inner = (
    <>
      <span className="xv-btn-label">{children}</span>
      <span className="xv-btn-chip" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </span>
    </>
  )
  if (to) return <Link to={to} className={cls}>{inner}</Link>
  return <a href={href} className={cls}>{inner}</a>
}

function Reveal({
  children, delay = 0, className = '', as: Tag = 'div',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'li' | 'article' | 'section'
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(
    typeof window === 'undefined' || typeof IntersectionObserver === 'undefined'
  )

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.01 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`xv-reveal ${shown ? 'is-visible' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  )
}


function CheckerCluster({ src, className }: { src: string; className: string }) {
  return <img aria-hidden="true" alt="" src={src} className={`xv-checker ${className}`} />
}

function ArrowTrack({ edge, src }: { edge: 'top' | 'bottom'; src: string }) {
  const items = Array.from({ length: 16 })
  const isTop = edge === 'top'
  return (
    <div aria-hidden="true" className={`xv-track xv-track-${edge}`}>
      <div className="xv-track-row">
        {items.map((_, i) => (
          <span
            key={i}
            className="xv-arrow"
            style={{ animationDelay: `${(isTop ? items.length - 1 - i : i) * 0.08}s` }}
          >
            <img src={src} alt="" />
          </span>
        ))}
      </div>
    </div>
  )
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`xv-eyebrow ${dark ? 'is-dark' : ''}`}>
      <span aria-hidden="true" className="xv-eyebrow-dot" />
      {children}
    </span>
  )
}

function CornerDots() {
  return (
    <>
      <span aria-hidden="true" className="xv-corner xv-corner-tl" />
      <span aria-hidden="true" className="xv-corner xv-corner-tr" />
      <span aria-hidden="true" className="xv-corner xv-corner-bl" />
      <span aria-hidden="true" className="xv-corner xv-corner-br" />
    </>
  )
}

export default function Landing() {
  const [navOpen, setNavOpen] = useState(false)
  const close = () => setNavOpen(false)
  const year = new Date().getFullYear()

  return (
    <div className="xv">
      <header className="xv-nav">
        <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-tl" />
        <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-bl" />
        <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-tr" />
        <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-br" />

        <div className="xv-shell xv-nav-inner">
          <Link to="/" className="xv-brand" onClick={close} aria-label="Hirely.ai home">
            <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-t" />
            <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-b" />
            <span className="xv-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m16 11 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="xv-brand-text">
              <span className="xv-brand-name">Hirely.ai</span>
            </span>
          </Link>

          <nav className={`xv-nav-links ${navOpen ? 'is-open' : ''}`}>
            <a href="#capabilities" onClick={close}><span className="xv-nav-label">Capabilities</span></a>
            <a href="#process" onClick={close}><span className="xv-nav-label">Process</span></a>
            <a href="#pipeline" onClick={close}><span className="xv-nav-label">Pipeline</span></a>
            <Link to="/login" className="xv-btn xv-btn-primary xv-btn-sm xv-nav-cta" onClick={close}>Launch Demo</Link>
          </nav>

          <div className="xv-nav-actions">
            <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-tl" />
            <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-bl" />
            <Link to="/login" className="xv-btn xv-btn-primary xv-btn-nav">
              <span className="xv-btn-label">Launch Demo</span>
              <span className="xv-btn-chip" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </Link>
            <button
              type="button"
              className="xv-burger"
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
              onClick={() => setNavOpen(v => !v)}
            >
              {navOpen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <section className="xv-hero">
        <div aria-hidden="true" className="xv-grid-overlay" />
        <CheckerCluster src={bannerShape01} className="xv-checker-tl" />
        <CheckerCluster src={bannerShape02} className="xv-checker-br" />
        <div aria-hidden="true" className="xv-droplines"><span /><span /></div>

        <div className="xv-shell xv-hero-inner">
          <h1 className="xv-hero-title">
            <ArrowTrack edge="top" src={bannerArrowLeft} />
            <ArrowTrack edge="bottom" src={bannerArrowRight} />

            <span className="xv-hero-title-mobile">Screen Fast, Hire Right</span>

            <span className="xv-hero-word xv-hero-word-left"><span>Screen Fast</span></span>
            <img
              src={centerHeroImg}
              alt=""
              aria-hidden="true"
              fetchPriority="high"
              className="xv-hero-img"
            />
            <span className="xv-hero-word xv-hero-word-right"><span>Hire Right</span></span>
          </h1>

          <p className="xv-hero-lead">
            Hirely.ai reads every resume, matches it against every open role, invites the
            <br />
            strongest candidates, and hands you a scored report.
          </p>

          <div className="xv-hero-cta">
            <Btn href="#process" variant="outline">See how it works</Btn>
            <Btn to="/login" variant="primary">Sign in to the platform</Btn>
          </div>
        </div>
      </section>

      <section className="xv-marquee-band" aria-label="Stack we use">
        <div className="xv-marquee">
          <span className="xv-marquee-label">Stack We Use</span>
          <div className="xv-marquee-viewport">
            <div className="xv-marquee-track">
              {[0, 1, 2, 3].map(rep => (
                <div className="xv-marquee-set" key={rep} aria-hidden={rep > 0}>
                  {STACK.map(item => (
                    <div className="xv-tile" key={`${rep}-${item.label}`}>
                      {item.logo ? (
                        <img src={item.logo} alt={item.label} width="64" height="64" loading="lazy" decoding="async" />
                      ) : (
                        <span className="xv-tile-label">{item.label}</span>
                      )}
                      <span className="xv-tile-tip">{item.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="xv-card-section" id="about">
        <div className="xv-card">
          <CornerDots />
          <div className="xv-shell">
            <Reveal className="xv-heading">
              <Eyebrow>About the platform</Eyebrow>
              <h2 className="xv-h2">
                One product that runs the whole funnel, from{' '}
                <span className="xv-accent">resume to offer</span>.
              </h2>
              <p className="xv-heading-desc">
                A FastAPI backend and a Vite SPA, deployed together as a single project.
                The recruiter makes every decision; the platform removes the work in between.
              </p>
            </Reveal>

            <div className="xv-about-grid">
              <dl className="xv-stats">
                {ABOUT_STATS.map(s => (
                  <div className="xv-stat-row" key={s.label}>
                    <img src={s.icon} alt="" aria-hidden="true" className="xv-stat-icon" />
                    <div>
                      <dd className="xv-stat-value">{s.value}</dd>
                      <dt className="xv-stat-label">{s.label}</dt>
                    </div>
                  </div>
                ))}
              </dl>

              <div className="xv-about-panel">
                <span className="xv-about-panel-eyebrow">Live pipeline</span>
                <ul className="xv-about-list">
                  <li><span>Job descriptions parsed and embedded</span></li>
                  <li><span>Resumes de-duplicated and classified</span></li>
                  <li><span>Candidates ranked against every role</span></li>
                  <li><span>Invites sent above the score threshold</span></li>
                  <li><span>Interviews scored, reports persisted</span></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="xv-card-section" id="capabilities">
        <div className="xv-card">
          <CornerDots />
          <div className="xv-shell">
            <Reveal className="xv-heading xv-heading-center">
              <Eyebrow>Capabilities</Eyebrow>
              <h2 className="xv-h2">
                What the platform <span className="xv-accent">actually ships with</span>
              </h2>
            </Reveal>
          </div>
          <div className="xv-ghost-grid">
            {CAPABILITIES.map((c, i) => (
              <div className="xv-ghost" key={c.title}>
                <span aria-hidden="true" className="xv-corner xv-corner-tl" />
                <span aria-hidden="true" className="xv-corner xv-corner-tr" />
                <span aria-hidden="true" className="xv-corner xv-corner-bl" />
                <span aria-hidden="true" className="xv-corner xv-corner-br" />
                <div className="xv-ghost-inner">
                  <div className="xv-ghost-top">
                    <span className="xv-ghost-tag">
                      <span aria-hidden="true" className="xv-ghost-tag-dot" />
                      {c.tag}
                    </span>
                    <p className="xv-ghost-desc">{c.description}</p>
                  </div>
                  <span aria-hidden="true" className="xv-ghost-numeral">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="xv-ghost-bottom">
                    <h3 className="xv-ghost-title">{c.title}</h3>
                    <ul className="xv-ghost-features">
                      {c.features.map(f => <li key={f}>{f}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="xv-card-section" id="process">
        <div className="xv-card xv-card-padded">
          <CornerDots />
          <div className="xv-shell xv-process-grid">
            <div className="xv-process-aside">
              <Reveal className="xv-heading">
                <Eyebrow>Process</Eyebrow>
                <h2 className="xv-h2">
                  Four stages, <span className="xv-accent">one continuous pipeline</span>
                </h2>
                <p className="xv-heading-desc">
                  A candidate can enter at stage two from a bulk upload, or at stage one when
                  a new role is posted and the existing pool is re-scored against it.
                </p>
              </Reveal>
              <div className="xv-process-cta">
                <Btn to="/login" variant="primary" size="lg">Start screening</Btn>
              </div>
            </div>

            <div className="xv-process">
              {PROCESS_STEPS.map((step, i) => (
                <div className="xv-process-card" key={step.title} style={{ zIndex: i + 1 }}>
                  <Reveal className="xv-process-inner" delay={i * 0.05}>
                  <div className="xv-process-media">
                    <img src={step.image} alt="" aria-hidden="true" loading="lazy" />
                  </div>
                  <div className="xv-process-body">
                    <span className="xv-process-num">{String(i + 1).padStart(2, '0')}</span>
                    <div className="xv-process-copy">
                      <h3 className="xv-process-title">{step.title}</h3>
                      <p className="xv-process-text">{step.description}</p>
                    </div>
                  </div>
                  </Reveal>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="xv-card-section" id="pipeline">
        <div className="xv-card xv-card-ink xv-card-padded">
          <div className="xv-shell">
            <Reveal className="xv-heading">
              <Eyebrow dark>The agent graph</Eyebrow>
              <h2 className="xv-h2 is-dark">
                Inside the <span className="xv-accent">ResumeAgent</span> pipeline
              </h2>
              <p className="xv-heading-desc is-dark">
                Every uploaded resume runs these nodes in order. Each one is idempotent, so a
                re-run of a batch costs nothing and cannot create a duplicate candidate.
              </p>
            </Reveal>

            <ol className="xv-nodes">
              {PIPELINE.map((n, i) => (
                <Reveal as="li" className="xv-node" key={n.title} delay={(i % 3) * 0.08}>
                  <span className="xv-node-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="xv-node-title">{n.title}</h3>
                  <p className="xv-node-text">{n.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="xv-card-section" id="why">
        <div className="xv-card xv-card-padded xv-why">
          <CornerDots />
          <img src={whyChooseShape} alt="" aria-hidden="true" className="xv-why-shape" />
          <div className="xv-shell">
            <Reveal className="xv-heading">
              <Eyebrow>Why this build</Eyebrow>
              <h2 className="xv-h2">
                Built to be <span className="xv-accent">operated</span>, not just demoed
              </h2>
            </Reveal>
            <div className="xv-why-grid">
              {WHY.map(w => (
                <Reveal as="article" className="xv-why-card" key={w.title}>
                  <h3 className="xv-why-title">{w.title}</h3>
                  <p className="xv-why-text">{w.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="xv-card-section">
        <div className="xv-cta">
          <div aria-hidden="true" className="xv-grid-overlay" />

          <div aria-hidden="true" className="xv-cta-arrows xv-cta-arrows-left">
            {[0, 1, 2].map(i => (
              <img key={i} src={ctaArrowRight} alt="" className="xv-arrow" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
          <div aria-hidden="true" className="xv-cta-arrows xv-cta-arrows-right">
            {[0, 1, 2].map(i => (
              <img key={i} src={ctaArrowLeft} alt="" className="xv-arrow" style={{ animationDelay: `${(2 - i) * 0.15}s` }} />
            ))}
          </div>

          <Reveal className="xv-cta-inner">
            <h2 className="xv-cta-title">Run your first pipeline</h2>
            <Btn to="/login" variant="outline" size="lg">Sign in to Hirely.ai</Btn>
          </Reveal>

          <svg aria-hidden="true" className="xv-step-graphic" viewBox="0 0 1408 356" preserveAspectRatio="none" fill="currentColor">
            <rect x="0" y="0" width="234.667" height="356" />
            <rect x="234.667" y="119" width="234.667" height="237" />
            <rect x="469.333" y="237" width="234.667" height="119" />
            <rect x="704" y="296.5" width="234.667" height="59.5" />
            <rect x="938.667" y="119" width="234.667" height="237" />
            <rect x="1173.33" y="0" width="234.667" height="356" />
          </svg>

          <div className="xv-cta-tag xv-cta-tag-left"><span className="xv-step-tag"><span aria-hidden="true" className="xv-step-tag-dot" />Recruitment automation</span></div>
          <div className="xv-cta-tag xv-cta-tag-right"><span className="xv-step-tag"><span aria-hidden="true" className="xv-step-tag-dot" />Built on your stack</span></div>
        </div>
      </section>

      <footer className="xv-foot">
        <div className="xv-foot-top">
          <div className="xv-shell xv-foot-grid">
            <div className="xv-foot-contact">
              <h3 className="xv-foot-h"><span aria-hidden="true" className="xv-foot-dot" />Platform</h3>
              <p className="xv-foot-lead">AI recruitment, end to end</p>
              <p className="xv-foot-sub">
                Job descriptions, resume screening, candidate matching, AI voice interviews,
                coding assessment and scored reports in one product.
              </p>

            </div>

            <div className="xv-foot-cols">
              {FOOTER_COLUMNS.map(col => (
                <div key={col.title}>
                  <h3 className="xv-foot-h"><span aria-hidden="true" className="xv-foot-dot" />{col.title}</h3>
                  <ul className="xv-foot-list">
                    {col.links.map(l => (
                      <li key={l}><span aria-hidden="true" className="xv-foot-bullet" />{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="xv-foot-mark">
          <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-tl" />
          <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-bl" />
          <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-br" />
          <Link to="/" className="xv-foot-wordmark">HIRELY.AI</Link>
        </div>

        <div className="xv-foot-bottom">
          <div className="xv-shell xv-foot-bottom-inner">
            <span>A XOVO Technologies product</span>
            <span>&copy; {year} Hirely.ai. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
