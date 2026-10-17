import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useUploadStore } from './upload.store'

export interface SessionUser {
  email?: string
  name?: string
  role?: string
  job_title?: string
  timezone?: string
  company_id?: string
  company_name?: string
  client_id?: string
  client_name?: string
  workspace_kind?: 'workspace' | 'platform'
  is_platform_admin?: boolean
  [key: string]: unknown
}

interface AuthState {
  token: string | null
  user: SessionUser | null
  avatarDataUrl: string | null | undefined
  login: (token: string, user: SessionUser) => void
  logout: () => void
  setAvatarDataUrl: (url: string | null) => void
}

function clearWorkspaceState() {
  useUploadStore.getState().dismiss()
  useUploadStore.persist.clearStorage()
}

export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      token: null,
      user: null,
      avatarDataUrl: undefined,
      login: (token, user) => set({ token, user, avatarDataUrl: undefined }),
      logout: () => {
        set({ token: null, user: null, avatarDataUrl: undefined })
        clearWorkspaceState()
      },
      setAvatarDataUrl: (avatarDataUrl) => set({ avatarDataUrl }),
    }),
    {
      name: 'hr-bot-auth',
      partialize: state => ({ token: state.token, user: state.user }),
    }
  )
)
