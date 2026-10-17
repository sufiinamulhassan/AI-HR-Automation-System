import { Link } from 'react-router-dom'
import { plainText } from '../../lib/jsonLd'
import { LEGAL_UPDATED, LEGAL_LINKS } from '../../lib/site'
import { usePageMeta } from '../../lib/usePageMeta'
import { Blocks } from './Blocks'
import type { LegalDoc } from './blockModel'
import { CornerDots, PageHero } from './kit'

export default function LegalDocument({ doc }: { doc: LegalDoc }) {
  usePageMeta({ title: doc.title, description: doc.description })
  const related = LEGAL_LINKS.filter(link => doc.related.includes(link.to))

  return (
    <>
      <PageHero eyebrow="Legal" title={doc.title} lead={plainText(doc.intro)} />

      <section className="xv-card-section">
        <div className="xv-card xv-card-padded">
          <CornerDots />
          <div className="xv-shell xv-legal-grid">
            <nav className="xv-toc" aria-label="On this page">
              <h2 className="xv-toc-title">On this page</h2>
              <ol>
                {doc.sections.map(section => (
                  <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
                ))}
              </ol>
            </nav>

            <article className="xv-prose">
              <div className="xv-legal-meta">
                <span className="xv-page-meta">Last updated {LEGAL_UPDATED.label}</span>
                <button type="button" className="xv-btn xv-btn-outline xv-btn-sm" onClick={() => window.print()}>
                  Print or save as PDF
                </button>
              </div>
              {doc.sections.map(section => (
                <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
                  <h2 id={`${section.id}-title`}>
                    <a className="xv-heading-anchor" href={`#${section.id}`}>{section.title}</a>
                  </h2>
                  <Blocks blocks={section.blocks} />
                </section>
              ))}

              {related.length > 0 && (
                <aside className="xv-legal-related" aria-label="Related documents">
                  <h2>Related documents</h2>
                  <ul>
                    {related.map(link => <li key={link.to}><Link to={link.to}>{link.label}</Link></li>)}
                  </ul>
                </aside>
              )}
            </article>
          </div>
        </div>
      </section>
    </>
  )
}
