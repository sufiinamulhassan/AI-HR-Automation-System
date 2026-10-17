import { INTEGRATIONS } from './content/integrations'
import ExplainerRoute from './ExplainerRoute'
import HubView from './HubView'
import { INTEGRATIONS_HUB } from './hubConfigs'

export function IntegrationsHub() {
  return <HubView hub={INTEGRATIONS_HUB} />
}

export function IntegrationDetail() {
  return <ExplainerRoute items={INTEGRATIONS} parent={{ label: 'Integrations', to: '/integrations' }} />
}
