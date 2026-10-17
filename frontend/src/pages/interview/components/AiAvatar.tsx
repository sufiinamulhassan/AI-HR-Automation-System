export default function AiAvatar({ speaking, size = 'lg' }: { speaking: boolean; size?: 'lg' | 'sm' }) {
  return (
    <div className={`ai-avatar ai-avatar-${size}${speaking ? ' ai-avatar-speaking' : ''}`} aria-hidden="true">
      <span className="ai-ring ai-ring-1" />
      <span className="ai-ring ai-ring-2" />
      <span className="ai-ring ai-ring-3" />
      <span className="ai-avatar-core">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="7" r="4" stroke="var(--primary)" strokeWidth="2" />
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m16 11 2 2 4-4" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
}
