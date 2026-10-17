import { careersApi, siteApi } from './api'

type Loader = () => Promise<unknown>

const CHUNKS: Record<string, Loader[]> = {
  '/careers': [
    () => import('../pages/careers/CareersLayout'),
    () => import('../pages/careers/CareersPage'),
  ],
  '/pricing': [() => import('../pages/site/PricingPage')],
  '/contact': [() => import('../pages/site/ContactPage')],
  '/features': [() => import('../pages/site/FeaturesPage')],
  '/security': [() => import('../pages/site/SecurityPage')],
  '/about': [() => import('../pages/site/AboutPage')],
  '/faq': [() => import('../pages/site/FaqPage')],
  '/candidates': [() => import('../pages/site/CandidatesPage')],
  '/trust': [() => import('../pages/site/TrustPage')],
  '/roi-calculator': [() => import('../pages/site/RoiCalculatorPage')],
  '/integrations': [() => import('../pages/site/IntegrationsSection')],
  '/compare': [() => import('../pages/site/CompareSection')],
}

const SECTION_PREFIXES = ['/integrations', '/compare']

export function chunkKey(path: string): string {
  const key = normalisePath(path)
  const section = SECTION_PREFIXES.find(prefix => key.startsWith(`${prefix}/`))
  return section ?? key
}

const DATA: Record<string, Loader[]> = {
  '/careers': [() => careersApi.filters(), () => careersApi.jobs({ page: 1, limit: 12 })],
  '/pricing': [() => siteApi.plans()],
}

const DATA_REPEAT_MS = 20_000
const IDLE_FALLBACK_MS = 1500

const chunksStarted = new Set<string>()
const dataStarted = new Map<string, number>()

function enabled(): boolean {
  return typeof window !== 'undefined' && import.meta.env.MODE !== 'test'
}

export function normalisePath(path: string): string {
  const clean = path.split('#')[0].split('?')[0]
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean
}

export function prefetchChunks(path: string): void {
  const key = chunkKey(path)
  const loaders = CHUNKS[key]
  if (!enabled() || !loaders || chunksStarted.has(key)) return
  chunksStarted.add(key)
  loaders.forEach(load => {
    load().catch(() => chunksStarted.delete(key))
  })
}

export function prefetchData(path: string, now: number = Date.now()): void {
  const key = normalisePath(path)
  const loaders = DATA[key]
  if (!enabled() || !loaders) return
  const last = dataStarted.get(key)
  if (last !== undefined && now - last < DATA_REPEAT_MS) return
  dataStarted.set(key, now)
  loaders.forEach(load => {
    load().catch(() => {})
  })
}

export function prefetchRoute(path: string): void {
  prefetchChunks(path)
  prefetchData(path)
}

export function prefetchChunksWhenIdle(paths: string[]): () => void {
  if (!enabled()) return () => {}
  const run = () => paths.forEach(prefetchChunks)
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 })
    return () => window.cancelIdleCallback?.(id)
  }
  const timer = window.setTimeout(run, IDLE_FALLBACK_MS)
  return () => window.clearTimeout(timer)
}

export function resetPrefetchForTests(): void {
  chunksStarted.clear()
  dataStarted.clear()
}
