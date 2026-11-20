/**
 * JARVIS — OpenWA: registro das últimas mensagens/eventos recebidos via webhook.
 * NDJSON em data/openwa/events.ndjson, limitado (~500 eventos recentes).
 */
import fs from 'fs'
import path from 'path'
import { dataDir } from '../agents/fsutil'

export interface OpenwaStoredEvent {
  at: number
  event: string
  sessionId?: string
  from?: string
  fromMe?: boolean
  chatId?: string
  chatName?: string
  body?: string
  messageId?: string
}

const EVENTS_FILE = () => path.join(dataDir(), 'openwa', 'events.ndjson')
const MAX_BYTES = 512 * 1024
const KEEP_LINES = 400

export function recordOpenwaEvent(evt: OpenwaStoredEvent) {
  try {
    fs.mkdirSync(path.dirname(EVENTS_FILE()), { recursive: true })
    fs.appendFileSync(EVENTS_FILE(), JSON.stringify(evt) + '\n', 'utf-8')
    // Cap ocasional: se cresceu demais, manter só as últimas KEEP_LINES linhas
    const size = fs.statSync(EVENTS_FILE()).size
    if (size > MAX_BYTES) {
      const lines = fs.readFileSync(EVENTS_FILE(), 'utf-8').split('\n').filter(Boolean)
      fs.writeFileSync(EVENTS_FILE(), lines.slice(-KEEP_LINES).join('\n') + '\n', 'utf-8')
    }
  } catch { /* nunca quebrar o webhook por causa de disco */ }
}

export function listOpenwaEvents(limit = 20): OpenwaStoredEvent[] {
  try {
    const raw = fs.readFileSync(EVENTS_FILE(), 'utf-8')
    const out: OpenwaStoredEvent[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line) as OpenwaStoredEvent) } catch {}
    }
    return out.slice(-Math.max(1, Math.min(limit, 100))).reverse()
  } catch {
    return []
  }
}

export function openwaEventStats() {
  const events = listOpenwaEvents(500)
  return {
    total: events.length,
    received: events.filter(e => e.event === 'message.received').length,
    lastAt: events[0]?.at,
  }
}
