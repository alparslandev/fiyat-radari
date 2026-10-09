export const FAILURES_BEFORE_ALERT = 3
export const REALERT_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface HealthProbe {
  name: string
  ok: boolean
  detail: string
}

export interface HealthState {
  failures: number
  since: string | null
  alertedAt: string | null
}

export type HealthAction = 'none' | 'alert' | 'recover'

export const HEALTHY_STATE: HealthState = { failures: 0, since: null, alertedAt: null }

export type AlertRule = (streak: { failures: number; outageMs: number }) => boolean

export const alertOnConsecutiveFailures: AlertRule = ({ failures }) => failures >= FAILURES_BEFORE_ALERT

export function nextHealthState(
  previous: HealthState,
  probes: HealthProbe[],
  now: Date,
  isAlertDue: AlertRule = alertOnConsecutiveFailures,
): { state: HealthState; action: HealthAction; changed: boolean } {
  const iso = now.toISOString()
  const ok = probes.every((probe) => probe.ok)

  if (ok) {
    const action: HealthAction = previous.alertedAt ? 'recover' : 'none'
    const changed = previous.failures !== 0 || previous.alertedAt !== null
    return { state: HEALTHY_STATE, action, changed }
  }

  const failures = previous.failures + 1
  const since = previous.since ?? iso
  const alertedAgo = previous.alertedAt ? now.getTime() - Date.parse(previous.alertedAt) : Infinity
  const outageMs = now.getTime() - Date.parse(since)
  const shouldAlert = isAlertDue({ failures, outageMs }) && alertedAgo >= REALERT_INTERVAL_MS

  return {
    state: { failures, since, alertedAt: shouldAlert ? iso : previous.alertedAt },
    action: shouldAlert ? 'alert' : 'none',
    changed: true,
  }
}

export function parseHealthState(raw: unknown): HealthState {
  if (typeof raw !== 'object' || raw === null) return HEALTHY_STATE
  const parsed = raw as Partial<HealthState>
  return {
    failures: Number(parsed.failures) || 0,
    since: typeof parsed.since === 'string' ? parsed.since : null,
    alertedAt: typeof parsed.alertedAt === 'string' ? parsed.alertedAt : null,
  }
}

export function formatOutage(since: string | null, now: Date): string {
  if (!since) return '?'
  const minutes = Math.max(1, Math.round((now.getTime() - Date.parse(since)) / 60_000))
  if (minutes < 60) return `${minutes} dakika`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} saat ${rest} dakika` : `${hours} saat`
}
