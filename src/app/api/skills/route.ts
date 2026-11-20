import { NextRequest } from 'next/server'
import { getEngine } from '@/lib/engine/engine'
import type { Candidate, Extension } from '@/lib/engine/types'

/**
 * Compatibility layer for the old /api/skills endpoints. Everything now lives in the
 * Jarvis Skill Engine, so there is a single catalogue, one security pipeline and one
 * source of truth for Skills, MCP servers and tools.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toLegacySkill(e: Extension) {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    source: e.source.type,
    content: '',
    tags: e.categories,
    enabled: e.enabled,
    kind: e.kind,
    risk: e.risk.level,
    status: e.status,
    updateAvailable: e.updateAvailable?.version,
  }
}

function toLegacyRepo(c: Candidate) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    author: c.source.ref.split('/')[0] || c.source.type,
    stars: c.stars ? String(c.stars) : '',
    url: c.homepage || c.source.url || c.source.ref,
    tags: [c.kind],
    installed: c.installed,
    license: c.license,
  }
}

export async function GET(req: NextRequest) {
  const engine = getEngine()
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'

  try {
    if (action === 'marketplace') {
      const query = searchParams.get('q') || 'agent skills'
      const kind = searchParams.get('kind') === 'mcp' ? 'mcp' : 'skill'
      const { candidates, errors } = await engine.discover(query, [kind])
      return Response.json({ repos: candidates.map(toLegacyRepo), query, kind, errors })
    }

    if (action === 'list') {
      const extensions = engine.list()
      return Response.json({ skills: extensions.map(toLegacySkill), extensions, stats: engine.stats() })
    }

    if (action === 'stats') return Response.json({ stats: engine.stats() })

    return Response.json({ error: `Ação inválida: ${action}` }, { status: 400 })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const engine = getEngine()
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { body = {} }
  const action = String(body.action || '')

  try {
    if (action === 'install-from-url') {
      const source = String(body.url || '').trim()
      if (!source) return Response.json({ success: false, error: 'Informe a URL ou o caminho da skill' }, { status: 400 })
      const outcome = await engine.installSource(source, { requestedBy: 'usuário (compatibilidade)' })
      if (outcome.status === 'installed') {
        return Response.json({ success: true, installed: [outcome.extension.name], id: outcome.extension.id, extension: outcome.extension })
      }
      if (outcome.status === 'existing') {
        return Response.json({ success: true, installed: [outcome.extension.name], id: outcome.extension.id, extension: outcome.extension, alreadyInstalled: true })
      }
      if (outcome.status === 'pending') {
        return Response.json({ success: false, pending: true, approval: outcome.approval, message: `Precisa de aprovação: ${outcome.approval.reason}` })
      }
      return Response.json({ success: false, blocked: true, error: outcome.reason })
    }

    if (action === 'create') {
      const name = String(body.name || '').trim()
      const description = String(body.description || '').trim()
      const content = String(body.content || '').trim()
      const need = [name || description, content].filter(Boolean).join(': ')
      if (!need) return Response.json({ success: false, error: 'Descreva a skill' }, { status: 400 })
      const job = engine.startJob('create', `Criar Skill: ${name || need.slice(0, 60)}`, log => engine.create(need, 'usuário (compatibilidade)', log))
      return Response.json({ success: true, job, message: 'A Skill está sendo criada, testada e analisada pelo Skill Engine.' })
    }

    if (action === 'enable' || action === 'disable' || action === 'toggle') {
      const id = String(body.id || '')
      if (!id) return Response.json({ success: false, error: 'Informe o id' }, { status: 400 })
      const enabled = action === 'toggle' ? !!body.enabled : action === 'enable'
      return Response.json({ success: true, extension: engine.setEnabled(id, enabled) })
    }

    return Response.json({ success: false, error: `Ação inválida: ${action}` }, { status: 400 })
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 200 })
  }
}
