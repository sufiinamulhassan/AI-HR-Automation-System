import type { CompanyAi } from '../../lib/platformTypes'
import { AiJobsTable, AiKeyCards, AiUsedTable } from './AiParts'
import { EmptyState } from './PlatformUi'
import './PlatformAi.css'

export default function CompanyAiCard({ ai }: { ai: CompanyAi }) {
  return (
    <section className="pco-card" aria-labelledby="pco-co-ai">
      <div className="pco-card-head">
        <h2 className="pco-card-title" id="pco-co-ai">AI models</h2>
        <span className="pco-chip">Default {ai.default_name}</span>
      </div>

      <div className="pai-sections">
        <AiKeyCards keys={ai.keys} showCompanies={false} nested />

        <div>
          <h3 className="pai-subhead">Jobs</h3>
          <AiJobsTable jobs={ai.jobs} keys={ai.keys} label="Jobs" />
        </div>

        <div>
          <h3 className="pai-subhead">Used in this period</h3>
          {ai.used.length === 0
            ? <EmptyState>No AI calls in this period.</EmptyState>
            : <AiUsedTable used={ai.used} keys={ai.keys} label="Used in this period" />}
        </div>
      </div>
    </section>
  )
}
