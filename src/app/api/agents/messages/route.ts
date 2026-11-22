// GET /api/agents/messages?runId=<id> — log de mensagens do run (histórico completo).
// POST /api/agents/messages — { runId, to, content, taskId? } envia uma mensagem do usuário.

import { NextRequest } from 'next/server'
import { getRuntime } from '@/lib/agents/runtime'

export async function GET(req: NextRequest) {
  const runId = new URL(req.url).searchParams.get('runId')
  if (!runId) return Response.json({ error: 'Informe o runId (?runId=...)' }, { status: 400 })
  const run = getRuntime().getRun(runId)
  if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })
  return Response.json({ runId: run.id, messages: run.messages })
}

export async function POST(req: NextRequest) {
  const rt = getRuntime()
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const runId = String(body.runId || '')
  const run = rt.getRun(runId)
  if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })
  const to = String(body.to || 'all')
  const content = String(body.content || '').trim()
  if (!content) return Response.json({ error: 'Informe o conteúdo da mensagem' }, { status: 400 })
  const ctrl = rt.runs.get(runId)
  if (!ctrl || ctrl.abort.signal.aborted) {
    return Response.json({ error: 'Esta execução não está ativa. Use "Retomar" para continuá-la.' }, { status: 409 })
  }
  try {
    ctrl.userMessage(to, content)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
  ctrl.persistNow()
  return Response.json({ ok: true, messages: ctrl.run.messages })
}
