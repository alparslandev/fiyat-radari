import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { HEALTHY_STATE } from '../src/health'
import { runScheduled } from '../src/scheduled'
import { CRON_KEY, STATE_KEY, type CronState } from '../src/state'
import {
  answerEverything,
  bodyOf,
  callsTo,
  GITHUB_DISPATCH_URL,
  NTFY_URL,
  offer,
  RESEND_URL,
  restoreFetch,
  silenceConsole,
  stubFetch,
  testEnv,
  type NtfyBody,
  type RecordedCall,
  type ResendBody,
  type TestEnv,
} from './support'

const turkey = (local: string) => Date.parse(`${local}:00+03:00`)
const MINUTE = 60_000

let restoreConsole: () => void = () => {}

beforeEach(() => {
  restoreConsole = silenceConsole()
})

afterEach(() => {
  restoreFetch()
  restoreConsole()
})

function seedIngest(env: TestEnv, lastIngestAt: number): void {
  env.RADAR.seed(STATE_KEY, {
    lastIngestAt,
    lastObservedAt: lastIngestAt - MINUTE,
    lastSites: {
      amazon: {
        status: 'ok',
        detail: '',
        best: offer({ key: 'amazon:B0FQTEST17:1', site: 'amazon', color: 'Kozmik Turuncu', effective: 103_869 }),
        cheapestOther: null,
      },
    },
  })
}

describe('dispatch', () => {
  test('calls GitHub only on due minutes with the right URL, headers and body', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)

    await runScheduled(env, turkey('2026-10-09T10:05'))
    await runScheduled(env, turkey('2026-10-09T10:15'))
    expect(calls).toHaveLength(0)

    await runScheduled(env, turkey('2026-10-09T10:16'))
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe(GITHUB_DISPATCH_URL)
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('Authorization')).toBe('Bearer ghp_test')
    expect(call?.headers.get('Accept')).toBe('application/vnd.github+json')
    expect(call?.headers.get('X-GitHub-Api-Version')).toBe('2022-11-28')
    expect(call?.headers.get('User-Agent')).toBe('fiyat-radari/1.0')
    expect(bodyOf<Record<string, unknown>>(call)).toEqual({
      ref: 'main',
      inputs: { dispatched_at: '2026-10-09T07:16:00.000Z' },
    })
    expect(env.RADAR.writes).toEqual([])
  })

  test('alerts once after three failed dispatches and recovers', async () => {
    const env = testEnv()
    let githubStatus = 401
    const calls = stubFetch((call: RecordedCall) => {
      if (call.url !== GITHUB_DISPATCH_URL) return answerEverything(call)
      return githubStatus === 204
        ? new Response(null, { status: 204 })
        : new Response('{"message":"Bad credentials"}', { status: githubStatus })
    })

    for (const minute of ['10:01', '10:16']) await runScheduled(env, turkey(`2026-10-09T${minute}`))
    expect(callsTo(calls, NTFY_URL)).toHaveLength(0)

    await runScheduled(env, turkey('2026-10-09T10:31'))
    await runScheduled(env, turkey('2026-10-09T10:46'))
    const alerts = callsTo(calls, NTFY_URL)
    expect(alerts).toHaveLength(1)
    expect(bodyOf<NtfyBody>(alerts[0])).toMatchObject({ title: 'Fiyat Radarı: GitHub işi başlatılamıyor', priority: 4 })
    expect(bodyOf<NtfyBody>(alerts[0]).message).toContain('HTTP 401')
    expect(bodyOf<ResendBody>(callsTo(calls, RESEND_URL)[0]).text).toContain(
      'GitHub Actions işi üst üste 3 kez başlatılamadı.',
    )
    expect(env.RADAR.read<CronState>(CRON_KEY).dispatch.failures).toBe(4)

    githubStatus = 204
    await runScheduled(env, turkey('2026-10-09T11:01'))
    const all = callsTo(calls, NTFY_URL)
    expect(all).toHaveLength(2)
    expect(bodyOf<NtfyBody>(all[1])).toMatchObject({
      title: 'Fiyat Radarı: GitHub işi yeniden başlatılıyor',
      priority: 3,
    })
    expect(env.RADAR.read<CronState>(CRON_KEY).dispatch).toEqual(HEALTHY_STATE)
  })

  test('a missing GH_TOKEN counts as a failed dispatch without calling GitHub', async () => {
    const env = testEnv({ GH_TOKEN: undefined })
    const calls = stubFetch(answerEverything)
    for (const minute of ['10:01', '10:16', '10:31']) await runScheduled(env, turkey(`2026-10-09T${minute}`))
    expect(callsTo(calls, GITHUB_DISPATCH_URL)).toHaveLength(0)
    expect(bodyOf<NtfyBody>(callsTo(calls, NTFY_URL)[0]).message).toContain('GH_TOKEN tanımlı değil')
  })
})

describe('watchdog', () => {
  test('stays quiet before the first ingest ever arrives', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    await runScheduled(env, turkey('2026-10-09T10:36'))
    expect(calls).toHaveLength(0)
    expect(env.RADAR.writes).toEqual([])
  })

  test('alerts once when ingests stop and recovers when they return', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    seedIngest(env, turkey('2026-10-09T10:00'))

    await runScheduled(env, turkey('2026-10-09T10:35'))
    expect(callsTo(calls, NTFY_URL)).toHaveLength(0)

    await runScheduled(env, turkey('2026-10-09T10:36'))
    await runScheduled(env, turkey('2026-10-09T10:37'))
    const alerts = callsTo(calls, NTFY_URL)
    expect(alerts).toHaveLength(1)
    expect(bodyOf<NtfyBody>(alerts[0])).toEqual({
      topic: 'radar-test',
      title: 'Fiyat Radarı: veri gelmiyor',
      message: 'Son veri: 9 Eki 10:00 (36 dakika önce)',
      priority: 4,
    })
    expect(callsTo(calls, RESEND_URL)).toHaveLength(1)

    seedIngest(env, turkey('2026-10-09T10:37') + 30_000)
    await runScheduled(env, turkey('2026-10-09T10:38'))
    const all = callsTo(calls, NTFY_URL)
    expect(all).toHaveLength(2)
    expect(bodyOf<NtfyBody>(all[1])).toMatchObject({ title: 'Fiyat Radarı: veri yeniden geliyor', priority: 3 })
    expect(env.RADAR.read<CronState>(CRON_KEY).watchdog).toEqual(HEALTHY_STATE)
    expect(env.RADAR.writes.every((key) => key === CRON_KEY)).toBe(true)
  })

  test('uses the slower cadence when the window changes', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    seedIngest(env, turkey('2026-10-31T23:50'))

    await runScheduled(env, turkey('2026-11-01T00:24'))
    expect(callsTo(calls, NTFY_URL)).toHaveLength(0)
    await runScheduled(env, turkey('2026-11-01T00:27'))
    expect(callsTo(calls, NTFY_URL)).toHaveLength(1)
  })
})

describe('digest', () => {
  test('is mailed once a day at 09:01 Turkey time, without a push', async () => {
    const env = testEnv()
    const calls = stubFetch(answerEverything)
    const digests = () => callsTo(calls, RESEND_URL)

    seedIngest(env, turkey('2026-10-09T08:47'))
    await runScheduled(env, turkey('2026-10-09T09:00'))
    expect(digests()).toHaveLength(0)

    await runScheduled(env, turkey('2026-10-09T09:01'))
    await runScheduled(env, turkey('2026-10-09T09:01'))
    await runScheduled(env, turkey('2026-10-09T09:02'))
    expect(digests()).toHaveLength(1)
    expect(callsTo(calls, NTFY_URL)).toHaveLength(0)
    expect(bodyOf<ResendBody>(digests()[0]).subject).toBe(
      'Fiyat Radarı günlük özet: en ucuz 103.869 TL (Amazon, Kozmik Turuncu)',
    )
    expect(digests()[0]?.headers.get('Idempotency-Key')).toBe('digest:2026-10-09')
    expect(env.RADAR.ttls.get('digest:2026-10-09')).toBe(3 * 24 * 60 * 60)

    seedIngest(env, turkey('2026-10-10T08:47'))
    await runScheduled(env, turkey('2026-10-10T09:01'))
    expect(digests()).toHaveLength(2)
    expect(digests()[1]?.headers.get('Idempotency-Key')).toBe('digest:2026-10-10')
    expect(env.RADAR.writes).toEqual(['digest:2026-10-09', 'digest:2026-10-10'])
  })

  test('is retried in the same minute when the mail could not be sent', async () => {
    const env = testEnv()
    let resendUp = false
    const calls = stubFetch((call) =>
      call.url === RESEND_URL && !resendUp ? new Response('hata', { status: 422 }) : answerEverything(call),
    )
    seedIngest(env, turkey('2026-10-09T08:47'))

    await runScheduled(env, turkey('2026-10-09T09:01'))
    expect(env.RADAR.values.has('digest:2026-10-09')).toBe(false)

    resendUp = true
    await runScheduled(env, turkey('2026-10-09T09:01'))
    expect(env.RADAR.values.has('digest:2026-10-09')).toBe(true)
    expect(callsTo(calls, RESEND_URL)).toHaveLength(2)
  })
})
