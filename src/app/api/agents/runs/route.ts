import { NextRequest } from 'next/server'
import { getRuntime } from '@/lib/agents/runtime'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProject, getProject, readEvents } from '@/lib/agents/store'
import { PERMISSION_MODES } from '@/lib/agents/permissions'
import { runChanges, runFileChange } from '@/lib/agents/changes'
import type { RunOptions } from '@/lib/agents/types'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const rt = getRuntime()
  const id = sp.get('id')
  if (id) {
    const run = rt.getRun(id)
    if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })
    // ?changes=1 → diffs dos arquivos alterados; &file=<caminho> → só um deles
    if (sp.get('changes')) {
      const file = sp.get('file')
      if (file) {
        const diff = runFileChange(run, file)
        return diff ? Response.json({ diff }) : Response.json({ error: 'Arquivo não alterado por esta execução' }, { status: 404 })
      }
      return Response.json(runChanges(run))
    }
    return Response.json({ run, events: readEvents(run.sessionId, run.id, 400) })
  }
  const sessionId = sp.get('sessionId')
  if (!sessionId) return Response.json({ error: 'Informe sessionId ou id' }, { status: 400 })
  return Response.json({ runs: rt.listSessionRuns(sessionId) })
}

/** Agent mode from the chat: a project without a folder works in "Documentos\JARVIS Projetos". */
function workspaceProject(projectId: string) {
  const p = projectId ? getProject(projectId) : undefined
  if (p?.path) return p.id
  const folder = path.join(os.homedir(), 'Documents', 'JARVIS Projetos')
  fs.mkdirSync(folder, { recursive: true })
  return createProject('JARVIS Projetos', folder).id
}

/** Aceita só valores conhecidos: um modo inválido não pode virar autonomia acidental. */
function sanitizeOptions(raw: unknown): Partial<RunOptions> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: Partial<RunOptions> = {}
  if (typeof r.permissionMode === 'string' && (PERMISSION_MODES as string[]).includes(r.permissionMode)) {
    out.permissionMode = r.permissionMode as RunOptions['permissionMode']
  }
  if (typeof r.planFirst === 'boolean') out.planFirst = r.planFirst
  for (const k of ['maxParallel', 'maxSteps', 'fixRounds'] as const) {
    if (typeof r[k] === 'number' && Number.isFinite(r[k]) && (r[k] as number) > 0) out[k] = Math.floor(r[k] as number)
  }
  if (typeof r.autoFallback === 'boolean') out.autoFallback = r.autoFallback
  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const projectId = body.agentMode ? workspaceProject(String(body.projectId || '')) : String(body.projectId || '')
    const ctrl = getRuntime().startRun({
      sessionId: body.sessionId,
      projectId,
      request: String(body.request || ''),
      teamId: body.teamId || undefined,
      options: sanitizeOptions(body.options),
    })
    return Response.json({ run: ctrl.run })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
