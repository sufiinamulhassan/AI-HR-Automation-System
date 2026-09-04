import './JobList.css'

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-600)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
)

type Job = Record<string, unknown>

interface Props {
  jobs: Job[]
  selected?: string
  onSelect: (job: Job) => void
  onEdit: (job: Job) => void
  onDelete: (id: string) => void
}

export default function JobList({ jobs, selected, onSelect, onEdit, onDelete }: Props) {
  if (jobs.length === 0) return (
    <div className="job-list-empty">No job descriptions yet. Create one to get started.</div>
  )
  return (
    <div className="job-list">
      {jobs.map((j: Job) => (
        <div
          key={j.job_id as string}
          className={`job-item${selected === j.job_id ? ' active' : ''}`}
          onClick={() => onSelect(j)}
        >
          <div className="job-item-body">
            <div className="job-title">{j.title as string}</div>
            <div className="job-meta">
              {!!j.company_name && <span>{j.company_name as string} ·</span>}
              <span>{j.employment_type as string}</span>
              {!!j.is_remote && <span> · Remote</span>}
            </div>
            <div className="job-pipeline-count">
              {((j.candidate_pipeline as { similarity_score?: number }[]) || [])
                .filter(c => Number(c.similarity_score || 0) >= 0.5).length} candidates
            </div>
          </div>
          <div className="job-item-actions">
            <button className="icon-btn" title="Edit" onClick={e => { e.stopPropagation(); onEdit(j) }}><EditIcon /></button>
            <button className="icon-btn" title="Delete" onClick={e => { e.stopPropagation(); onDelete(j.job_id as string) }}><TrashIcon /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
