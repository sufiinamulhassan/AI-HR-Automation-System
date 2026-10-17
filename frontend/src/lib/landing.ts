import type { SessionUser } from '../store/auth.store'

export function landingPathFor(
  user: Pick<SessionUser, 'workspace_kind' | 'is_platform_admin'> | null | undefined,
): string {
  return user?.is_platform_admin === true || user?.workspace_kind === 'platform' ? '/platform' : '/dashboard'
}
