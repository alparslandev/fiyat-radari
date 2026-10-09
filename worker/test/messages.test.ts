import { describe, expect, test } from 'bun:test'
import type { HealthState } from '../src/health'
import {
  dealActions,
  dealNotice,
  digestMail,
  dispatchFailingNotice,
  dispatchRecoveredNotice,
  formatSpan,
  formatTl,
  formatTurkeyTime,
  siteDownNotice,
  siteRecoveredNotice,
  watchdogRecoveredNotice,
  watchdogStaleNotice,
} from '../src/messages'
import type { AllTimeLow, Deal } from '../src/rule'
import { parseRadarState, type RadarState } from '../src/state'
import { offer, report, warmBuckets } from './support'

const EM_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)
const NOW = Date.parse('2026-10-09T10:45:00Z')
const HOUR = 60 * 60 * 1000

const best = offer({
  key: 'trendyol:985256847:968',
  color: 'Kozmik Turuncu',
  seller_score: 9.3,
  price: 103_000,
  effective: 101_499,
  basis: 'kupon',
  notes: ['Plus ile 100.999 TL'],
  stock_hint: 'Stokta sadece 6 adet kaldı.',
})
const runnerUp = offer({
  key: 'amazon:B0FQTEST17:1',
  site: 'amazon',
  seller_score: null,
  effective: 103_869,
  basis: 'prime',
})
const third = offer({ key: 'trendyol:985256847:970', color: 'Lacivert', effective: 104_250.5, basis: 'sepette' })
const deal: Deal = { best, normal: 105_000, floor: null, top: [best, runnerUp, third], missingSites: ['hepsiburada'] }
const RUN_URL = 'https://github.com/alparslandev/fiyat-radari/actions/runs/123'
const higherLow: AllTimeLow = {
  price: 102_000,
  site: 'amazon',
  color: 'Siyah',
  seller: 'Amazon',
  at: Date.parse('2026-10-02T11:05:00Z'),
}
const outage: HealthState = { failures: 3, since: '2026-10-09T10:00:00.000Z', alertedAt: '2026-10-09T10:30:00.000Z' }

function digestState(): RadarState {
  const empty = parseRadarState(null)
  return {
    ...empty,
    buckets: warmBuckets(105_000, NOW),
    allTimeLow: { price: 101_499, site: 'trendyol', color: 'Kozmik Turuncu', seller: 'Trendyol', at: higherLow.at },
    ingests: [
      { at: NOW - 25 * HOUR, latencyMs: 999_000 },
      { at: NOW - 3 * HOUR, latencyMs: 60_000 },
      { at: NOW - 2 * HOUR, latencyMs: 102_000 },
      { at: NOW - HOUR, latencyMs: 185_000 },
      { at: NOW - HOUR / 2, latencyMs: null },
    ],
    lastIngestAt: NOW - HOUR / 2,
    lastObservedAt: NOW - HOUR / 2,
    lastSites: {
      trendyol: {
        status: 'ok',
        detail: '',
        best: offer({ effective: 104_999 }),
        cheapestOther: offer({
          key: 'trendyol:985256847:999',
          color: 'Siyah',
          seller: 'Teknoloji Dünyası',
          seller_score: 8.1,
          effective: 102_500,
          qualifies: false,
          why_not: 'satıcı puanı 9,0 altında',
        }),
      },
      hepsiburada: { status: 'engel', detail: 'Cloudflare doğrulaması', best: null, cheapestOther: null },
      amazon: {
        status: 'ok',
        detail: '',
        best: offer({ key: 'amazon:B0FQTEST17:1', site: 'amazon', color: 'Kozmik Turuncu', effective: 103_869 }),
        cheapestOther: null,
      },
    },
  }
}

describe('formatting', () => {
  test('formats lira amounts the Turkish way', () => {
    expect(formatTl(105913.12)).toBe('105.913,12 TL')
    expect(formatTl(103869)).toBe('103.869 TL')
    expect(formatTl(104999.9)).toBe('104.999,90 TL')
    expect(formatTl(3401)).toBe('3.401 TL')
    expect(formatTl(99.999)).toBe('100 TL')
  })

  test('formats dates in Turkey time', () => {
    expect(formatTurkeyTime(Date.parse('2026-10-09T11:05:00Z'))).toBe('9 Eki 14:05')
    expect(formatTurkeyTime(Date.parse('2026-10-31T21:30:00Z'))).toBe('1 Kas 00:30')
    expect(formatTurkeyTime(Date.parse('2026-08-15T09:07:00Z'))).toBe('15 Ağu 12:07')
  })

  test('formats spans in minutes and seconds', () => {
    expect(formatSpan(102_000)).toBe('1 dk 42 sn')
    expect(formatSpan(45_000)).toBe('45 sn')
    expect(formatSpan(180_000)).toBe('3 dk')
  })
})

describe('deal messages', () => {
  test('push title and short lines', () => {
    const notice = dealNotice(deal, higherLow, RUN_URL)
    expect(notice.title).toBe('iPhone 17 Pro 256 GB: 101.499 TL')
    expect(notice.message.split('\n')).toEqual([
      'Trendyol, Kozmik Turuncu',
      'Satıcı: Trendyol (9,3)',
      'Olağan fiyatın 3.501 TL altında, kuponla',
      'Stokta sadece 6 adet kaldı.',
    ])
  })

  test('push lines skip the basis note for list prices and the score when missing', () => {
    const plain = { ...runnerUp, basis: 'liste' as const }
    const notice = dealNotice({ ...deal, best: plain, top: [plain] }, null, null)
    expect(notice.message.split('\n')).toEqual(['Amazon, Gümüş', 'Satıcı: Amazon', 'Olağan fiyatın 1.131 TL altında'])
  })

  test('mail subject and body', () => {
    const notice = dealNotice(deal, higherLow, RUN_URL)
    const lines = notice.text.split('\n')
    expect(notice.subject).toBe('iPhone 17 Pro 256 GB: 101.499 TL, Trendyol, Kozmik Turuncu')
    expect(lines[0]).toBe(best.url)
    expect(lines).toContain('1. Trendyol, 101.499 TL (kuponla), Kozmik Turuncu, satıcı Trendyol (9,3)')
    expect(lines).toContain('2. Amazon, 103.869 TL (Prime fiyatı), Gümüş, satıcı Amazon')
    expect(lines).toContain('3. Trendyol, 104.250,50 TL (sepette), Lacivert, satıcı Trendyol (9,3)')
    expect(lines).toContain(`   ${runnerUp.url}`)
    expect(lines).toContain('Olağan fiyat: 105.000 TL (bu teklif 3.501 TL altında)')
    expect(lines).toContain(
      'Tüm zamanların en düşüğü: bu teklif (önceki: 102.000 TL, Amazon, Siyah, satıcı Amazon (2 Eki 14:05))',
    )
    expect(notice.text).toContain('Notlar:\n- Plus ile 100.999 TL')
    expect(lines).toContain('Bu turda veri gelmeyen siteler: Hepsiburada')
    expect(lines.at(-1)).toBe(`Çalıştırma: ${RUN_URL}`)
  })

  test('mail mentions the earlier all-time low when it is still lower, or a first record', () => {
    const lowerLow = { ...higherLow, price: 100_000 }
    expect(dealNotice(deal, lowerLow, null).text).toContain(
      'Tüm zamanların en düşüğü: 100.000 TL, Amazon, Siyah, satıcı Amazon (2 Eki 14:05)',
    )
    expect(dealNotice(deal, null, null).text).toContain('Tüm zamanların en düşüğü: bu teklif (ilk kayıt)')
  })

  test('push buttons for the two cheapest offers', () => {
    expect(dealActions(deal)).toEqual([
      { label: "Trendyol'da aç", url: best.url },
      { label: "Amazon'da aç", url: runnerUp.url },
    ])
    expect(dealActions({ ...deal, top: [best, third] })).toEqual([
      { label: "Trendyol'da aç (Kozmik Turuncu)", url: best.url },
      { label: "Trendyol'da aç (Lacivert)", url: third.url },
    ])
    expect(dealActions({ ...deal, top: [best] })).toHaveLength(1)
  })
})

describe('health messages', () => {
  test('site down and recovered', () => {
    const down = siteDownNotice(
      'trendyol',
      report({ status: 'engel', detail: 'Cloudflare doğrulaması', pages_ok: 0 }),
      outage,
      NOW,
      RUN_URL,
    )
    expect(down.title).toBe('Trendyol takibi çalışmıyor')
    expect(down.subject).toBe('Trendyol takibi çalışmıyor')
    expect(down.message).toBe('Durum: bot engeli\nAyrıntı: Cloudflare doğrulaması\nSüre: 45 dakika')
    expect(down.text).toContain('Trendyol takibi üst üste 3 turdur başarısız.')
    expect(down.text).toContain('Sayfalar: 0/3')
    expect(down.text).toContain('İlk hata: 9 Eki 13:00')

    const recovered = siteRecoveredNotice('hepsiburada', outage, NOW)
    expect(recovered.subject).toBe('Hepsiburada takibi düzeldi')
    expect(recovered.message).toBe('Kesinti süresi: 45 dakika')
    expect(recovered.text).toContain('Toparlanma: 9 Eki 13:45')
  })

  test('watchdog stale and recovered', () => {
    const stale = watchdogStaleNotice(NOW - 36 * 60_000, 35 * 60_000, NOW)
    expect(stale.subject).toBe('Fiyat Radarı: veri gelmiyor')
    expect(stale.message).toBe('Son veri: 9 Eki 13:09 (36 dakika önce)')
    expect(stale.text).toContain('Beklenen en uzun ara: 35 dakika')
    expect(stale.text).toContain('Tarama aralığı: 15 dakika')

    const recovered = watchdogRecoveredNotice(outage, NOW - 60_000, NOW)
    expect(recovered.subject).toBe('Fiyat Radarı: veri yeniden geliyor')
    expect(recovered.text).toContain('Son veri: 9 Eki 13:44')
  })

  test('dispatch failing and recovered', () => {
    const failing = dispatchFailingNotice('HTTP 401: Bad credentials', outage, NOW)
    expect(failing.subject).toBe('Fiyat Radarı: GitHub işi başlatılamıyor')
    expect(failing.text).toContain('GitHub Actions işi üst üste 3 kez başlatılamadı.')
    expect(failing.message).toContain('Son hata: HTTP 401: Bad credentials')

    const recovered = dispatchRecoveredNotice(outage, NOW)
    expect(recovered.subject).toBe('Fiyat Radarı: GitHub işi yeniden başlatılıyor')
    expect(recovered.text).toContain('Kesinti süresi: 45 dakika')
  })
})

describe('digest mail', () => {
  test('summarises sites, prices, ingest count, latency and cadence', () => {
    const mail = digestMail(digestState(), NOW)
    const lines = mail.text.split('\n')
    expect(mail.subject).toBe('Fiyat Radarı günlük özet: en ucuz 103.869 TL (Amazon, Kozmik Turuncu)')
    expect(lines[0]).toBe('Son veri: 9 Eki 13:15')
    expect(lines).toContain('Trendyol: çalışıyor')
    expect(lines).toContain('  En ucuz uygun teklif: 104.999 TL, Gümüş, satıcı Trendyol (9,3)')
    expect(lines).toContain(
      [
        '  Bilgi, uygun olmayan en ucuz teklif: 102.500 TL, Siyah,',
        'satıcı Teknoloji Dünyası (8,1) (satıcı puanı 9,0 altında)',
      ].join(' '),
    )
    expect(lines).toContain('Hepsiburada: bot engeli (Cloudflare doğrulaması)')
    expect(lines).toContain('Amazon: çalışıyor')
    expect(lines).toContain('Olağan fiyat: 105.000 TL')
    expect(lines).toContain(
      'Tüm zamanların en düşüğü: 101.499 TL, Trendyol, Kozmik Turuncu, satıcı Trendyol (2 Eki 14:05)',
    )
    expect(lines).toContain('Son 24 saatte gelen veri: 4 tur')
    expect(lines).toContain('Gecikme (tetiklemeden ölçüme): p50 1 dk 42 sn, p95 3 dk 5 sn')
    expect(lines).toContain('Tarama aralığı: 15 dakika')
  })

  test('explains why the cheapest other offer does not count, in Turkish', () => {
    const state = digestState()
    const amazon = state.lastSites.amazon
    if (!amazon) throw new Error('amazon snapshot missing')
    state.lastSites.amazon = {
      ...amazon,
      cheapestOther: offer({
        key: 'amazon:B0FQG1C99S:turkiye-magaza',
        site: 'amazon',
        color: 'Abis',
        seller: 'Turkiye Magaza',
        seller_score: null,
        effective: 103_000,
        qualifies: false,
        why_not: 'guvenilmeyen_satici',
      }),
    }
    expect(digestMail(state, NOW).text).toContain(
      '  Bilgi, uygun olmayan en ucuz teklif: 103.000 TL, Abis, satıcı Turkiye Magaza (güvenilir satıcı listesinde değil)',
    )
  })

  test('has a no-data variant', () => {
    const mail = digestMail(parseRadarState(null), NOW)
    expect(mail.subject).toBe('Fiyat Radarı günlük özet: veri yok')
    expect(mail.text).toContain('Son veri: henüz yok')
    expect(mail.text).toContain('Trendyol: henüz veri yok')
    expect(mail.text).toContain('Olağan fiyat: henüz yok (0/96 ölçüm)')
    expect(mail.text).toContain('Tüm zamanların en düşüğü: henüz yok')
    expect(mail.text).toContain('Gecikme (tetiklemeden ölçüme): ölçüm yok')
  })
})

test('no message ever contains an em dash or an en dash', () => {
  const healthy: HealthState = { failures: 0, since: null, alertedAt: null }
  const notices = [
    dealNotice(deal, higherLow, RUN_URL),
    dealNotice({ ...deal, missingSites: [] }, null, null),
    siteDownNotice('amazon', report({ status: 'urun_degisti', detail: '' }), outage, NOW, null),
    siteDownNotice('hepsiburada', report({ status: 'hata', detail: 'zaman aşımı' }), outage, NOW, RUN_URL),
    siteDownNotice('trendyol', report({ status: 'veri_yok' }), healthy, NOW, null),
    siteRecoveredNotice('amazon', healthy, NOW),
    watchdogStaleNotice(NOW - 3 * HOUR, 11 * 60_000, NOW),
    watchdogRecoveredNotice(outage, NOW, NOW),
    dispatchFailingNotice('GH_TOKEN tanımlı değil', outage, NOW),
    dispatchRecoveredNotice(healthy, NOW),
  ]
  const outputs = [
    ...notices.flatMap((notice) => [notice.title, notice.message, notice.subject, notice.text]),
    ...dealActions(deal).map((action) => action.label),
    ...[digestMail(digestState(), NOW), digestMail(parseRadarState(null), NOW)].flatMap((mail) => [
      mail.subject,
      mail.text,
    ]),
    formatTl(105913.12),
    formatTurkeyTime(NOW),
    formatSpan(3_725_000),
  ]
  for (const output of outputs) {
    expect(output).not.toContain(EM_DASH)
    expect(output).not.toContain(EN_DASH)
  }
  expect(outputs.length).toBeGreaterThan(40)
})
