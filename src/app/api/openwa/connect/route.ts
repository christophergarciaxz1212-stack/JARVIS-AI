import { getOpenwaConfig, jarvisWebhookUrl } from '@/lib/openwa/config'
import {
  ensureSession, startSession, getQr, getSession, findSessionByName, ensureWebhook, isConfigured, OpenwaError,
  type OpenwaSession,
} from '@/lib/openwa/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Vincula um número de WhatsApp ao JARVIS via OpenWA:
 * garante a sessão, inicia o engine e devolve o QR (PNG data URL) para escanear.
 * Se já estiver vinculada, devolve status "ready".
 */
export async function POST() {
  if (!isConfigured()) {
    return Response.json({ ok: false, error: 'OpenWA não configurado: falta a API key. Clique em Instalar (o JARVIS adota a key gerada no 1º boot) ou cole a key em Chaves de API.' }, { status: 400 })
  }
  const cfg = getOpenwaConfig()

  let session: OpenwaSession
  try {
    session = await ensureSession(cfg.sessionName)
  } catch (e) {
    const err = e as OpenwaError
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }

  // Já vinculado?
  if (session.status === 'ready' && session.engineLoaded) {
    const warning = await registerWebhookBestEffort(session.id)
    return Response.json({ ok: true, status: 'ready', sessionId: session.id, phone: session.phone, pushName: session.pushName, warning })
  }

  // Iniciar o engine (tolera "já iniciado")
  if (!session.engineLoaded) {
    try {
      session = await startSession(session.id)
    } catch (e) {
      const err = e as OpenwaError
      const msg = String(err.message || '')
      const alreadyRunning = err.status === 400 && /already/i.test(msg)
      if (!alreadyRunning) {
        return Response.json({ ok: false, error: err.message, sessionId: session.id }, { status: err.status || 502 })
      }
      // já está iniciando; segue para o QR
    }
  }

  // Aguardar o QR ou o pronto do engine (até ~14s)
  let qr: string | undefined
  let lastStatus = session.status
  for (let i = 0; i < 10; i++) {
    await sleep(1_500)
    try {
      const s = await getSession(session.id)
      lastStatus = s.status
      if (s.status === 'ready') {
        const warning = await registerWebhookBestEffort(session.id)
        return Response.json({ ok: true, status: 'ready', sessionId: session.id, phone: s.phone, pushName: s.pushName, warning })
      }
    } catch { /* engine ainda sobe */ }
    try {
      const q = await getQr(session.id)
      if (q?.qrCode) { qr = q.qrCode; lastStatus = (q.status as typeof lastStatus) || 'qr_ready'; break }
    } catch { /* QR ainda não pronto */ }
  }

  const warning = qr ? await registerWebhookBestEffort(session.id) : undefined
  if (qr) return Response.json({ ok: true, status: 'qr_ready', sessionId: session.id, qr, warning })
  return Response.json({ ok: true, status: lastStatus, sessionId: session.id, qr: null, waiting: true, warning })
}

async function registerWebhookBestEffort(sessionId: string): Promise<string | undefined> {
  const cfg = getOpenwaConfig()
  if (!cfg.autoRegisterWebhook) return undefined
  try {
    await ensureWebhook(sessionId, jarvisWebhookUrl(), ['message.received', 'session.status'], cfg.webhookSecret)
    return undefined // silêncio quando ok; a UI mostra só falhas
  } catch (e) {
    return `Webhook não registrado (${(e as Error).message}). Mensagens recebidas não aparecerão aqui, mas enviar funciona.`
  }
}
