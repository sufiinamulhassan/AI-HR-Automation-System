import { usePageMeta } from '../lib/usePageMeta'
import { Btn, Eyebrow } from '../components/site/kit'

export default function NotFoundPage() {
  usePageMeta({ title: 'Page not found', description: 'The page you are looking for does not exist.', noindex: true })
  return (
    <>
      <section className="xv-page-hero xv-notfound">
        <div aria-hidden="true" className="xv-grid-overlay" />
        <div className="xv-shell xv-page-hero-inner">
          <Eyebrow>Error 404</Eyebrow>
          <span aria-hidden="true" className="xv-notfound-code">404</span>
          <h1 className="xv-page-title">This page does not exist</h1>
          <p className="xv-page-lead">
            The link may be old or mistyped. Head back to the home page, or tell us what you were looking for.
          </p>
        </div>
      </section>
      <section className="xv-card-section">
        <div className="xv-section-actions">
          <Btn to="/" variant="primary">Go to the home page</Btn>
          <Btn to="/contact" variant="outline">Contact us</Btn>
        </div>
      </section>
    </>
  )
}
