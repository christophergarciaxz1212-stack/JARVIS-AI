import { NextRequest } from 'next/server'
import { getRuntime } from '@/lib/agents/runtime'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProject, getProject, readEvents } from '@/lib/agents/store'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const rt = getRuntime()
  const id = sp.get('id')
  if (id) {
    const run = rt.getRun(id)
    if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const projectId = body.agentMode ? workspaceProject(String(body.projectId || '')) : String(body.projectId || '')
    const ctrl = getRuntime().startRun({
      sessionId: body.sessionId,
      projectId,
      request: String(body.request || ''),
      teamId: body.teamId || undefined,
      options: body.options,
    })
    return Response.json({ run: ctrl.run })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
