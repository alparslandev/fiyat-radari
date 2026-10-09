import type { Env } from './env'

export const USER_AGENT = 'fiyat-radari/1.0'

const NTFY_ENDPOINT = 'https://ntfy.sh/'
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 5_000

export type PushPriority = 1 | 2 | 3 | 4 | 5

export interface PushAction {
  label: string
  url: string
}

export interface Push {
  title: string
  message: string
  priority: PushPriority
  click?: string
  actions?: PushAction[]
}

export interface Mail {
  subject: string
  text: string
  idempotencyKey: string
}

export interface Notice {
  title: string
  message: string
  subject: string
  text: string
}

export interface Delivery {
  priority: PushPriority
  idempotencyKey: string
  click?: string
  actions?: PushAction[]
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function sendPush(env: Env, push: Push): Promise<boolean> {
  if (!env.NTFY_TOPIC) {
    console.warn(`[ntfy] NTFY_TOPIC tanımlı değil, bildirim atlandı: ${push.title}`)
    return false
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT }
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`
  const body = JSON.stringify({
    topic: env.NTFY_TOPIC,
    title: push.title,
    message: push.message,
    priority: push.priority,
    ...(push.click ? { click: push.click } : {}),
    ...(push.actions?.length
      ? { actions: push.actions.map(({ label, url }) => ({ action: 'view', label, url })) }
      : {}),
  })
  try {
    const response = await fetch(NTFY_ENDPOINT, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.ok) return true
    console.error(`[ntfy] gönderim başarısız (${response.status}): ${push.title}`)
    return false
  } catch (error) {
    console.error(`[ntfy] gönderim hatası (${errorMessage(error)}): ${push.title}`)
    return false
  }
}

export function retryDelayMs(response: Response): number {
  const header = response.headers.get('Retry-After')
  const seconds = header === null ? Number.NaN : Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_DELAY_MS
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function worthRetrying(status: number): boolean {
  return status === 429 || status >= 500
}

export async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_TO || !env.MAIL_FROM) {
    console.warn(`[mail] RESEND_API_KEY, MAIL_TO veya MAIL_FROM tanımlı değil, e-posta atlandı: ${mail.subject}`)
    return false
  }
  const init = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'Idempotency-Key': mail.idempotencyKey,
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [env.MAIL_TO], subject: mail.subject, text: mail.text }),
  }
  try {
    const first = await fetch(RESEND_ENDPOINT, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (first.ok) return true
    if (!worthRetrying(first.status)) {
      console.error(`[mail] Resend gönderimi başarısız (${first.status}): ${mail.subject}`)
      return false
    }
    const delay = retryDelayMs(first)
    console.warn(`[mail] Resend ${first.status} döndü, ${delay} ms sonra yeniden denenecek: ${mail.subject}`)
    await wait(delay)
    const second = await fetch(RESEND_ENDPOINT, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (second.ok) return true
    console.error(`[mail] Resend yeniden denemede de başarısız (${second.status}): ${mail.subject}`)
    return false
  } catch (error) {
    console.error(`[mail] Resend gönderim hatası (${errorMessage(error)}): ${mail.subject}`)
    return false
  }
}

export async function announce(env: Env, notice: Notice, delivery: Delivery): Promise<void> {
  await Promise.all([
    sendPush(env, {
      title: notice.title,
      message: notice.message,
      priority: delivery.priority,
      click: delivery.click,
      actions: delivery.actions,
    }),
    sendMail(env, { subject: notice.subject, text: notice.text, idempotencyKey: delivery.idempotencyKey }),
  ])
}
