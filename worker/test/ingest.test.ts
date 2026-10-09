import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleIngest, MAX_BODY_BYTES } from '../src/ingest'
import type { IngestPayload, Offer, Site } from '../src/payload'
import { STATE_KEY, type RadarState } from '../src/state'
import {
  answerEverything,
  bodyOf,
  callsTo,
  ingestRequest,
  NTFY_URL,
  offer,
  payloadWith,
  RESEND_URL,
  restoreFetch,
  silenceConsole,
  stubFetch,
  testEnv,
  warmBuckets,
  type NtfyBody,
  type ResendBody,
  type TestEnv,
} from './support'

interface IngestResponse {
  deal: boolean
  best: Offer | null
  normal: number | null
  health: Record<Site, string>
}

const NOW = Date.parse('2026-10-09T10:01:30Z')
const MINUTE = 60_000
const OBSERVED_AT = '2026-10-09T10:00:00.000Z'

const dealOffer = offer({
  key: 'trendyol:985256847:968',
  color: 'Kozmik Turuncu',
  seller_score: 9.3,
  price: 103_000,
  effective: 101_499,
  basis: 'kupon',
  notes: ['Plus ile 100.999 TL'],
  stock_hint: 'Stokta sadece 6 adet kaldı.',
})
const amazonOffer = offer({ key: 'amazon:B0FQTEST17:1', site: 'amazon', seller_score: null, effective: 103_869 })
const dealPayload = payloadWith([dealOffer, amazonOffer], { hepsiburada: 'engel' })

let restoreConsole: () => void = () => {}

beforeEach(() => {
  restoreConsole = silenceConsole()
})

afterEach(() => {
  restoreFetch()
  restoreConsole()
})

function post(env: TestEnv, payload: IngestPayload | string, now: number = NOW): Promise<Response> {
  return handleIngest(ingestRequest(typeof payload === 'string' ? payload : JSON.stringify(payload)), env, now)
}

function seedWarmState(env: TestEnv): void {
  env.RADAR.seed(STATE_KEY, {
    buckets: warmBuckets(105_000, NOW),
    notified: {},
    allTimeLow: null,
    lastIngestAt: NOW - 15 * MINUTE,
    lastObservedAt: NOW - 16 * MINUTE,
  })
}

describe('handleIngest', () => {
  test('rejects a missing or wrong token with 401 and touches nothing', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    const body = JSON.stringify(payloadWith([offer()]))

    expect((await handleIngest(ingestRequest(body, 'Bearer yanlis'), env, NOW)).status).toBe(401)
    expect((await handleIngest(ingestRequest(body, null), env, NOW)).status).toBe(401)
    expect((await handleIngest(ingestRequest(body, 'Basic gizli-anahtar'), env, NOW)).status).toBe(401)
    expect((await handleIngest(ingestRequest(body), testEnv({ INGEST_TOKEN: undefined }), NOW)).status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(env.RADAR.writes).toEqual([])

    expect((await handleIngest(ingestRequest(body, 'bearer gizli-anahtar'), env, NOW)).status).toBe(200)
  })

  test('rejects a body over 256 KB with 413', async () => {
    const env = testEnv()
    stubFetch(answerEverything)
    const padded = JSON.stringify({ ...payloadWith([]), padding: 'x'.repeat(MAX_BODY_BYTES) })

    const response = await post(env, padded)
    expect(response.status).toBe(413)
    expect(env.RADAR.writes).toEqual([])
  })

  test('rejects malformed JSON and a wrong shape with 400', async () => {
    const env = testEnv()
    stubFetch(answerEverything)
    const priced = JSON.stringify(payloadWith([offer({ effective: 101_499 })]))
    const cases: [string, string][] = [
      ['{bozuk', 'json'],
      ['[]', 'body'],
      [JSON.stringify({ ...payloadWith([]), version: 2 }), 'version'],
      [JSON.stringify(payloadWith([], {}, { observed_at: 'dün' })), 'observed_at'],
      [priced.replace('"effective":101499', '"effective":"pahalı"'), 'sites.trendyol.offers[0].effective'],
      [priced.replace('"qualifies":true', '"qualifies":"evet"'), 'sites.trendyol.offers[0].qualifies'],
      [priced.replace('"basis":"liste"', '"basis":"indirim"'), 'sites.trendyol.offers[0].basis'],
      [priced.replace('"site":"trendyol"', '"site":"amazon"'), 'sites.trendyol.offers[0].site'],
      [JSON.stringify(payloadWith([offer({ url: 'javascript:alert(1)' })])), 'sites.trendyol.offers[0].url'],
      [priced.replace('"status":"ok"', '"status":"bilinmiyor"'), 'sites.trendyol.status'],
      [JSON.stringify(payloadWith([], {}, { observed_at: new Date(NOW + 10 * MINUTE).toISOString() })), 'observed_at'],
    ]

    for (const [body, field] of cases) {
      const response = await post(env, body)
      expect(response.status).toBe(400)
      expect(await response.json<Record<string, unknown>>()).toEqual({ error: 'geçersiz veri', field })
    }
    expect(env.RADAR.writes).toEqual([])
  })

  test('treats a site missing from the payload as veri_yok', async () => {
    const env = testEnv()
    stubFetch(answerEverything)
    const raw = JSON.parse(JSON.stringify(payloadWith([offer()])))
    delete raw.sites.amazon

    const response = await post(env, JSON.stringify(raw))
    expect(response.status).toBe(200)
    expect(env.RADAR.read<RadarState>(STATE_KEY).lastSites.amazon?.status).toBe('veri_yok')
  })

  test('ignores a payload whose observed_at is not newer than the last one', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    const first = await post(env, payloadWith([offer()]))
    expect(await first.json<IngestResponse>()).toMatchObject({ deal: false })

    const same = await post(env, payloadWith([offer()]), NOW + MINUTE)
    const older = await post(env, payloadWith([offer()], {}, { observed_at: '2026-10-09T09:59:00.000Z' }), NOW + MINUTE)
    expect(same.status).toBe(200)
    expect(await same.json<Record<string, unknown>>()).toEqual({ ignored: 'eski' })
    expect(await older.json<Record<string, unknown>>()).toEqual({ ignored: 'eski' })
    expect(env.RADAR.writes).toEqual([STATE_KEY])
    expect(calls).toHaveLength(0)
  })

  test('a deal sends exactly one ntfy push and one Resend mail with Turkish text intact', async () => {
    const env = testEnv()
    seedWarmState(env)
    const calls = stubFetch(answerEverything)

    const response = await post(env, dealPayload)
    expect(response.status).toBe(200)
    const result = await response.json<IngestResponse>()
    expect(result.deal).toBe(true)
    expect(result.best?.key).toBe(dealOffer.key)
    expect(result.normal).toBe(105_000)
    expect(result.health).toEqual({ trendyol: 'none', hepsiburada: 'none', amazon: 'none' })

    expect(calls).toHaveLength(2)
    const pushes = callsTo(calls, NTFY_URL)
    const mails = callsTo(calls, RESEND_URL)
    expect(pushes).toHaveLength(1)
    expect(mails).toHaveLength(1)

    expect(pushes[0]?.body).toContain('Olağan fiyatın 3.501 TL altında, kuponla')
    expect(bodyOf<NtfyBody>(pushes[0])).toEqual({
      topic: 'radar-test',
      title: 'iPhone 17 Pro 256 GB: 101.499 TL',
      message: [
        'Trendyol, Kozmik Turuncu',
        'Satıcı: Trendyol (9,3)',
        'Olağan fiyatın 3.501 TL altında, kuponla',
        'Stokta sadece 6 adet kaldı.',
      ].join('\n'),
      priority: 5,
      click: dealOffer.url,
      actions: [
        { action: 'view', label: "Trendyol'da aç", url: dealOffer.url },
        { action: 'view', label: "Amazon'da aç", url: amazonOffer.url },
      ],
    })

    const mail = bodyOf<ResendBody>(mails[0])
    expect(mails[0]?.body).toContain('Bu turda veri gelmeyen siteler: Hepsiburada')
    expect(mail.subject).toBe('iPhone 17 Pro 256 GB: 101.499 TL, Trendyol, Kozmik Turuncu')
    expect(mail.text.split('\n')[0]).toBe(dealOffer.url)
    expect(mail.text).toContain('1. Trendyol, 101.499 TL (kuponla), Kozmik Turuncu, satıcı Trendyol (9,3)')
    expect(mail.text).toContain('Tüm zamanların en düşüğü: bu teklif (ilk kayıt)')
    expect(mails[0]?.headers.get('Idempotency-Key')).toBe(
      `deal:trendyol:985256847:968:101499:${Date.parse(OBSERVED_AT)}`,
    )

    const state = env.RADAR.read<RadarState>(STATE_KEY)
    expect(env.RADAR.writes).toEqual([STATE_KEY])
    expect(state.notified[dealOffer.key]).toEqual({ site: 'trendyol', price: 101_499, current: 101_499, seenAt: NOW })
    expect(state.allTimeLow).toEqual({
      price: 101_499,
      site: 'trendyol',
      color: 'Kozmik Turuncu',
      seller: 'Trendyol',
      at: NOW,
    })
    expect(state.lastIngestAt).toBe(NOW)
    expect(state.lastObservedAt).toBe(Date.parse(OBSERVED_AT))
    expect(state.lastSites.trendyol?.best?.key).toBe(dealOffer.key)
    expect(state.lastSites.hepsiburada).toEqual({
      status: 'engel',
      detail: 'Cloudflare doğrulaması',
      best: null,
      cheapestOther: null,
    })
    expect(state.ingests.at(-1)).toEqual({ at: NOW, latencyMs: 90_000 })
    expect(state.health.hepsiburada.failures).toBe(1)
  })

  test('a failing notification channel does not fail the ingest', async () => {
    const thrownEnv = testEnv()
    seedWarmState(thrownEnv)
    const thrown = stubFetch(() => {
      throw new Error('ağ hatası')
    })
    const response = await post(thrownEnv, dealPayload)
    expect(response.status).toBe(200)
    expect((await response.json<IngestResponse>()).deal).toBe(true)
    expect(thrown).toHaveLength(2)
    expect(thrownEnv.RADAR.read<RadarState>(STATE_KEY).notified[dealOffer.key]?.price).toBe(101_499)

    const failingEnv = testEnv()
    seedWarmState(failingEnv)
    stubFetch(() => new Response('hata', { status: 500, headers: { 'Retry-After': '0' } }))
    const failing = await post(failingEnv, dealPayload)
    expect(failing.status).toBe(200)
    expect((await failing.json<IngestResponse>()).deal).toBe(true)
  })

  test('alerts once a site has failed for an hour and recovers once it works again', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    const at = (minutes: number) => NOW + minutes * MINUTE
    const observed = (minutes: number) => new Date(at(minutes) - 30_000).toISOString()

    const actions: string[] = []
    for (const minutes of [0, 15, 30, 45, 60]) {
      const failing = payloadWith([], { trendyol: 'engel' }, { observed_at: observed(minutes) })
      const response = await post(env, failing, at(minutes))
      actions.push((await response.json<IngestResponse>()).health.trendyol)
    }
    expect(actions).toEqual(['none', 'none', 'none', 'none', 'alert'])
    expect(callsTo(calls, NTFY_URL)).toHaveLength(1)
    expect(bodyOf<NtfyBody>(callsTo(calls, NTFY_URL)[0])).toMatchObject({
      title: 'Trendyol takibi çalışmıyor',
      priority: 4,
    })
    expect(bodyOf<ResendBody>(callsTo(calls, RESEND_URL)[0]).text).toContain(
      'Trendyol takibi üst üste 5 turdur başarısız.',
    )

    const recovered = await post(env, payloadWith([], {}, { observed_at: observed(75) }), at(75))
    expect((await recovered.json<IngestResponse>()).health.trendyol).toBe('recover')
    expect(callsTo(calls, NTFY_URL)).toHaveLength(2)
    expect(bodyOf<NtfyBody>(callsTo(calls, NTFY_URL)[1])).toMatchObject({
      title: 'Trendyol takibi düzeldi',
      priority: 3,
    })
    expect(callsTo(calls, RESEND_URL)).toHaveLength(2)
  })
  test('tolerates Amazon blocks for three hours before alerting', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    const at = (minutes: number) => NOW + minutes * MINUTE
    const observed = (minutes: number) => new Date(at(minutes) - 30_000).toISOString()

    const actions: string[] = []
    for (let minutes = 0; minutes <= 180; minutes += 15) {
      const failing = payloadWith([], { amazon: 'engel' }, { observed_at: observed(minutes) })
      const response = await post(env, failing, at(minutes))
      actions.push((await response.json<IngestResponse>()).health.amazon)
    }
    expect(actions.slice(0, -1).every((action) => action === 'none')).toBe(true)
    expect(actions.at(-1)).toBe('alert')
    expect(callsTo(calls, NTFY_URL)).toHaveLength(1)
  })
})
