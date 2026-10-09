import { cadenceMinutes, inTurkey } from './cadence'
import { formatOutage, type HealthState } from './health'
import type { Notice, PushAction } from './notify'
import { SITES, type Offer, type PriceBasis, type Site, type SiteReport, type SiteStatus } from './payload'
import { compareOffers, MIN_BUCKETS, normalPrice, type AllTimeLow, type Deal } from './rule'
import type { IngestRecord, RadarState, SiteSnapshot } from './state'

const PRODUCT_NAME = 'iPhone 17 Pro 256 GB'
const RADAR_NAME = 'Fiyat Radarı'
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60_000

const SITE_NAMES: Record<Site, string> = {
  trendyol: 'Trendyol',
  hepsiburada: 'Hepsiburada',
  amazon: 'Amazon',
}

const SITE_LOCATIVES: Record<Site, string> = {
  trendyol: "Trendyol'da",
  hepsiburada: "Hepsiburada'da",
  amazon: "Amazon'da",
}

const STATUS_LABELS: Record<SiteStatus, string> = {
  ok: 'çalışıyor',
  engel: 'bot engeli',
  urun_degisti: 'ürün değişti',
  hata: 'hata',
  veri_yok: 'veri yok',
}

const BASIS_NOTES: Record<PriceBasis, string | null> = {
  liste: null,
  sepette: 'sepette',
  kupon: 'kuponla',
  prime: 'Prime fiyatı',
}

const WHY_NOT_LABELS: Record<string, string> = {
  garanti: 'Apple Türkiye garantili değil',
  stok_yok: 'stokta yok',
  fiyat_bandi: 'fiyat beklenen aralığın dışında',
  guvenilmeyen_satici: 'güvenilir satıcı listesinde değil',
  puansiz_satici: 'satıcı puanı yok',
  dusuk_puan: 'satıcı puanı 8,5 altında',
  veri_uyusmazligi: 'sayfa verileri uyuşmuyor',
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

const wholeAmount = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })
const centAmount = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const scoreAmount = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

export interface MailText {
  subject: string
  text: string
}

export function formatTl(value: number): string {
  const cents = Math.round(value * 100)
  const formatter = cents % 100 === 0 ? wholeAmount : centAmount
  return `${formatter.format(cents / 100)} TL`
}

export function formatTurkeyTime(ms: number): string {
  const local = inTurkey(ms)
  const hours = String(local.getUTCHours()).padStart(2, '0')
  const minutes = String(local.getUTCMinutes()).padStart(2, '0')
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${hours}:${minutes}`
}

export function formatSpan(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds} sn`
  return seconds ? `${minutes} dk ${seconds} sn` : `${minutes} dk`
}

function formatIsoTime(iso: string | null): string {
  return iso ? formatTurkeyTime(Date.parse(iso)) : '?'
}

function sellerText(offer: Offer): string {
  return offer.seller_score === null ? offer.seller : `${offer.seller} (${scoreAmount.format(offer.seller_score)})`
}

function priceWithBasis(offer: Offer): string {
  const basisNote = BASIS_NOTES[offer.basis]
  return basisNote ? `${formatTl(offer.effective)} (${basisNote})` : formatTl(offer.effective)
}

function offerSummary(offer: Offer): string {
  return `${priceWithBasis(offer)}, ${offer.color}, satıcı ${sellerText(offer)}`
}

function lowSummary(low: AllTimeLow): string {
  const when = formatTurkeyTime(low.at)
  return `${formatTl(low.price)}, ${SITE_NAMES[low.site]}, ${low.color}, satıcı ${low.seller} (${when})`
}

function allTimeLowLine(previousLow: AllTimeLow | null, best: Offer): string {
  if (!previousLow) return 'Tüm zamanların en düşüğü: bu teklif (ilk kayıt)'
  if (best.effective < previousLow.price) {
    return `Tüm zamanların en düşüğü: bu teklif (önceki: ${lowSummary(previousLow)})`
  }
  return `Tüm zamanların en düşüğü: ${lowSummary(previousLow)}`
}

export function dealNotice(deal: Deal, previousLow: AllTimeLow | null, runUrl: string | null): Notice {
  const { best } = deal
  const price = formatTl(best.effective)
  const gap = `${formatTl(deal.normal - best.effective)} altında`
  const basisNote = BASIS_NOTES[best.basis]
  const message = [
    `${SITE_NAMES[best.site]}, ${best.color}`,
    `Satıcı: ${sellerText(best)}`,
    `Olağan fiyatın ${gap}${basisNote ? `, ${basisNote}` : ''}`,
    ...(best.stock_hint ? [best.stock_hint] : []),
  ]
  const text = [
    best.url,
    '',
    'En ucuz teklifler:',
    ...deal.top.flatMap((offer, index) => [
      `${index + 1}. ${SITE_NAMES[offer.site]}, ${offerSummary(offer)}`,
      `   ${offer.url}`,
    ]),
    '',
    `Olağan fiyat: ${formatTl(deal.normal)} (bu teklif ${gap})`,
    allTimeLowLine(previousLow, best),
    ...(best.stock_hint ? [`Stok: ${best.stock_hint}`] : []),
    ...(best.notes.length ? ['', 'Notlar:', ...best.notes.map((note) => `- ${note}`)] : []),
    ...(deal.missingSites.length
      ? ['', `Bu turda veri gelmeyen siteler: ${deal.missingSites.map((site) => SITE_NAMES[site]).join(', ')}`]
      : []),
    ...(runUrl ? ['', `Çalıştırma: ${runUrl}`] : []),
  ]
  return {
    title: `${PRODUCT_NAME}: ${price}`,
    message: message.join('\n'),
    subject: `${PRODUCT_NAME}: ${price}, ${SITE_NAMES[best.site]}, ${best.color}`,
    text: text.join('\n'),
  }
}

export function dealActions(deal: Deal): PushAction[] {
  const offers = deal.top.slice(0, 2)
  const sameSite = offers.length === 2 && offers[0].site === offers[1].site
  return offers.map((offer) => ({
    label: sameSite ? `${SITE_LOCATIVES[offer.site]} aç (${offer.color})` : `${SITE_LOCATIVES[offer.site]} aç`,
    url: offer.url,
  }))
}

export function siteDownNotice(
  site: Site,
  report: SiteReport,
  health: HealthState,
  now: number,
  runUrl: string | null,
): Notice {
  const name = SITE_NAMES[site]
  const title = `${name} takibi çalışmıyor`
  const duration = formatOutage(health.since, new Date(now))
  const status = `Durum: ${STATUS_LABELS[report.status]}`
  const detail = report.detail ? [`Ayrıntı: ${report.detail}`] : []
  return {
    title,
    message: [status, ...detail, `Süre: ${duration}`].join('\n'),
    subject: title,
    text: [
      `${name} takibi üst üste ${health.failures} turdur başarısız.`,
      '',
      status,
      ...detail,
      `Sayfalar: ${report.pages_ok}/${report.pages_total}`,
      `İlk hata: ${formatIsoTime(health.since)}`,
      `Süre: ${duration}`,
      ...(runUrl ? [`Çalıştırma: ${runUrl}`] : []),
    ].join('\n'),
  }
}

export function siteRecoveredNotice(site: Site, previous: HealthState, now: number): Notice {
  const name = SITE_NAMES[site]
  const title = `${name} takibi düzeldi`
  const duration = formatOutage(previous.since, new Date(now))
  return {
    title,
    message: `Kesinti süresi: ${duration}`,
    subject: title,
    text: [
      `${name} takibi yeniden çalışıyor.`,
      '',
      `Kesinti süresi: ${duration}`,
      `İlk hata: ${formatIsoTime(previous.since)}`,
      `Toparlanma: ${formatTurkeyTime(now)}`,
    ].join('\n'),
  }
}

export function watchdogStaleNotice(lastIngestAt: number, limitMs: number, now: number): Notice {
  const title = `${RADAR_NAME}: veri gelmiyor`
  const ago = formatOutage(new Date(lastIngestAt).toISOString(), new Date(now))
  const last = `Son veri: ${formatTurkeyTime(lastIngestAt)} (${ago} önce)`
  return {
    title,
    message: last,
    subject: title,
    text: [
      'GitHub işinden beklenen sürede veri gelmedi.',
      '',
      last,
      `Beklenen en uzun ara: ${Math.round(limitMs / MINUTE_MS)} dakika`,
      `Tarama aralığı: ${cadenceMinutes(now)} dakika`,
    ].join('\n'),
  }
}

export function watchdogRecoveredNotice(previous: HealthState, lastIngestAt: number, now: number): Notice {
  const title = `${RADAR_NAME}: veri yeniden geliyor`
  const duration = formatOutage(previous.since, new Date(now))
  return {
    title,
    message: `Kesinti süresi: ${duration}`,
    subject: title,
    text: [
      'Veri akışı yeniden başladı.',
      '',
      `Son veri: ${formatTurkeyTime(lastIngestAt)}`,
      `Kesinti süresi: ${duration}`,
      `Uyarı başlangıcı: ${formatIsoTime(previous.since)}`,
    ].join('\n'),
  }
}

export function dispatchFailingNotice(detail: string, health: HealthState, now: number): Notice {
  const title = `${RADAR_NAME}: GitHub işi başlatılamıyor`
  const duration = formatOutage(health.since, new Date(now))
  return {
    title,
    message: [`Son hata: ${detail}`, `Süre: ${duration}`].join('\n'),
    subject: title,
    text: [
      `GitHub Actions işi üst üste ${health.failures} kez başlatılamadı.`,
      '',
      `Son hata: ${detail}`,
      `İlk hata: ${formatIsoTime(health.since)}`,
      `Süre: ${duration}`,
    ].join('\n'),
  }
}

export function dispatchRecoveredNotice(previous: HealthState, now: number): Notice {
  const title = `${RADAR_NAME}: GitHub işi yeniden başlatılıyor`
  const duration = formatOutage(previous.since, new Date(now))
  return {
    title,
    message: `Kesinti süresi: ${duration}`,
    subject: title,
    text: [
      'GitHub Actions işi yeniden sorunsuz başlatılıyor.',
      '',
      `Kesinti süresi: ${duration}`,
      `İlk hata: ${formatIsoTime(previous.since)}`,
      `Toparlanma: ${formatTurkeyTime(now)}`,
    ].join('\n'),
  }
}

function nearestRank(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

function latencyLine(records: IngestRecord[]): string {
  const latencies = records
    .flatMap((record) => (record.latencyMs === null ? [] : [record.latencyMs]))
    .sort((a, b) => a - b)
  if (latencies.length === 0) return 'Gecikme (tetiklemeden ölçüme): ölçüm yok'
  const p50 = formatSpan(nearestRank(latencies, 0.5))
  const p95 = formatSpan(nearestRank(latencies, 0.95))
  return `Gecikme (tetiklemeden ölçüme): p50 ${p50}, p95 ${p95}`
}

function snapshotLines(site: Site, snapshot: SiteSnapshot | undefined): string[] {
  const name = SITE_NAMES[site]
  if (!snapshot) return [`${name}: henüz veri yok`]
  const status = STATUS_LABELS[snapshot.status]
  const lines = [`${name}: ${snapshot.detail ? `${status} (${snapshot.detail})` : status}`]
  if (snapshot.best) lines.push(`  En ucuz uygun teklif: ${offerSummary(snapshot.best)}`, `  ${snapshot.best.url}`)
  else if (snapshot.status === 'ok') lines.push('  Uygun teklif yok')
  if (snapshot.cheapestOther) {
    const whyNot = snapshot.cheapestOther.why_not
    const reason = whyNot ? ` (${WHY_NOT_LABELS[whyNot] ?? whyNot})` : ''
    lines.push(`  Bilgi, uygun olmayan en ucuz teklif: ${offerSummary(snapshot.cheapestOther)}${reason}`)
  }
  return lines
}

export function digestMail(state: RadarState, now: number): MailText {
  const bests = SITES.flatMap((site) => {
    const best = state.lastSites[site]?.best
    return best ? [best] : []
  }).sort(compareOffers)
  const cheapest: Offer | undefined = bests[0]
  const headline = cheapest
    ? `en ucuz ${formatTl(cheapest.effective)} (${SITE_NAMES[cheapest.site]}, ${cheapest.color})`
    : 'veri yok'
  const normal = normalPrice(state.buckets)
  const recent = state.ingests.filter((record) => record.at > now - DAY_MS)
  const normalText =
    normal === null ? `henüz yok (${Object.keys(state.buckets).length}/${MIN_BUCKETS} ölçüm)` : formatTl(normal)
  const text = [
    `Son veri: ${state.lastIngestAt === null ? 'henüz yok' : formatTurkeyTime(state.lastIngestAt)}`,
    '',
    ...SITES.flatMap((site) => snapshotLines(site, state.lastSites[site])),
    '',
    `Olağan fiyat: ${normalText}`,
    `Tüm zamanların en düşüğü: ${state.allTimeLow ? lowSummary(state.allTimeLow) : 'henüz yok'}`,
    `Son 24 saatte gelen veri: ${recent.length} tur`,
    latencyLine(recent),
    `Tarama aralığı: ${cadenceMinutes(now)} dakika`,
  ]
  return { subject: `${RADAR_NAME} günlük özet: ${headline}`, text: text.join('\n') }
}
