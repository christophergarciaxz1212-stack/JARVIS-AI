/**
 * JARVIS — Cliente REST do OpenWA (WhatsApp gateway auto-hospedado).
 * Só o servidor usa este módulo. Nenhuma credencial sai daqui.
 *
 * Docs: https://github.com/rmyndharis/OpenWA/blob/main/docs/06-api-specification.md
 */
import { getOpenwaConfig } from './config'

export type OpenwaSessionStatus =
  | 'created' | 'initializing' | 'qr_ready' | 'authenticating' | 'ready'
  | 'disconnected' | 'action_required' | 'failed'

export interface OpenwaSession {
  id: string
  name: string
  status: OpenwaSessionStatus
  phone: string | null
  pushName: string | null
  connectedAt: string | null
  lastActive: string | null
  createdAt: string | null
  updatedAt: string | null
  lastError: string | null
  engineLoaded: boolean
}

export class OpenwaError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function baseUrl(): string {
  return getOpenwaConfig().baseUrl
}
function apiKey(): string {
  return String(process.env.OPENWA_API_KEY || '')
}

export function isConfigured(): boolean {
  return !!apiKey() && !!baseUrl()
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {}): Promise<T> {
  const url = `${baseUrl()}${path}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.auth !== false) {
    if (!apiKey()) throw new OpenwaError('API key do OpenWA não configurada. Configure em Chaves de API ou no painel do OpenWA.', 401)
    headers['X-API-Key'] = apiKey()
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    })
  } catch (e) {
    const msg = (e as Error).message || String(e)
    const hint = /abort|timeout/i.test(msg) ? 'tempo esgotado' : 'OpenWA não respondeu — está iniciado?'
    throw new OpenwaError(`${hint} (${baseUrl()})`, 0)
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const err = (data as { message?: unknown; error?: unknown; code?: unknown } | null)
    const detail = err?.message ?? err?.error ?? (typeof data === 'string' ? data : `HTTP ${res.status}`)
    const message = Array.isArray(detail) ? detail.join('; ') : String(detail || `HTTP ${res.status}`)
    throw new OpenwaError(friendly(res.status, message), res.status, typeof err?.code === 'string' ? err.code : undefined)
  }
  return data as T
}

function friendly(status: number, raw: string): string {
  const s = String(raw || '')
  if (status === 401) return 'API key do OpenWA inválida ou ausente — copie a key do OpenWA (data/.api-key) para o JARVIS.'
  if (status === 403) return 'A API key do OpenWA não tem permissão para esta operação (use a key admin).'
  if (status === 404) return 'Sessão não encontrada no OpenWA — vincule de novo.'
  if (status === 400 && /not started|qr/i.test(s)) return 'A sessão não está iniciada ou o QR ainda não está pronto — aguarde alguns segundos e tente de novo.'
  return s || `Erro do OpenWA (HTTP ${status})`
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface OpenwaHealth { status: string; timestamp?: string; version?: string }

export async function health(timeoutMs = 4_000): Promise<OpenwaHealth> {
  return request<OpenwaHealth>('/api/health', { timeoutMs, auth: true })
}
export async function healthPublic(timeoutMs = 4_000): Promise<OpenwaHealth> {
  return request<OpenwaHealth>('/api/health', { timeoutMs, auth: false })
}

// ─── Sessões ──────────────────────────────────────────────────────────────────

export async function listSessions(name?: string): Promise<OpenwaSession[]> {
  const q = name ? `?name=${encodeURIComponent(name)}` : ''
  const out = await request<OpenwaSession[] | { data?: OpenwaSession[] }>(`/api/sessions${q}`)
  return Array.isArray(out) ? out : Array.isArray(out?.data) ? out.data : []
}

export async function findSessionByName(name: string): Promise<OpenwaSession | null> {
  const list = await listSessions(name)
  return list.find(s => s.name === name) || null
}

export async function getSession(id: string): Promise<OpenwaSession> {
  return request<OpenwaSession>(`/api/sessions/${encodeURIComponent(id)}`)
}

export async function createSession(name: string): Promise<OpenwaSession> {
  return request<OpenwaSession>('/api/sessions', { method: 'POST', body: { name } })
}

export async function startSession(id: string): Promise<OpenwaSession> {
  return request<OpenwaSession>(`/api/sessions/${encodeURIComponent(id)}/start`, { method: 'POST', timeoutMs: 60_000 })
}

export async function stopSession(id: string): Promise<OpenwaSession> {
  return request<OpenwaSession>(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', timeoutMs: 45_000 })
}

export async function logoutSession(id: string): Promise<OpenwaSession> {
  return request<OpenwaSession>(`/api/sessions/${encodeURIComponent(id)}/logout`, { method: 'POST', timeoutMs: 60_000 })
}

/** Garante a sessão com o nome configurado (cria se não existir). */
export async function ensureSession(name: string): Promise<OpenwaSession> {
  const existing = await findSessionByName(name).catch(() => null)
  if (existing) return existing
  try {
    return await createSession(name)
  } catch (e) {
    // 409 = alguém criou ao mesmo tempo; reler
    if (e instanceof OpenwaError && e.status === 409) {
      const again = await findSessionByName(name)
      if (again) return again
    }
    throw e
  }
}

// ─── QR ───────────────────────────────────────────────────────────────────────

export interface OpenwaQr { qrCode?: string; status?: string }

/** QR como PNG data URL (data:image/png;base64,...). 400 quando ainda não está pronto. */
export async function getQr(id: string): Promise<OpenwaQr> {
  return request<OpenwaQr>(`/api/sessions/${encodeURIComponent(id)}/qr`, { timeoutMs: 15_000 })
}

// ─── Envio ────────────────────────────────────────────────────────────────────

export interface OpenwaSendResult { ok: boolean; messageId?: string; error?: string }

export async function sendText(sessionId: string, chatId: string, text: string): Promise<OpenwaSendResult> {
  try {
    const out = await request<{ messageId?: string; id?: string; data?: { messageId?: string } }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
      method: 'POST',
      body: { chatId, text },
      timeoutMs: 45_000,
    })
    return { ok: true, messageId: out?.messageId || out?.data?.messageId || out?.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface OpenwaWebhook {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt?: string
}

export async function listWebhooks(sessionId: string): Promise<OpenwaWebhook[]> {
  const out = await request<OpenwaWebhook[] | { data?: OpenwaWebhook[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/webhooks`)
  return Array.isArray(out) ? out : Array.isArray(out?.data) ? out.data : []
}

export async function ensureWebhook(sessionId: string, url: string, events: string[], secret: string): Promise<{ created: boolean; id?: string }> {
  const existing = await listWebhooks(sessionId).catch(() => [] as OpenwaWebhook[])
  const found = existing.find(w => w.url === url)
  if (found) return { created: false, id: found.id }
  const created = await request<OpenwaWebhook>(`/api/sessions/${encodeURIComponent(sessionId)}/webhooks`, {
    method: 'POST',
    body: { url, events, secret, retryCount: 3 },
  })
  return { created: true, id: created?.id }
}
