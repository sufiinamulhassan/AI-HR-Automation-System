import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { intelApi } from '../lib/api'

export interface UploadBatch {
  batchId: string
  totalFiles: number
  status: string
  processed: number
  skippedDuplicates: number
  failed: number
  autoInvited: number
  uploadedBy?: string
}

interface UploadState {
  batch: UploadBatch | null
  uploading: boolean
  error: string
  startUpload: (files: File[], model?: string) => Promise<boolean>
  resume: () => void
  dismiss: () => void
}

const TERMINAL = ['completed', 'failed']
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export const useUploadStore = create<UploadState>()(
  persist(
    (set, get) => {
      function poll(batchId: string) {
        stopPolling()
        pollTimer = setInterval(async () => {
          try {
            const s = await intelApi.batchStatus(batchId)
            const d = s.data as Record<string, unknown>
            set(state => ({
              batch: state.batch && {
                ...state.batch,
                status: (d.status as string) ?? state.batch.status,
                processed: (d.processed as number) ?? state.batch.processed,
                skippedDuplicates: (d.skipped_duplicates as number) ?? state.batch.skippedDuplicates,
                failed: (d.failed as number) ?? state.batch.failed,
                autoInvited: (d.auto_invited as number) ?? state.batch.autoInvited,
                uploadedBy: (d.uploaded_by as string) ?? state.batch.uploadedBy,
              },
            }))
            if (TERMINAL.includes(d.status as string)) stopPolling()
          } catch { stopPolling() }
        }, 2000)
      }

      return {
        batch: null,
        uploading: false,
        error: '',

        startUpload: async (files, model) => {
          if (!files.length) return false
          stopPolling()
          set({ uploading: true, error: '', batch: null })
          try {
            const r = await intelApi.bulkUpload(files, model || undefined)
            const batch: UploadBatch = {
              batchId: r.data.batch_id,
              totalFiles: r.data.total_files,
              status: r.data.status || 'queued',
              processed: 0,
              skippedDuplicates: 0,
              failed: 0,
              autoInvited: 0,
            }
            set({ batch, uploading: false })
            poll(batch.batchId)
            return true
          } catch (err: unknown) {
            set({
              uploading: false,
              error: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Upload failed',
            })
            return false
          }
        },

        resume: () => {
          const b = get().batch
          if (b && !TERMINAL.includes(b.status)) poll(b.batchId)
        },

        dismiss: () => { stopPolling(); set({ batch: null, error: '' }) },
      }
    },
    {
      name: 'hr-bot-upload',
      partialize: state => ({ batch: state.batch }),
    }
  )
)
