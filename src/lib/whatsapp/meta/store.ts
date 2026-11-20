import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../../agents/fsutil'
import type {
  MetaConfig, MetaSecrets, WaAutomation, WaContact, WaConversation, WaMessage, WaNotification,
} from './types'

const BASE = () => path.join(dataDir(), 'whatsapp', 'meta')
const CONFIG_FILE = () => path.join(BASE(), 'config.json')
const SECRETS_FILE = () => path.join(BASE(), 'secrets.json')
const CONTACTS_FILE = () => path.join(BASE(), 'contacts.json')
const CONVERSATIONS_FILE = () => path.join(BASE(), 'conversations.json')
const MESSAGES_FILE = () => path.join(BASE(), 'messages.json')
const AUTOMATIONS_FILE = () => path.join(BASE(), 'automations.json')
const NOTIFICATIONS_FILE = () => path.join(BASE(), 'notifications.json')
const SEEN_FILE = () => path.join(BASE(), 'seen.json')
const EVENTS_FILE = () => path.join(BASE(), 'events.json')

function ensure() { fs.mkdirSync(BASE(), { recursive: true }) }

function readArr<T>(file: string): T[] {
  ensure()
  const v = readJson<unknown>(file, [])
  return Array.isArray(v) ? (v as T[]) : []
}
function writeArr<T>(file: string, v: T[]) { ensure(); writeJsonAtomic(file, v) }

export function readConfig(): MetaConfig {
  ensure()
  const c = readJson<Partial<MetaConfig> | null>(CONFIG_FILE(), null)
  return {
    apiVersion: 'v20.0',
    connected: false,
    ... (c || {}),
  }
}
export function writeConfig(patch: Partial<MetaConfig>): MetaConfig {
  ensure()
  const cur = readConfig()
  const next = { ...cur, ...patch }
  writeJsonAtomic(CONFIG_FILE(), next)
  return next
}

export function readSecrets(): MetaSecrets {
  ensure()
  return readJson<MetaSecrets | null>(SECRETS_FILE(), {}) || {}
}
export function writeSecrets(patch: Partial<MetaSecrets>): MetaSecrets {
  ensure()
  const cur = readSecrets()
  const next = { ...cur, ...patch }
  // remove undefined
  for (const k of Object.keys(next) as (keyof MetaSecrets)[]) {
    if (next[k] === undefined) delete next[k]
  }
  writeJsonAtomic(SECRETS_FILE(), next)
  return next
}
export function clearSecrets() {
  ensure()
  try { fs.rmSync(SECRETS_FILE(), { force: true }) } catch {}
}

// Contacts
export function listContacts(): WaContact[] { return readArr< WaContact>(CONTACTS_FILE()) }
export function getContact(id: string): WaContact | undefined { return listContacts().find(c => c.id === id || c.waId === id) }
export function upsertContact(c: Partial<WaContact> & { waId: string }): WaContact {
  const all = listContacts()
  const now = Date.now()
  const id = c.id || c.waId
  const idx = all.findIndex(x => x.id === id || x.waId === c.waId)
  const base: WaContact = idx >= 0 ? all[idx] : {
    id, waId: c.waId, createdAt: now, updatedAt: now,
  }
  const next: WaContact = {
    ...base,
    ...c,
    id,
    waId: c.waId,
    updatedAt: now,
    createdAt: base.createdAt || now,
  }
  if (idx >= 0) all[idx] = next; else all.unshift(next)
  writeArr(CONTACTS_FILE(), all)
  return next
}

// Conversations
export function listConversations(): WaConversation[] { return readArr<WaConversation>(CONVERSATIONS_FILE()) }
export function getConversation(id: string): WaConversation | undefined { return listConversations().find(c => c.id === id) }
export function upsertConversation(conv: Partial<WaConversation> & { id: string }): WaConversation {
  const all = listConversations()
  const now = Date.now()
  const idx = all.findIndex(x => x.id === conv.id)
  const base: WaConversation = idx >= 0 ? all[idx] : {
    id: conv.id, unread: 0, messages: [], lastMessageAt: now,
  }
  const next: WaConversation = {
    ...base,
    ...conv,
    id: conv.id,
    messages: conv.messages ?? base.messages ?? [],
    unread: conv.unread ?? base.unread ?? 0,
    lastMessageAt: conv.lastMessageAt ?? base.lastMessageAt ?? now,
  }
  if (idx >= 0) all[idx] = next; else all.unshift(next)
  // keep sorted by lastMessageAt desc
  all.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  writeArr(CONVERSATIONS_FILE(), all)
  return next
}

// Messages
export function listMessages(convId?: string): WaMessage[] {
  const all = readArr<WaMessage>(MESSAGES_FILE())
  return convId ? all.filter(m => m.conversationId === convId) : all
}
export function getMessage(id: string): WaMessage | undefined {
  return readArr<WaMessage>(MESSAGES_FILE()).find(m => m.id === id)
}
export function appendMessage(m: WaMessage): WaMessage {
  const all = readArr<WaMessage>(MESSAGES_FILE())
  if (all.some(x => x.id === m.id)) {
    // update existing (status changes)
    const idx = all.findIndex(x => x.id === m.id)
    all[idx] = { ...all[idx], ...m }
  } else {
    all.push(m)
  }
  // cap to last 5000
  if (all.length > 5000) all.splice(0, all.length - 5000)
  writeArr(MESSAGES_FILE(), all)
  return m
}
export function updateMessageStatus(id: string, status: WaMessage['status']) {
  const all = readArr<WaMessage>(MESSAGES_FILE())
  const idx = all.findIndex(x => x.id === id)
  if (idx >= 0) {
    all[idx].status = status
    all[idx].statusUpdatedAt = Date.now()
    writeArr(MESSAGES_FILE(), all)
  }
}

// Automations
export function listAutomations(): WaAutomation[] { return readArr<WaAutomation>(AUTOMATIONS_FILE()) }
export function saveAutomations(list: WaAutomation[]) { writeArr(AUTOMATIONS_FILE(), list) }
export function upsertAutomation(a: WaAutomation) {
  const all = listAutomations()
  const idx = all.findIndex(x => x.id === a.id)
  if (idx >= 0) all[idx] = a; else all.push(a)
  saveAutomations(all)
  return a
}
export function deleteAutomation(id: string) {
  saveAutomations(listAutomations().filter(a => a.id !== id))
}

// Notifications
export function listNotifications(): WaNotification[] { return readArr<WaNotification>(NOTIFICATIONS_FILE()) }
export function addNotification(n: WaNotification) {
  const all = listNotifications()
  all.unshift(n)
  if (all.length > 200) all.splice(200)
  writeArr(NOTIFICATIONS_FILE(), all)
}
export function markNotificationRead(id: string) {
  const all = listNotifications()
  const n = all.find(x => x.id === id)
  if (n) { n.read = true; writeArr(NOTIFICATIONS_FILE(), all) }
}
export function unreadNotificationCount() { return listNotifications().filter(n => !n.read).length }

// Seen ids (dedup)
export function isSeen(id: string): boolean {
  ensure()
  const seen = readJson<string[]>(SEEN_FILE(), [])
  return seen.includes(id)
}
export function markSeen(id: string) {
  ensure()
  const seen = readJson<string[]>(SEEN_FILE(), [])
  if (!seen.includes(id)) {
    seen.push(id)
    if (seen.length > 10000) seen.splice(0, seen.length - 10000)
    writeJsonAtomic(SEEN_FILE(), seen)
  }
}

// Events log
export function logEvent(e: { id: string; type: string; payload: unknown; processed?: boolean; error?: string }) {
  ensure()
  const all = readArr<{ id: string; receivedAt: number; type: string; payload: unknown; processed: boolean; error?: string }>(EVENTS_FILE())
  all.unshift({ id: e.id, receivedAt: Date.now(), type: e.type, payload: e.payload, processed: e.processed ?? false, error: e.error })
  if (all.length > 500) all.splice(500)
  writeArr(EVENTS_FILE(), all)
}
export function listEvents(limit = 100) { return readArr(EVENTS_FILE()).slice(0, limit) }