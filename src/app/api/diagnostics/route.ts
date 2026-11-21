import { NextRequest } from 'next/server'
import { gatherDiagnostics } from '@/lib/infra/diagnostics'
import { readLogs } from '@/lib/infra/log'
import { collectModuleStatus, diagnosticReportPath, type ModuleDiagnostic, type ModuleStatus } from '@/lib/diagnostics/modules'
import type { Diagnostics } from '@/lib/infra/diagnostics'
import type { LogEntry } from '@/lib/infra/log'
import { getLiveCatalog, rankModels } from '@/lib/ai/catalog'
import { isHiddenModel } from '@/lib/ai/modelTests'
import { readAudit, recordAudit, runModelAudit } from '@/lib/ai/audit'
import { redact } from '@/lib/redact'
import { writeJsonAtomic } from '@/lib/agents/fsutil'

/**
 * Diagnóstico interno do JARVIS.
 *
 * O corpo responde ao contrato rico de `Diagnostics` (usado pelo DiagnosticsPanel)
 * e acrescenta `modules`/`summary` — o mapa simples de módulos com status
 * `ok | error | attention | unknown` — sem quebrar nenhum dos dois consumidores.
 * Nenhuma chave é lida, gravada ou devolvida aqui.
 */
export interface DiagnosticsPayload {
  diagnostics: Diagnostics
  modules: ModuleDiagnostic[]
  summary: Record<ModuleStatus, number>
  checkedAt: number
  logs: LogEntry[]
  ran?: number
}

async function payload(): Promise<DiagnosticsPayload> {
  const [diagnostics, modules] = await Promise.all([gatherDiagnostics(), collectModuleStatus()])
  return {
    diagnostics,
    modules: modules.modules,
    summary: modules.summary,
    checkedAt: modules.checkedAt,
    logs: readLogs({ limit: 60 }).slice().reverse(),
  }
}

export async function GET(req?: NextRequest) {
  try {
    const sse = req?.nextUrl?.searchParams?.get('sse') === '1'
    if (sse) {
      const encoder = new TextEncoder()
      let closed = false
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            if (closed) return
            try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { closed = true }
          }
          const push = async () => {
            try {
              const p = await payload()
              send('snapshot', p)
              send('logs', readLogs({ limit: 60 }).slice().reverse())
            } catch { /* sonda transitória: mantém o stream */ }
          }
          await push()
          const timer = setInterval(() => { void push() }, 5_000)
          const stop = () => { if (closed) return; closed = true; clearInterval(timer); try { controller.close() } catch {} }
          req?.signal?.addEventListener('abort', stop)
        },
        cancel() { closed = true },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
    }
    return Response.json(await payload())
  } catch (error) {
    return Response.json({ error: redact(String((error as Error).message)) }, { status: 500 })
  }
}

let running = false

/** Força nova verificação N1 nos melhores modelos gratuitos. Uma por vez. */
export async function POST(req: NextRequest) {
  if (running) return Response.json({ error: 'Já há uma verificação em andamento' }, { status: 409 })
  running = true
  try {
    const body = await req.json().catch(() => ({})) as { limit?: unknown }
    const limit = Math.max(1, Math.min(5, Number(body.limit ?? 3) || 3))
    const catalog = await getLiveCatalog()
    const ids = rankModels(catalog, 'chat')
      .filter(m => m.free !== false && !isHiddenModel(m.id) && !/^(openai|anthropic|deepseek|xai)\|/.test(m.id))
      .map(m => m.id)
      .slice(0, limit)
    let ran = 0
    for (const id of ids) { recordAudit(await runModelAudit(id, 1)); ran++ }
    const p = await payload()
    try { writeJsonAtomic(diagnosticReportPath(), p) } catch { /* evidência é best-effort */ }
    return Response.json({ ...p, ran })
  } catch (error) {
    return Response.json({ error: redact(String((error as Error).message)) }, { status: 500 })
  } finally {
    running = false
  }
}
