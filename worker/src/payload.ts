export const SITES = ['trendyol', 'hepsiburada', 'amazon'] as const
export type Site = (typeof SITES)[number]

const SITE_STATUSES = ['ok', 'engel', 'urun_degisti', 'hata', 'veri_yok'] as const
export type SiteStatus = (typeof SITE_STATUSES)[number]

const PRICE_BASES = ['liste', 'sepette', 'kupon', 'prime'] as const
export type PriceBasis = (typeof PRICE_BASES)[number]

export interface Offer {
  key: string
  site: Site
  color: string
  seller: string
  seller_score: number | null
  price: number
  effective: number
  basis: PriceBasis
  url: string
  in_stock: boolean
  qualifies: boolean
  why_not: string | null
  notes: string[]
  stock_hint: string | null
}

export interface SiteReport {
  status: SiteStatus
  detail: string
  pages_ok: number
  pages_total: number
  pages_failed: string[]
  offers: Offer[]
}

export interface IngestPayload {
  version: 1
  observed_at: string
  dispatched_at: string | null
  run_url: string | null
  duration_ms: number
  sites: Record<Site, SiteReport>
}

export type PayloadResult = { ok: true; payload: IngestPayload } | { ok: false; field: string }

export function perSite<T>(make: (site: Site) => T): Record<Site, T> {
  return { trendyol: make('trendyol'), hepsiburada: make('hepsiburada'), amazon: make('amazon') }
}

const UNREPORTED_SITE: SiteReport = {
  status: 'veri_yok',
  detail: 'rapor gelmedi',
  pages_ok: 0,
  pages_total: 0,
  pages_failed: [],
  offers: [],
}
const WEB_ADDRESS = /^https?:\/\/\S+$/

class InvalidField extends Error {}

function reject(field: string): never {
  throw new InvalidField(field)
}

function objectAt(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject(field)
  return value as Record<string, unknown>
}

function textAt(value: unknown, field: string): string {
  if (typeof value !== 'string') reject(field)
  return value
}

function nullableTextAt(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : textAt(value, field)
}

function numberAt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(field)
  return value
}

function nullableNumberAt(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : numberAt(value, field)
}

function priceAt(value: unknown, field: string): number {
  const price = numberAt(value, field)
  if (price <= 0) reject(field)
  return price
}

function flagAt(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') reject(field)
  return value
}

function choiceAt<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  const match = choices.find((choice) => choice === value)
  if (match === undefined) reject(field)
  return match
}

function timeAt(value: unknown, field: string): string {
  const text = textAt(value, field)
  if (Number.isNaN(Date.parse(text))) reject(field)
  return text
}

function nullableTimeAt(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : timeAt(value, field)
}

function addressAt(value: unknown, field: string): string {
  const text = textAt(value, field)
  if (!WEB_ADDRESS.test(text)) reject(field)
  return text
}

function textListAt(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) reject(field)
  return value.map((item, index) => textAt(item, `${field}[${index}]`))
}

function offerAt(value: unknown, site: Site, field: string): Offer {
  const raw = objectAt(value, field)
  if (raw.site !== site) reject(`${field}.site`)
  const key = textAt(raw.key, `${field}.key`)
  if (!key.trim()) reject(`${field}.key`)
  return {
    key,
    site,
    color: textAt(raw.color, `${field}.color`),
    seller: textAt(raw.seller, `${field}.seller`),
    seller_score: nullableNumberAt(raw.seller_score, `${field}.seller_score`),
    price: priceAt(raw.price, `${field}.price`),
    effective: priceAt(raw.effective, `${field}.effective`),
    basis: choiceAt(raw.basis, PRICE_BASES, `${field}.basis`),
    url: addressAt(raw.url, `${field}.url`),
    in_stock: flagAt(raw.in_stock, `${field}.in_stock`),
    qualifies: flagAt(raw.qualifies, `${field}.qualifies`),
    why_not: nullableTextAt(raw.why_not, `${field}.why_not`),
    notes: textListAt(raw.notes, `${field}.notes`),
    stock_hint: nullableTextAt(raw.stock_hint, `${field}.stock_hint`),
  }
}

function siteReportAt(value: unknown, site: Site, field: string): SiteReport {
  if (value === null || value === undefined) return UNREPORTED_SITE
  const raw = objectAt(value, field)
  const offers = raw.offers ?? []
  if (!Array.isArray(offers)) reject(`${field}.offers`)
  return {
    status: choiceAt(raw.status, SITE_STATUSES, `${field}.status`),
    detail: nullableTextAt(raw.detail, `${field}.detail`) ?? '',
    pages_ok: nullableNumberAt(raw.pages_ok, `${field}.pages_ok`) ?? 0,
    pages_total: nullableNumberAt(raw.pages_total, `${field}.pages_total`) ?? 0,
    pages_failed: textListAt(raw.pages_failed, `${field}.pages_failed`),
    offers: offers.map((offer, index) => offerAt(offer, site, `${field}.offers[${index}]`)),
  }
}

function payloadFrom(value: unknown): IngestPayload {
  const raw = objectAt(value, 'body')
  if (raw.version !== 1) reject('version')
  const sites = objectAt(raw.sites, 'sites')
  return {
    version: 1,
    observed_at: timeAt(raw.observed_at, 'observed_at'),
    dispatched_at: nullableTimeAt(raw.dispatched_at, 'dispatched_at'),
    run_url: nullableTextAt(raw.run_url, 'run_url'),
    duration_ms: nullableNumberAt(raw.duration_ms, 'duration_ms') ?? 0,
    sites: perSite((site) => siteReportAt(sites[site], site, `sites.${site}`)),
  }
}

export function parsePayload(body: string): PayloadResult {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { ok: false, field: 'json' }
  }
  try {
    return { ok: true, payload: payloadFrom(json) }
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, field: error.message }
    throw error
  }
}
