/**
 * JARVIS Self-Improvement: varredura determinística do próprio repositório +
 * revisão de IA sobre os achados. Read-only: nada é alterado sem aprovação.
 *
 * Uso no chat: `/self-improve`
 */
import fs from 'fs'
import path from 'path'
import { getLiveCatalog, rankModels, defaultModelFrom, fallbackChain } from './catalog'
import { completeOnce, classifyModelError } from './client'
import { modelHealth } from '../agents/models'

export interface ScanSignals {
  root: string
  totalFiles: number
  totalLines: number
  bigFiles: Array<{ file: string; lines: number }>
  echo: { todo: number; fixme: number; anyCast: number; consoleLog: number }
  tests: { testFiles: number }
}

const PAID = /^(openai|anthropic|deepseek|xai)\|/
const SCAN_DIRS = ['src', 'tests', 'electron', 'scripts']
const SKIP = /node_modules|\.next|\.next-|\.venv|\.git|dist|out|\.tmp/

function walk(dir: string, base: string, acc: Array<{ file: string; lines: number }>): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(full, base, acc); continue }
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|css)$/.test(entry.name)) continue
    try {
      const lines = fs.readFileSync(full, 'utf8').split('\n').length
      acc.push({ file: path.relative(base, full).replace(/\\/g, '/'), lines })
    } catch {}
  }
}

export function scanRepo(root = process.cwd()): ScanSignals {
  const files: Array<{ file: string; lines: number }> = []
  for (const d of SCAN_DIRS) walk(path.join(root, d), root, files)
  const totalLines = files.reduce((s, f) => s + f.lines, 0)
  const echo = { todo: 0, fixme: 0, anyCast: 0, consoleLog: 0 }
  for (const f of files.slice(0, 400)) {
    try {
      const text = fs.readFileSync(path.join(root, f.file), 'utf8')
      echo.todo += (text.match(/TODO/g) || []).length
      echo.fixme += (text.match(/FIXME|HACK|XXX/g) || []).length
      echo.anyCast += (text.match(/\bas any\b|@ts-ignore|@ts-nocheck|@ts-expect-error/g) || []).length
      echo.consoleLog += (text.match(/console\.(log|debug)\b/g) || []).length
    } catch {}
  }
  const bigFiles = [...files].sort((a, b) => b.lines - a.lines).slice(0, 8)
  const testFiles = files.filter(f => f.file.includes('/tests/') || /\.test\./.test(f.file)).length
  return { root, totalFiles: files.length, totalLines, bigFiles, echo, tests: { testFiles } }
}

let completeImpl: typeof completeOnce = completeOnce
let modelsFn: () => Promise<string[]> = async () => {
  const catalog = await getLiveCatalog()
  const chain = fallbackChain(catalog, defaultModelFrom(catalog), 6)
  const strong = rankModels(catalog, 'code').filter(m => m.free !== false && !PAID.test(m.id)).slice(0, 3).map(m => m.id)
  return [...new Set([...strong, ...chain])].slice(0, 5)
}

/** Injetado pelos testes. */
export function setSelfImproveLlm(complete: typeof completeOnce, models?: () => Promise<string[]>) {
  completeImpl = complete
  if (models) modelsFn = models
}

export interface SelfImproveResult { report: string; model?: string; scanned: ScanSignals }

export async function runSelfImprove(): Promise<SelfImproveResult> {
  const scanned = scanRepo()
  const prompt = `Você é um engenheiro sênior fazendo uma revisão do repositório do JARVIS (um app Electron+Next.js de agentes de IA).
# Estrutura (medida de verdade agora)
- ${scanned.totalFiles} arquivos, ${scanned.totalLines} linhas
- Testes: ${scanned.tests.testFiles} arquivos de teste
- Sinais: TODO=${scanned.echo.todo} · FIXME/HACK=${scanned.echo.fixme} · qualquer=${scanned.echo.anyCast} · console.log/debug=${scanned.echo.consoleLog}
## Maiores arquivos
${scanned.bigFiles.map(f => `- ${f.file}: ${f.lines} linhas`).join('\n')}

Com base SÓ nestes dados + no seu conhecimento do código deste repositório, liste as 5 melhorias de MAIOR impacto para este projeto, em ordem. Cada uma: (1) o que mudar, (2) por que importa agora, (3) esforço (S/M/G). Não invente problemas invisíveis; não sugira refatorações sem sinal nos dados. Português do Brasil, markdown curto, sem enrolação.`
  const models = (await modelsFn()).filter(m => modelHealth.state(m) !== 'unavailable')
  for (const model of models) {
    try {
      const c = await completeImpl(model, [{ role: 'system', content: 'Você é um revisor de código pragmático. Responda só com a lista pedida.' }, { role: 'user', content: prompt }], AbortSignal.timeout(60_000))
      modelHealth.reportSuccess(model)
      return { report: c.text.trim(), model, scanned }
    } catch (e) {
      const cls = classifyModelError(e)
      modelHealth.reportFailure(model, cls.kind, cls.message, cls.retryAfterMs)
    }
  }
  // Sem IA: devolve o relatório determinístico mesmo assim
  return {
    report: `**Sinais do repositório** — ${scanned.totalFiles} arquivos, ${scanned.totalLines} linhas, ${scanned.tests.testFiles} arquivos de teste.\n\nMaiores arquivos:\n${scanned.bigFiles.map(f => `- ${f.file}: ${f.lines} linhas`).join('\n')}\n\nSinais: TODO=${scanned.echo.todo}, FIXME=${scanned.echo.fixme}, qualquer=${scanned.echo.anyCast}, console.log=${scanned.echo.consoleLog}\n\n*A revisão por IA falhou nesta execução (ver logs); os sinais acima são medidos de verdade.*`,
    scanned,
  }
}

const formatReport = (r: SelfImproveResult) =>
  `## 🔍 JARVIS Self-Improvement\n\n${r.report}\n\n---\n*Varredura determinística em ${r.scanned.totalFiles} arquivos · ${r.scanned.totalLines} linhas · testes: ${r.scanned.tests.testFiles}*${r.model ? ` · revisor: \`${r.model.split('|').pop()}\`` : ''}`

const RE = /^\/(?:self-improve|self-improvement|auto-melhorar)(?:\s*)$/i

export function selfImproveRunner(message: string): (() => Promise<string>) | null {
  if (!RE.test(message.trim())) return null
  return async () => formatReport(await runSelfImprove())
}
