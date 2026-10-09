export const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000
export const DEFAULT_CADENCE_MINUTES = 15

const MINUTE_MS = 60_000
const DIGEST_MINUTE_OF_DAY = 9 * 60 + 1

export interface CadenceWindow {
  from: string
  to: string
  minutes: number
}

export const CADENCE_WINDOWS: CadenceWindow[] = [
  { from: '2026-11-01T00:00:00+03:00', to: '2026-12-01T00:00:00+03:00', minutes: 5 },
  { from: '2026-11-10T23:00:00+03:00', to: '2026-11-12T03:00:00+03:00', minutes: 3 },
  { from: '2026-11-26T23:00:00+03:00', to: '2026-12-01T03:00:00+03:00', minutes: 3 },
]

export function cadenceMinutes(now: number): number {
  return CADENCE_WINDOWS.reduce(
    (fastest, window) =>
      now >= Date.parse(window.from) && now < Date.parse(window.to) ? Math.min(fastest, window.minutes) : fastest,
    DEFAULT_CADENCE_MINUTES,
  )
}

export function inTurkey(ms: number): Date {
  return new Date(ms + TURKEY_OFFSET_MS)
}

export function turkeyMinuteOfDay(ms: number): number {
  const local = inTurkey(ms)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

export function turkeyDateKey(ms: number): string {
  return inTurkey(ms).toISOString().slice(0, 10)
}

export function dispatchDue(now: number): boolean {
  const cadence = cadenceMinutes(now)
  return (turkeyMinuteOfDay(now) + cadence - 1) % cadence === 0
}

export function staleLimitMs(now: number, lastIngestAt: number): number {
  return (2 * Math.max(cadenceMinutes(now), cadenceMinutes(lastIngestAt)) + 5) * MINUTE_MS
}

export function digestDue(now: number): boolean {
  return turkeyMinuteOfDay(now) === DIGEST_MINUTE_OF_DAY
}
