/**
 * JARVIS — Processamento de eventos do webhook da Meta.
 * Chamado pelo POST /api/whatsapp/webhook DEPOIS da validação da assinatura.
 * Idempotente (dedup por wamid). Persiste → SSE → automações → contadores.
 */
import { getConfig, saveConfig } from './config'
import {
  appendMessage, getMessages, getConversation, upsertConversation, upsertContact, getContact,
  updateMessageStatus, logWa, normalizePhone, type WaMessage,
} from './store'
import { runAutomations } from './automations'
import { publishWa } from './sse'
import type { NormalizedInbound, NormalizedStatus, NormalizedWebhook } from './meta'

export interface ProcessResult {
  inbound: number
  deduped: number
  statusUpdates: number
  automationsFired: number
}

export async function processWebhookPayload(evt: NormalizedWebhook): Promise<ProcessResult> {
  let inbound = 0
  let deduped = 0
  let automationFired = 0
  const cfg = getConfig()

  // ── Mensagens recebidas ──────────────────────────────────────────────────
  for (const msg of evt.inbound) {
    const phone = normalizePhone(msg.phone)
    // Nome: perfil da Meta ou contato salvo pelo usuário (alias vence)
    const saved = getContact(phone)
    const name = saved?.alias || saved?.name || msg.name || undefined
    if (msg.name) upsertContact(phone, { name: msg.name }) // enriquece sem sobrescrever alias

    const message: WaMessage = {
      id: msg.wamid,
      wamid: msg.wamid,
      phone,
      direction: 'in',
      type: msg.type as WaMessage['type'],
      text: msg.text,
      mediaId: msg.mediaId,
      mediaMime: msg.mediaMime,
      mediaName: msg.mediaName,
      contextWamid: msg.contextWamid,
      at: msg.timestamp,
    }
    const { inserted } = appendMessage(message)
    if (!inserted) { deduped++; continue }
    inbound++

    // Índice de conversa
    const conv = upsertConversation(phone, {
      name,
      lastText: msg.text,
      lastAt: msg.timestamp,
      lastInboundAt: msg.timestamp,
      unread: (getConversation(phone)?.unread || 0) + 1,
      lastWamid: msg.wamid,
    })
    publishWa({ type: 'message', phone, name, text: msg.text, at: msg.timestamp, id: msg.wamid, mediaType: msg.mediaId ? msg.type : undefined, important: !!conv.important, starred: !!conv.starred })

    // Automações (não bloqueia a resposta do webhook — roda inline, é rápido)
    const outcomes = await runAutomations({ msg: message, contact: saved, contactName: name || `+${phone}` })
    automationFired += outcomes.filter(o => o.fired).length
    for (const o of outcomes.filter(o => o.fired)) logWa('automation', { id: o.id, phone, detail: o.detail })
  }

  // ── Atualizações de status (sent/delivered/read/failed) ───────────────────
  let statusUpdates = 0
  for (const st of evt.statuses) {
    const updated = updateMessageStatus(st.wamid, st.status, st.errorCode)
    if (updated) {
      statusUpdates++
      publishWa({ type: 'status', wamid: st.wamid, status: st.status, errorCode: st.errorCode, phone: st.phone })
      if (st.errorCode) logWa('status-error', { wamid: st.wamid, code: st.errorCode, errors: st.errors })
    }
  }

  // ── Contadores ───────────────────────────────────────────────────────────
  if (inbound > 0 || statusUpdates > 0) {
    saveConfig({ stats: { ...cfg.stats, received: cfg.stats.received + inbound, lastWebhookAt: Date.now() } })
  }

  return { inbound, deduped, statusUpdates, automationsFired: automationFired }
}

/** Última mensagem inbound de uma conversa (para "o que X me disse?"). */
export function lastInboundMessage(phone: string): WaMessage | undefined {
  const p = normalizePhone(phone)
  const msgs = getMessages(p)
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].direction === 'in') return msgs[i]
  return undefined
}
