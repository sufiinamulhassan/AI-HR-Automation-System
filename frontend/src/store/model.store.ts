import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface StoredModel { id: string; label: string; provider: string }

interface ModelState {
  activeModel: string
  availableModels: StoredModel[]
  setActiveModel: (id: string) => void
  setAvailableModels: (models: StoredModel[]) => void
}

export const useModelStore = create<ModelState>()(
  persist(
    set => ({
      activeModel: 'gpt-4o',
      availableModels: [],
      setActiveModel: (activeModel) => set({ activeModel }),
      setAvailableModels: (availableModels) => set({ availableModels }),
    }),
    {
      name: 'hr-bot-model',
      version: 1,
      migrate: (persisted) => {
        const s = persisted as { activeModel?: string; availableModels?: (StoredModel & { name?: string })[] }
        return {
          activeModel: s.activeModel ?? 'gpt-4o',
          availableModels: (s.availableModels ?? []).map(m => ({
            id: m.id,
            label: m.label ?? m.name ?? m.id,
            provider: m.provider ?? '',
          })),
        }
      },
    }
  )
)
