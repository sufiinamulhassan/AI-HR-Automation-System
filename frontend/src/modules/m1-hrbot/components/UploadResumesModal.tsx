import ResumeUpload from './ResumeUpload'
import './UploadResumesModal.css'


interface Props {
  onClose: () => void
  onUploaded?: () => void
}

export default function UploadResumesModal({ onClose, onUploaded }: Props) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="urm-card">
        <div className="urm-header">
          <h2>Upload Résumés</h2>
          <button className="urm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <ResumeUpload onSubmitted={() => { onUploaded?.(); onClose() }} />
      </div>
    </div>
  )
}
