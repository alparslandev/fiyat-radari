import { describe, expect, test } from 'bun:test'
import { cadenceMinutes, digestDue, dispatchDue, staleLimitMs, turkeyDateKey, turkeyMinuteOfDay } from '../src/cadence'

const turkey = (local: string) => Date.parse(`${local}:00+03:00`)
const MINUTE = 60_000

function dueMinutesOfHour(hourStart: string): number[] {
  const start = turkey(hourStart)
  return Array.from({ length: 60 }, (_, minute) => minute).filter((minute) => dispatchDue(start + minute * MINUTE))
}

describe('cadenceMinutes', () => {
  test('is 15 minutes in October', () => {
    expect(cadenceMinutes(turkey('2026-10-09T10:00'))).toBe(15)
    expect(cadenceMinutes(turkey('2026-10-31T23:59'))).toBe(15)
  })

  test('is 5 minutes in November outside the hot windows', () => {
    expect(cadenceMinutes(turkey('2026-11-01T00:00'))).toBe(5)
    expect(cadenceMinutes(turkey('2026-11-05T12:00'))).toBe(5)
    expect(cadenceMinutes(turkey('2026-11-30T22:00'))).toBe(3)
  })

  test('is 3 minutes inside the hot windows with an inclusive start and an exclusive end', () => {
    expect(cadenceMinutes(turkey('2026-11-10T22:59'))).toBe(5)
    expect(cadenceMinutes(turkey('2026-11-10T23:00'))).toBe(3)
    expect(cadenceMinutes(turkey('2026-11-12T02:59'))).toBe(3)
    expect(cadenceMinutes(turkey('2026-11-12T03:00'))).toBe(5)

    expect(cadenceMinutes(turkey('2026-11-26T22:59'))).toBe(5)
    expect(cadenceMinutes(turkey('2026-11-26T23:00'))).toBe(3)
    expect(cadenceMinutes(turkey('2026-12-01T00:00'))).toBe(3)
    expect(cadenceMinutes(turkey('2026-12-01T02:59'))).toBe(3)
    expect(cadenceMinutes(turkey('2026-12-01T03:00'))).toBe(15)
  })
})

describe('dispatchDue', () => {
  test('fires at :01, :16, :31 and :46 Turkey time in October', () => {
    expect(dueMinutesOfHour('2026-10-09T10:00')).toEqual([1, 16, 31, 46])
    expect(dueMinutesOfHour('2026-10-09T00:00')).toEqual([1, 16, 31, 46])
    expect(dispatchDue(Date.parse('2026-10-09T07:01:00Z'))).toBe(true)
    expect(dispatchDue(Date.parse('2026-10-09T10:01:00Z'))).toBe(true)
    expect(dispatchDue(Date.parse('2026-10-09T10:00:00Z'))).toBe(false)
  })

  test('fires every 5 minutes from :01 in November', () => {
    expect(dueMinutesOfHour('2026-11-05T12:00')).toEqual([1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56])
  })

  test('fires every 3 minutes from :01 inside a hot window', () => {
    expect(dueMinutesOfHour('2026-11-11T14:00')).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58,
    ])
    expect(dispatchDue(turkey('2026-11-10T23:01'))).toBe(true)
    expect(dispatchDue(turkey('2026-11-10T23:02'))).toBe(false)
  })

  test('gives 96 dispatches on a plain October day', () => {
    const start = turkey('2026-10-09T00:00')
    const due = Array.from({ length: 24 * 60 }, (_, minute) => start + minute * MINUTE).filter(dispatchDue)
    expect(due).toHaveLength(96)
  })
})

describe('staleLimitMs', () => {
  test('is twice the slower cadence plus 5 minutes', () => {
    expect(staleLimitMs(turkey('2026-10-09T10:00'), turkey('2026-10-09T09:30'))).toBe(35 * MINUTE)
    expect(staleLimitMs(turkey('2026-11-05T12:00'), turkey('2026-11-05T11:55'))).toBe(15 * MINUTE)
    expect(staleLimitMs(turkey('2026-11-11T12:00'), turkey('2026-11-11T11:57'))).toBe(11 * MINUTE)
    expect(staleLimitMs(turkey('2026-11-01T00:10'), turkey('2026-10-31T23:50'))).toBe(35 * MINUTE)
    expect(staleLimitMs(turkey('2026-12-01T03:10'), turkey('2026-12-01T02:50'))).toBe(35 * MINUTE)
  })
})

describe('digestDue', () => {
  test('is true only at 09:01 Turkey time', () => {
    expect(digestDue(turkey('2026-10-09T09:01'))).toBe(true)
    expect(digestDue(turkey('2026-10-09T09:00'))).toBe(false)
    expect(digestDue(turkey('2026-10-09T09:02'))).toBe(false)
    expect(digestDue(Date.parse('2026-10-09T09:01:00Z'))).toBe(false)
    expect(digestDue(Date.parse('2026-10-09T06:01:00Z'))).toBe(true)
  })
})

describe('Turkey time helpers', () => {
  test('format the digest date key and minute of day in Turkey time', () => {
    expect(turkeyDateKey(Date.parse('2026-10-08T21:30:00Z'))).toBe('2026-10-09')
    expect(turkeyDateKey(Date.parse('2026-10-08T20:59:00Z'))).toBe('2026-10-08')
    expect(turkeyMinuteOfDay(Date.parse('2026-10-08T21:30:00Z'))).toBe(30)
    expect(turkeyMinuteOfDay(turkey('2026-10-09T09:01'))).toBe(541)
  })
})
