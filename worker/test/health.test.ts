import { describe, expect, test } from 'bun:test'
import {
  formatOutage,
  HEALTHY_STATE,
  nextHealthState,
  parseHealthState,
  REALERT_INTERVAL_MS,
  type AlertRule,
  type HealthProbe,
  type HealthState,
} from '../src/health'

const T0 = Date.parse('2026-10-09T10:00:00Z')
const MINUTE = 60_000
const at = (minutes: number) => new Date(T0 + minutes * MINUTE)
const failing: HealthProbe[] = [{ name: 'trendyol', ok: false, detail: 'engel' }]
const passing: HealthProbe[] = [{ name: 'trendyol', ok: true, detail: '' }]

function failTimes(count: number, start: HealthState = HEALTHY_STATE): HealthState {
  let state = start
  for (let index = 0; index < count; index += 1) state = nextHealthState(state, failing, at(index * 15)).state
  return state
}

describe('nextHealthState', () => {
  test('alerts on the third consecutive failure, not before', () => {
    const first = nextHealthState(HEALTHY_STATE, failing, at(0))
    const second = nextHealthState(first.state, failing, at(15))
    const third = nextHealthState(second.state, failing, at(30))

    expect(first.action).toBe('none')
    expect(second.action).toBe('none')
    expect(third.action).toBe('alert')
    expect(third.state).toEqual({ failures: 3, since: at(0).toISOString(), alertedAt: at(30).toISOString() })
  })

  test('does not repeat the alert within 6 hours and re-alerts after', () => {
    const alerted = failTimes(3)
    const soon = nextHealthState(alerted, failing, at(30 + 5 * 60))
    expect(soon.action).toBe('none')

    const realertAt = new Date(Date.parse(alerted.alertedAt ?? '') + REALERT_INTERVAL_MS)
    const later = nextHealthState(soon.state, failing, realertAt)
    expect(later.action).toBe('alert')
  })

  test('recovers only after an alert was sent', () => {
    const once = failTimes(1)
    const quiet = nextHealthState(once, passing, at(20))
    expect(quiet.action).toBe('none')
    expect(quiet.changed).toBe(true)
    expect(quiet.state).toEqual(HEALTHY_STATE)

    const recovered = nextHealthState(failTimes(3), passing, at(60))
    expect(recovered.action).toBe('recover')
    expect(recovered.state).toEqual(HEALTHY_STATE)

    const steady = nextHealthState(HEALTHY_STATE, passing, at(75))
    expect(steady).toEqual({ state: HEALTHY_STATE, action: 'none', changed: false })
  })

  test('takes a custom alert rule', () => {
    const firstFailure: AlertRule = ({ failures }) => failures >= 1
    expect(nextHealthState(HEALTHY_STATE, failing, at(0), firstFailure).action).toBe('alert')

    const longOutage: AlertRule = ({ outageMs }) => outageMs >= 60 * MINUTE
    const quietStreak: HealthState = { failures: 4, since: at(0).toISOString(), alertedAt: null }
    const early = nextHealthState(quietStreak, failing, at(59), longOutage)
    expect(early.action).toBe('none')
    expect(nextHealthState(early.state, failing, at(60), longOutage).action).toBe('alert')
  })
})

describe('parseHealthState', () => {
  test('falls back to healthy for missing or malformed values', () => {
    expect(parseHealthState(undefined)).toEqual(HEALTHY_STATE)
    expect(parseHealthState(null)).toEqual(HEALTHY_STATE)
    expect(parseHealthState('bozuk')).toEqual(HEALTHY_STATE)
    expect(parseHealthState({ failures: 'iki', since: 5, alertedAt: null })).toEqual(HEALTHY_STATE)
    expect(parseHealthState({ failures: 2, since: '2026-10-09T10:00:00.000Z', alertedAt: null })).toEqual({
      failures: 2,
      since: '2026-10-09T10:00:00.000Z',
      alertedAt: null,
    })
  })
})

describe('formatOutage', () => {
  test('formats minutes and hours in Turkish', () => {
    const since = at(0).toISOString()
    expect(formatOutage(null, at(5))).toBe('?')
    expect(formatOutage(since, new Date(T0 + 10_000))).toBe('1 dakika')
    expect(formatOutage(since, at(45))).toBe('45 dakika')
    expect(formatOutage(since, at(125))).toBe('2 saat 5 dakika')
    expect(formatOutage(since, at(180))).toBe('3 saat')
  })
})
