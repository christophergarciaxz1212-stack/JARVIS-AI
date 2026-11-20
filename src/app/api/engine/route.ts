import { NextRequest } from 'next/server'
import { getEngine } from '@/lib/engine/engine'
import type { Candidate } from '@/lib/engine/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(e: unknown, status = 400) {
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
}

function cleanKinds(value: unknown): Array<'skill' | 'mcp' | 'tool'> {
  const list = Array.isArray(value) ? value : ['skill', 'mcp', 'tool']
  const kinds = list.filter((k): k is 'skill' | 'mcp' | 'tool' => k === 'skill' || k === 'mcp' || k === 'tool')
  return kinds.length ? kinds : ['skill', 'mcp', 'tool']
}

export async function GET(req: NextRequest) {
  const engine = getEngine()
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'catalog'
  try {
    switch (action) {
      case 'catalog':
        return Response.json({
          extensions: engine.list(),
          settings: engine.settings(),
          approvals: engine.approvals().slice(-50).reverse(),
          opportunities: engine.opportunities().slice(-50).reverse(),
          conflicts: engine.conflicts(),
          running: engine.runningServers(),
          jobs: engine.jobsList(),
          stats: engine.stats(),
        })
      case 'history':
        return Response.json({
          history: engine.history(Number(searchParams.get('limit')) || 200, searchParams.get('id') || undefined),
        })
      case 'job': {
        const job = engine.job(searchParams.get('id') || '')
        if (!job) return fail('Tarefa não encontrada', 404)
        return Response.json({ job })
      }
      case 'recommend':
        return Response.json({
          extensions: engine.recommend(searchParams.get('q') || '', searchParams.get('role') || 'jarvis', Number(searchParams.get('limit')) || 8),
        })
      case 'read': {
        const id = searchParams.get('id') || ''
        const skill = searchParams.get('skill') || undefined
        return Response.json({ content: engine.readSkill(id, 'jarvis', skill) })
      }
      default:
        return fail(`Ação inválida: ${action}`, 404)
    }
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  const engine = getEngine()
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { body = {} }
  const action = String(body.action || '')

  try {
    switch (action) {
      case 'discover':
        return Response.json(await engine.discover(String(body.query || ''), cleanKinds(body.kinds)))

      case 'resolve':
        return Response.json({ candidate: await engine.resolve(String(body.source || '')) })

      case 'inspect': {
        if (typeof body.token === 'string' && body.token) return Response.json(engine.inspectToken(body.token))
        if (typeof body.source === 'string' && body.source) return Response.json(await engine.inspectSource(body.source))
        if (body.candidate && typeof body.candidate === 'object') return Response.json(await engine.inspect(body.candidate as Candidate))
        return fail('Envie candidate, source ou token para analisar')
      }

      case 'install': {
        const opts = {
          requestedBy: String(body.requestedBy || 'usuário'),
          approved: body.approved === true,
          grantEnv: Array.isArray(body.grantEnv) ? body.grantEnv.map(String) : undefined,
        }
        if (typeof body.source === 'string' && body.source) return Response.json(await engine.installSource(body.source, opts))
        const input = {
          token: typeof body.token === 'string' ? body.token : undefined,
          candidate: body.candidate && typeof body.candidate === 'object' ? body.candidate as Candidate : undefined,
        }
        return Response.json(await engine.install(input, opts))
      }

      case 'approve':
      case 'deny': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da aprovação')
        return Response.json(await engine.decideApproval(id, action === 'approve', Array.isArray(body.grantEnv) ? body.grantEnv.map(String) : []))
      }

      case 'update': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        return Response.json(await engine.update(id, 'usuário'))
      }

      case 'update-all':
        return Response.json({ job: engine.startJob('update-all', 'Atualizar todas as extensões', log => engine.updateAll('usuário', log)) })

      case 'check-updates':
        return Response.json({ found: await engine.checkUpdates() })

      case 'test': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        return Response.json(await engine.test(id))
      }

      case 'test-all':
        return Response.json({ job: engine.startJob('test-all', 'Testar todas as extensões', log => engine.testAll(log)) })

      case 'enable':
      case 'disable': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        return Response.json({ extension: engine.setEnabled(id, action === 'enable') })
      }

      case 'remove': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        await engine.remove(id)
        return Response.json({ ok: true })
      }

      case 'restore': {
        const id = String(body.id || '')
        const dir = String(body.dir || '')
        if (!id || !dir) return fail('Informe a extensão e a versão')
        return Response.json({ extension: await engine.restore(id, dir) })
      }

      case 'repair': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        return Response.json(await engine.repair(id))
      }

      case 'permissions': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        const patch = (body.patch && typeof body.patch === 'object' ? body.patch : {}) as Record<string, unknown>
        return Response.json({
          extension: engine.setPermissions(id, {
            ...(typeof patch.network === 'boolean' ? { network: patch.network } : {}),
            ...(typeof patch.shell === 'boolean' ? { shell: patch.shell } : {}),
            ...(typeof patch.fsWrite === 'boolean' ? { fsWrite: patch.fsWrite } : {}),
            ...(Array.isArray(patch.env) ? { env: patch.env.map(String) } : {}),
            ...(Array.isArray(patch.agents) ? { agents: patch.agents.map(String) } : {}),
          }),
        })
      }

      case 'setup': {
        const id = String(body.id || '')
        if (!id) return fail('Informe o id da extensão')
        const raw = (body.values && typeof body.values === 'object' ? body.values : {}) as Record<string, unknown>
        const values = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]))
        const r = await engine.configure(id, values)
        return Response.json({ extension: r.ext, test: r.test })
      }

      case 'settings': {
        const patch = (body.settings && typeof body.settings === 'object' ? body.settings : body) as Record<string, unknown>
        const next: Record<string, unknown> = {}
        if (patch.autonomy === 'manual' || patch.autonomy === 'assisted' || patch.autonomy === 'autonomous') next.autonomy = patch.autonomy
        for (const key of ['autoUpdate', 'autoCreate', 'autoOptimize']) {
          if (typeof patch[key] === 'boolean') next[key] = patch[key]
        }
        return Response.json({ settings: engine.setSettings(next) })
      }

      case 'create': {
        const need = String(body.need || '').trim()
        if (!need) return fail('Descreva o que a Skill deve fazer')
        return Response.json({
          job: engine.startJob('create', `Criar Skill: ${need.slice(0, 80)}`, log => engine.create(need, 'usuário', log)),
        })
      }

      case 'acquire': {
        const need = String(body.need || '').trim()
        if (!need) return fail('Descreva a necessidade')
        return Response.json({
          job: engine.startJob('acquire', `Adquirir capacidade: ${need.slice(0, 80)}`, log => engine.acquire(need, 'usuário', log)),
        })
      }

      case 'optimize':
        return Response.json({ job: engine.startJob('optimize', 'Pesquisar melhorias e alternativas', log => engine.optimize(8, log)) })

      case 'self-check':
        return Response.json({ job: engine.startJob('self-check', 'Verificação completa do ecossistema', log => engine.selfCheck(log)) })

      case 'dismiss-opportunity': {
        const id = String(body.id || '')
        if (!id) return fail('Informe a oportunidade')
        engine.dismissOpportunity(id)
        return Response.json({ ok: true })
      }

      case 'read-skill':
        return Response.json({ content: engine.readSkill(String(body.id || ''), 'jarvis', body.skill ? String(body.skill) : undefined) })

      case 'call': {
        const id = String(body.id || '')
        const tool = String(body.tool || '')
        if (!id || !tool) return fail('Informe a extensão e a ferramenta')
        const args = body.args && typeof body.args === 'object' ? body.args as Record<string, unknown> : {}
        return Response.json({ output: await engine.callTool(id, tool, args, 'jarvis') })
      }

      default:
        return fail(`Ação inválida: ${action}`, 404)
    }
  } catch (e) {
    return fail(e)
  }
}
