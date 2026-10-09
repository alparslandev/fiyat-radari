import { describe, expect, test } from 'bun:test'
import pythonPayload from './fixtures/python-payload.json'
import { parsePayload } from '../src/payload'
import { decide } from '../src/rule'
import { parseRadarState } from '../src/state'

const PYTHON_PAYLOAD = JSON.stringify(pythonPayload)

describe('payload produced by the Python job', () => {
  test('passes validation with every site and offer intact', () => {
    const parsed = parsePayload(PYTHON_PAYLOAD)
    if (!parsed.ok) throw new Error(`geçersiz alan: ${parsed.field}`)
    for (const site of ['trendyol', 'hepsiburada', 'amazon'] as const) {
      expect(parsed.payload.sites[site].status).toBe('ok')
      expect(parsed.payload.sites[site].offers.length).toBe(pythonPayload.sites[site].offers.length)
    }
  })

  test('feeds the rule and picks the cheapest qualifying offer', () => {
    const parsed = parsePayload(PYTHON_PAYLOAD)
    if (!parsed.ok) throw new Error(`geçersiz alan: ${parsed.field}`)
    const decision = decide(parseRadarState(null), parsed.payload, Date.parse('2026-10-09T01:24:00Z'))
    expect(decision.deal).toBeNull()
    expect(decision.best?.site).toBe('amazon')
    expect(decision.best?.effective).toBe(103869)
    expect(decision.best?.seller).toBe('Gürgençler Apple Premium Partner')
  })
})
