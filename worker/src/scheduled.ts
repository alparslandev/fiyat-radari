import { digestDue, dispatchDue, staleLimitMs, turkeyDateKey } from './cadence'
import type { Env } from './env'
import { nextHealthState, type AlertRule, type HealthState } from './health'
import {
  digestMail,
  dispatchFailingNotice,
  dispatchRecoveredNotice,
  watchdogRecoveredNotice,
  watchdogStaleNotice,
} from './messages'
import { announce, errorMessage, sendMail, USER_AGENT } from './notify'
import {
  CRON_KEY,
  DIGEST_KEY_PREFIX,
  parseCronState,
  parseRadarState,
  STATE_KEY,
  type CronState,
  type RadarState,
} from './state'

const GITHUB_TIMEOUT_MS = 10_000
const DIGEST_TTL_SECONDS = 3 * 24 * 60 * 60
const WATCHDOG_FAILURES_BEFORE_ALERT = 1

const alertOnFirstStaleTick: AlertRule = ({ failures }) => failures >= WATCHDOG_FAILURES_BEFORE_ALERT

function dispatchUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${env.GH_WORKFLOW}/dispatches`
}

async function dispatchWorkflow(env: Env, now: number): Promise<string | null> {
  if (!env.GH_TOKEN) return 'GH_TOKEN tanımlı değil'
  try {
    const response = await fetch(dispatchUrl(env), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: env.GH_REF, inputs: { dispatched_at: new Date(now).toISOString() } }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
    if (response.ok) return null
    return `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`
  } catch (error) {
    return errorMessage(error)
  }
}

async function runDispatch(env: Env, now: number, previous: HealthState): Promise<HealthState> {
  const failure = await dispatchWorkflow(env, now)
  if (failure) console.error(`[dispatch] GitHub işi başlatılamadı: ${failure}`)
  const { state, action } = nextHealthState(
    previous,
    [{ name: 'dispatch', ok: failure === null, detail: failure ?? 'ok' }],
    new Date(now),
  )
  if (action === 'alert' && failure) {
    await announce(env, dispatchFailingNotice(failure, state, now), {
      priority: 4,
      idempotencyKey: `dispatch-alert:${state.alertedAt}`,
    })
  }
  if (action === 'recover') {
    await announce(env, dispatchRecoveredNotice(previous, now), {
      priority: 3,
      idempotencyKey: `dispatch-recover:${previous.since}`,
    })
  }
  return state
}

async function runWatchdog(env: Env, now: number, radar: RadarState, previous: HealthState): Promise<HealthState> {
  const lastIngestAt = radar.lastIngestAt
  if (lastIngestAt === null) return previous
  const limitMs = staleLimitMs(now, lastIngestAt)
  const stale = now - lastIngestAt > limitMs
  const { state, action } = nextHealthState(
    previous,
    [{ name: 'watchdog', ok: !stale, detail: stale ? 'veri gelmiyor' : 'ok' }],
    new Date(now),
    alertOnFirstStaleTick,
  )
  if (action === 'alert') {
    await announce(env, watchdogStaleNotice(lastIngestAt, limitMs, now), {
      priority: 4,
      idempotencyKey: `watchdog-alert:${state.alertedAt}`,
    })
  }
  if (action === 'recover') {
    await announce(env, watchdogRecoveredNotice(previous, lastIngestAt, now), {
      priority: 3,
      idempotencyKey: `watchdog-recover:${previous.since}`,
    })
  }
  return state
}

async function sendDigestOnce(env: Env, now: number, radar: RadarState): Promise<void> {
  const key = `${DIGEST_KEY_PREFIX}${turkeyDateKey(now)}`
  if (await env.RADAR.get(key)) return
  const sent = await sendMail(env, { ...digestMail(radar, now), idempotencyKey: key })
  if (sent) await env.RADAR.put(key, new Date(now).toISOString(), { expirationTtl: DIGEST_TTL_SECONDS })
}

export async function runScheduled(env: Env, now: number): Promise<void> {
  const [cronRaw, stateRaw] = await Promise.all([env.RADAR.get(CRON_KEY), env.RADAR.get(STATE_KEY)])
  const previous = parseCronState(cronRaw)
  const radar = parseRadarState(stateRaw)

  const next: CronState = {
    dispatch: dispatchDue(now) ? await runDispatch(env, now, previous.dispatch) : previous.dispatch,
    watchdog: await runWatchdog(env, now, radar, previous.watchdog),
  }
  if (JSON.stringify(next) !== JSON.stringify(previous)) {
    try {
      await env.RADAR.put(CRON_KEY, JSON.stringify(next))
    } catch (error) {
      console.error(`[cron] durum yazılamadı: ${errorMessage(error)}`)
    }
  }

  if (digestDue(now)) {
    try {
      await sendDigestOnce(env, now, radar)
    } catch (error) {
      console.error(`[digest] günlük özet gönderilemedi: ${errorMessage(error)}`)
    }
  }
}
