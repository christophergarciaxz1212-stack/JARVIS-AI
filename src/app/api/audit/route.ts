import { NextRequest } from 'next/server'
import { getLiveCatalog, rankModels } from '@/lib/ai/catalog'
import { readAudit, recordAudit, runModelAudit, type AuditLevel } from '@/lib/ai/audit'
import { isHiddenModel } from '@/lib/ai/modelTests'
import { redact } from '@/lib/redact'

/** Resultados reais já medidos nesta máquina. */
export async function GET(_req?: NextRequest) {
  return Response.json({ results: readAudit(), at: new Date().toISOString() })
}

const PAID = /^(openai|anthropic|deepseek|xai)\|/

/** Executa a auditoria N1–N5 nos modelos pedidos ou nos melhores modelos gratuitos do catálogo. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { models?: unknown; level?: unknown; limit?: unknown }
    const level = Number(body.level ?? 1) as AuditLevel
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      return Response.json({ error: 'Nível inválido: use de 1 a 5' }, { status: 400 })
    }
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 20) || 20))
    let ids: string[]
    if (Array.isArray(body.models) && body.models.length) {
      ids = body.models.filter((m): m is string => typeof m === 'string' && m.length > 0).slice(0, 50)
    } else {
      const catalog = await getLiveCatalog()
      ids = rankModels(catalog, 'chat')
        .filter(m => m.free !== false && !PAID.test(m.id) && !isHiddenModel(m.id))
        .map(m => m.id)
        .slice(0, limit)
    }
    if (!ids.length) return Response.json({ error: 'Nenhum modelo gratuito disponível para auditar' }, { status: 400 })

    const results = []
    for (const id of ids) {
      const r = await runModelAudit(id, level)
      recordAudit(r)
      results.push(r)
    }
    return Response.json({ ran: results.length, level, results })
  } catch (error) {
    return Response.json({ error: redact(String((error as Error).message)) }, { status: 500 })
  }
}
