import path from 'path'
import fs from 'fs'
import { dataDir, writeJsonAtomic } from './agents/fsutil'
import type { SessionKind, SessionStatus } from './agents/types'

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface ConversationRow {
  id: string; title: string; model: string; created_at: number; updated_at: number; metadata: string
  // Session fields; absent on conversations saved before sessions existed
  project_id?: string
  kind?: SessionKind
  status?: SessionStatus
  archived?: boolean
  team_id?: string
}

export const DEFAULT_PROJECT_ID = 'geral'
export interface MessageRow {
  id: string; conversation_id: string; role: string; content: string; created_at: number; model: string | null; tokens: number | null
}
export interface MemoryRow { id: string; type: string; content: string; tags: string; created_at: number; updated_at: number; relevance: number }
export interface SkillRow { id: string; name: string; description: string; source: string; content: string; enabled: number; created_at: number; tags: string }

// ─── Storage ─────────────────────────────────────────────────────────────────

type Store = {
  conversations: ConversationRow[]
  messages: MessageRow[]
  memory: MemoryRow[]
  skills: SkillRow[]
}

const storePath = () => path.join(dataDir(), 'store.json')

// Each API route can hold its own copy of this module, so the cache is keyed on the
// file's mtime: a write from any route invalidates every other route's copy.
let cached: { file: string; mtimeMs: number; store: Store } | null = null

function readStore(): Store {
  const file = storePath()
  try {
    const { mtimeMs } = fs.statSync(file)
    if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return structuredClone(cached.store)
    const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as Store
    cached = { file, mtimeMs, store }
    return structuredClone(store)
  } catch (err) {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { conversations: [], messages: [], memory: [], skills: [] }
    }
    if ((err as NodeJS.ErrnoException).name === 'SyntaxError' || (err as Error).message?.includes('JSON')) {
      // Corrupt file: quarantine it instead of silently "starting empty" and wiping everything on the next write
      const quarantine = `${file}.corrupt-${Date.now()}`
      try { fs.renameSync(file, quarantine) } catch {}
      throw new Error(`O banco de dados (store.json) está corrompido — movido para ${path.basename(quarantine)}. Nenhum dado foi apagado.`)
    }
    throw err
  }
}

function writeStore(store: Store): void {
  const file = storePath()
  writeJsonAtomic(file, store)
  cached = { file, mtimeMs: fs.statSync(file).mtimeMs, store: structuredClone(store) }
}

/**
 * Mutação atômica (leitura + mutação + gravação no mesmo tick). Devolve o que o
 * mutador devolve. Todas as mutações públicas do banco usam isto: rotas do
 * Next rodam intercaladas num mesmo processo, e ler-antes/gravar-depois-de-await
 * era perda de atualizações concorrentes.
 */
function readModifyWrite<T>(mutate: (store: Store) => T): T {
  const store = readStore()
  const result = mutate(store)
  writeStore(store)
  return result
}

// ─── Conversations ────────────────────────────────────────────────────────────

export function createConversation(
  id: string,
  model: string,
  title?: string,
  extra: { projectId?: string; kind?: SessionKind; teamId?: string } = {},
) {
  const now = Date.now()
  readModifyWrite(store => {
    store.conversations.push({
      id,
      title: title || 'Nova Conversa',
      model,
      created_at: now,
      updated_at: now,
      metadata: '{}',
      project_id: extra.projectId || DEFAULT_PROJECT_ID,
      kind: extra.kind || 'chat',
      status: 'active',
      archived: false,
      team_id: extra.teamId,
    })
  })
}

export function getConversation(id: string): ConversationRow | undefined {
  return readStore().conversations.find(c => c.id === id)
}

export function listConversations(limit = 50) {
  const store = readStore()
  const counts = new Map<string, number>()
  for (const m of store.messages) counts.set(m.conversation_id, (counts.get(m.conversation_id) || 0) + 1)
  return store.conversations
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit)
    .map(c => ({ ...c, message_count: counts.get(c.id) || 0 }))
}

export function updateConversationTitle(id: string, title: string) {
  readModifyWrite(store => {
    const c = store.conversations.find(x => x.id === id)
    if (c) { c.title = title; c.updated_at = Date.now() }
  })
}

/** Guarda o JSON de metadados da conversa (hoje: o ponto de compactação). */
export function updateConversationMetadata(id: string, metadata: string) {
  readModifyWrite(store => {
    const c = store.conversations.find(x => x.id === id)
    if (c) { c.metadata = metadata; c.updated_at = Date.now() }
  })
}

export function deleteConversation(id: string) {
  deleteConversations([id])
}

/** Removes the rows and every message of each session in one write. Returns what was removed. */
export function deleteConversations(ids: string[]) {
  const set = new Set(ids)
  const removed = readModifyWrite(store => {
    const before = { conversations: store.conversations.length, messages: store.messages.length }
    store.conversations = store.conversations.filter(c => !set.has(c.id))
    store.messages = store.messages.filter(m => !set.has(m.conversation_id))
    return {
      conversations: before.conversations - store.conversations.length,
      messages: before.messages - store.messages.length,
    }
  })
  // O contexto jogado na conversa (data/context/<id>.json) vai junto
  for (const id of set) {
    if (!/^[\w-]{1,80}$/.test(id)) continue
    try { fs.unlinkSync(path.join(dataDir(), 'context', `${id}.json`)) } catch { /* conversa sem contexto */ }
  }
  return removed
}

// ─── Sessions (conversations plus project/kind/status/archive) ───────────────

export interface SessionRow extends ConversationRow {
  project_id: string
  kind: SessionKind
  status: SessionStatus
  archived: boolean
  message_count: number
}

function asSession(c: ConversationRow, messageCount: number): SessionRow {
  return {
    ...c,
    project_id: c.project_id || DEFAULT_PROJECT_ID,
    kind: c.kind || 'chat',
    status: c.status || 'active',
    archived: !!c.archived,
    message_count: messageCount,
  }
}

export function getSession(id: string): SessionRow | undefined {
  const store = readStore()
  const c = store.conversations.find(x => x.id === id)
  return c && asSession(c, store.messages.filter(m => m.conversation_id === id).length)
}

export function listSessions(filter: {
  projectId?: string
  status?: SessionStatus
  archived?: boolean
  q?: string
  kind?: SessionKind
} = {}): SessionRow[] {
  const store = readStore()
  const counts = new Map<string, number>()
  for (const m of store.messages) counts.set(m.conversation_id, (counts.get(m.conversation_id) || 0) + 1)

  const q = filter.q?.trim().toLowerCase()
  let contentHits: Set<string> | null = null
  if (q) {
    contentHits = new Set(store.messages.filter(m => m.content.toLowerCase().includes(q)).map(m => m.conversation_id))
  }

  return store.conversations
    .map(c => asSession(c, counts.get(c.id) || 0))
    .filter(s => !filter.projectId || s.project_id === filter.projectId)
    .filter(s => filter.archived === undefined || s.archived === filter.archived)
    .filter(s => !filter.status || s.status === filter.status)
    .filter(s => !filter.kind || s.kind === filter.kind)
    .filter(s => !q || s.title.toLowerCase().includes(q) || contentHits!.has(s.id))
    .sort((a, b) => b.updated_at - a.updated_at)
}

export function updateSession(
  id: string,
  patch: Partial<Pick<ConversationRow, 'title' | 'status' | 'archived' | 'project_id' | 'team_id' | 'model'>>,
) {
  return readModifyWrite(store => {
    const c = store.conversations.find(x => x.id === id)
    if (!c) return false
    Object.assign(c, patch, { updated_at: Date.now() })
    return true
  })
}

/** Copies the session row and all its messages under a new id. */
export function duplicateSession(id: string, newId: string, makeMessageId: () => string) {
  return readModifyWrite(store => {
    const c = store.conversations.find(x => x.id === id)
    if (!c) return undefined
    const now = Date.now()
    const copy: ConversationRow = { ...c, id: newId, title: `${c.title} (cópia)`, created_at: now, updated_at: now, status: 'completed' }
    store.conversations.push(copy)
    for (const m of store.messages.filter(x => x.conversation_id === id)) {
      store.messages.push({ ...m, id: makeMessageId(), conversation_id: newId })
    }
    return copy
  })
}

export function moveSessionsToProject(fromProjectId: string, toProjectId: string) {
  return readModifyWrite(store => {
    let moved = 0
    for (const c of store.conversations) {
      if ((c.project_id || DEFAULT_PROJECT_ID) === fromProjectId) { c.project_id = toProjectId; moved++ }
    }
    return moved
  })
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function addMessage(msg: { id: string; conversationId: string; role: string; content: string; model?: string; tokens?: number }) {
  const now = Date.now()
  readModifyWrite(store => {
    store.messages.push({ id: msg.id, conversation_id: msg.conversationId, role: msg.role, content: msg.content, created_at: now, model: msg.model || null, tokens: msg.tokens || null })
    const c = store.conversations.find(x => x.id === msg.conversationId)
    if (c) c.updated_at = now
  })
}

/**
 * Corta a conversa a partir de uma mensagem (inclusive): ela e tudo que veio
 * depois saem. É o que editar uma mensagem e regenerar uma resposta fazem — o
 * mesmo que no Claude e no ChatGPT, onde a conversa segue a partir do ponto
 * alterado. Devolve o que foi removido, ou null se a mensagem não existe nesta
 * conversa (nada é apagado nesse caso).
 */
export function truncateMessagesFrom(conversationId: string, messageId: string): { removed: number; fromCreatedAt: number } | null {
  return readModifyWrite(store => {
    const daConversa = store.messages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.created_at - b.created_at)
    const i = daConversa.findIndex(m => m.id === messageId)
    if (i < 0) return null

    const sair = new Set(daConversa.slice(i).map(m => m.id))
    store.messages = store.messages.filter(m => !sair.has(m.id))
    const c = store.conversations.find(x => x.id === conversationId)
    if (c) c.updated_at = Date.now()
    return { removed: sair.size, fromCreatedAt: daConversa[i].created_at }
  })
}

export function getMessages(conversationId: string) {
  const store = readStore()
  return store.messages.filter(m => m.conversation_id === conversationId).sort((a, b) => a.created_at - b.created_at)
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export function addMemory(entry: { id: string; type: string; content: string; tags: string[] }) {
  const now = Date.now()
  readModifyWrite(store => {
    store.memory.push({ id: entry.id, type: entry.type, content: entry.content, tags: JSON.stringify(entry.tags), created_at: now, updated_at: now, relevance: 1.0 })
  })
}

export function listMemory(type?: string, limit = 100) {
  const store = readStore()
  return store.memory.filter(m => !type || m.type === type).sort((a, b) => b.relevance - a.relevance || b.updated_at - a.updated_at).slice(0, limit)
}

export function deleteMemory(id: string) {
  readModifyWrite(store => {
    store.memory = store.memory.filter(m => m.id !== id)
  })
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'os', 'as', 'ao', 'aos',
  'que', 'qual', 'quais', 'como', 'para', 'pra', 'por', 'com', 'sem', 'se', 'me', 'eu', 'meu', 'minha', 'meus', 'minhas',
  'seu', 'sua', 'voce', 'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'ele', 'ela', 'mais', 'muito', 'sobre', 'ou',
  'mas', 'tem', 'ter', 'foi', 'ser', 'sao', 'nao', 'sim', 'pode', 'faz', 'fazer', 'quero', 'preciso', 'agora',
  'the', 'and', 'for', 'with', 'what', 'how', 'is', 'to', 'of', 'in', 'on',
])
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const terms = (s: string) => [...new Set(fold(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOPWORDS.has(t)))]
// "roteador" also finds "roteadores"; short terms must match a whole word
const termHit = (t: string, words: string[]) => words.some(w => w === t || (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))))

/** Memories ranked by how many terms of `query` they share; a whole chat message works as the query. */
export function searchMemory(query: string, limit = 10) {
  const store = readStore()
  const q = terms(query)
  if (!q.length) {
    const needle = fold(query.trim())
    return needle ? store.memory.filter(m => fold(`${m.content} ${m.tags}`).includes(needle)).slice(0, limit) : []
  }
  return store.memory
    .map(m => {
      const words = terms(`${m.content} ${m.tags}`)
      return { m, score: q.filter(t => termHit(t, words)).length }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.relevance - a.m.relevance || b.m.updated_at - a.m.updated_at)
    .slice(0, limit)
    .map(x => x.m)
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export function listSkills(onlyEnabled = false) {
  const store = readStore()
  return onlyEnabled ? store.skills.filter(s => s.enabled === 1) : store.skills.sort((a, b) => a.name.localeCompare(b.name))
}

export function addSkill(skill: { id: string; name: string; description: string; source: string; content: string; tags?: string[] }) {
  const now = Date.now()
  readModifyWrite(store => {
    const existing = store.skills.findIndex(s => s.id === skill.id)
    const row: SkillRow = { id: skill.id, name: skill.name, description: skill.description, source: skill.source, content: skill.content, enabled: 1, created_at: now, tags: JSON.stringify(skill.tags || []) }
    if (existing >= 0) store.skills[existing] = row
    else store.skills.push(row)
  })
}

export function toggleSkill(id: string, enabled: boolean) {
  readModifyWrite(store => {
    const s = store.skills.find(x => x.id === id)
    if (s) s.enabled = enabled ? 1 : 0
  })
}

const db = {}
export default db
