import { SITES, type IngestPayload, type Offer, type Site } from './payload'

export const STEP_TL = 500
export const DEAL_ENDED_TL = 1000
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const BUCKET_MS = 15 * 60 * 1000
export const MIN_BUCKETS = 96
export const FORGET_AFTER_MS = 6 * 60 * 60 * 1000

export interface NotifiedDeal {
  site: Site
  price: number
  current: number | null
  seenAt: number
}

export interface AllTimeLow {
  price: number
  site: Site
  color: string
  seller: string
  at: number
}

export interface RuleState {
  buckets: Record<string, number>
  notified: Record<string, NotifiedDeal>
  allTimeLow: AllTimeLow | null
}

export interface Deal {
  best: Offer
  normal: number
  floor: number | null
  top: Offer[]
  missingSites: Site[]
}

export interface Decision {
  state: RuleState
  deal: Deal | null
  best: Offer | null
  normal: number | null
}

export function compareOffers(a: Offer, b: Offer): number {
  if (a.effective !== b.effective) return a.effective - b.effective
  const scoreA = a.seller_score ?? Number.NEGATIVE_INFINITY
  const scoreB = b.seller_score ?? Number.NEGATIVE_INFINITY
  if (scoreA !== scoreB) return scoreB > scoreA ? 1 : -1
  if (a.site !== b.site) return a.site < b.site ? -1 : 1
  if (a.key !== b.key) return a.key < b.key ? -1 : 1
  return 0
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function normalPrice(buckets: Record<string, number>): number | null {
  const values = Object.values(buckets)
  return values.length >= MIN_BUCKETS ? median(values) : null
}

function okSites(payload: IngestPayload): Site[] {
  return SITES.filter((site) => payload.sites[site].status === 'ok')
}

function liveOffers(payload: IngestPayload): Offer[] {
  return okSites(payload).flatMap((site) => payload.sites[site].offers.filter((offer) => offer.qualifies))
}

function productIdOf(key: string): string {
  return key.split(':')[1] ?? ''
}

function failedPagesBySite(payload: IngestPayload): Map<Site, Set<string>> {
  return new Map(SITES.map((site) => [site, new Set(payload.sites[site].pages_failed)]))
}

function refreshNotified(
  notified: Record<string, NotifiedDeal>,
  ok: Set<Site>,
  seen: Map<string, Offer>,
  failedPages: Map<Site, Set<string>>,
  now: number,
): Record<string, NotifiedDeal> {
  const kept: Record<string, NotifiedDeal> = {}
  for (const [key, entry] of Object.entries(notified)) {
    const next = { ...entry }
    if (ok.has(next.site)) {
      const offer = seen.get(key)
      if (offer) {
        next.current = offer.effective
        next.seenAt = now
        if (next.current >= next.price + DEAL_ENDED_TL) next.price = next.current
      } else if (!failedPages.get(next.site)?.has(productIdOf(key))) {
        next.current = null
      }
    }
    if (now - next.seenAt > FORGET_AFTER_MS) continue
    kept[key] = next
  }
  return kept
}

function cheapestOtherDeal(notified: Record<string, NotifiedDeal>, bestKey: string): number {
  let floor = Number.POSITIVE_INFINITY
  for (const [key, entry] of Object.entries(notified)) {
    if (key !== bestKey && entry.current !== null && entry.current < floor) floor = entry.current
  }
  return floor
}

function withBucket(buckets: Record<string, number>, now: number, price: number): Record<string, number> {
  const start = String(Math.floor(now / BUCKET_MS) * BUCKET_MS)
  const oldest = now - WINDOW_MS
  const next: Record<string, number> = {}
  for (const [key, value] of Object.entries(buckets)) {
    if (Number(key) >= oldest) next[key] = value
  }
  next[start] = Math.min(next[start] ?? Number.POSITIVE_INFINITY, price)
  return next
}

function lowerOf(previous: AllTimeLow | null, best: Offer, now: number): AllTimeLow {
  if (previous && previous.price <= best.effective) return previous
  return { price: best.effective, site: best.site, color: best.color, seller: best.seller, at: now }
}

export function decide(state: RuleState, payload: IngestPayload, now: number): Decision {
  const ok = okSites(payload)
  const live = liveOffers(payload)
  const seen = new Map(live.map((offer) => [offer.key, offer]))
  const notified = refreshNotified(state.notified, new Set(ok), seen, failedPagesBySite(payload), now)
  const normal = normalPrice(state.buckets)

  if (live.length === 0) {
    return { state: { buckets: state.buckets, notified, allTimeLow: state.allTimeLow }, deal: null, best: null, normal }
  }

  const ranked = [...live].sort(compareOffers)
  const best = ranked[0]
  const floor = cheapestOtherDeal(notified, best.key)
  const own = notified[best.key]
  const fire =
    normal !== null &&
    best.effective <= normal - STEP_TL &&
    best.effective <= floor - STEP_TL &&
    (own === undefined || best.effective <= own.price - STEP_TL)

  if (fire) notified[best.key] = { site: best.site, price: best.effective, current: best.effective, seenAt: now }

  const nextState: RuleState = {
    buckets: withBucket(state.buckets, now, best.effective),
    notified,
    allTimeLow: lowerOf(state.allTimeLow, best, now),
  }
  const deal: Deal | null =
    fire && normal !== null
      ? {
          best,
          normal,
          floor: Number.isFinite(floor) ? floor : null,
          top: ranked.slice(0, 3),
          missingSites: SITES.filter((site) => !ok.includes(site)),
        }
      : null

  return { state: nextState, deal, best, normal }
}
