import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'
import bannerShape01 from '../../assets/graphics/shapes/banner-shape-01.svg'
import bannerShape02 from '../../assets/graphics/shapes/banner-shape-02.svg'
import ctaArrowLeft from '../../assets/graphics/icons/cta-arrow-left.svg'
import ctaArrowRight from '../../assets/graphics/icons/cta-arrow-right.svg'
import { Inline } from './Blocks'
import { SiteIcon } from './siteIcons'

type Variant = 'primary' | 'outline' | 'white' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface BtnProps {
  to?: string
  href?: string
  variant?: Variant
  size?: Size
  children: ReactNode
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type']
  disabled?: boolean
  onClick?: () => void
}

export function Btn({ to, href, variant = 'primary', size = 'md', children, type = 'button', disabled, onClick }: BtnProps) {
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
  if (href) {
    const external = href.startsWith('https://')
    return (
      <a href={href} className={cls} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {inner}
      </a>
    )
  }
  return <button type={type} className={cls} disabled={disabled} onClick={onClick}>{inner}</button>
}

export function Reveal({
  children, delay = 0, className = '', as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'li' | 'article' | 'section'
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(
    typeof window === 'undefined' || typeof IntersectionObserver === 'undefined',
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
      { threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <Tag
      ref={ref as Ref<never>}
      className={`xv-reveal ${shown ? 'is-visible' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  )
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span className={`xv-eyebrow ${dark ? 'is-dark' : ''}`}>
      <span aria-hidden="true" className="xv-eyebrow-dot" />
      {children}
    </span>
  )
}

export function CornerDots() {
  return (
    <>
      <span aria-hidden="true" className="xv-corner xv-corner-tl" />
      <span aria-hidden="true" className="xv-corner xv-corner-tr" />
      <span aria-hidden="true" className="xv-corner xv-corner-bl" />
      <span aria-hidden="true" className="xv-corner xv-corner-br" />
    </>
  )
}

export interface Crumb {
  label: string
  to?: string
}

export function PageHero({
  eyebrow, title, accent, lead,
}: {
  eyebrow: string
  title: ReactNode
  accent?: string
  lead?: ReactNode
}) {
  return (
    <section className="xv-page-hero">
      <div aria-hidden="true" className="xv-grid-overlay" />
      <img aria-hidden="true" alt="" src={bannerShape01} width="261" height="223" className="xv-checker xv-page-checker xv-page-checker-tl" />
      <img aria-hidden="true" alt="" src={bannerShape02} width="377" height="324" className="xv-checker xv-page-checker xv-page-checker-br" />
      <div className="xv-shell xv-page-hero-inner">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="xv-page-title">
          {title}
          {accent && <>{' '}<span className="xv-accent xv-page-accent">{accent}</span></>}
        </h1>
        {lead && <p className="xv-page-lead">{lead}</p>}
      </div>
    </section>
  )
}

export function Section({
  id, eyebrow, title, lead, center = false, tone = 'light', children,
}: {
  id?: string
  eyebrow?: string
  title?: ReactNode
  lead?: ReactNode
  center?: boolean
  tone?: 'light' | 'ink'
  children?: ReactNode
}) {
  const ink = tone === 'ink'
  return (
    <section className="xv-card-section" id={id}>
      <div className={`xv-card xv-card-padded${ink ? ' xv-card-ink' : ''}`}>
        <CornerDots />
        <div className="xv-shell">
          {(eyebrow || title) && (
            <Reveal className={`xv-heading${center ? ' xv-heading-center' : ''}`}>
              {eyebrow && <Eyebrow dark={ink}>{eyebrow}</Eyebrow>}
              {title && <h2 className={`xv-h2${ink ? ' is-dark' : ''}`}>{title}</h2>}
              {lead && <p className={`xv-heading-desc${ink ? ' is-dark' : ''}`}>{lead}</p>}
            </Reveal>
          )}
          {children}
        </div>
      </div>
    </section>
  )
}

export function InfoGrid({ columns = 3, children }: { columns?: 2 | 3 | 4; children: ReactNode }) {
  return <div className={`xv-info-grid xv-info-cols-${columns}`}>{children}</div>
}

export function InfoCard({
  tag, title, children, items, icon,
}: {
  tag?: string
  title: string
  children?: ReactNode
  items?: string[]
  icon?: string
}) {
  return (
    <Reveal as="article" className="xv-info">
      {icon && <span className="xv-info-icon"><SiteIcon name={icon} size={20} /></span>}
      {tag && <span className="xv-info-tag"><span aria-hidden="true" className="xv-info-tag-dot" />{tag}</span>}
      <h3 className="xv-info-title">{title}</h3>
      {children && <div className="xv-info-body">{children}</div>}
      {items && (
        <ul className="xv-info-list">
          {items.map(item => <li key={item}><Inline text={item} /></li>)}
        </ul>
      )}
    </Reveal>
  )
}

export function StatsRow({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <dl className="xv-statsrow">
      {stats.map(stat => (
        <div key={stat.label} className="xv-statsrow-item">
          <dd>{stat.value}</dd>
          <dt>{stat.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export function Steps({ steps }: { steps: { title: string; description: string }[] }) {
  return (
    <ol className="xv-steps">
      {steps.map((step, i) => (
        <Reveal as="li" key={step.title} className="xv-step" delay={i * 0.05}>
          <span className="xv-step-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="xv-step-title">{step.title}</h3>
          <p className="xv-step-text"><Inline text={step.description} /></p>
        </Reveal>
      ))}
    </ol>
  )
}

export function FaqList({ items, defaultOpen = 0 }: { items: { q: string; a: string }[]; defaultOpen?: number }) {
  const base = useId()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="xv-faq">
      {items.map((item, i) => {
        const isOpen = open === i
        const buttonId = `${base}-button-${i}`
        const panelId = `${base}-panel-${i}`
        return (
          <div key={item.q} className={`xv-faq-item${isOpen ? ' is-open' : ''}`}>
            <h3 className="xv-faq-q">
              <button
                type="button"
                id={buttonId}
                className="xv-faq-btn"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                <span className="xv-faq-text">{item.q}</span>
                <span className="xv-faq-chip" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path className="xv-faq-bar" d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="xv-faq-panel"
              {...(isOpen ? {} : { inert: '' as unknown as boolean })}
            >
              <div className="xv-faq-panel-inner">
                <div className="xv-faq-answer"><p><Inline text={item.a} /></p></div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CtaBand({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <section className="xv-card-section">
      <div className="xv-cta xv-cta-band">
        <div aria-hidden="true" className="xv-grid-overlay" />
        <div aria-hidden="true" className="xv-cta-arrows xv-cta-arrows-left">
          {[0, 1, 2].map(i => <img key={i} src={ctaArrowRight} alt="" className="xv-arrow" style={{ animationDelay: `${i * 0.15}s` }} />)}
        </div>
        <div aria-hidden="true" className="xv-cta-arrows xv-cta-arrows-right">
          {[0, 1, 2].map(i => <img key={i} src={ctaArrowLeft} alt="" className="xv-arrow" style={{ animationDelay: `${(2 - i) * 0.15}s` }} />)}
        </div>
        <Reveal className="xv-cta-inner">
          <h2 className="xv-cta-title xv-cta-title-band">{title}</h2>
          {text && <p className="xv-cta-text">{text}</p>}
          <div className="xv-cta-actions">{children}</div>
        </Reveal>
        <svg aria-hidden="true" className="xv-step-graphic" viewBox="0 0 1408 356" preserveAspectRatio="none" fill="currentColor">
          <rect x="0" y="0" width="234.667" height="356" />
          <rect x="234.667" y="119" width="234.667" height="237" />
          <rect x="469.333" y="237" width="234.667" height="119" />
          <rect x="704" y="296.5" width="234.667" height="59.5" />
          <rect x="938.667" y="119" width="234.667" height="237" />
          <rect x="1173.33" y="0" width="234.667" height="356" />
        </svg>
      </div>
    </section>
  )
}
