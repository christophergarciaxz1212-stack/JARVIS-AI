/**
 * JARVIS — OpenWA (gateway WhatsApp auto-hospedado) — configuração persistida.
 *
 * OpenWA (https://github.com/rmyndharis/OpenWA) é um gateway de WhatsApp não-oficial.
 * Este módulo guarda só o que NÃO é segredo (URL base, nome da sessão, porta local).
 * A API key do OpenWA vive em data/keys.json (OPENWA_API_KEY) via lib/keys,
 * nunca em config.json e nunca exposta ao frontend.
 */
import path from 'path'
import crypto from 'crypto'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

export interface OpenwaConfig {
  /** URL base do OpenWA, ex.: http://127.0.0.1:2785 */
  baseUrl: string
  /** Nome da sessão criada no OpenWA (regex ^[a-zA-Z0-9-]{3,50}$) */
  sessionName: string
  /** Porta do serviço gerenciado localmente */
  port: number
  /** true quando o JARVIS deve gerenciar a instalação local (instalar/iniciar/parar) */
  manageLocal: boolean
  /** Segredo HMAC para validar os webhooks que o OpenWA entrega ao JARVIS */
  webhookSecret: string
  /** Registra webhook no OpenWA automaticamente ao vincular (message.received + session.status) */
  autoRegisterWebhook: boolean
}

const CONFIG_FILE = () => path.join(dataDir(), 'openwa', 'config.json')

export const OPENWA_VERSION = 'v0.30.3'
export const OPENWA_DEFAULT_PORT = 2785

const DEFAULTS: OpenwaConfig = {
  baseUrl: `http://127.0.0.1:${OPENWA_DEFAULT_PORT}`,
  sessionName: 'jarvis',
  port: OPENWA_DEFAULT_PORT,
  manageLocal: true,
  webhookSecret: '',
  autoRegisterWebhook: true,
}

export function getOpenwaConfig(): OpenwaConfig {
  const saved = readJson<Partial<OpenwaConfig> | null>(CONFIG_FILE(), null)
  const cfg: OpenwaConfig = {
    ...DEFAULTS,
    ...(saved || {}),
    port: typeof saved?.port === 'number' && saved.port > 0 && saved.port < 65536 ? saved.port : DEFAULTS.port,
    sessionName: sanitizeSessionName(saved?.sessionName) || DEFAULTS.sessionName,
    baseUrl: sanitizeBaseUrl(saved?.baseUrl) || DEFAULTS.baseUrl,
    webhookSecret: saved?.webhookSecret || '',
  }
  if (!cfg.webhookSecret) {
    cfg.webhookSecret = crypto.randomBytes(24).toString('hex')
    try { writeJsonAtomic(CONFIG_FILE(), cfg) } catch {}
  }
  return cfg
}

export function saveOpenwaConfig(patch: Partial<OpenwaConfig>): OpenwaConfig {
  const cur = getOpenwaConfig()
  const next: OpenwaConfig = {
    ...cur,
    ...patch,
    sessionName: sanitizeSessionName(patch.sessionName ?? cur.sessionName) || cur.sessionName,
    baseUrl: sanitizeBaseUrl(patch.baseUrl ?? cur.baseUrl) || cur.baseUrl,
    port: typeof patch.port === 'number' && patch.port > 0 && patch.port < 65536 ? Math.floor(patch.port) : cur.port,
    webhookSecret: cur.webhookSecret, // nunca sobrescrevível via API
  }
  writeJsonAtomic(CONFIG_FILE(), next)
  return next
}

/** URL pública (loopback) que o OpenWA usa para entregar webhooks ao JARVIS. */
export function jarvisWebhookUrl(): string {
  if (process.env.OPENWA_WEBHOOK_URL) return process.env.OPENWA_WEBHOOK_URL
  // O Electron escolhe a primeira porta livre a partir de 3001 e a exporta como PORT para o Next
  const port = process.env.PORT || '3001'
  return `http://127.0.0.1:${port}/api/openwa/webhook`
}

export function sanitizeSessionName(name?: string | null): string | null {
  const n = String(name || '').trim()
  if (!n) return null
  if (!/^[a-zA-Z0-9-]{3,50}$/.test(n)) return null
  return n
}

export function sanitizeBaseUrl(url?: string | null): string | null {
  const u = String(url || '').trim().replace(/\/+$/, '')
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) return null
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname)
  } catch {
    return null
  }
}

/** Visão segura para o frontend: nunca expõe a API key nem o segredo do webhook. */
export function openwaConfigStatus() {
  const cfg = getOpenwaConfig()
  const apiKey = !!process.env.OPENWA_API_KEY
  return {
    baseUrl: cfg.baseUrl,
    sessionName: cfg.sessionName,
    port: cfg.port,
    manageLocal: cfg.manageLocal,
    autoRegisterWebhook: cfg.autoRegisterWebhook,
    hasApiKey: apiKey,
    apiKeyHint: apiKey ? `••••${String(process.env.OPENWA_API_KEY).slice(-4)}` : '',
    configured: apiKey && !!cfg.baseUrl,
    github: 'https://github.com/rmyndharis/OpenWA',
  }
}
