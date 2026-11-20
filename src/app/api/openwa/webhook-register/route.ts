import { getOpenwaConfig, jarvisWebhookUrl } from '@/lib/openwa/config'
import { findSessionByName, ensureWebhook, OpenwaError } from '@/lib/openwa/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Registra (ou confirma) o webhook do JARVIS na sessão do OpenWA. */
export async function POST() {
  const cfg = getOpenwaConfig()
  try {
    const session = await findSessionByName(cfg.sessionName)
    if (!session) return Response.json({ ok: false, error: 'Sessão não existe — vincule primeiro.' }, { status: 404 })
    const r = await ensureWebhook(session.id, jarvisWebhookUrl(), ['message.received', 'session.status'], cfg.webhookSecret)
    return Response.json({ ok: true, ...r, url: jarvisWebhookUrl() })
  } catch (e) {
    const err = e as OpenwaError
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
}
