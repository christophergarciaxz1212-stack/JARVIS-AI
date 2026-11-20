import { getOpenwaConfig, jarvisWebhookUrl } from '@/lib/openwa/config'
import { verifyOpenwaSignature } from '@/lib/openwa/signature'
import { recordOpenwaEvent } from '@/lib/openwa/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ingress dos webhooks do OpenWA. Configurado automaticamente ao vincular
 * (POST /api/openwa/webhook-register) apontando para jarvisWebhookUrl().
 * Autenticação = HMAC-SHA256 no corpo bruto (header X-OpenWA-Signature: sha256=<hex>).
 */
export async function POST(req: Request) {
  const raw = await req.text()
  const cfg = getOpenwaConfig()
  if (cfg.webhookSecret) {
    const ok = verifyOpenwaSignature(raw, req.headers.get('x-openwa-signature'), cfg.webhookSecret)
    if (!ok) return Response.json({ error: 'Assinatura inválida.' }, { status: 401 })
  }
  let body: Record<string, unknown> = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { return Response.json({ error: 'JSON inválido.' }, { status: 400 }) }

  const event = String(body.event || 'unknown')
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
  const truncate = (v: unknown, max = 500) => String(v ?? '').slice(0, max)

  if (event === 'message.received') {
    recordOpenwaEvent({
      at: Date.now(),
      event,
      sessionId,
      from: truncate(data.from, 64) || undefined,
      fromMe: data.fromMe === true,
      chatId: truncate(data.chatId || data.from, 64) || undefined,
      body: truncate(data.body),
      messageId: truncate(data.id, 128) || undefined,
    })
  } else {
    // session.status / session.authenticated / session.disconnected etc. — registro leve
    recordOpenwaEvent({
      at: Date.now(),
      event,
      sessionId,
      body: truncate(data.status || data.reason || ''),
    })
  }
  return Response.json({ ok: true })
}

/** Confirmação manual de que o endpoint está de pé (curl pelo navegador). */
export async function GET() {
  return Response.json({ ok: true, endpoint: jarvisWebhookUrl(), hint: 'O OpenWA entrega eventos aqui via POST.' })
}
