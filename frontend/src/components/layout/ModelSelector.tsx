import { useEffect } from 'react'
import { authApi } from '../../lib/api'
import { useModelStore } from '../../store/model.store'
import './ModelSelector.css'

export default function ModelSelector() {
  const { activeModel, availableModels, setActiveModel, setAvailableModels } = useModelStore()

  useEffect(() => {
    authApi.listModels().then(r => {
      const models = (r.data.models ?? []).map((m: { id: string; label?: string; name?: string; provider: string }) => ({
        id: m.id,
        label: m.label ?? m.name ?? m.id,
        provider: m.provider ?? '',
      }))
      setAvailableModels(models)
      if (r.data.current) setActiveModel(r.data.current)
    }).catch(() => {})
  }, [])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setActiveModel(id)
    try {
      await authApi.setDefaultModel(id)
    } catch {}
  }

  return (
    <div className="model-selector">
      <label className="model-label">AI Model</label>
      <select className="model-select" value={activeModel} onChange={handleChange}>
        {availableModels.length === 0 && (
          <option value={activeModel}>{activeModel}</option>
        )}
        {availableModels.map(m => (
          <option key={m.id} value={m.id}>{m.label || m.id}</option>
        ))}
      </select>
    </div>
  )
}
