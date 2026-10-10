import { spyOn } from 'bun:test'
import type { Env, RadarKv } from '../src/env'
import { perSite, type IngestPayload, type Offer, type Site, type SiteReport, type SiteStatus } from '../src/payload'
import { BUCKET_MS, MIN_BUCKETS, type RuleState } from '../src/rule'

export const RESEND_URL = 'https://api.resend.com/emails'
export const GITHUB_DISPATCH_URL =
  'https://api.github.com/repos/alparslandev/fiyat-radari/actions/workflows/radar.yml/dispatches'

export class MemoryKv implements RadarKv {
  readonly values = new Map<string, string>()
  readonly ttls = new Map<string, number | undefined>()
  readonly writes: string[] = []

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value)
    this.ttls.set(key, options?.expirationTtl)
    this.writes.push(key)
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value))
  }

  read<T>(key: string): T {
    const raw = this.values.get(key)
    if (raw === undefined) throw new Error(`KV anahtarı yok: ${key}`)
    return JSON.parse(raw) as T
  }
}

export type TestEnv = Omit<Env, 'RADAR'> & { RADAR: MemoryKv }

export function testEnv(overrides: Partial<Omit<Env, 'RADAR'>> = {}): TestEnv {
  return {
    RADAR: new MemoryKv(),
    GH_REPO: 'alparslandev/fiyat-radari',
    GH_WORKFLOW: 'radar.yml',
    GH_REF: 'main',
    MAIL_FROM: 'Fiyat Radarı <radar@devdiscipline.com>',
    GH_TOKEN: 'ghp_test',
    INGEST_TOKEN: 'gizli-anahtar',
    RESEND_API_KEY: 're_test',
    MAIL_TO: 'alp@example.com',
    ...overrides,
  }
}

export interface RecordedCall {
  url: string
  method: string
  headers: Headers
  body: string
}

type Responder = (call: RecordedCall) => Response | Promise<Response>

const realFetch = globalThis.fetch

export function stubFetch(respond: Responder): RecordedCall[] {
  const calls: RecordedCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const call: RecordedCall = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return calls
}

export function restoreFetch(): void {
  globalThis.fetch = realFetch
}

export function answerEverything(call: RecordedCall): Response {
  if (call.url === GITHUB_DISPATCH_URL) return new Response(null, { status: 204 })
  if (call.url === RESEND_URL) return Response.json({ id: 'email-1' })
  return new Response(null, { status: 404 })
}

export function callsTo(calls: RecordedCall[], url: string): RecordedCall[] {
  return calls.filter((call) => call.url === url)
}

export function bodyOf<T>(call: RecordedCall | undefined): T {
  if (!call) throw new Error('beklenen istek yok')
  return JSON.parse(call.body) as T
}

export interface ResendBody {
  from: string
  to: string[]
  subject: string
  text: string
}

export function silenceConsole(): () => void {
  const spies = [spyOn(console, 'error'), spyOn(console, 'warn'), spyOn(console, 'log')]
  for (const spy of spies) spy.mockImplementation(() => {})
  return () => {
    for (const spy of spies) spy.mockRestore()
  }
}

const OFFER_URLS: Record<Site, string> = {
  trendyol: 'https://www.trendyol.com/apple/iphone-17-pro-256-gb-p-985256847',
  hepsiburada: 'https://www.hepsiburada.com/apple-iphone-17-pro-256-gb-p-HBC00009',
  amazon: 'https://www.amazon.com.tr/dp/B0FQTEST17',
}

const SELLERS: Record<Site, string> = { trendyol: 'Trendyol', hepsiburada: 'Hepsiburada', amazon: 'Amazon' }

export function offer(overrides: Partial<Offer> = {}): Offer {
  const site = overrides.site ?? 'trendyol'
  const effective = overrides.effective ?? 105_000
  return {
    key: `${site}:1:1`,
    site,
    color: 'Gümüş',
    seller: SELLERS[site],
    seller_score: 9.3,
    price: effective,
    effective,
    basis: 'liste',
    url: OFFER_URLS[site],
    in_stock: true,
    qualifies: true,
    why_not: null,
    notes: [],
    stock_hint: null,
    ...overrides,
  }
}

export function report(overrides: Partial<SiteReport> = {}): SiteReport {
  return { status: 'ok', detail: '', pages_ok: 3, pages_total: 3, pages_failed: [], offers: [], ...overrides }
}

export function payloadWith(
  offers: Offer[],
  statuses: Partial<Record<Site, SiteStatus>> = {},
  overrides: Partial<IngestPayload> = {},
): IngestPayload {
  return {
    version: 1,
    observed_at: '2026-10-09T10:00:00.000Z',
    dispatched_at: '2026-10-09T09:58:30.000Z',
    run_url: 'https://github.com/alparslandev/fiyat-radari/actions/runs/123',
    duration_ms: 41_234,
    sites: perSite((site) =>
      report({
        status: statuses[site] ?? 'ok',
        detail: statuses[site] && statuses[site] !== 'ok' ? 'Cloudflare doğrulaması' : '',
        offers: offers.filter((item) => item.site === site),
      }),
    ),
    ...overrides,
  }
}

export function warmBuckets(price: number, now: number, count: number = MIN_BUCKETS): Record<string, number> {
  const current = Math.floor(now / BUCKET_MS) * BUCKET_MS
  const buckets: Record<string, number> = {}
  for (let index = 1; index <= count; index += 1) buckets[String(current - index * BUCKET_MS)] = price
  return buckets
}

export function warmState(price: number, now: number, count: number = MIN_BUCKETS): RuleState {
  return { buckets: warmBuckets(price, now, count), notified: {}, allTimeLow: null }
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export function ingestRequest(body: string, authorization: string | null = 'Bearer gizli-anahtar'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authorization !== null) headers.Authorization = authorization
  return new Request('https://fiyat-radari.example.workers.dev/ingest', { method: 'POST', headers, body })
}
