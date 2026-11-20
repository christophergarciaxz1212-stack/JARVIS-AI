/**
 * JARVIS — Cliente da WhatsApp Cloud API (Meta Graph API).
 * Só o servidor usa este módulo. Nenhuma credencial sai daqui — nem por erro de mensagem.
 */
import crypto from 'crypto'

export const GRAPH_VERSION = 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

// ─── Assinatura do webhook (X-Hub-Signature-256) ─────────────────────────────

export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false
  const m = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader.trim())
  if (!m) return false
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest()
  let provided: Buffer
  try { provided = Buffer.from(m[1], 'hex') } catch { return false }
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
}

// ─── Tipos do webhook ────────────────────────────────────────────────────────

export interface NormalizedInbound {
  wamid: string
  phone: string // remetente (digits)
  name?: string // profile.name do webhook, quando presente
  type: string
  text: string
  mediaId?: string
  mediaMime?: string
  mediaName?: string
  contextWamid?: string
  timestamp: number // ms
}

export interface NormalizedStatus {
  wamid: string
  phone: string // destinatário (recipient_id)
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errorCode?: string
  timestamp: number
  errors?: Array<{ code?: number | string; title?: string }>
}

export interface NormalizedWebhook {
  inbound: NormalizedInbound[]
  statuses: NormalizedStatus[]
  unknownFields: number
}

/** Normaliza o payload oficial do webhook (object=whatsapp_business_account). Entrada não-Meta → vazio seguro. */
export function parseWebhookEvent(body: unknown): NormalizedWebhook {
  const out: NormalizedWebhook = { inbound: [], statuses: [], unknownFields: 0 }
  if (!body || typeof body !== 'object') return out
  const root = body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> }
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return out

  for (const entry of root.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages' || !change.value) { out.unknownFields++; continue }
      const value = change.value as {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: Array<Record<string, unknown>>
        statuses?: Array<Record<string, unknown>>
      }
      const nameByPhone = new Map<string, string>()
      for (const c of value.contacts || []) {
        if (c.wa_id) nameByPhone.set(normalizePhone(c.wa_id), String(c.profile?.name || '').trim())
      }
      for (const m of value.messages || []) {
        const parsed = normalizeInbound(m, nameByPhone)
        if (parsed) out.inbound.push(parsed)
      }
      for (const s of value.statuses || []) {
        const parsed = normalizeStatus(s)
        if (parsed) out.statuses.push(parsed)
      }
    }
  }
  return out
}

function normalizePhone(p: string): string { return String(p || '').replace(/\D/g, '') }

function normalizeInbound(m: Record<string, unknown>, nameByPhone: Map<string, string>): NormalizedInbound | null {
  const phone = normalizePhone(String(m.from || ''))
  const wamid = String(m.id || '')
  if (!phone || !wamid) return null
  const type = String(m.type || 'unknown')
  const ts = Number(m.timestamp || 0) * 1000 || Date.now()
  const contextWamid = (m.context as { id?: unknown } | undefined)?.id ? String((m.context as { id: unknown }).id) : undefined

  let text = ''
  let mediaId: string | undefined
  let mediaMime: string | undefined
  let mediaName: string | undefined

  switch (type) {
    case 'text': {
      text = String((m.text as { body?: unknown } | undefined)?.body || '')
      break
    }
    case 'image': case 'video': case 'audio': case 'sticker': case 'document': {
      const media = m[type] as { id?: unknown; mime_type?: unknown; caption?: unknown; filename?: unknown } | undefined
      mediaId = media?.id ? String(media.id) : undefined
      mediaMime = media?.mime_type ? String(media.mime_type) : undefined
      mediaName = media?.filename ? String(media.filename) : undefined
      text = media?.caption ? String(media.caption) : mediaName ? String(mediaName) : `[${type}]`
      break
    }
    case 'location': {
      const loc = m.location as { latitude?: unknown; longitude?: unknown; name?: unknown; address?: unknown } | undefined
      const coords = loc?.latitude != null ? `${loc.latitude},${loc.longitude}` : ''
      text = ['📍 Localização', loc?.name || '', coords, loc?.address || ''].filter(Boolean).join(' — ')
      break
    }
    case 'contacts': {
      const contacts = m.contacts as Array<{ name?: { formatted_name?: unknown } }> | undefined
      text = `📇 Contato: ${(contacts || []).map(c => String(c?.name?.formatted_name || '')).filter(Boolean).join(', ') || '[contato]'}`
      break
    }
    case 'reaction': {
      const reaction = m.reaction as { emoji?: unknown } | undefined
      text = `Reação ${String(reaction?.emoji || '')} à mensagem`
      break
    }
    case 'interactive': {
      const interactive = m.interactive as { type?: unknown; button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined
      text = String(interactive?.button_reply?.title || interactive?.list_reply?.title || `[interactive ${String(interactive?.type || '')}]`)
      break
    }
    case 'order': {
      text = '🧾 [pedido]'
      break
    }
    default:
      text = `[${type}]`
  }
  return { wamid, phone, name: nameByPhone.get(phone) || undefined, type, text, mediaId, mediaMime, mediaName, contextWamid, timestamp: ts }
}

function normalizeStatus(s: Record<string, unknown>): NormalizedStatus | null {
  const wamid = String(s.id || '')
  const phone = normalizePhone(String(s.recipient_id || ''))
  const raw = String(s.status || '')
  const status = (['sent', 'delivered', 'read', 'failed'].includes(raw) ? raw : 'sent') as NormalizedStatus['status']
  const ts = Number(s.timestamp || 0) * 1000 || Date.now()
  const errors = Array.isArray(s.errors) ? (s.errors as Array<Record<string, unknown>>).map(e => ({ code: e.code as number | string | undefined, title: String(e.title || e.message || '') })) : undefined
  const errorCode = errors?.[0]?.code != null ? String(errors[0].code) : undefined
  return wamid ? { wamid, phone, status, timestamp: ts, errorCode, errors } : null
}

// ─── Chamadas de envio ───────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean
  wamid?: string
  error?: string
  code?: string
  /** true quando o erro indica janela de 24h fechada (precisa de template aprovado) */
  windowClosed?: boolean
  /** true quando parece ser limite de envio (rate limit) */
  rateLimited?: boolean
}

export async function sendTextMessage(to: string, text: string, opts: { replyToWamid?: string } = {}): Promise<SendResult> {
  const cfg = (await import('./config')).getConfig()
  const token = process.env.WA_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'WA_ACCESS_TOKEN não configurado. Salve em 🔑 Chaves de API.' }
  if (!cfg.phoneNumberId) return { ok: false, error: 'phone_number_id não configurado.' }
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'text',
    text: { preview_url: false, body: text },
  }
  if (opts.replyToWamid) body.context = { message_id: opts.replyToWamid }
  return postMessage(cfg.phoneNumberId, token, body)
}

/** Envio com mídia já enviada à Meta (media_id). */
export async function sendMediaById(to: string, mediaId: string, mediaType: 'image' | 'document' | 'video' | 'audio', caption?: string, filename?: string): Promise<SendResult> {
  const cfg = (await import('./config')).getConfig()
  const token = process.env.WA_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'WA_ACCESS_TOKEN não configurado.' }
  if (!cfg.phoneNumberId) return { ok: false, error: 'phone_number_id não configurado.' }
  const media: Record<string, unknown> = { id: mediaId }
  // A API não aceita caption em áudio
  if (caption && mediaType !== 'audio') media.caption = caption
  if (mediaType === 'document' && filename) media.filename = filename
  const body = { messaging_product: 'whatsapp', to: normalizePhone(to), type: mediaType, [mediaType]: media }
  return postMessage(cfg.phoneNumberId, token, body)
}

export async function sendMediaByLink(to: string, link: string, mediaType: 'image' | 'document' | 'video' | 'audio', caption?: string, filename?: string): Promise<SendResult> {
  const cfg = (await import('./config')).getConfig()
  const token = process.env.WA_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'WA_ACCESS_TOKEN não configurado.' }
  if (!cfg.phoneNumberId) return { ok: false, error: 'phone_number_id não configurado.' }
  const media: Record<string, unknown> = { link, ...(caption ? { caption } : {}) }
  if (mediaType === 'document' && filename) media.filename = filename
  const body = { messaging_product: 'whatsapp', to: normalizePhone(to), type: mediaType, [mediaType]: media }
  return postMessage(cfg.phoneNumberId, token, body)
}

/** Envio fora da janela de 24h: exige template aprovado (ex.: nome + idioma). */
export async function sendTemplateMessage(to: string, templateName: string, languageCode = 'pt_BR', bodyParams: string[] = []): Promise<SendResult> {
  const cfg = (await import('./config')).getConfig()
  const token = process.env.WA_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'WA_ACCESS_TOKEN não configurado.' }
  if (!cfg.phoneNumberId) return { ok: false, error: 'phone_number_id não configurado.' }
  const components = bodyParams.length
    ? [{ type: 'body', parameters: bodyParams.map(p => ({ type: 'text', text: p })) }]
    : undefined
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, ...(components ? { components } : {}) },
  }
  return postMessage(cfg.phoneNumberId, token, body)
}

async function postMessage(phoneNumberId: string, token: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } }
    if (res.ok && data.messages?.[0]?.id) return { ok: true, wamid: data.messages[0].id }
    const err = data.error
    const code = err?.code != null ? String(err.code) : String(res.status)
    const rawMsg = err?.error_data?.details || err?.message || `HTTP ${res.status}`
    // 131047: janela de 24h fechada; 131048: rate limit; 131049/131050: restrição; 131026: sem WhatsApp no número
    const windowClosed = code === '131047'
    const rateLimited = code === '131048'
    return { ok: false, error: friendlyMetaError(code, rawMsg), code, windowClosed, rateLimited }
  } catch (e) {
    return { ok: false, error: `Falha de rede com a Meta: ${(e as Error).message}` }
  }
}

function friendlyMetaError(code: string, raw: string): string {
  const map: Record<string, string> = {
    '131047': 'A janela de 24h fechou com este contato (a última mensagem dele foi há mais de 24h). Para reengajar, use um template aprovado pela Meta — configure no painel e envie pelo Centro do WhatsApp.',
    '131048': 'Limite de envio atingido (rate limit). Aguarde alguns minutos e tente de novo.',
    '131026': 'Este número não tem WhatsApp ou não é um número válido para a API.',
    '131042': 'Problema na conta (faturamento/permissões do número). Verifique a conta no painel Meta.',
    '190': 'Token inválido ou expirado. Gere um novo token (de sistema, permanente) e salve em 🔑 Chaves de API.',
    '10': 'Permissão insuficiente no app: confira whatsapp_business_messaging.',
  }
  return map[code] || raw || `Erro da Meta (código ${code})`
}

// ─── Diagnóstico (health) ────────────────────────────────────────────────────

export interface WaHealth {
  ok: boolean
  checkedAt: number
  items: Array<{ id: string; label: string; ok: boolean; detail: string; fix?: string }>
  phoneNumber?: { display: string; verifiedName: string; quality: string; status: string }
  token?: { valid: boolean; expiresAt?: number; scopes?: string[]; appId?: string }
}

export async function healthCheck(): Promise<WaHealth> {
  const { getConfig } = await import('./config')
  const cfg = getConfig()
  const items: WaHealth['items'] = []
  const push = (id: string, label: string, ok: boolean, detail: string, fix?: string) => items.push({ id, label, ok, detail, fix })
  const now = Date.now()

  // 1. Config mínima
  const hasId = !!cfg.phoneNumberId
  push('phoneNumberId', 'Phone Number ID (número da Cloud API)', hasId, hasId ? `Configurado (••••${cfg.phoneNumberId!.slice(-4)})` : 'Ausente', 'Crie o app no Meta for Developers → WhatsApp → Começar → copie o Phone Number ID')
  const hasToken = !!process.env.WA_ACCESS_TOKEN
  push('accessToken', 'Token de acesso (WA_ACCESS_TOKEN)', hasToken, hasToken ? 'Salvo neste computador' : 'Ausente', 'Meta for Developers → seu app → WhatsApp → Configuração da API → Token (use um token permanente de System User)')
  const hasSecret = !!process.env.WA_APP_SECRET
  push('appSecret', 'App Secret (validação da assinatura X-Hub-Signature-256)', hasSecret, hasSecret ? 'Salvo neste computador' : 'Ausente — webhooks não podem ser autenticados sem ele', 'Meta for Developers → seu app → Configurações → Básico → App Secret')
  push('verifyToken', 'Verify Token do webhook', !!cfg.verifyToken, `Definido (hint ${cfg.verifyToken.slice(-6)}…) — cole no painel da Meta`, 'Em Webhooks do seu app: URL pública (https) + este verify token')

  // 2. Endpoint Graph: número configurado
  let phoneNumber: WaHealth['phoneNumber']
  if (hasId && hasToken) {
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(cfg.phoneNumberId!)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, {
        headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      })
      const d = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string; error?: { message?: string; code?: number } }
      if (res.ok) {
        phoneNumber = { display: d.display_phone_number || '?', verifiedName: d.verified_name || '?', quality: d.quality_rating || '?', status: d.code_verification_status || '?' }
        push('phoneInfo', 'Número alcançável na Meta', true, `${phoneNumber.display} — ${phoneNumber.verifiedName} (qualidade ${phoneNumber.quality})`)
      } else {
        push('phoneInfo', 'Número alcançável na Meta', false, `Meta respondeu: ${d.error?.message || `HTTP ${res.status}`}`, 'Confira Phone Number ID e permissões (whatsapp_business_management)')
      }
    } catch (e) {
      push('phoneInfo', 'Número alcançável na Meta', false, `Rede: ${(e as Error).message}`)
    }
  } else {
    push('phoneInfo', 'Número alcançável na Meta', false, 'Pulado — configure Phone Number ID e token primeiro')
  }

  // 3. Token: validade real via debug_token (precisa appId + appSecret)
  let token: WaHealth['token']
  if (hasToken && cfg.appId && hasSecret) {
    try {
      const appToken = `${cfg.appId}|${process.env.WA_APP_SECRET}`
      const res = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(process.env.WA_ACCESS_TOKEN!)}&access_token=${encodeURIComponent(appToken)}`, {
        signal: AbortSignal.timeout(10_000),
      })
      const d = (await res.json().catch(() => ({}))) as { data?: { is_valid?: boolean; expires_at?: number; scopes?: string[]; app_id?: string; error?: { message?: string } }; error?: { message?: string } }
      const dd = d.data
      if (res.ok && dd) {
        token = { valid: !!dd.is_valid, expiresAt: dd.expires_at && dd.expires_at > 0 ? dd.expires_at * 1000 : undefined, scopes: dd.scopes, appId: dd.app_id }
        const exp = dd.expires_at && dd.expires_at > 0 ? new Date(dd.expires_at * 1000).toLocaleDateString('pt-BR') : 'permanente'
        push('tokenValid', 'Token válido (debug_token)', !!dd.is_valid, dd.is_valid ? `Válido — expira em ${exp} — escopos: ${(dd.scopes || []).join(', ')}` : `Inválido/expirado. ${d.error?.message || dd.error?.message || ''}`, 'Gere um System User token permanente em business.facebook.com → Configurações → Usuários do sistema')
      } else {
        push('tokenValid', 'Token válido (debug_token)', false, `debug_token falhou: ${d.error?.message || `HTTP ${res.status}`}`, 'Confira App ID e App Secret')
      }
    } catch (e) {
      push('tokenValid', 'Token válido (debug_token)', false, `Rede: ${(e as Error).message}`)
    }
  } else {
    push('tokenValid', 'Token válido (debug_token)', false, 'Pulado — preencha App ID + App Secret + token para diagnóstico completo', 'No painel Meta: Configurações → Básico (App ID e App Secret)')
  }

  const ok = items.every(i => i.ok)
  return { ok, checkedAt: now, items, phoneNumber, token }
}
