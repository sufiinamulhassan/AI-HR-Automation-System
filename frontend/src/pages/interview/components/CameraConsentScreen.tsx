import './CameraConsentScreen.css'

interface Props {
  onEnable: () => void
  onDecline: () => void
}

const CameraIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 8a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="var(--primary-dark)" strokeWidth="1.6" />
    <path d="M15 10.4 20 8v8l-5-2.4" stroke="var(--primary-dark)" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
)

export default function CameraConsentScreen({ onEnable, onDecline }: Props) {
  return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-camconsent">
        <div className="iv-camconsent-icon"><CameraIcon /></div>
        <h2>Camera-based integrity monitoring</h2>
        <p className="iv-camconsent-lead">
          Once your interview starts, this tab can check your camera feed for a visible face,
          more than one person in frame, and a visible phone. Everything runs locally, in your
          browser, on your own device: your video is never uploaded, recorded, or stored
          anywhere. Only short results (for example, "face detected") are ever shared with your
          recruiter, the same way a tab switch already is today.
        </p>
        <p className="iv-camconsent-choice">
          This is your choice: your interview proceeds normally either way.
        </p>
        <div className="iv-camconsent-actions">
          <button type="button" className="iv-camconsent-decline" onClick={onDecline}>
            Continue without monitoring
          </button>
          <button type="button" className="iv-camconsent-enable" onClick={onEnable}>
            Enable camera monitoring
          </button>
        </div>
      </div>
    </div>
  )
}
