import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { retryDelayMs, sendMail } from '../src/notify'
import {
  bodyOf,
  callsTo,
  RESEND_URL,
  restoreFetch,
  silenceConsole,
  stubFetch,
  testEnv,
  type ResendBody,
} from './support'

let restoreConsole: () => void = () => {}

beforeEach(() => {
  restoreConsole = silenceConsole()
})

afterEach(() => {
  restoreFetch()
  restoreConsole()
})

const mail = { subject: 'Trendyol takibi düzeldi', text: 'Kesinti süresi: 45 dakika', idempotencyKey: 'site-recover:x' }

describe('sendMail', () => {
  test('posts to Resend with idempotency key and user agent', async () => {
    const calls = stubFetch(() => Response.json({ id: 'email-1' }))
    expect(await sendMail(testEnv(), mail)).toBe(true)

    const call = callsTo(calls, RESEND_URL)[0]
    expect(call?.headers.get('Authorization')).toBe('Bearer re_test')
    expect(call?.headers.get('Idempotency-Key')).toBe('site-recover:x')
    expect(call?.headers.get('User-Agent')).toBe('fiyat-radari/1.0')
    expect(call?.headers.get('Content-Type')).toBe('application/json')
    expect(bodyOf<ResendBody>(call)).toEqual({
      from: 'Fiyat Radarı <radar@devdiscipline.com>',
      to: ['alp@example.com'],
      subject: 'Trendyol takibi düzeldi',
      text: 'Kesinti süresi: 45 dakika',
    })
  })

  test('retries once on 429 honouring Retry-After', async () => {
    let attempt = 0
    const calls = stubFetch(() => {
      attempt += 1
      return attempt === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } })
        : Response.json({ id: 'email-1' })
    })
    expect(await sendMail(testEnv(), mail)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe('site-recover:x')
  })

  test('gives up after the second server error and never retries a client error', async () => {
    const serverCalls = stubFetch(() => new Response('down', { status: 503, headers: { 'Retry-After': '0' } }))
    expect(await sendMail(testEnv(), mail)).toBe(false)
    expect(serverCalls).toHaveLength(2)

    const clientCalls = stubFetch(() => new Response('bad', { status: 422 }))
    expect(await sendMail(testEnv(), mail)).toBe(false)
    expect(clientCalls).toHaveLength(1)
  })

  test('skips when a secret is missing and survives network errors', async () => {
    const calls = stubFetch(() => {
      throw new Error('ağ hatası')
    })
    expect(await sendMail(testEnv({ RESEND_API_KEY: undefined }), mail)).toBe(false)
    expect(await sendMail(testEnv({ MAIL_TO: undefined }), mail)).toBe(false)
    expect(calls).toHaveLength(0)
    expect(await sendMail(testEnv(), mail)).toBe(false)
    expect(calls).toHaveLength(1)
  })

  test('sends email using Cloudflare EMAIL binding when available', async () => {
    let captured: unknown = null
    const mockEmail = {
      send: async (msg: unknown) => {
        captured = msg
        return { messageId: 'cf-1' }
      },
    } as unknown as SendEmail
    const env = { ...testEnv(), EMAIL: mockEmail }
    expect(await sendMail(env, mail)).toBe(true)
    expect(captured).toEqual({
      from: { name: 'Fiyat Radarı', email: 'radar@devdiscipline.com' },
      to: 'alp@example.com',
      subject: 'Trendyol takibi düzeldi',
      text: 'Kesinti süresi: 45 dakika',
    })
  })

  test('handles Cloudflare EMAIL send error gracefully', async () => {
    const failingEmail = {
      send: async () => {
        throw new Error('cf error')
      },
    } as unknown as SendEmail
    const env = { ...testEnv(), EMAIL: failingEmail }
    expect(await sendMail(env, mail)).toBe(false)
  })
})

describe('retryDelayMs', () => {
  test('reads Retry-After seconds, caps at 5 seconds and defaults to 1 second', () => {
    const delay = (value?: string) =>
      retryDelayMs(new Response(null, { status: 429, headers: value === undefined ? {} : { 'Retry-After': value } }))
    expect(delay('2')).toBe(2_000)
    expect(delay('120')).toBe(5_000)
    expect(delay()).toBe(1_000)
    expect(delay('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(1_000)
  })
})
