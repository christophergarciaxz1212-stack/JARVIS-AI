/**
 * Ponte AO VIVO com o WhatsApp, via protocolo Web multi-device (Baileys).
 * Estado vive em globalThis para sobreviver ao ciclo de vida das rotas do Next.
 *
 * Leia isto antes de usar:
 *  - A API OFICIAL do WhatsApp não permite ler conversas pessoais. Este modo usa o
 *    protocolo do WhatsApp Web (mesmo que o site), o que NÃO é sancionado pela Meta —
 *    pode resultar em limitação/historicamente ban da conta.
 *  - Use apenas para ler os grupos da SUA faculdade e com ciência de quem participa
 *    (mensagens de colegas são dados pessoais de terceiros — LGPD).
 *  - O JARVIS nunca envia nada por você: qualquer resposta fica no modo de aprovação.
 *  - O modo RECOMENDADO segue sendo o de sempre: Exportar conversa + importar arquivo.
 */
import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import type { HubItem } from '../hub/types'

const AUTH_DIR = () => path.join(dataDir(), 'whatsapp', 'auth')
const GROUPS_FILE = () => path.join(dataDir(), 'whatsapp', 'groups.json')
const META_FILE = () => path.join(dataDir(), 'whatsapp', 'live.json')

export type LiveStatus = 'disconnected' | 'pairing' | 'connected' | 'error'

export interface LiveChat { jid: string; name: string; participants: number; academic: boolean; suggested: boolean }
export interface LiveStats { received: number; ingested: number; skipped: number }

interface LiveState {
  status: LiveStatus
  qr?: string // data URI PNG
  error?: string
  me?: string
  chats: LiveChat[]
  stats: LiveStats
  academicJids: string[]
  startedAt?: number
  sock?: unknown
  reconnectDelay: number
  reconnectTimer?: NodeJS.Timeout
  flushTimer?: NodeJS.Timeout
  pendingCount: number
}

const g = globalThis as unknown as { __jarvisWhatsAppLive?: LiveState }
const state = (): LiveState => (g.__jarvisWhatsAppLive ||= {
  status: 'disconnected', chats: [], stats: { received: 0, ingested: 0, skipped: 0 },
  academicJids: [], reconnectDelay: 1_000, pendingCount: 0,
})

// ─── Configuração persistida (espelho mínimo do connection config) ──────────────

function persistMeta() {
  try {
    const s = state()
    fs.mkdirSync(path.dirname(META_FILE()), { recursive: true })
    writeJsonAtomic(META_FILE(), { academicJids: s.academicJids })
  } catch {}
}
function loadPersisted() {
  try {
    const meta = readJson<{ academicJids?: string[] } | null>(META_FILE(), null)
    if (meta?.academicJids?.length) state().academicJids = meta.academicJids
  } catch {}
}
loadPersisted()

// ─── Classificação de conteúdo acadêmico (proxy: só grupos marcados pelo usuário + palavras-chave) ──

const ACADEMIC_HINTS = /\b(entregar|entrega|prova|provas|trabalho|trabalhos|atividade|atividades|prazo|professor|professora|disciplina|matéria|faculdade|aula|aulas|nota|notas|falta|faltas|frequência|semestre|teams|whatsapp|portal|estudar|revisão|turma|n1|n2|av1|av2|np1|np2|seminário|artigo|relatório|projeto integrador|banca|defesa|substituição|substituto|monitoria)\b/i

const SUBJECT_TI_HINTS = /\b(algoritmos?|estrutura de dados|banco( de dados)?|redes|sistemas?|programação|operações? de ti|gestão|engenharia|computação|software|ia|cloud|devops|segurança|estatística|cálculo|portfólio|currículo|estágio)\b/i

/** Heurística leve: texto parece ser sobre a vida acadêmica (usado só para DESCUBRIR chats e para pré-filtrar). */
export function looksAcademic(text: string): boolean {
  return ACADEMIC_HINTS.test(text) || SUBJECT_TI_HINTS.test(text)
}

// ─── Conversões ─────────────────────────────────────────────────────────────────

export interface ConvertedMessage {
  key: string
  at: number
  author: string
  text: string
}

/** Extrai o texto útil de qualquer variante de mensagem do Baileys. */
export function extractMessageText(message: Record<string, unknown> | undefined | null): string {
  if (!message) return ''
  const msg = message as Record<string, unknown>
  const conversation = typeof msg.conversation === 'string' ? msg.conversation : undefined
  if (conversation) return conversation
  const ext = msg.extendedTextMessage as { text?: unknown } | undefined
  if (typeof ext?.text === 'string') return ext.text
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'] as const) {
    const media = msg[key] as { caption?: unknown } | undefined
    if (typeof media?.caption === 'string' && media.caption) return media.caption
  }
  const reaction = msg.reactionMessage as { text?: unknown } | undefined
  if (typeof reaction?.text === 'string' && reaction.text) return reaction.text
  return ''
}

export function messageToItem(msg: { key: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; participant?: string | null }; messageTimestamp?: unknown; key2?: never; message?: Record<string, unknown> | null; pushName?: string | null }, chatName: string): ConvertedMessage | null {
  const text = extractMessageText(msg.message)
  if (!text.trim()) return null
  const rawTs = msg.messageTimestamp
  const ts = typeof rawTs === 'number' ? rawTs * 1000 : typeof rawTs === 'object' && rawTs !== null && 'toNumber' in rawTs
    ? Number((rawTs as { toNumber: () => number }).toNumber()) * 1000
    : Number(rawTs) * 1000 || Date.now()
  const remoteJid = msg.key?.remoteJid || 'desconhecido'
  return {
    key: `wa:${remoteJid}:${msg.key?.id || `${ts}-${Math.random().toString(36).slice(2)}`}`,
    at: ts,
    author: String(msg.pushName || (msg.key?.participant ? jidToPhone(msg.key.participant) : 'WhatsApp')).trim(),
    text: text.trim(),
  }
}

export function toHubItem(conv: ConvertedMessage, chatName: string, index: number): HubItem {
  return {
    id: conv.key,
    source: 'whatsapp',
    kind: 'message',
    title: conv.text.replace(/\s+/g, ' ').slice(0, 140),
    text: conv.text,
    origin: { source: 'whatsapp', where: chatName, author: conv.author, at: conv.at, ref: `WhatsApp ao vivo · ${conv.key.split(':').pop()}` },
    importedAt: Date.now(),
  }
}

const jidToPhone = (jid: string) => jid.split('@')[0].split(':')[0].replace(/\D/g, '')
const jidIsGroup = (jid: string) => jid.endsWith('@g.us')
const jidIsUser = (jid: string) => /@(s\.whatsapp\.net|lid)$/.test(jid)

// ─── Conexão/Socket ──────────────────────────────────────────────────────────

async function renderQr(text: string): Promise<string> {
  try {
    const QRCode = (await import('qrcode')).default
    return await QRCode.toDataURL(text, { margin: 1, width: 240, color: { dark: '#0b1520', light: '#ffffff' } })
  } catch {
    return '' // Se o QR não renderizar, a UI mostra a instrução manual
  }
}

function flushPending() {
  const s = state()
  if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = undefined }
  const bag = ((s as unknown as { _pending?: HubItem[] })._pending ||= [])
  const batch = [...bag]
  bag.length = 0
  s.pendingCount = 0
  if (!batch.length) return
  void import('../hub/hub')
    .then(m => m.ingestLiveWhatsApp(batch))
    .then(r => { const s2 = state(); s2.stats.ingested += r.added })
    .catch(e => console.error('[whatsapp] ingest error', (e as Error).message))
}
function scheduleFlush() {
  const s = state()
  if (!s.flushTimer) {
    s.flushTimer = setTimeout(() => { s.flushTimer = undefined; flushPending() }, 45_000)
  }
}
function pendingBag(): HubItem[] {
  const s = state()
  return ((s as unknown as { _pending?: HubItem[] })._pending ||= [])
}
function enqueue(item: HubItem) {
  const bag = pendingBag()
  bag.push(item)
  state().pendingCount = bag.length
  if (bag.length >= 8) flushPending()
  else scheduleFlush()
}

export async function waStatus() {
  loadPersisted()
  const s = state()
  if (s.status === 'disconnected' && fs.existsSync(path.join(AUTH_DIR(), 'creds.json'))) await waStart().catch(() => {})
  return {
    status: s.status,
    qr: s.qr,
    error: s.error,
    me: s.me,
    chats: s.chats,
    stats: s.stats,
    academicJids: s.academicJids,
    startedAt: s.startedAt,
  }
}

export async function waStart(): Promise<{ status: LiveStatus }> {
  const s = state()
  if (s.status === 'connected' || s.status === 'pairing') return { status: s.status }
  try {
    const b = (await import('baileys')) as unknown as {
      makeWASocket: (o: Record<string, unknown>) => {
        ev: { on: (event: string, fn: (...args: never[]) => void) => void }
        groupFetchAllParticipating: () => Promise<Record<string, { subject?: string; participants?: unknown[] }>>
        end: (error?: unknown) => void
        ws?: { close: () => void }
      }
      useMultiFileAuthState: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
      fetchLatestBaileysVersion: () => Promise<{ version: unknown }>
      Browsers: { macOS: (name: string) => [string, string, string] }
    }
    fs.mkdirSync(AUTH_DIR(), { recursive: true })
    const { state: authState, saveCreds } = await b.useMultiFileAuthState(AUTH_DIR())
    const { version } = await b.fetchLatestBaileysVersion()
    const sock = b.makeWASocket({
      version,
      auth: authState,
      browser: b.Browsers.macOS('JARVIS'),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      logger: makeSilentLogger() as never,
    })

    s.sock = sock
    s.status = 'pairing'
    s.error = undefined
    s.startedAt = Date.now()

    sock.ev.on('connection.update', (update: unknown) => {
      const u = update as { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } }
      if (u.qr) {
        void renderQr(u.qr).then(dataUri => {
          const cur = state()
          cur.qr = dataUri
          cur.status = 'pairing'
        })
      }
      if (u.connection === 'open') {
        const cur = state()
        cur.status = 'connected'
        cur.qr = undefined
        cur.reconnectDelay = 1_000
        // Baileys expõe o JID conectado em sock.user
        const sockUser = (sock as unknown as { user?: { id?: string } }).user?.id
        cur.me = sockUser ? jidToPhone(sockUser) : undefined
        // Grupo do usuário: descobrir grupos do WhatsApp para ele escolher quais são da faculdade
        void sock.groupFetchAllParticipating().then(groups => {
          const cur2 = state()
          cur2.chats = Object.entries(groups || {}).map(([jid, meta]) => {
            const name = String(meta?.subject || 'Grupo sem nome').slice(0, 80)
            return {
              jid,
              name,
              participants: Array.isArray(meta?.participants) ? meta.participants.length : 0,
              academic: cur2.academicJids.includes(jid),
              suggested: looksAcademic(name),
            }
          }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          try { fs.mkdirSync(path.dirname(GROUPS_FILE()), { recursive: true }); writeJsonAtomic(GROUPS_FILE(), cur2.chats) } catch {}
        }).catch(() => {})
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode
        const cur = state()
        if (code === 401 || code === 440 || code === 411) {
          // Logout real: apaga a sessão para exigir novo pareamento
          cur.status = 'error'
          cur.error = 'Sessão expirada — clique em Conectar e pareie de novo.'
          try { fs.rmSync(AUTH_DIR(), { recursive: true, force: true }) } catch {}
          return
        }
        cur.status = 'error'
        cur.error = `Conexão caiu (código ${code ?? 'desconhecido'}). Tentando reconectar…`
        if (cur.reconnectTimer) clearTimeout(cur.reconnectTimer)
        cur.reconnectTimer = setTimeout(() => {
          const cur2 = state()
          if (cur2.status !== 'connected') void waStart().catch(() => {})
        }, cur.reconnectDelay)
        cur.reconnectDelay = Math.min(cur.reconnectDelay * 2, 60_000)
      }
    })

    sock.ev.on('creds.update', () => { void saveCreds().catch(() => {}) })

    sock.ev.on('messages.upsert', (upsert: unknown) => {
      const cur = state()
      const payload = upsert as { messages: Array<{ key: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; participant?: string | null }; messageTimestamp?: unknown; message?: Record<string, unknown> | null; pushName?: string | null }>; type: string }
      if (cur.status !== 'connected') return
      // Só mensagens novas em tempo real (histórico vem pelo sync, não interessa ao vivo)
      if (payload.type !== 'notify') return
      for (const msg of payload.messages || []) {
        if (msg.key?.fromMe) continue
        const jid = msg.key?.remoteJid || ''
        const isGroupChat = jidIsGroup(jid)
        if (!isGroupChat && !jidIsUser(jid)) continue
        // Só ingere nos chats que o usuário marcou como acadêmicos
        if (!cur.academicJids.includes(jid)) { cur.stats.skipped++; continue }
        const conv = messageToItem(msg, cur.chats.find(c => c.jid === jid)?.name || jid.split('@')[0])
        if (!conv) { cur.stats.skipped++; continue }
        const chatName = cur.chats.find(c => c.jid === jid)?.name || jid.split('@')[0]
        enqueue(toHubItem(conv, chatName, cur.stats.ingested + cur.stats.skipped))
        cur.stats.received++
      }
    })
    return { status: 'pairing' }
  } catch (e) {
    const s = state()
    s.status = 'error'
    s.error = (e as Error).message || String(e)
    return { status: 'error' }
  }
}

function makeSilentLogger() {
  const noop = () => {}
  const logger = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => logger }
  return logger
}

export async function waStop(eraseAuth = false) {
  const s = state()
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
  if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = undefined }
  try {
    const sock = s.sock as { end?: (e?: unknown) => void; ws?: { close?: () => void } } | undefined
    try { sock?.end?.() } catch {}
    try { sock?.ws?.close?.() } catch {}
  } catch {}
  s.sock = undefined
  s.status = 'disconnected'
  s.qr = undefined
  s.startedAt = undefined
  if (eraseAuth) { try { fs.rmSync(AUTH_DIR(), { recursive: true, force: true }) } catch {} }
  return { status: 'disconnected' }
}

/** Rebusca os grupos do WhatsApp (conectado) e devolve a lista atual. */
export async function waDiscover(): Promise<LiveChat[]> {
  const s = state()
  if (s.status !== 'connected') throw new Error('WhatsApp não está conectado')
  const sock = s.sock as { groupFetchAllParticipating?: () => Promise<Record<string, { subject?: string; participants?: unknown[] }>> } | undefined
  if (!sock?.groupFetchAllParticipating) throw new Error('A conexão não expõe busca de grupos nesta versão')
  const groups = await sock.groupFetchAllParticipating()
  const chats = Object.entries(groups || {}).map(([jid, meta]) => {
    const name = String(meta?.subject || 'Grupo sem nome').slice(0, 80)
    return {
      jid,
      name,
      participants: Array.isArray(meta?.participants) ? meta.participants.length : 0,
      academic: s.academicJids.includes(jid),
      suggested: looksAcademic(name),
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  s.chats = chats
  try { fs.mkdirSync(path.dirname(GROUPS_FILE()), { recursive: true }); writeJsonAtomic(GROUPS_FILE(), chats) } catch {}
  return chats
}

export function waSetAcademic(jid: string, academic: boolean): string[] {
  const s = state()
  const set = new Set(s.academicJids)
  if (academic) set.add(jid); else set.delete(jid)
  s.academicJids = [...set]
  s.chats = s.chats.map(c => (c.jid === jid ? { ...c, academic } : c))
  persistMeta()
  return s.academicJids
}

export function waSetAcademicAll(jids: string[]): string[] {
  const s = state()
  s.academicJids = [...new Set(jids)]
  s.chats = s.chats.map(c => ({ ...c, academic: s.academicJids.includes(c.jid) }))
  persistMeta()
  return s.academicJids
}
