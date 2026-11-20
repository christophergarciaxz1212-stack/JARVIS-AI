import { NextRequest } from 'next/server'
import { getConfig } from '@/lib/wa/config'
import { parseWebhookEvent, verifySignature } from '@/lib/wa/meta'
import { processWebhookPayload } from '@/lib/wa/events'
import { logWa } from '@/lib/wa/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Verificação do webhook (a Meta chama UMA vez ao salvar a URL) ───────────
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  const cfg = getConfig()
  if (mode === 'subscribe' && token && cfg.verifyToken && token === cfg.verifyToken) {
    logWa('webhook-verified', { mode })
    return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  logWa('webhook-verify-failed', { mode })
  return new Response('Forbidden', { status: 403 })
}

// ─── Recebimento de eventos (mensagens e status) ─────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const appSecret = process.env.WA_APP_SECRET || ''
  const signature = req.headers.get('x-hub-signature-256')

  if (!appSecret) {
    // Sem App Secret não dá para autenticar a origem — recusa (fail closed) e explica
    logWa('webhook-rejected', { reason: 'WA_APP_SECRET ausente' })
    return new Response('App secret not configured', { status: 500 })
  }
  if (!verifySignature(rawBody, signature, appSecret)) {
    logWa('webhook-rejected', { reason: 'assinatura inválida' })
    return new Response('Invalid signature', { status: 401 })
  }

  let body: unknown
  try { body = JSON.parse(rawBody) } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const evt = parseWebhookEvent(body)
  try {
    const result = await processWebhookPayload(evt)
    logWa('webhook-processed', { inbound: result.inbound, deduped: result.deduped, statuses: result.statusUpdates, automations: result.automationsFired })
  } catch (e) {
    logWa('webhook-error', { error: (e as Error).message })
    // Meta reenvia se não for 200 — devolve 200 mesmo assim? Não: erro transitório merece retry da Meta (500)
    return new Response('Processing error', { status: 500 })
  }
  return new Response('EVENT_RECEIVED', { status: 200 })
}
