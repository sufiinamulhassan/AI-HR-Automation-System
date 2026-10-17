import { useParams } from 'react-router-dom'
import type { Explainer } from '../../lib/siteContent'
import NotFoundPage from '../NotFoundPage'
import ExplainerView, { type ExplainerParent } from './ExplainerView'

export default function ExplainerRoute({ items, parent }: { items: Explainer[]; parent: ExplainerParent }) {
  const { slug } = useParams()
  const page = items.find(item => item.slug === slug)
  return page ? <ExplainerView page={page} parent={parent} /> : <NotFoundPage />
}
