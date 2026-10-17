import { Link } from 'react-router-dom'
import { prefetchRoute } from '../../lib/prefetch'
import { pageEntry } from '../../lib/siteIndex'
import type { NavItem } from '../../lib/siteNav'
import { Reveal } from './kit'
import { SiteIcon } from './siteIcons'
import './Related.css'

export function LinkGrid({ items, columns = 3 }: { items: NavItem[]; columns?: 2 | 3 }) {
  return (
    <div className={`xv-links xv-links-${columns}`}>
      {items.map((item, i) => (
        <Reveal key={item.to} delay={Math.min(i, 5) * 0.04}>
          <Link
            to={item.to}
            className="xv-link-card"
            onMouseEnter={() => prefetchRoute(item.to)}
            onFocus={() => prefetchRoute(item.to)}
          >
            <span className="xv-link-icon"><SiteIcon name={item.icon} size={20} /></span>
            <span className="xv-link-title">{item.label}</span>
            <span className="xv-link-text">{item.description}</span>
            <span className="xv-link-more" aria-hidden="true">
              Learn more
              <SiteIcon name="arrowright" size={14} />
            </span>
          </Link>
        </Reveal>
      ))}
    </div>
  )
}

export function RelatedGrid({ paths }: { paths: string[] }) {
  const items = paths.map(pageEntry).filter((item): item is NavItem => Boolean(item))
  if (items.length === 0) return null
  return <LinkGrid items={items} columns={items.length === 2 ? 2 : 3} />
}
