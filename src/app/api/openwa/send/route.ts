import { getOpenwaConfig } from '@/lib/openwa/config'
import { findSessionByName, sendText, OpenwaError } from '@/lib/openwa/client'
import { normalizeChatId } from '@/lib/openwa/chatid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Body inválido.' }, { status: 400 }) }
  const text = String(body.text || '').trim()
  if (!text) return Response.json({ ok: false, error: 'Informe o texto da mensagem.' }, { status: 400 })
  if (text.length > 4096) return Response.json({ ok: false, error: 'Texto acima de 4096 caracteres.' }, { status: 400 })
  const chatId = normalizeChatId(String(body.chatId || body.to || ''))
  if (!chatId) return Response.json({ ok: false, error: 'Destinatário inválido. Use o número com DDI+DDD (ex.: 5511998877665) ou um chatId (5511998877665@c.us / grupo@g.us).' }, { status: 400 })

  const cfg = getOpenwaConfig()
  try {
    const session = await findSessionByName(cfg.sessionName)
    if (!session) return Response.json({ ok: false, error: 'Sessão não existe — vincule primeiro.' }, { status: 409 })
    if (session.status !== 'ready') return Response.json({ ok: false, error: `Sessão não está pronta (status: ${session.status}). Aguarde a vinculação.` }, { status: 409 })
    const r = await sendText(session.id, chatId, text)
    if (!r.ok) return Response.json({ ok: false, error: r.error || 'Falha no envio.' }, { status: 502 })
    return Response.json({ ok: true, messageId: r.messageId })
  } catch (e) {
    const err = e as OpenwaError
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
}
