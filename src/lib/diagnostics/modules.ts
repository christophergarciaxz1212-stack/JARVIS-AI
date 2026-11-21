/**
 * Diagnóstico interno do JARVIS.
 *
 * Cada módulo é verificado por uma sonda real (HTTP local, leitura de arquivo ou
 * informação do runtime). Falhas externas — cota, chave inválida, rede — viram
 * `attention`; falhas do próprio JARVIS viram `error`. Nenhum valor de chave é
 * lido, gravado ou devolvido daqui.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { dataDir } from '../agents/fsutil'
import { readAudit } from '../ai/audit'

export type ModuleStatus = 'ok' | 'error' | 'attention' | 'unknown'
export type ModuleCategory = 'nucleo' | 'ia' | 'agentes' | 'integracoes' | 'dados' | 'build'

export interface ModuleDiagnostic {
  id: string
  name: string
  category: ModuleCategory
  status: ModuleStatus
  evidence: string
  detail?: string
  checkedAt: number
  action?: string
  external?: boolean
}

export interface DiagnosticReport {
  modules: ModuleDiagnostic[]
  summary: Record<ModuleStatus, number>
  checkedAt: number
}

/** Tipos de erro que não provam defeito do JARVIS (mesmo conjunto de ai/audit.ts). */
const EXTERNAL_KINDS = new Set(['rate_limit', 'overloaded', 'unavailable', 'auth', 'network', 'cancelled', 'context'])

export function classifyModuleError(error: unknown): 'error' | 'attention' {
  const kind = (error as { kind?: unknown } | null)?.kind
  if (typeof kind === 'string' && EXTERNAL_KINDS.has(kind)) return 'attention'
  return 'error'
}

export function summarize(modules: Array<{ status: ModuleStatus }>): Record<ModuleStatus, number> {
  const out: Record<ModuleStatus, number> = { ok: 0, error: 0, attention: 0, unknown: 0 }
  for (const m of modules) out[m.status]++
  return out
}

type Probe = () => Promise<Omit<ModuleDiagnostic, 'checkedAt'>>

const BASE = () => process.env.JARVIS_BASE_URL || 'http://127.0.0.1:3001'

async function httpProbe(pathname: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(BASE() + pathname, { signal: AbortSignal.timeout(2_000) })
    const text = await res.text()
    return { ok: res.ok, detail: `HTTP ${res.status} · ${text.length} bytes` }
  } catch (error) {
    const cls = classifyModuleError({ kind: 'network' })
    return { ok: false, detail: `${cls === 'attention' ? 'não alcançável' : 'falha'}: ${(error as Error).name}` }
  }
}

const PROBES: Probe[] = [
  async () => {
    const version = process.version
    return { id: 'runtime', name: 'Runtime Node.js', category: 'nucleo', status: 'ok',
      evidence: version, detail: 'Runtime do servidor do JARVIS', checkedAt: 0 }
  },
  async () => {
    const r = await httpProbe('/api/models')
    return { id: 'catalogo', name: 'Catálogo de modelos', category: 'ia', status: r.ok ? 'ok' : 'attention',
      evidence: r.detail, action: r.ok ? undefined : 'Inicie o JARVIS para carregar o catálogo',
      detail: 'GET /api/models — modelos gratuitos disponíveis', checkedAt: 0,
      external: !r.ok }
  },
  async () => {
    const results = readAudit()
    const ok = results.filter(r => r.ok).length
    return { id: 'auditoria-modelos', name: 'Auditoria N1–N5', category: 'ia', status: results.length ? (ok ? 'ok' : 'attention') : 'unknown',
      evidence: `${ok} aprovados de ${results.length} medidos`,
      action: results.length ? undefined : 'Rode a verificação na tela de diagnóstico',
      detail: 'Resultados reais medidos nesta máquina', checkedAt: 0 }
  },
  async () => {
    const r = await httpProbe('/api/agents/health')
    return { id: 'saude-agentes', name: 'Saúde dos agentes', category: 'agentes', status: r.ok ? 'ok' : 'attention',
      evidence: r.detail, action: r.ok ? undefined : 'Inicie o JARVIS para verificar os agentes',
      detail: 'GET /api/agents/health', checkedAt: 0, external: !r.ok }
  },
  async () => {
    const r = await httpProbe('/api/providers')
    return { id: 'provedores', name: 'Provedores conectados', category: 'ia', status: r.ok ? 'ok' : 'attention',
      evidence: r.detail, detail: 'GET /api/providers — somente provedores gratuitos', checkedAt: 0, external: !r.ok }
  },
  async () => {
    const r = await httpProbe('/api/whatsapp/health')
    return { id: 'whatsapp', name: 'WhatsApp Center', category: 'integracoes', status: r.ok ? 'ok' : 'attention',
      evidence: r.detail, detail: 'GET /api/whatsapp/health', checkedAt: 0, external: !r.ok }
  },
  async () => {
    let writable = false
    let detail = 'diretório de dados não encontrado'
    try {
      const dir = dataDir()
      fs.accessSync(dir, fs.constants.W_OK)
      writable = true
      detail = dir
    } catch { /* mantém o padrão */ }
    return { id: 'persistencia', name: 'Persistência de dados', category: 'dados', status: writable ? 'ok' : 'error',
      evidence: writable ? 'diretório gravável' : detail,
      action: writable ? undefined : 'Verifique permissões da pasta de dados',
      detail: 'dataDir() gravável', checkedAt: 0 }
  },
  async () => {
    let sha = 'desconhecido'
    try {
      sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 2_000 }).trim()
    } catch { /* sem git ou sem HEAD */ }
    return { id: 'build', name: 'Versão do build', category: 'build', status: sha === 'desconhecido' ? 'unknown' : 'ok',
      evidence: sha, detail: 'commit atual do código-fonte', checkedAt: 0 }
  },
]

/** Executa todas as sondas; uma sonda que lança nunca derruba o relatório inteiro. */
export async function collectModuleStatus(opts: { now?: number } = {}): Promise<DiagnosticReport> {
  const now = opts.now ?? Date.now()
  const results = await Promise.allSettled(PROBES.map(p => p()))
  const modules: ModuleDiagnostic[] = results.map((r, i) =>
    r.status === 'fulfilled'
      ? { ...r.value, checkedAt: now }
      : { id: `sonda-${i}`, name: `Sonda ${i + 1}`, category: 'nucleo', status: 'error',
          evidence: (r.reason as Error)?.message?.slice(0, 160) || 'falha desconhecida', checkedAt: now },
  )
  return { modules, summary: summarize(modules), checkedAt: now }
}

/** Caminho do arquivo de relatório (usado pelo script de evidência). */
export const diagnosticReportPath = () => path.join(dataDir(), 'audit', 'diagnostics.json')
