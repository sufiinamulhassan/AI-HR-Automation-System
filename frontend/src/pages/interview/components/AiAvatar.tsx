export default function AiAvatar({ speaking, size = 'lg' }: { speaking: boolean; size?: 'lg' | 'sm' }) {
  return (
    <div className={`ai-avatar ai-avatar-${size}${speaking ? ' ai-avatar-speaking' : ''}`} aria-hidden="true">
      <span className="ai-ring ai-ring-1" />
      <span className="ai-ring ai-ring-2" />
      <span className="ai-ring ai-ring-3" />
      <span className="ai-avatar-core">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 14C22.2091 14 24 12.2091 24 10C24 7.79086 22.2091 6 20 6C17.7909 6 16 7.79086 16 10C16 12.2091 17.7909 14 20 14Z" fill="#4778f3" />
          <path d="M20 16C14.4772 16 10 20.4772 10 26C10 31.5228 14.4772 36 20 36C25.5228 36 30 31.5228 30 26C30 24 29.2 22.2 27.8 20.8L25.8 22.8C26.5 23.7 27 24.8 27 26C27 29.866 23.866 33 20 33C16.134 33 13 29.866 13 26C13 22.134 16.134 19 20 19C21.2 19 22.3 19.3 23.2 19.9L25.2 17.9C23.7 16.7 21.9 16 20 16Z" fill="#4778f3" />
        </svg>
      </span>
    </div>
  )
}
