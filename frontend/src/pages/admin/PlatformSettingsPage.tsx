import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import '../../styles/admin-tabs.css'
import './PlatformSettingsPage.css'
import SystemPanel from './platform/SystemPanel'
import EmailTemplatesPanel from './platform/EmailTemplatesPanel'
import PromptConfigPanel from './platform/PromptConfigPanel'
import WebhooksPanel from './platform/WebhooksPanel'


const TABS = [
  { key: 'system', label: 'System' },
  { key: 'email', label: 'Email Templates' },
  { key: 'prompts', label: 'AI Prompts' },
  { key: 'webhooks', label: 'Webhooks' },
] as const

type TabKey = typeof TABS[number]['key']

const TAB_KEYS = TABS.map(t => t.key) as readonly string[]

export default function PlatformSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab: TabKey = (raw && TAB_KEYS.includes(raw) ? raw : 'system') as TabKey

  function setTab(next: TabKey) {
    setSearchParams(next === 'system' ? {} : { tab: next }, { replace: true })
  }

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className="ps-page">
      {toast && <div className="ps-toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Platform Settings</div>
          <div className="page-sub">AI models, email templates, prompt configuration, and outbound webhooks</div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`adm-tab${tab === t.key ? ' adm-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'system' && <SystemPanel showToast={showToast} />}
      {tab === 'email' && <EmailTemplatesPanel showToast={showToast} />}
      {tab === 'prompts' && <PromptConfigPanel showToast={showToast} />}
      {tab === 'webhooks' && <WebhooksPanel showToast={showToast} />}
    </div>
  )
}
