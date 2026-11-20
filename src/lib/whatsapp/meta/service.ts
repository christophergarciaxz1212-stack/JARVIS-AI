import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { dataDir } from '../../agents/fsutil'
import {
  readConfig, writeConfig, readSecrets, writeSecrets, clearSecrets,
  listContacts, getContact, upsertContact,
  listConversations, getConversation, upsertConversation,
  listMessages, appendMessage, updateMessageStatus,
  listAutomations, upsertAutomation, deleteAutomation,
  listNotifications, markNotificationRead, unreadNotificationCount,
  listEvents,
} from './store'
import { verifyWebhookSignature, randomToken } from './crypto'
import * as client from './client'
import { enqueueWebhook } from './queue'
import { broadcast } from './realtime'

export function status() {
  const cfg = readConfig()
  const secs = readSecrets()
  return {
    config: {
      appId: cfg.appId,
      apiVersion: cfg.apiVersion,
      connected: cfg.connected,
      connectedAt: cfg.connectedAt,
      wabaId: cfg.wabaId,
      phoneNumberId: cfg.phoneNumberId,
      businessId: cfg.businessId,
      displayPhoneNumber: cfg.displayPhoneNumber,
      verifiedName: cfg.verifiedName,
      scopes: cfg.scopes,
      tokenExpiresAt: cfg.tokenExpiresAt,
      lastError: cfg.lastError,
      webhookVerified: cfg.webhookVerified,
      lastWebhookAt: cfg.lastWebhookAt,
      redirectUri: cfg.redirectUri,
      verifyToken: cfg.verifyToken,
      hasAppSecret: !!secs.appSecret,
      hasUserToken: !!secs.userAccessToken,
      hasVerifyToken: !!cfg.verifyToken,
    },
    counts: {
      contacts: listContacts().length,
      conversations: listConversations().length,
      messages: listMessages().length,
      unreadNotifications: unreadNotificationCount(),
      automations: listAutomations().length,
      enabledAutomations: listAutomations().filter(a => a.enabled).length,
    },
  }
}

export function saveAppConfig(input: {
  appId?: string
  appSecret?: string
  apiVersion?: string
  verifyToken?: string
  redirectUri?: string
}) {
  const cfgPatch: any = {}
  if (input.appId !== undefined) cfgPatch.appId = input.appId.trim() || undefined
  if (input.apiVersion) cfgPatch.apiVersion = input.apiVersion.trim()
  if (input.redirectUri !== undefined) cfgPatch.redirectUri = input.redirectUri.trim() || undefined
  if (input.verifyToken !== undefined) {
    cfgPatch.verifyToken = input.verifyToken.trim() || randomToken(16)
  } else if (!readConfig().verifyToken) {
    cfgPatch.verifyToken = randomToken(16)
  }
  const cfg = writeConfig(cfgPatch)
  if (input.appSecret !== undefined) {
    writeSecrets({ appSecret: input.appSecret.trim() || undefined })
  }
  return status()
}

export function oauthStartUrl(): string {
  const cfg = readConfig()
  if (!cfg.appId) throw new Error('App ID da Meta não configurado')
  if (!cfg.redirectUri) throw new Error('Redirect URI não configurado')
  const scopes = ['whatsapp_business_messaging', 'whatsapp_business_management', 'business_management']
  const state = randomToken(16)
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: scopes.join(','),
    response_type: 'code',
    state,
  })
  // O state é de uso único: sem ele gravado, nenhum callback é aceito
  const stateFile = oauthStateFile()
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify({ state, createdAt: Date.now() }))
  return `https://www.facebook.com/${cfg.apiVersion}/dialog/oauth?${params.toString()}`
}

const oauthStateFile = () => path.join(dataDir(), 'whatsapp', 'meta', 'oauth-state.json')
const OAUTH_STATE_TTL = 15 * 60_000

/** O state recebido precisa ser exatamente o último emitido, e recente (anti-CSRF de login). */
export function consumeOauthState(state: string): boolean {
  const file = oauthStateFile()
  let saved: { state?: unknown; createdAt?: unknown } = {}
  try { saved = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return false }
  try { fs.rmSync(file, { force: true }) } catch { /* uso único mesmo se a remoção falhar: o TTL expira */ }
  const expected = typeof saved.state === 'string' ? Buffer.from(saved.state) : Buffer.alloc(0)
  const given = Buffer.from(String(state || ''))
  const fresh = typeof saved.createdAt === 'number' && Date.now() - saved.createdAt < OAUTH_STATE_TTL
  return fresh && expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

export async function oauthCallback(code: string, state: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!consumeOauthState(state)) throw new Error('State OAuth inválido ou expirado (possível CSRF) — inicie a conexão de novo pelo JARVIS')

    const cfg = readConfig()
    const secs = readSecrets()
    if (!cfg.appId || !secs.appSecret || !cfg.redirectUri) throw new Error('App ID/Secret/Redirect URI não configurados')
    const { accessToken, expiresIn } = await client.exchangeCodeForToken(code, cfg.redirectUri, cfg.appId, secs.appSecret)
    writeSecrets({ userAccessToken: accessToken })
    writeConfig({
      connected: true,
      connectedAt: Date.now(),
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      tokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      lastError: undefined,
    })
    // discover waba/phone
    await discoverResources().catch(e => writeConfig({ lastError: e.message }))
    return { ok: true }
  } catch (e: any) {
    writeConfig({ lastError: e?.message || String(e), connected: false })
    return { ok: false, error: e?.message || String(e) }
  }
}

export async function discoverResources(): Promise<{ wabas: any[]; phones: any[] }> {
  const wabas = await client.listWhatsAppBusinessAccounts()
  let phones: any[] = []
  if (wabas.length) {
    const wabaId = wabas[0].id
    phones = await client.listPhoneNumbers(wabaId)
    const phone = phones[0]
    writeConfig({
      wabaId,
      phoneNumberId: phone?.id,
      displayPhoneNumber: phone?.display_phone_number,
      verifiedName: phone?.verified_name,
      businessId: wabas[0].id,
    })
    // subscribe app to waba webhooks
    try { await client.subscribeAppToWaba(wabaId) } catch {}
  }
  return { wabas, phones }
}

export async function disconnect(erase = false) {
  if (erase) {
    clearSecrets()
    // reset config connected fields
    writeConfig({
      connected: false, connectedAt: undefined, wabaId: undefined, phoneNumberId: undefined,
      displayPhoneNumber: undefined, verifiedName: undefined,
      tokenExpiresAt: undefined, lastError: undefined, webhookVerified: false,
    })
  } else {
    writeConfig({ connected: false })
    writeSecrets({ userAccessToken: undefined })
  }
  broadcast('connection', { connected: false })
  return status()
}

export function verifyWebhookToken(mode: string | null, token: string | null, challenge: string | null): { ok: boolean; challenge?: string } {
  const cfg = readConfig()
  if (mode === 'subscribe' && token && cfg.verifyToken && token === cfg.verifyToken) {
    writeConfig({ webhookVerified: true })
    return { ok: true, challenge: challenge || '' }
  }
  return { ok: false }
}

export function handleIncomingWebhook(rawBody: string, signature: string | null): { ok: boolean; error?: string } {
  const cfg = readConfig()
  const secs = readSecrets()
  const secret = secs.webhookSecret || secs.appSecret
  if (secret) {
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return { ok: false, error: 'Assinatura inválida' }
    }
  }
  let body: any
  try { body = JSON.parse(rawBody) } catch { return { ok: false, error: 'JSON inválido' } }
  // async process
  enqueueWebhook(body)
  return { ok: true }
}

export async function sendMessage(input: {
  to: string
  type?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'template'
  text?: string
  mediaId?: string
  mediaUrl?: string
  caption?: string
  filename?: string
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  templateName?: string
  languageCode?: string
  templateComponents?: any[]
  quotedMessageId?: string
}) {
  const cfg = readConfig()
  if (!cfg.connected || !cfg.phoneNumberId) throw new Error('WhatsApp não conectado')
  const to = input.to.replace(/\D/g, '')
  if (!to) throw new Error('Destinatário inválido')
  // 24h window check for non-template
  if (input.type !== 'template') {
    const lastInbound = listMessages().filter(m => m.conversationId === to && m.direction === 'inbound').sort((a, b) => b.timestamp - a.timestamp)[0]
    const within24 = lastInbound && (Date.now() - lastInbound.timestamp) < 24 * 60 * 60 * 1000
    if (!within24) {
      throw new Error('Janela de 24h expirada para este contato. Use um template aprovado (type=template).')
    }
  }
  let res: any
  const type = input.type || 'text'
  if (type === 'text') {
    res = await client.sendText(cfg.phoneNumberId, to, input.text || '', input.quotedMessageId)
  } else if (type === 'location' && input.location) {
    res = await client.sendLocation(cfg.phoneNumberId, to, input.location.latitude, input.location.longitude, input.location.name, input.location.address)
  } else if (type === 'template') {
    res = await client.sendTemplate(cfg.phoneNumberId, to, input.templateName || '', input.languageCode || 'pt_BR', input.templateComponents)
  } else if (['image', 'audio', 'video', 'document'].includes(type)) {
    let mediaId = input.mediaId
    if (!mediaId && input.mediaUrl) {
      // can't upload from url directly; send by link not supported in our client; require mediaId
      throw new Error('Envio de mídia requer upload prévio (mediaId). Use /api/whatsapp/media upload.')
    }
    if (!mediaId) throw new Error('mediaId obrigatório para envio de mídia')
    res = await client.sendMedia(cfg.phoneNumberId, to, mediaId, type as any, input.caption, input.filename)
  } else {
    throw new Error('Tipo de mensagem não suportado')
  }
  const waMessageId = res?.messages?.[0]?.id
  const msg: any = {
    id: waMessageId || `out-${Date.now()}`,
    conversationId: to,
    direction: 'outbound',
    from: cfg.displayPhoneNumber || cfg.phoneNumberId || '',
    to,
    type: type === 'text' ? 'text' : (type as any),
    text: input.text || input.caption,
    timestamp: Date.now(),
    status: 'sent',
    quotedMessageId: input.quotedMessageId,
  }
  appendMessage(msg)
  upsertConversation({
    id: to,
    lastMessageAt: msg.timestamp,
    lastMessagePreview: (msg.text || `[${type}]`).slice(0, 120),
    lastDirection: 'outbound',
    unread: 0,
  })
  broadcast('message', { message: msg, outbound: true })
  return { ok: true, messageId: waMessageId, raw: res }
}

export async function markRead(messageId: string) {
  const cfg = readConfig()
  if (!cfg.connected || !cfg.phoneNumberId) throw new Error('Não conectado')
  // Meta mark as read (direct fetch)
  const { readSecrets } = await import('./store')
  const secs = readSecrets()
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secs.userAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  })
  if (!res.ok) throw new Error(`Falha ao marcar lido: HTTP ${res.status}`)
  updateMessageStatus(messageId, 'read')
  return { ok: true }
}

// AI helpers are in route; service exposes data access
export function getConversationWithMessages(id: string) {
  const conv = getConversation(id)
  const msgs = listMessages(id).sort((a, b) => a.timestamp - b.timestamp)
  return { conversation: conv, messages: msgs }
}

export function searchMessages(query: string, limit = 50) {
  const q = query.toLowerCase()
  return listMessages().filter(m => (m.text || '').toLowerCase().includes(q)).slice(0, limit)
}

export function identifyPendingReplies() {
  // conversations where last message inbound and unread > 0
  return listConversations().filter(c => c.unread > 0 || c.lastDirection === 'inbound')
}

export async function diagnose() {
  const cfg = readConfig()
  const secs = readSecrets()
  const report: any = {
    config: {
      appId: !!cfg.appId,
      appSecret: !!secs.appSecret,
      verifyToken: !!cfg.verifyToken,
      redirectUri: !!cfg.redirectUri,
      apiVersion: cfg.apiVersion,
    },
    connection: {
      connected: cfg.connected,
      hasUserToken: !!secs.userAccessToken,
      tokenExpired: cfg.tokenExpiresAt ? Date.now() > cfg.tokenExpiresAt : false,
      wabaId: cfg.wabaId,
      phoneNumberId: cfg.phoneNumberId,
    },
    webhook: {
      verifyTokenSet: !!cfg.verifyToken,
      webhookVerified: !!cfg.webhookVerified,
      lastWebhookAt: cfg.lastWebhookAt,
    },
    storage: {
      contacts: listContacts().length,
      conversations: listConversations().length,
      messages: listMessages().length,
    },
    checks: [] as string[],
  }
  // try token validation if app secret present
  if (cfg.appId && secs.appSecret && secs.userAccessToken) {
    try {
      const d = await client.debugToken(secs.userAccessToken, cfg.appId, secs.appSecret)
      report.tokenDebug = d?.data
      report.checks.push('Token validado com sucesso')
    } catch (e: any) {
      report.checks.push(`Falha ao validar token: ${e.message}`)
    }
  }
  if (cfg.connected && cfg.phoneNumberId) {
    try {
      const p = await client.getBusinessProfile(cfg.phoneNumberId)
      report.businessProfile = p
      report.checks.push('Perfil comercial obtido')
    } catch (e: any) {
      report.checks.push(`Falha ao obter perfil: ${e.message}`)
    }
  }
  // webhook reachability hint
  report.checks.push('Webhook deve ser configurado no painel Meta for Developers apontando para /api/whatsapp/webhook')
  return report
}

export async function testSend(to: string, text: string) {
  return sendMessage({ to, type: 'text', text })
}

export async function testWebhookSimulate() {
  // simulate an inbound message webhook payload for testing
  const cfg = readConfig()
  const fake = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test-waba',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: cfg.displayPhoneNumber || '5511999999999', phone_number_id: cfg.phoneNumberId || '123' },
          contacts: [{ profile: { name: 'Contato Teste' }, wa_id: '5511888888888' }],
          messages: [{
            from: '5511888888888',
            id: `wamid.test.${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            text: { body: 'Mensagem de teste do JARVIS' },
            type: 'text',
          }],
        },
        field: 'messages',
      }],
    }],
  }
  enqueueWebhook(fake)
  return { ok: true, simulated: true }
}

export {
  listContacts, getContact, upsertContact,
  listConversations, getConversation, upsertConversation,
  listMessages, getMessage, appendMessage, updateMessageStatus,
  listAutomations, upsertAutomation, deleteAutomation,
  listNotifications, markNotificationRead, unreadNotificationCount,
  listEvents,
} from './store'