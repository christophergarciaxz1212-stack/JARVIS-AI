import { NextRequest } from 'next/server'
import { getConfig, saveConfig } from '@/lib/wa/config'
import {
  sendTextMessage, sendMediaByLink, sendMediaById, sendTemplateMessage,
} from '@/lib/wa/meta'
import { isInsideWindow, windowExpiresAt } from '@/lib/wa/store'
import {
  appendMessage, upsertConversation, normalizePhone, logWa, getContact,
} from '@/lib/wa/store'
import { publishWa } from '@/lib/wa/sse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
const MEDIA = new Set(['image', 'video', 'audio', 'document'])

/**
 * Envio real pela API oficial (Cloud API). Aceita os dois contratos:
 *   { to|phone, type?: 'text'|'image'|…|'template', text?, link?, mediaId?, caption?,
 *     filename?, quotedMessageId?|replyToWamid?, templateName?, languageCode?, bodyParams? }
 * Persiste a mensagem enviada (histórico + status via webhook), publica SSE e registra o envio.
 */
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido', 400) }

  const phone = normalizePhone(String(b.to || b.phone || ''))
  if (!phone) return fail('Destinatário inválido (use E.164 só com dígitos, ex.: 5511987654321)', 400)
  const type = String(b.type || (b.templateName ? 'template' : 'text'))
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  const link = typeof b.link === 'string' ? b.link.trim() : (typeof b.mediaUrl === 'string' ? b.mediaUrl.trim() : '')
  const mediaId = typeof b.mediaId === 'string' ? b.mediaId.trim() : ''
  const caption = typeof b.caption === 'string' ? b.caption.trim() : ''
  const filename = typeof b.filename === 'string' ? b.filename.trim() : ''
  const replyTo = typeof b.quotedMessageId === 'string' ? b.quotedMessageId : typeof b.replyToWamid === 'string' ? b.replyToWamid : undefined
  const templateName = typeof b.templateName === 'string' ? b.templateName.trim() : ''
  const templateLang = typeof b.languageCode === 'string' ? b.languageCode : 'pt_BR'
  const templateParams = Array.isArray(b.bodyParams) ? (b.bodyParams as unknown[]).map(p => String(p)) : Array.isArray(b.templateParams) ? (b.templateParams as unknown[]).map(p => String(p)) : []

  if (type !== 'template' && !isInsideWindow(phone)) {
    const exp = windowExpiresAt(phone)
    return Response.json({
      error: `Janela de 24h fechada com este contato. A Meta só aceita template aprovado — a última mensagem DELE foi há mais de 24h.`,
      windowClosed: true,
      windowExpiresAt: exp,
    }, { status: 409 })
  }

  let result
  if (type === 'template' || templateName) {
    if (!templateName) return fail('templateName obrigatório para envio por template', 400)
    result = await sendTemplateMessage(phone, templateName, templateLang, templateParams)
  } else if (MEDIA.has(type)) {
    if (mediaId) result = await sendMediaById(phone, mediaId, type as 'image' | 'document' | 'video' | 'audio', caption || undefined, filename || undefined)
    else if (link) result = await sendMediaByLink(phone, link, type as 'image' | 'document' | 'video' | 'audio', caption || undefined, filename || undefined)
    else return fail('Para mídia, informe mediaId (upload em /api/whatsapp/media) ou link público.', 400)
  } else {
    if (!text) return fail('Texto vazio', 400)
    result = await sendTextMessage(phone, text, { replyToWamid: replyTo })
  }

  if (!result.ok) {
    logWa('send-error', { phone, code: result.code, error: result.error })
    const status = result.windowClosed ? 409 : result.rateLimited ? 429 : 502
    return Response.json({ error: result.error, code: result.code, windowClosed: result.windowClosed, rateLimited: result.rateLimited }, { status })
  }

  const now = Date.now()
  const contact = getContact(phone)
  const name = contact?.alias || contact?.name
  const kind = templateName || type === 'template' ? 'template' : MEDIA.has(type) ? type : 'text'
  appendMessage({
    id: result.wamid!,
    wamid: result.wamid,
    phone,
    direction: 'out',
    type: kind as 'text' | 'image' | 'document' | 'video' | 'audio' | 'template',
    text: kind === 'text' ? text : MEDIA.has(kind) ? caption || `[${kind}]${filename ? ` ${filename}` : ''}` : `[template ${templateName}]`,
    mediaMime: MEDIA.has(kind) ? kind : undefined,
    mediaName: filename || undefined,
    at: now,
    status: 'sent',
  })
  upsertConversation(phone, { name, lastText: kind === 'text' ? text : MEDIA.has(kind) ? caption || `[${kind}]` : `[template]`, lastAt: now, lastOutboundAt: now, lastWamid: result.wamid })
  const cfg = getConfig()
  saveConfig({ stats: { ...cfg.stats, sent: cfg.stats.sent + 1, lastSendAt: now } })
  publishWa({ type: 'message', phone, name, text: kind === 'text' ? text : caption || `[${kind}]`, at: now, id: result.wamid, fromMe: true })
  logWa('send-ok', { phone, wamid: result.wamid, kind })

  return Response.json({ ok: true, wamid: result.wamid, messageId: result.wamid })
}
