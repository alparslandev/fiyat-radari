import { describe, expect, test } from 'bun:test'
import type { Offer, Site, SiteStatus } from '../src/payload'
import { BUCKET_MS, decide, FORGET_AFTER_MS, type Decision, type RuleState } from '../src/rule'
import { deepFreeze, offer, payloadWith, warmState } from './support'

const T0 = Date.parse('2026-10-09T10:00:00Z')
const MINUTE = 60_000

function timeline(initial: RuleState) {
  let current = initial
  const step = (now: number, offers: Offer[], statuses: Partial<Record<Site, SiteStatus>> = {}): Decision => {
    const decision = decide(current, payloadWith(offers, statuses), now)
    current = decision.state
    return decision
  }
  return { step, state: () => current }
}

const trendyolA = (effective: number) => offer({ key: 'trendyol:a:1', site: 'trendyol', effective })
const amazonB = (effective: number) => offer({ key: 'amazon:b:1', site: 'amazon', effective, seller_score: null })

describe('decide', () => {
  test('never fires during warm-up with fewer than 96 buckets', () => {
    const { step } = timeline(warmState(105_000, T0, 95))
    const first = step(T0, [trendyolA(90_000)])
    expect(first.normal).toBeNull()
    expect(first.deal).toBeNull()

    const second = step(T0 + 15 * MINUTE, [trendyolA(90_000)])
    expect(second.normal).toBe(105_000)
    expect(second.deal?.best.effective).toBe(90_000)
  })

  test('fires when a qualifying offer is 500 TL below the median', () => {
    const { step } = timeline(warmState(105_000, T0))
    const decision = step(T0, [trendyolA(104_500)])
    expect(decision.deal?.best.key).toBe('trendyol:a:1')
    expect(decision.deal?.normal).toBe(105_000)
    expect(decision.deal?.floor).toBeNull()
  })

  test('one lira short of the step does not fire', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [trendyolA(104_501)]).deal).toBeNull()
  })

  test('the same offer at the same price stays quiet, 500 TL lower fires again', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [trendyolA(104_500)]).deal).not.toBeNull()
    expect(step(T0 + 15 * MINUTE, [trendyolA(104_500)]).deal).toBeNull()
    expect(step(T0 + 30 * MINUTE, [trendyolA(104_001)]).deal).toBeNull()
    expect(step(T0 + 45 * MINUTE, [trendyolA(104_000)]).deal?.best.effective).toBe(104_000)
  })

  test('flash deal A disappears, then B below normal but above A fires', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [trendyolA(103_000)]).deal).not.toBeNull()

    const decision = step(T0 + 15 * MINUTE, [amazonB(104_000)])
    expect(decision.deal?.best.key).toBe('amazon:b:1')
    expect(decision.deal?.floor).toBeNull()
    expect(decision.state.notified['trendyol:a:1']?.current).toBeNull()
  })

  test('step-wise 300 TL cuts fire once the cumulative drop reaches 500 below normal', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [trendyolA(105_000)]).deal).toBeNull()
    expect(step(T0 + 15 * MINUTE, [trendyolA(104_700)]).deal).toBeNull()
    expect(step(T0 + 30 * MINUTE, [trendyolA(104_400)]).deal?.best.effective).toBe(104_400)
    expect(step(T0 + 45 * MINUTE, [trendyolA(104_100)]).deal).toBeNull()
    expect(step(T0 + 60 * MINUTE, [trendyolA(103_800)]).deal?.best.effective).toBe(103_800)
  })

  test('a blocked cheapest site for one run, then back at the same price, does not fire', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [trendyolA(103_000)]).deal).not.toBeNull()

    const blocked = step(T0 + 15 * MINUTE, [trendyolA(103_000), amazonB(104_000)], { trendyol: 'engel' })
    expect(blocked.deal).toBeNull()
    expect(blocked.best?.key).toBe('amazon:b:1')
    expect(blocked.state.notified['trendyol:a:1']).toEqual({
      site: 'trendyol',
      price: 103_000,
      current: 103_000,
      seenAt: T0,
    })

    expect(step(T0 + 30 * MINUTE, [trendyolA(103_000), amazonB(104_000)]).deal).toBeNull()
  })

  test('a notified deal whose price rises 1000 TL is re-baselined and fires again after a fresh 500 TL drop', () => {
    const { step, state } = timeline(warmState(104_400, T0))
    expect(step(T0, [trendyolA(103_000)]).deal).not.toBeNull()

    expect(step(T0 + 15 * MINUTE, [trendyolA(104_000)]).deal).toBeNull()
    expect(state().notified['trendyol:a:1']?.price).toBe(104_000)

    expect(step(T0 + 30 * MINUTE, [trendyolA(103_000)]).deal?.best.effective).toBe(103_000)
  })

  test('a deal that rises 1000 TL but stays far below normal is not announced again at the higher price', () => {
    const { step } = timeline(warmState(110_000, T0))
    expect(step(T0, [trendyolA(100_000)]).deal).not.toBeNull()
    expect(step(T0 + 15 * MINUTE, [trendyolA(101_500)]).deal).toBeNull()
    expect(step(T0 + 30 * MINUTE, [trendyolA(101_500), amazonB(101_200)]).deal).toBeNull()
    expect(step(T0 + 45 * MINUTE, [trendyolA(100_900), amazonB(101_200)]).deal?.best.key).toBe('trendyol:a:1')
  })

  test('a rise below 1000 TL keeps the deal remembered', () => {
    const { step, state } = timeline(warmState(104_400, T0))
    step(T0, [trendyolA(103_000)])
    step(T0 + 15 * MINUTE, [trendyolA(103_999)])
    expect(state().notified['trendyol:a:1']?.current).toBe(103_999)
    expect(step(T0 + 30 * MINUTE, [trendyolA(103_000)]).deal).toBeNull()
  })

  test('a notified deal whose page failed this run is held, not treated as sold out', () => {
    const first = decide(warmState(105_000, T0), payloadWith([amazonB(103_000)]), T0)
    expect(first.deal).not.toBeNull()

    const partial = payloadWith([trendyolA(104_000)])
    partial.sites.amazon = { ...partial.sites.amazon, pages_failed: ['b'] }
    const held = decide(first.state, partial, T0 + 15 * MINUTE)
    expect(held.deal).toBeNull()
    expect(held.state.notified['amazon:b:1']?.current).toBe(103_000)

    const soldOut = decide(first.state, payloadWith([trendyolA(104_000)]), T0 + 15 * MINUTE)
    expect(soldOut.deal?.best.key).toBe('trendyol:a:1')
  })

  test('FORGET_AFTER prunes a deal that has not been seen for 6 hours', () => {
    const { step, state } = timeline(warmState(105_000, T0))
    step(T0, [trendyolA(103_000)])

    step(T0 + FORGET_AFTER_MS, [])
    expect(state().notified['trendyol:a:1']).toEqual({ site: 'trendyol', price: 103_000, current: null, seenAt: T0 })

    step(T0 + FORGET_AFTER_MS + MINUTE, [])
    expect(state().notified).toEqual({})
  })

  test('FORGET_AFTER also prunes a deal whose site stays blocked', () => {
    const { step, state } = timeline(warmState(105_000, T0))
    step(T0, [trendyolA(103_000)])

    step(T0 + FORGET_AFTER_MS, [amazonB(105_000)], { trendyol: 'engel' })
    expect(state().notified['trendyol:a:1']?.current).toBe(103_000)

    step(T0 + FORGET_AFTER_MS + MINUTE, [amazonB(105_000)], { trendyol: 'engel' })
    expect(state().notified).toEqual({})
  })

  test('non-qualifying offers never fire and never feed the buckets', () => {
    const { step } = timeline(warmState(105_000, T0))
    const cheapButRejected = offer({
      key: 'trendyol:x:1',
      effective: 90_000,
      qualifies: false,
      why_not: 'satıcı puanı düşük',
    })

    const mixed = step(T0, [cheapButRejected, trendyolA(105_000)])
    expect(mixed.deal).toBeNull()
    expect(mixed.best?.key).toBe('trendyol:a:1')
    expect(mixed.state.buckets[String(Math.floor(T0 / BUCKET_MS) * BUCKET_MS)]).toBe(105_000)
    expect(mixed.state.allTimeLow?.price).toBe(105_000)

    const alone = step(T0 + 15 * MINUTE, [cheapButRejected])
    expect(alone.deal).toBeNull()
    expect(alone.best).toBeNull()
    expect(Object.keys(alone.state.buckets)).toHaveLength(97)
  })

  test('does not mutate the input state', () => {
    const input = deepFreeze<RuleState>({
      ...warmState(105_000, T0),
      notified: { 'trendyol:a:1': { site: 'trendyol', price: 103_000, current: 103_000, seenAt: T0 - MINUTE } },
      allTimeLow: { price: 103_000, site: 'trendyol', color: 'Gümüş', seller: 'Trendyol', at: T0 - MINUTE },
    })
    const snapshot = structuredClone(input)

    decide(input, payloadWith([trendyolA(102_000), amazonB(101_000)]), T0)
    decide(input, payloadWith([trendyolA(104_500)]), T0 + MINUTE)
    decide(input, payloadWith([], { trendyol: 'engel' }), T0 + FORGET_AFTER_MS + MINUTE)

    expect(input).toEqual(snapshot)
  })

  test('ranks by price, then seller score with missing last, then site, then key', () => {
    const state = warmState(105_000, T0)
    const pick = (offers: Offer[]) => decide(state, payloadWith(offers), T0).best?.key

    expect(
      pick([
        offer({ key: 'trendyol:p:1', site: 'trendyol', effective: 104_000, seller_score: null }),
        offer({ key: 'amazon:p:1', site: 'amazon', effective: 104_000, seller_score: 9 }),
        offer({ key: 'hepsiburada:p:1', site: 'hepsiburada', effective: 104_000, seller_score: 9.5 }),
      ]),
    ).toBe('hepsiburada:p:1')
    expect(
      pick([
        offer({ key: 'trendyol:p:1', site: 'trendyol', effective: 104_000, seller_score: null }),
        offer({ key: 'amazon:p:1', site: 'amazon', effective: 104_000, seller_score: null }),
      ]),
    ).toBe('amazon:p:1')
    expect(
      pick([
        offer({ key: 'trendyol:p:2', site: 'trendyol', effective: 104_000 }),
        offer({ key: 'trendyol:p:1', site: 'trendyol', effective: 104_000 }),
      ]),
    ).toBe('trendyol:p:1')
  })

  test('a deal carries the top three, the floor and the missing sites', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [amazonB(104_000)]).deal).not.toBeNull()

    const third = offer({ key: 'trendyol:c:1', site: 'trendyol', effective: 104_200, color: 'Lacivert' })
    const extra = offer({ key: 'trendyol:d:1', site: 'trendyol', effective: 104_900, color: 'Kozmik Turuncu' })
    const decision = step(T0 + 15 * MINUTE, [extra, third, amazonB(104_000), trendyolA(103_000)], {
      hepsiburada: 'engel',
    })

    expect(decision.deal?.best.key).toBe('trendyol:a:1')
    expect(decision.deal?.floor).toBe(104_000)
    expect(decision.deal?.top.map((item) => item.key)).toEqual(['trendyol:a:1', 'amazon:b:1', 'trendyol:c:1'])
    expect(decision.deal?.missingSites).toEqual(['hepsiburada'])
  })

  test('an offer within 500 TL of another live notified deal does not fire', () => {
    const { step } = timeline(warmState(105_000, T0))
    expect(step(T0, [amazonB(104_000)]).deal).not.toBeNull()
    expect(step(T0 + 15 * MINUTE, [amazonB(104_000), trendyolA(103_600)]).deal).toBeNull()
  })

  test('keeps the all-time low as context and buckets only the last 7 days', () => {
    const { step, state } = timeline({
      buckets: { [String(T0 - 8 * 24 * 60 * MINUTE)]: 99_000, ...warmState(105_000, T0).buckets },
      notified: {},
      allTimeLow: { price: 99_000, site: 'amazon', color: 'Siyah', seller: 'Amazon', at: T0 - 8 * 24 * 60 * MINUTE },
    })
    step(T0, [trendyolA(104_000)])
    expect(state().allTimeLow?.price).toBe(99_000)
    expect(Object.values(state().buckets)).not.toContain(99_000)
    expect(Object.keys(state().buckets)).toHaveLength(97)
  })
})
