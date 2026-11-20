import { NextRequest } from 'next/server'
import { createProject, getProject, listProjects, removeProject, renameProject } from '@/lib/agents/store'
import { DEFAULT_PROJECT_ID, moveSessionsToProject } from '@/lib/db'
import { clearMemory, readInstructions, readMemory, removeMemory, writeMemory } from '@/lib/agents/projectMemory'
import { readProjectFile, searchProjectFiles } from '@/lib/agents/projectFiles'

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams

  // Sugestões do "@arquivo" no composer: enraizadas na pasta DO PROJETO.
  const filesFor = sp.get('files')
  if (filesFor) {
    const project = getProject(filesFor)
    if (!project?.path) return Response.json({ files: [] })
    return Response.json({ files: searchProjectFiles(project.path, sp.get('q') || '', 12) })
  }

  const id = sp.get('memory')
  if (id) {
    const project = getProject(id)
    if (!project) return Response.json({ error: 'Projeto não encontrado' }, { status: 404 })
    return Response.json({
      memory: readMemory(id),
      instructions: project.path ? readInstructions(project.path) : null,
    })
  }
  return Response.json({ projects: listProjects() })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case 'create':
        return Response.json({ project: createProject(String(body.name || ''), String(body.path || '')) })
      case 'rename':
        return Response.json({ ok: renameProject(String(body.id), String(body.name || '')) })
      case 'remove': {
        // JARVIS forgets the project; its sessions move to "Geral" and the folder on disk is untouched
        const moved = moveSessionsToProject(String(body.id), DEFAULT_PROJECT_ID)
        removeProject(String(body.id))
        return Response.json({ ok: true, movedSessions: moved })
      }
      // Lê os arquivos citados com @. Só LÊ: quem decide se eles ficam pendentes
      // no navegador ou vão direto para o servidor é o useChatContext, que já
      // trata conversa nova e conversa existente.
      case 'read-files': {
        const project = getProject(String(body.id || ''))
        if (!project?.path) return Response.json({ error: 'Escolha um projeto com uma pasta no disco' }, { status: 400 })
        const pedidos = (Array.isArray(body.files) ? body.files : []).map(String).slice(0, 10)
        const lidos: Array<{ name: string; text: string; kind: 'file'; truncated: boolean }> = []
        const falhas: Array<{ file: string; reason: string }> = []
        for (const rel of pedidos) {
          try {
            const r = readProjectFile(project.path, rel)
            lidos.push({ name: r.path, text: r.text, kind: 'file', truncated: r.truncated })
          } catch (e) {
            falhas.push({ file: rel, reason: (e as Error).message })
          }
        }
        return Response.json({ files: lidos, failed: falhas })
      }
      case 'memory-save': {
        const id = String(body.id || '')
        if (!getProject(id)) return Response.json({ error: 'Projeto não encontrado' }, { status: 404 })
        return Response.json({ memory: writeMemory(id, body.memory || {}) })
      }
      case 'memory-remove': {
        const field = body.field === 'pendencias' ? 'pendencias' : 'decisoes'
        return Response.json({ memory: removeMemory(String(body.id || ''), field, String(body.text || '')) })
      }
      case 'memory-clear':
        if (body.confirm !== true) return Response.json({ error: 'Confirmação obrigatória para apagar a memória' }, { status: 400 })
        return Response.json({ memory: clearMemory(String(body.id || '')) })
      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
