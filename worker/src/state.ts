import { parseHealthState, type HealthState } from './health'
import { perSite, type Offer, type Site, type SiteStatus } from './payload'
import type { AllTimeLow, NotifiedDeal, RuleState } from './rule'

export const STATE_KEY = 'state'
export const CRON_KEY = 'cron'
export const DIGEST_KEY_PREFIX = 'digest:'

export interface IngestRecord {
  at: number
  latencyMs: number | null
}

export interface SiteSnapshot {
  status: SiteStatus
  detail: string
  best: Offer | null
  cheapestOther: Offer | null
}

export interface RadarState extends RuleState {
  health: Record<Site, HealthState>
  ingests: IngestRecord[]
  lastIngestAt: number | null
  lastObservedAt: number | null
  lastSites: Partial<Record<Site, SiteSnapshot>>
}

export interface CronState {
  dispatch: HealthState
  watchdog: HealthState
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return objectOrEmpty(JSON.parse(raw))
  } catch {
    console.error('[state] KV kaydı çözümlenemedi, boş durumla devam ediliyor')
    return {}
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseRadarState(raw: string | null): RadarState {
  const parsed = parseJsonObject(raw)
  const health = objectOrEmpty(parsed.health)
  return {
    buckets: objectOrEmpty(parsed.buckets) as Record<string, number>,
    notified: objectOrEmpty(parsed.notified) as Record<string, NotifiedDeal>,
    allTimeLow: parsed.allTimeLow ? (parsed.allTimeLow as AllTimeLow) : null,
    health: perSite((site) => parseHealthState(health[site])),
    ingests: Array.isArray(parsed.ingests) ? (parsed.ingests as IngestRecord[]) : [],
    lastIngestAt: numberOrNull(parsed.lastIngestAt),
    lastObservedAt: numberOrNull(parsed.lastObservedAt),
    lastSites: objectOrEmpty(parsed.lastSites) as RadarState['lastSites'],
  }
}

export function parseCronState(raw: string | null): CronState {
  const parsed = parseJsonObject(raw)
  return { dispatch: parseHealthState(parsed.dispatch), watchdog: parseHealthState(parsed.watchdog) }
}
