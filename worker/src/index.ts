import type { Env } from './env'
import { handleIngest } from './ingest'
import { runScheduled } from './scheduled'

const INGEST_PATH = '/ingest'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname !== INGEST_PATH) return new Response('Bulunamadı', { status: 404 })
    if (request.method !== 'POST') return new Response('Yalnızca POST', { status: 405, headers: { Allow: 'POST' } })
    return handleIngest(request, env, Date.now())
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
