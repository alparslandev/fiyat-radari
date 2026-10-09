import type { Env } from './env'
import { nextHealthState, type HealthAction, type HealthState } from './health'
import { dealActions, dealNotice, siteDownNotice, siteRecoveredNotice } from './messages'
import { announce, errorMessage } from './notify'
import { parsePayload, perSite, SITES, type IngestPayload, type Offer, type Site } from './payload'
import { compareOffers, decide, type Decision } from './rule'
import { parseRadarState, STATE_KEY, type IngestRecord, type RadarState, type SiteSnapshot } from './state'

export const MAX_BODY_BYTES = 256 * 1024

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const BEARER = /^Bearer\s+(\S+)\s*$/i

type SiteHealth = Record<Site, { state: HealthState; action: HealthAction }>

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) {
    console.error('[ingest] INGEST_TOKEN tanımlı değil, istek reddedildi')
    return false
  }
  const match = BEARER.exec(request.headers.get('Authorization') ?? '')
  return match ? sameSecret(match[1], token) : false
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (declared > MAX_BODY_BYTES) return null
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_BODY_BYTES) return null
  return new TextDecoder().decode(bytes)
}

function cheapest(offers: Offer[]): Offer | null {
  return offers.length ? [...offers].sort(compareOffers)[0] : null
}

function siteSnapshot(payload: IngestPayload, site: Site): SiteSnapshot {
  const report = payload.sites[site]
  const offers = report.status === 'ok' ? report.offers : []
  return {
    status: report.status,
    detail: report.detail,
    best: cheapest(offers.filter((offer) => offer.qualifies)),
    cheapestOther: cheapest(offers.filter((offer) => !offer.qualifies)),
  }
}

function withIngestRecord(records: IngestRecord[], payload: IngestPayload, now: number): IngestRecord[] {
  const latencyMs =
    payload.dispatched_at === null
      ? null
      : Math.max(0, Date.parse(payload.observed_at) - Date.parse(payload.dispatched_at))
  return [...records.filter((record) => record.at > now - DAY_MS), { at: now, latencyMs }]
}

async function notifyIngest(
  env: Env,
  payload: IngestPayload,
  previous: RadarState,
  decision: Decision,
  health: SiteHealth,
  now: number,
): Promise<void> {
  const deliveries: Promise<void>[] = []
  const deal = decision.deal
  if (deal) {
    deliveries.push(
      announce(env, dealNotice(deal, previous.allTimeLow, payload.run_url), {
        priority: 5,
        click: deal.best.url,
        actions: dealActions(deal),
        idempotencyKey: `deal:${deal.best.key}:${deal.best.effective}:${Date.parse(payload.observed_at)}`,
      }),
    )
  }
  for (const site of SITES) {
    const { state, action } = health[site]
    if (action === 'alert') {
      deliveries.push(
        announce(env, siteDownNotice(site, payload.sites[site], state, now, payload.run_url), {
          priority: 4,
          idempotencyKey: `site-alert:${site}:${state.alertedAt}`,
        }),
      )
    }
    if (action === 'recover') {
      deliveries.push(
        announce(env, siteRecoveredNotice(site, previous.health[site], now), {
          priority: 3,
          idempotencyKey: `site-recover:${site}:${previous.health[site].since}`,
        }),
      )
    }
  }
  await Promise.all(deliveries)
}

export async function handleIngest(request: Request, env: Env, now: number): Promise<Response> {
  if (!(await authorized(request, env.INGEST_TOKEN))) return json(401, { error: 'yetkisiz' })
  const body = await readBody(request)
  if (body === null) return json(413, { error: 'gövde çok büyük', limit: MAX_BODY_BYTES })
  const parsed = parsePayload(body)
  if (!parsed.ok) return json(400, { error: 'geçersiz veri', field: parsed.field })
  const payload = parsed.payload
  const observedAt = Date.parse(payload.observed_at)
  if (observedAt > now + MAX_CLOCK_SKEW_MS) return json(400, { error: 'geçersiz veri', field: 'observed_at' })

  const previous = parseRadarState(await env.RADAR.get(STATE_KEY))
  if (previous.lastObservedAt !== null && observedAt <= previous.lastObservedAt) return json(200, { ignored: 'eski' })

  const decision = decide(previous, payload, now)
  const checkedAt = new Date(now)
  const health: SiteHealth = perSite((site) => {
    const report = payload.sites[site]
    const { state, action } = nextHealthState(
      previous.health[site],
      [{ name: site, ok: report.status === 'ok', detail: report.detail }],
      checkedAt,
    )
    return { state, action }
  })
  const next: RadarState = {
    ...decision.state,
    health: perSite((site) => health[site].state),
    ingests: withIngestRecord(previous.ingests, payload, now),
    lastIngestAt: now,
    lastObservedAt: observedAt,
    lastSites: perSite((site) => siteSnapshot(payload, site)),
  }
  await env.RADAR.put(STATE_KEY, JSON.stringify(next))

  try {
    await notifyIngest(env, payload, previous, decision, health, now)
  } catch (error) {
    console.error(`[ingest] bildirim gönderilemedi: ${errorMessage(error)}`)
  }

  return json(200, {
    deal: decision.deal !== null,
    best: decision.best,
    normal: decision.normal,
    health: perSite((site) => health[site].action),
  })
}
