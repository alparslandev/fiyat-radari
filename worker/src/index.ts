import type { Env } from './env'
import { handleIngest } from './ingest'
import { digestMail } from './messages'
import { sendMail } from './notify'
import { runScheduled } from './scheduled'
import { parseRadarState, STATE_KEY } from './state'

const INGEST_PATH = '/ingest'
const TEST_MAIL_PATH = '/test-mail'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === TEST_MAIL_PATH) {
      const radar = parseRadarState(await env.RADAR.get(STATE_KEY))
      const sent = await sendMail(env, {
        subject: 'Fiyat Radarı Test Maili',
        text: digestMail(radar, Date.now()).text,
        idempotencyKey: `test-${Date.now()}`,
      })
      return Response.json({ sent, recipient: env.MAIL_TO })
    }
    if (pathname !== INGEST_PATH) return new Response('Bulunamadı', { status: 404 })
    if (request.method !== 'POST') return new Response('Yalnızca POST', { status: 405, headers: { Allow: 'POST' } })
    return handleIngest(request, env, Date.now())
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
