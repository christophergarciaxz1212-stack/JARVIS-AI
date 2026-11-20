/**
 * JARVIS — WhatsApp Cloud API — armazenamento local persistente.
 * Conversas, mensagens, contatos, pendências e log operacional.
 * JSONL para log; arquivos por conversa (cap 500 msgs) para mensagens.
 * NUNCA guarda tokens — eles ficam em keys.json.
 */
import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

const ROOT = () => path.join(dataDir(), 'whatsapp-meta')
const CONV_FILE = () => path.join(ROOT(), 'conversations.json')
const CONTACTS_FILE = () => path.join(ROOT(), 'contacts.json')
const PENDING_FILE = () => path.join(ROOT(), 'pending.json')
const WAMID_FILE = () => path.join(ROOT(), 'wamids.json')
const WAMID_INDEX = () => path.join(ROOT(), 'wamid-index.json')
const REMINDERS_FILE = () => path.join(ROOT(), 'reminders.json')
const LOG_FILE = () => path.join(ROOT(), 'operations.jsonl')
const msgFile = (phone: string) => path.join(ROOT(), 'messages', `${String(phone).replace(/\D/g, '')}.json`)

export type WaMessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker' | 'reaction' | 'contacts' | 'template' | 'interactive' | 'order' | 'unknown'
export type WaMessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface WaMessage {
  id: string // = wamid quando vindo da Meta; senão id local
  wamid?: string
  phone: string
  direction: 'in' | 'out'
  type: WaMessageType
  text: string
  mediaId?: string
  mediaMime?: string
  mediaName?: string
  at: number
  status?: WaMessageStatus
  errorCode?: string
  contextWamid?: string
}

export interface WaConversation {
  phone: string
  name?: string
  lastText: string
  lastAt: number
  lastInboundAt?: number
  lastOutboundAt?: number
  unread: number
  important: boolean
  starred: boolean
  lastWamid?: string
}

export interface WaContact {
  phone: string
  name?: string
  alias?: string
  tags: string[]
  notes: string
  category?: string
  starred: boolean
}

export interface WaReminder { id: string; phone: string; text: string; at?: number; createdAt: number; done: boolean }

const MAX_MESSAGES = 500
const MAX_WAMIDS = 4000

function ensureDirs() { fs.mkdirSync(path.join(ROOT(), 'messages'), { recursive: true }) }

export function logWa(event: string, detail: Record<string, unknown>) {
  try {
    ensureDirs()
    fs.appendFileSync(LOG_FILE(), JSON.stringify({ ts: Date.now(), event, detail: redact(detail) }) + '\n')
  } catch {}
}

/** Nunca registrar tokens/chaves em log. */
function redact(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    out[k] = /token|secret|key|password/i.test(k) ? '••••' : v
  }
  return out
}

// ─── Conversas ───────────────────────────────────────────────────────────────

export function listConversations(): WaConversation[] {
  const all = readJson<Record<string, WaConversation>>(CONV_FILE(), {}) || {}
  return Object.values(all).sort((a, b) => b.lastAt - a.lastAt)
}

export function getConversation(phone: string): WaConversation | undefined {
  const all = readJson<Record<string, WaConversation>>(CONV_FILE(), {}) || {}
  return all[normalizePhone(phone)]
}

export function upsertConversation(phone: string, patch: Partial<WaConversation>): WaConversation {
  const p = normalizePhone(phone)
  const all = readJson<Record<string, WaConversation>>(CONV_FILE(), {}) || {}
  const cur = all[p] || { phone: p, lastText: '', lastAt: 0, unread: 0, important: false, starred: false }
  const next: WaConversation = { ...cur, ...patch, phone: p }
  all[p] = next
  ensureDirs()
  writeJsonAtomic(CONV_FILE(), all)
  return next
}

export function markConversationRead(phone: string) {
  const all = readJson<Record<string, WaConversation>>(CONV_FILE(), {}) || {}
  const p = normalizePhone(phone)
  if (all[p]) { all[p].unread = 0; writeJsonAtomic(CONV_FILE(), all) }
}

export function setConversationFlags(phone: string, patch: Pick<Partial<WaConversation>, 'important' | 'starred'>) {
  const all = readJson<Record<string, WaConversation>>(CONV_FILE(), {}) || {}
  const p = normalizePhone(phone)
  if (all[p]) { Object.assign(all[p], patch); writeJsonAtomic(CONV_FILE(), all) }
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

export function getMessages(phone: string): WaMessage[] {
  return readJson<WaMessage[]>(msgFile(phone), []) || []
}

export function appendMessage(msg: WaMessage): { inserted: boolean } {
  const p = normalizePhone(msg.phone)
  ensureDirs()
  // Dedup por wamid (Meta reenvia webhooks)
  if (msg.wamid && isProcessedWamid(msg.wamid)) return { inserted: false }
  const file = msgFile(p)
  const list = readJson<WaMessage[]>(file, []) || []
  if (msg.wamid && list.some(m => m.wamid === msg.wamid)) return { inserted: false }
  list.push({ ...msg, phone: p })
  const trimmed = list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list
  writeJsonAtomic(file, trimmed)
  if (msg.wamid) { rememberWamid(msg.wamid); indexWamid(msg.wamid, p) }
  return { inserted: true }
}

export function updateMessageStatus(wamid: string, status: WaMessageStatus, errorCode?: string): boolean {
  const phone = getWamidPhone(wamid)
  if (!phone) return false
  const file = msgFile(phone)
  const list = readJson<WaMessage[]>(file, []) || []
  const idx = list.findIndex(m => m.wamid === wamid)
  if (idx < 0) return false
  list[idx] = { ...list[idx], status, ...(errorCode ? { errorCode } : {}) }
  writeJsonAtomic(file, list)
  return true
}

export function getLastInboundAt(phone: string): number | undefined {
  const conv = getConversation(phone)
  return conv?.lastInboundAt
}

/** Janela de atendimento Meta: 24h após a última mensagem recebida. */
export function isInsideWindow(phone: string, now = Date.now()): boolean {
  const last = getLastInboundAt(phone)
  return !!last && now - last < 24 * 60 * 60 * 1000
}

export function windowExpiresAt(phone: string): number | undefined {
  const last = getLastInboundAt(phone)
  return last ? last + 24 * 60 * 60 * 1000 : undefined
}

// ─── Dedup de wamids ─────────────────────────────────────────────────────────

export function isProcessedWamid(wamid: string): boolean {
  const all = readJson<string[]>(WAMID_FILE(), []) || []
  return all.includes(wamid)
}

function rememberWamid(wamid: string) {
  const all = readJson<string[]>(WAMID_FILE(), []) || []
  if (all.includes(wamid)) return
  all.push(wamid)
  writeJsonAtomic(WAMID_FILE(), all.slice(-MAX_WAMIDS))
}

function indexWamid(wamid: string, phone: string) {
  const all = readJson<Record<string, string>>(WAMID_INDEX(), {}) || {}
  all[wamid] = phone
  const keys = Object.keys(all)
  if (keys.length > MAX_WAMIDS) {
    const keep = new Set(keys.slice(-MAX_WAMIDS))
    for (const k of keys) if (!keep.has(k)) delete all[k]
  }
  writeJsonAtomic(WAMID_INDEX(), all)
}

function getWamidPhone(wamid: string): string | undefined {
  const all = readJson<Record<string, string>>(WAMID_INDEX(), {}) || {}
  return all[wamid]
}

// ─── Contatos ────────────────────────────────────────────────────────────────

export function listContacts(): WaContact[] {
  const all = readJson<Record<string, WaContact>>(CONTACTS_FILE(), {}) || {}
  return Object.values(all).sort((a, b) => (displayName(a)).localeCompare(displayName(b), 'pt-BR'))
}

export function getContact(phone: string): WaContact | undefined {
  const all = readJson<Record<string, WaContact>>(CONTACTS_FILE(), {}) || {}
  return all[normalizePhone(phone)]
}

export function upsertContact(phone: string, patch: Partial<Omit<WaContact, 'phone'>>): WaContact {
  const p = normalizePhone(phone)
  const all = readJson<Record<string, WaContact>>(CONTACTS_FILE(), {}) || {}
  const cur = all[p] || { phone: p, tags: [], notes: '', starred: false }
  const next: WaContact = { ...cur, ...patch, phone: p, tags: patch.tags ?? cur.tags }
  all[p] = next
  ensureDirs()
  writeJsonAtomic(CONTACTS_FILE(), all)
  return next
}

export function searchContacts(query: string): WaContact[] {
  const q = query.trim().toLowerCase()
  const digits = query.replace(/\D/g, '')
  return listContacts().filter(c =>
    (c.alias || c.name || '').toLowerCase().includes(q) ||
    c.phone.includes(digits && digits.length >= 3 ? digits : q) ||
    c.tags.join(' ').toLowerCase().includes(q) ||
    c.notes.toLowerCase().includes(q)
  )
}

export function displayName(c: Pick<WaContact, 'alias' | 'name' | 'phone'>): string {
  return (c.alias || c.name || formatPhone(c.phone)).trim()
}

/** Resolve por apelido/nome (correspondência parcial, case-insensitive). */
export function resolveContactByName(name: string): { match?: WaContact; candidates: WaContact[] } {
  const q = name.trim().toLowerCase()
  const all = listContacts()
  const scored = all
    .map(c => ({ c, score: scoreName(c, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
  const candidates = scored.map(x => x.c)
  const match = candidates.length === 1 ? candidates[0] : undefined
  return { match, candidates: candidates.slice(0, 5) }
}

function scoreName(c: WaContact, q: string): number {
  const alias = (c.alias || '').toLowerCase()
  const name = (c.name || '').toLowerCase()
  if (alias === q || name === q) return 100
  if (alias.startsWith(q) || name.startsWith(q)) return 60
  if (alias.includes(q) || name.includes(q)) return 30
  return 0
}

// ─── Pendências (confirmação de envio pelo chat) ─────────────────────────────

export interface WaPendingAction {
  action: 'send'
  to: string
  toName: string
  text: string
  createdAt: number
}

export function getPending(): WaPendingAction | null { return readJson<WaPendingAction | null>(PENDING_FILE(), null) }
export function setPending(p: WaPendingAction) { writeJsonAtomic(PENDING_FILE(), p) }
export function clearPending() { try { fs.rmSync(PENDING_FILE(), { force: true }) } catch {} }

// ─── Lembretes (a partir de mensagens) ───────────────────────────────────────

export function listReminders(): WaReminder[] {
  return (readJson<WaReminder[]>(REMINDERS_FILE(), []) || []).sort((a, b) => (b.done === a.done ? b.createdAt - a.createdAt : a.done ? -1 : 1))
}

export function addReminder(phone: string, text: string, at?: number): WaReminder {
  const list = readJson<WaReminder[]>(REMINDERS_FILE(), []) || []
  const reminder: WaReminder = { id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, phone: normalizePhone(phone), text, at, createdAt: Date.now(), done: false }
  list.push(reminder)
  writeJsonAtomic(REMINDERS_FILE(), list)
  return reminder
}

export function setReminderDone(id: string) {
  const list = readJson<WaReminder[]>(REMINDERS_FILE(), []) || []
  const i = list.findIndex(r => r.id === id)
  if (i >= 0) { list[i].done = true; writeJsonAtomic(REMINDERS_FILE(), list) }
}

// ─── Util ────────────────────────────────────────────────────────────────────

export function normalizePhone(phone: string): string { return String(phone || '').replace(/\D/g, '') }

export function formatPhone(phone: string): string {
  const d = normalizePhone(phone)
  if (d.length === 13 && d.startsWith('55')) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`
  return d ? `+${d}` : phone
}

export function ssePreview(text: string, max = 120): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
