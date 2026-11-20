import { NextRequest } from 'next/server'
import { getConfig, saveConfig } from '@/lib/wa/config'
import { getPending, setPending, clearPending, logWa, type WaPendingAction } from '@/lib/wa/store'
import { sendTextMessage } from '@/lib/wa/meta'
import { isInsideWindow } from '@/lib/wa/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET() {
  return Response.json({ pending: getPending() })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('JSON inválido', 400) }
  try {
    switch (String(body.action || '')) {
      case 'set': {
        const to = String(body.to || '').replace(/\D/g, '')
        const toName = String(body.toName || '').trim()
        const text = String(body.text || '').trim()
        if (!to || !text) return fail('to e text são obrigatórios', 400)
        const pending: WaPendingAction = { action: 'send', to, toName: toName || `+${to}`, text, createdAt: Date.now() }
        setPending(pending)
        return Response.json({ ok: true, pending })
      }
      case 'confirm': {
        const p = getPending()
        if (!p) return fail('Não há envio pendente.', 404)
        if (Date.now() - p.createdAt > 10 * 60_000) { clearPending(); return fail('Envio pendente expirou. Peça de novo.', 410) }
        if (!isInsideWindow(p.to)) { clearPending(); return fail('Janela de 24h fechada com este contato — use um template aprovado.', 409) }
        clearPending()
        const r = await sendTextMessage(p.to, p.text)
        if (!r.ok) return Response.json({ ok: false, error: r.error, code: r.code }, { status: 502 })
        const cfg = getConfig()
        saveConfig({ stats: { ...cfg.stats, sent: cfg.stats.sent + 1, lastSendAt: Date.now() } })
        logWa('send-ok', { to: p.to, wamid: r.wamid, via: 'pending-confirm' })
        return Response.json({ ok: true, wamid: r.wamid })
      }
      case 'cancel': { clearPending(); return Response.json({ ok: true }) }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}
