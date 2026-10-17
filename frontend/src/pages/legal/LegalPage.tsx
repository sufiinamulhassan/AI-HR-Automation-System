import LegalDocument from '../../components/site/LegalDocument'
import NotFoundPage from '../NotFoundPage'
import { LEGAL_DOCS } from './docs'

export default function LegalPage({ slug }: { slug: string }) {
  const doc = LEGAL_DOCS[slug]
  return doc ? <LegalDocument doc={doc} /> : <NotFoundPage />
}
