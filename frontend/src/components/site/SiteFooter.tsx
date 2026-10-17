import { Link } from 'react-router-dom'
import { PRODUCT_NAME } from '../../lib/brand'
import { prefetchRoute } from '../../lib/prefetch'
import { FOOTER_GROUPS, SITE } from '../../lib/site'
import { SiteIcon } from './siteIcons'
import './SiteFooter.css'

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="xv-foot">
      <div className="xv-foot-top">
        <div className="xv-shell xv-foot-grid xv-foot-grid-v2">
          <div className="xv-foot-contact">
            <h3 className="xv-foot-h"><span aria-hidden="true" className="xv-foot-dot" />Contact</h3>
            <a href={`mailto:${SITE.contactEmail}`} className="xv-foot-email">{SITE.contactEmail}</a>
            <Link to="/contact" className="xv-foot-cta xv-foot-contact-link">
              Send a message
              <SiteIcon name="arrowright" size={16} />
            </Link>
          </div>

          <nav aria-label="Footer" className="xv-foot-cols xv-foot-cols-v2">
            {FOOTER_GROUPS.map(group => (
              <div key={group.title}>
                <h3 className="xv-foot-h"><span aria-hidden="true" className="xv-foot-dot" />{group.title}</h3>
                <ul className="xv-foot-list">
                  {group.links.map(link => (
                    <li key={`${group.title}-${link.to}-${link.label}`}>
                      <span aria-hidden="true" className="xv-foot-bullet" />
                      <Link to={link.to} onMouseEnter={() => prefetchRoute(link.to)} onFocus={() => prefetchRoute(link.to)}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>

      <div className="xv-foot-mark">
        <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-tl" />
        <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-bl" />
        <span aria-hidden="true" className="xv-foot-mark-dot xv-foot-mark-br" />
        <Link to="/" className="xv-foot-wordmark">HIRELY.AI</Link>
      </div>

      <div className="xv-foot-bottom">
        <div className="xv-shell xv-foot-bottom-inner xv-foot-bottom-v2">
          <span>&copy; {year} {PRODUCT_NAME}. All rights reserved.</span>
        </div>
      </div>
    </footer>
  )
}
