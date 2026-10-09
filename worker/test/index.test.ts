import { afterEach, beforeEach, expect, test } from 'bun:test'
import worker from '../src/index'
import {
  answerEverything,
  GITHUB_DISPATCH_URL,
  payloadWith,
  restoreFetch,
  silenceConsole,
  stubFetch,
  testEnv,
} from './support'

let restoreConsole: () => void = () => {}

beforeEach(() => {
  restoreConsole = silenceConsole()
})

afterEach(() => {
  restoreFetch()
  restoreConsole()
})

test('routes POST /ingest and rejects other paths and methods', async () => {
  const env = testEnv()
  stubFetch(answerEverything)
  const base = 'https://fiyat-radari.example.workers.dev'

  expect((await worker.fetch(new Request(`${base}/`), env)).status).toBe(404)
  expect((await worker.fetch(new Request(`${base}/ingest`), env)).status).toBe(405)

  const ingest = new Request(`${base}/ingest`, {
    method: 'POST',
    headers: { Authorization: 'Bearer gizli-anahtar' },
    body: JSON.stringify(payloadWith([], {}, { observed_at: new Date(Date.now() - 60_000).toISOString() })),
  })
  expect((await worker.fetch(ingest, env)).status).toBe(200)
})

test('runs the scheduled handler at the scheduled time', async () => {
  const env = testEnv()
  const calls = stubFetch(answerEverything)
  const controller = { scheduledTime: Date.parse('2026-10-09T10:16:00+03:00'), cron: '* * * * *', noRetry() {} }

  await worker.scheduled(controller, env)
  expect(calls.map((call) => call.url)).toEqual([GITHUB_DISPATCH_URL])
})
