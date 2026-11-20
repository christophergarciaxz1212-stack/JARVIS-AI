/**
 * JARVIS — WhatsApp Business Cloud API (Meta) — configuração persistida.
 * Segredos (WA_ACCESS_TOKEN, WA_APP_SECRET) vivem em data/keys.json via lib/keys,
 * nunca em config.json e nunca no frontend. config.json guarda só dados não secretos
 * + preferências do usuário.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

export interface WaConfig {
  phoneNumberId?: string
  wabaId?: string
  appId?: string
  configId?: string // Facebook Login for Business (Embedded Signup) — opcional
  displayName?: string
  verifyToken: string // gerado na primeira execução; colado no painel Meta pelo usuário
  /** Preferências */
  requireConfirmSend: boolean
  notify: { desktop: boolean; sound: boolean; importantOnly: boolean }
  businessHours: { enabled: boolean; start: string; end: string } // dias úteis 08:00–18:00 por padrão
  autoReply: { enabled: boolean; text: string }
  urgentKeywords: string[]
  automations: { urgent: boolean; commitment: boolean; document: boolean; outsideHours: boolean; question: boolean; starredSender: boolean }
  stats: { received: number; sent: number; lastWebhookAt?: number; lastSendAt?: number }
}

const CONFIG_FILE = () => path.join(dataDir(), 'whatsapp-meta', 'config.json')

const DEFAULTS: WaConfig = {
  verifyToken: '',
  requireConfirmSend: true,
  notify: { desktop: true, sound: false, importantOnly: false },
  businessHours: { enabled: true, start: '08:00', end: '18:00' },
  autoReply: { enabled: false, text: '' },
  urgentKeywords: ['urgente', 'emergência', 'emergencia', 'agora', 'hoje', 'prazo', 'atrasado', 'cobrança', 'cobranca', 'inadimplência', 'inadimplencia'],
  automations: { urgent: true, commitment: true, document: true, outsideHours: false, question: true, starredSender: true },
  stats: { received: 0, sent: 0 },
}

export function getConfig(): WaConfig {
  const saved = readJson<Partial<WaConfig> | null>(CONFIG_FILE(), null)
  const cfg: WaConfig = {
    ...DEFAULTS,
    ...saved,
    notify: { ...DEFAULTS.notify, ...(saved?.notify || {}) },
    businessHours: { ...DEFAULTS.businessHours, ...(saved?.businessHours || {}) },
    autoReply: { ...DEFAULTS.autoReply, ...(saved?.autoReply || {}) },
    urgentKeywords: saved?.urgentKeywords?.length ? saved.urgentKeywords : DEFAULTS.urgentKeywords,
    automations: { ...DEFAULTS.automations, ...(saved?.automations || {}) },
    stats: { ...DEFAULTS.stats, ...(saved?.stats || {}) },
  }
  if (!cfg.verifyToken) {
    cfg.verifyToken = crypto.randomBytes(24).toString('hex')
    try { fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true }); writeJsonAtomic(CONFIG_FILE(), cfg) } catch {}
  }
  return cfg
}

export function saveConfig(patch: Partial<WaConfig>): WaConfig {
  const cur = getConfig()
  const next: WaConfig = {
    ...cur,
    ...patch,
    notify: { ...cur.notify, ...(patch.notify || {}) },
    businessHours: { ...cur.businessHours, ...(patch.businessHours || {}) },
    autoReply: { ...cur.autoReply, ...(patch.autoReply || {}) },
    urgentKeywords: patch.urgentKeywords ?? cur.urgentKeywords,
    automations: { ...cur.automations, ...(patch.automations || {}) },
    stats: { ...cur.stats, ...(patch.stats || {}) },
    verifyToken: cur.verifyToken, // nunca sobrescrevível via API
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true })
  writeJsonAtomic(CONFIG_FILE(), next)
  return next
}

/** Visão segura para o frontend: nunca expõe segredos nem o verify token completo. */
export function configStatus() {
  const cfg = getConfig()
  const token = !!process.env.WA_ACCESS_TOKEN
  const appSecret = !!process.env.WA_APP_SECRET
  const looksTemporary = token && /EAAG|EAAP/.test(process.env.WA_ACCESS_TOKEN || '') ? undefined : undefined // não dá para distinguir sem debug_token; teste real valida
  return {
    phoneNumberId: cfg.phoneNumberId || '',
    wabaId: cfg.wabaId || '',
    appId: cfg.appId || '',
    configId: cfg.configId || '',
    displayName: cfg.displayName || '',
    hasAccessToken: token,
    hasAppSecret: appSecret,
    webhookVerifyTokenSet: !!cfg.verifyToken,
    verifyTokenHint: `••••${cfg.verifyToken.slice(-6)}`,
    requireConfirmSend: cfg.requireConfirmSend,
    notify: cfg.notify,
    businessHours: cfg.businessHours,
    autoReply: { enabled: cfg.autoReply.enabled, text: cfg.autoReply.text },
    urgentKeywords: cfg.urgentKeywords,
    automations: cfg.automations,
    stats: cfg.stats,
    configured: !!(cfg.phoneNumberId && token),
    looksTemporary,
  }
}

/** Copia o verify token (o usuário cola no painel do app Meta). Só por chamada explícita. */
export function getVerifyToken(): string { return getConfig().verifyToken }

/** Regenera o verify token (invalida o configurado no painel Meta). */
export function rotateVerifyToken(): string {
  const cur = getConfig()
  cur.verifyToken = crypto.randomBytes(24).toString('hex')
  writeJsonAtomic(CONFIG_FILE(), cur)
  return cur.verifyToken
}
