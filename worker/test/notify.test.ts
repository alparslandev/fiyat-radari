import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { retryDelayMs, sendMail, sendPush } from '../src/notify'
import {
  bodyOf,
  callsTo,
  NTFY_URL,
  RESEND_URL,
  restoreFetch,
  silenceConsole,
  stubFetch,
  testEnv,
  type NtfyBody,
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

describe('sendPush', () => {
  test('publishes JSON to the ntfy root with the bearer token', async () => {
    const calls = stubFetch(() => Response.json({ id: 'n1' }))
    const sent = await sendPush(testEnv(), {
      title: 'iPhone 17 Pro 256 GB: 101.499 TL',
      message: 'Trendyol, Kozmik Turuncu',
      priority: 5,
      click: 'https://www.trendyol.com/x',
      actions: [{ label: "Trendyol'da aç", url: 'https://www.trendyol.com/x' }],
    })

    expect(sent).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(NTFY_URL)
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tk_test')
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json')
    expect(calls[0]?.body).toContain('Kozmik Turuncu')
    expect(bodyOf<NtfyBody>(calls[0])).toEqual({
      topic: 'radar-test',
      title: 'iPhone 17 Pro 256 GB: 101.499 TL',
      message: 'Trendyol, Kozmik Turuncu',
      priority: 5,
      click: 'https://www.trendyol.com/x',
      actions: [{ action: 'view', label: "Trendyol'da aç", url: 'https://www.trendyol.com/x' }],
    })
  })

  test('sends without Authorization when there is no token', async () => {
    const calls = stubFetch(() => Response.json({ id: 'n1' }))
    await sendPush(testEnv({ NTFY_TOKEN: undefined }), { title: 'a', message: 'b', priority: 3 })
    expect(calls[0]?.headers.get('Authorization')).toBeNull()
    expect(bodyOf<NtfyBody>(calls[0])).toEqual({ topic: 'radar-test', title: 'a', message: 'b', priority: 3 })
  })

  test('skips when the topic is missing and reports failures as false', async () => {
    const calls = stubFetch(() => new Response('nope', { status: 500 }))
    expect(await sendPush(testEnv({ NTFY_TOPIC: undefined }), { title: 'a', message: 'b', priority: 3 })).toBe(false)
    expect(calls).toHaveLength(0)
    expect(await sendPush(testEnv(), { title: 'a', message: 'b', priority: 3 })).toBe(false)
  })
})

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
