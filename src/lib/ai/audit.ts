/**
 * Auditoria real de modelos: N1 comunicação, N2 raciocínio, N3 código,
 * N4 engenharia (JSON) e N5 autonomia (ferramenta nativa).
 *
 * Cada nível usa o mesmo cliente do chat (`streamAI`/`completeOnce`) e só marca uma
 * capacidade como `false` quando o modelo respondeu e provou que não sabe fazer aquilo.
 * Erros externos (cota, sobrecarga, rede) ficam como `null` — não são falta de capacidade.
 */
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { redact } from '../redact'
import { classifyModelError, completeOnce, streamAI, type NativeToolSpec } from './client'

export type AuditLevel = 1 | 2 | 3 | 4 | 5

export interface AuditCapabilities {
  stream: boolean | null
  json: boolean | null
  reasoning: boolean | null
  code: boolean | null
  tools: boolean | null
}

export interface AuditResult {
  provider: string
  model: string
  ok: boolean
  ms: number
  level: AuditLevel
  /** Maior nível concluído antes da falha (0 = nem o N1 passou). */
  reached: AuditLevel | 0
  capability: AuditCapabilities
  error?: string
  sample?: string
  at: number
}

const AUDIT_FILE = () => path.join(dataDir(), 'audit', 'models.json')
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_SAMPLE = 240

/** Falhas do ambiente/provedor não provam nada sobre a capacidade do modelo. */
const EXTERNAL_ERROR_KINDS = new Set<ReturnType<typeof classifyModelError>['kind']>([
  'rate_limit', 'overloaded', 'unavailable', 'auth', 'network', 'cancelled', 'context',
])

// Injetados pelos testes seguindo o padrão de setCouncilLlm (src/lib/ai/council.ts).
let completeImpl: typeof completeOnce = completeOnce
let streamImpl: typeof streamAI = streamAI
export function setAuditClients(complete: typeof completeOnce, stream: typeof streamAI) {
  completeImpl = complete
  streamImpl = stream
}

const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, '')
const flat = (t: string) => stripThink(String(t || '')).replace(/\s+/g, ' ').trim()

/** Extrai o primeiro objeto JSON de uma resposta que pode vir com cerca de código. */
function parseObject(text: string): Record<string, unknown> {
  const body = stripThink(text)
  const raw = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)
  if (!raw.startsWith('{')) throw new Error(`JSON ausente na resposta: ${flat(text).slice(0, 80)}`)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error(`JSON inválido: ${flat(text).slice(0, 80)}`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON não é um objeto')
  return parsed as Record<string, unknown>
}

const WRITE_FILE: NativeToolSpec = {
  name: 'write_file',
  description: 'Grava um arquivo de texto no projeto do usuário',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
}

type Probe = { level: AuditLevel; cap: keyof AuditCapabilities; run: (id: string, timeoutMs: number) => Promise<string> }

const PROBES: Probe[] = [
  {
    level: 1, cap: 'stream',
    run: async (id, timeoutMs) => {
      let text = ''
      await streamImpl(id, [
        { role: 'system', content: 'Você é o JARVIS. Responda em português, curto.' },
        { role: 'user', content: 'Quanto é 9 + 4? Responda só com o número.' },
      ], c => { if (c.content) text += c.content }, AbortSignal.timeout(timeoutMs))
      if (!/\b13\b|treze/i.test(flat(text))) throw new Error(`streaming sem resposta correta: ${flat(text).slice(0, 100)}`)
      return text
    },
  },
  {
    level: 2, cap: 'reasoning',
    run: async (id, timeoutMs) => {
      const { text } = await completeImpl(id, [
        { role: 'system', content: 'Resolva o problema e termine exatamente com RESPOSTA: <número>.' },
        { role: 'user', content: 'Ana tem 3 caixas com 4 maçãs cada. Ela dá 2 maçãs ao Beto. Quantas maçãs sobram? Termine com RESPOSTA: <número>.' },
      ], AbortSignal.timeout(timeoutMs))
      if (!/\b(10|dez)\b/i.test(flat(text))) throw new Error(`raciocínio incorreto: ${flat(text).slice(0, 100)}`)
      return text
    },
  },
  {
    level: 3, cap: 'code',
    run: async (id, timeoutMs) => {
      const { text } = await completeImpl(id, [
        { role: 'system', content: 'Entregue somente código JavaScript válido, sem explicação.' },
        { role: 'user', content: 'Escreva o código JavaScript da função `soma(a, b)` que devolve a soma dos dois números. Inclua um bloco de código.' },
      ], AbortSignal.timeout(timeoutMs))
      if (!/function\s+soma|const\s+soma|let\s+soma|\bsoma\s*=\s*\(/.test(text) || !/\ba\s*\+\s*b/.test(text)) {
        throw new Error(`não entregou a função soma(a, b): ${flat(text).slice(0, 100)}`)
      }
      return text
    },
  },
  {
    level: 4, cap: 'json',
    run: async (id, timeoutMs) => {
      const { text } = await completeImpl(id, [
        { role: 'system', content: 'Responda somente com um objeto JSON válido, sem cercas de código.' },
        { role: 'user', content: 'Devolva um JSON para o projeto de uma API de notas com login e banco, com os campos "servicos" (pelo menos 2 itens), "banco" (texto) e "riscos" (pelo menos 1 item).' },
      ], AbortSignal.timeout(timeoutMs), { json: true })
      const j = parseObject(text)
      if (!Array.isArray(j.servicos) || j.servicos.length < 2 || typeof j.banco !== 'string' || !j.banco || !Array.isArray(j.riscos) || j.riscos.length < 1) {
        throw new Error(`JSON sem os campos pedidos: ${flat(text).slice(0, 100)}`)
      }
      return text
    },
  },
  {
    level: 5, cap: 'tools',
    run: async (id, timeoutMs) => {
      const { text } = await completeImpl(id, [
        { role: 'system', content: 'Você é um agente do JARVIS. Use a ferramenta disponível quando ela atender ao pedido e responda no formato JSON do JARVIS.' },
        { role: 'user', content: 'Use a ferramenta write_file para criar o arquivo README.md com o texto "JARVIS OK". Responda com a chamada da ferramenta.' },
      ], AbortSignal.timeout(timeoutMs), { tools: [WRITE_FILE] })
      const j = parseObject(text)
      const actions = Array.isArray(j.actions) ? j.actions as Array<{ tool?: unknown; args?: { path?: unknown } }> : []
      if (!actions.some(a => a.tool === 'write_file' && /README\.md/i.test(String(a.args?.path || '')))) {
        throw new Error(`não chamou write_file para README.md: ${flat(text).slice(0, 100)}`)
      }
      return text
    },
  },
]

/** Roda os níveis de 1 até `level`, parando no primeiro que falhar. */
export async function runModelAudit(modelId: string, level: AuditLevel, opts: { timeoutMs?: number } = {}): Promise<AuditResult> {
  const started = Date.now()
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const provider = modelId.includes('|') ? modelId.slice(0, modelId.indexOf('|')) : modelId
  const capability: AuditCapabilities = { stream: null, json: null, reasoning: null, code: null, tools: null }
  const result: AuditResult = { provider, model: modelId, ok: false, ms: 0, level, reached: 0, capability, at: started }

  for (const probe of PROBES) {
    if (probe.level > level) break
    try {
      const sample = await probe.run(modelId, timeoutMs)
      capability[probe.cap] = true
      result.reached = probe.level
      result.sample = flat(sample).slice(0, MAX_SAMPLE)
    } catch (error) {
      const cls = classifyModelError(error)
      // Cota/sobrecarga/rede não provam nada sobre a capacidade do modelo.
      if (!EXTERNAL_ERROR_KINDS.has(cls.kind)) capability[probe.cap] = false
      result.error = redact(cls.message).slice(0, 300)
      result.ms = Date.now() - started
      return result
    }
  }
  result.ok = result.reached === level
  result.ms = Date.now() - started
  return result
}

export function readAudit(): AuditResult[] {
  return readJson<AuditResult[]>(AUDIT_FILE(), [])
}

/** Grava/substitui uma lista completa de resultados (usado pelo script de auditoria). */
export function saveAudit(results: AuditResult[]) {
  writeJsonAtomic(AUDIT_FILE(), results.slice().sort((a, b) => b.at - a.at).slice(0, 500))
}

/** Mescla um resultado pelo id do modelo, preservando os demais. */
export function recordAudit(entry: AuditResult) {
  const all = readAudit().filter(r => r.model !== entry.model)
  saveAudit([entry, ...all])
}
