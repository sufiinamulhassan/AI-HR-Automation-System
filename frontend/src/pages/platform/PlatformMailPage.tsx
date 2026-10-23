import { platformApi } from '../../lib/api'
import { MailForm, type MailSource } from '../admin/organization/MailPanel'
import { useToast } from './PlatformUi'

const PLATFORM_SOURCE: MailSource = {
  title: 'Platform mail',
  load: () => platformApi.getMail(),
  save: d => platformApi.updateMail(d),
  verify: () => platformApi.verifyMail(),
  test: to => platformApi.testMail(to),
  defaultLabel: 'Default service',
  ownLabel: 'Your own mail server',
  defaultHint: 'Messages go out through the mail service set in the server configuration. Choose your own server to connect one here.',
  incompleteHint: 'Incomplete. Your own server is used only when the settings are complete.',
  completeHint: 'Complete. Platform messages, and every company without its own server, go out through this server. They are not sent another way if it fails.',
  ownVia: 'platform',
  ownViaText: 'your mail server',
  defaultViaText: 'the default mail service',
  fromNamePlaceholder: 'Talent Desk',
  fromAddressPlaceholder: 'no-reply@example.com',
  replyToPlaceholder: 'support@example.com',
}

export default function PlatformMailPage() {
  const { toast, showToast } = useToast()

  return (
    <div className="pco-page">
      {toast}
      <div className="pco-header">
        <h1 className="pco-title">Email</h1>
      </div>
      <MailForm showToast={showToast} source={PLATFORM_SOURCE} />
    </div>
  )
}
