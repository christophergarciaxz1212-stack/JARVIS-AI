import { NextRequest } from 'next/server'
import { getRuntime } from '@/lib/agents/runtime'
import { ROLE_MAP } from '@/lib/agents/roles'
import { acceptFile, revertFile } from '@/lib/agents/changes'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rt = getRuntime()
  try {
    const body = await req.json()
    const action = String(body.action || '')

    if (action === 'resume-run') return Response.json({ run: rt.resumeRun(id).run })
    // Decisão por arquivo: aceitar mantém a alteração; reverter devolve o original.
    if (action === 'accept-file' || action === 'revert-file') {
      const run = rt.getRun(id)
      if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })
      const rel = String(body.file || '')
      if (!rel) return Response.json({ error: 'Informe o arquivo' }, { status: 400 })
      const out = action === 'accept-file' ? acceptFile(run, rel) : revertFile(run, rel)
      return out.ok ? Response.json({ ok: true, action: out.action }) : Response.json({ error: out.reason }, { status: 400 })
    }
    if (action === 'rollback') {
      if (body.confirm !== true) return Response.json({ error: 'Confirmação obrigatória para reverter' }, { status: 400 })
      return Response.json({ ok: true, ...rt.rollback(id) })
    }

    const ctrl = rt.runs.get(id)
    if (!ctrl || ctrl.abort.signal.aborted) {
      return Response.json({ error: 'Esta execução não está ativa. Use "Retomar" para continuá-la.' }, { status: 409 })
    }
    const agentId = String(body.agentId || '')

    switch (action) {
      case 'pause': ctrl.pause(); break
      case 'resume': ctrl.resume(); break
      case 'cancel': ctrl.cancel(); break
      case 'agent-pause': ctrl.pauseAgent(agentId); break
      case 'agent-resume': ctrl.resumeAgent(agentId); break
      case 'agent-stop': ctrl.stopAgent(agentId); break
      case 'agent-restart': ctrl.restartAgent(agentId); break
      case 'agent-remove': ctrl.removeAgent(agentId); break
      case 'agent-add': {
        const roleId = String(body.roleId || 'fullstack')
        if (!ROLE_MAP.has(roleId)) return Response.json({ error: `Papel desconhecido "${roleId}": use um dos papéis da equipe` }, { status: 400 })
        ctrl.addAgent({ roleId, model: String(body.model || 'auto'), name: body.name, scope: body.scope, responsibilities: body.responsibilities })
        break
      }
      case 'agent-config':
        ctrl.configureAgent(agentId, { model: body.model, name: body.name, scope: body.scope, responsibilities: body.responsibilities })
        break
      case 'scope-approve':
      case 'scope-deny':
        if (!ctrl.decideScope(String(body.requestId), action === 'scope-approve')) return Response.json({ error: 'Pedido não encontrado ou já decidido' }, { status: 404 })
        break
      case 'approve':
      case 'deny':
        if (!ctrl.decideApproval(String(body.approvalId), action === 'approve')) {
          return Response.json({ error: 'Pedido de aprovação não encontrado ou já decidido' }, { status: 404 })
        }
        break
      case 'plan-approve':
        if (!ctrl.approvePlan()) return Response.json({ error: 'Esta execução não está esperando aprovação de plano' }, { status: 409 })
        break
      case 'plan-reject':
        if (!ctrl.rejectPlan()) return Response.json({ error: 'Esta execução não está esperando aprovação de plano' }, { status: 409 })
        break
      case 'cancel-task': {
        const taskId = String(body.taskId || '')
        if (!taskId) return Response.json({ error: 'Informe a tarefa a cancelar' }, { status: 400 })
        if (!ctrl.cancelTask(taskId)) return Response.json({ error: 'Tarefa não encontrada nesta execução' }, { status: 404 })
        break
      }
      case 'message':
        ctrl.userMessage(String(body.to || 'all'), String(body.content || ''))
        break
      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
    ctrl.persistNow()
    return Response.json({ ok: true, run: ctrl.run })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
