import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import '../../styles/admin-tabs.css'
import './PlatformSettingsPage.css'
import SystemPanel from './platform/SystemPanel'
import EmailTemplatesPanel from './platform/EmailTemplatesPanel'
import WebhooksPanel from './platform/WebhooksPanel'
import SecurityPoliciesPanel from './platform/SecurityPoliciesPanel'
import EmailDeliveryPanel from './platform/EmailDeliveryPanel'

const TABS = [
  { key: 'system', label: 'System' },
  { key: 'email', label: 'Email Templates' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'security', label: 'Security Policies' },
  { key: 'delivery', label: 'Email Delivery' },
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null
      setToast('')
    }, 3000)
  }, [])
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  return (
    <div className="ps-page">
      {toast && <div className="ps-toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Platform Settings</div>
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
      {tab === 'webhooks' && <WebhooksPanel showToast={showToast} />}
      {tab === 'security' && <SecurityPoliciesPanel showToast={showToast} />}
      {tab === 'delivery' && <EmailDeliveryPanel showToast={showToast} />}
    </div>
  )
}
