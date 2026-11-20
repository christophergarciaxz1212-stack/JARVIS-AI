import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject } from '@/lib/agents/store'
import type { ChatMessage, CompleteFn } from '@/lib/agents/models'
import { act, completion, fakeProviders, json, sleep, tempProject, until, whoAmI } from './helpers'

function runtime(complete: CompleteFn) {
  const rt = new AgentRuntime()
  rt.complete = complete
  rt.providers = async () => fakeProviders()
  return rt
}

const onePlan = json({
  complexity: 'small',
  summary: 'plano de teste',
  decisions: [],
  tasks: [{ id: 'a', title: 'Criar arquivo', description: 'cria notas.txt', role: 'backend', dependsOn: [], files: ['notas.txt'] }],
})

/** Modelo falso: planeja uma tarefa e, nela, tenta escrever um arquivo e finaliza. */
function writerModel(onStep?: (step: number, last: string) => void): CompleteFn {
  return async (model, messages: ChatMessage[]) => {
    const me = whoAmI(messages)
    await sleep(10)
    if (me.kind === 'planner') return completion(onePlan, model)
    if (me.kind === 'report') return completion('# Relatório\nfeito', model)
    if (me.kind === 'answer') return completion('ok', model)
    onStep?.(me.step, me.last)
    return completion(
      me.step === 0
        ? act('write_file', { path: 'notas.txt', content: 'conteúdo\n' })
        : act('finish', { summary: 'terminei' }),
      model,
    )
  }
}

const startRun = (rt: AgentRuntime, projectId: string, options: Record<string, unknown>) =>
  rt.startRun({ projectId, request: 'crie notas.txt', teamId: undefined, options: options as never })

describe('modo supervisionado: escrita espera aprovação na conversa', () => {
  it('para no pedido, e depois de aprovar o arquivo é criado de verdade', async () => {
    const dir = tempProject()
    const project = createProject('Gate aprovar', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'supervisionado', maxSteps: 6, fixRounds: 0 })

    // O agente pede aprovação e fica esperando — nada foi escrito ainda.
    await until(() => (ctrl.run.approvals || []).some(a => a.status === 'pending'), 15_000)
    const req = (ctrl.run.approvals || []).find(a => a.status === 'pending')!
    expect(req.tool).toBe('write_file')
    expect(req.summary).toContain('notas.txt')
    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)

    expect(ctrl.decideApproval(req.id, true)).toBe(true)
    await ctrl.done

    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'notas.txt'), 'utf8')).toContain('conteúdo')
  }, 40_000)

  it('negar impede a escrita e o agente é avisado', async () => {
    const dir = tempProject()
    const project = createProject('Gate negar', dir)
    const seen: string[] = []
    const rt = runtime(writerModel((_step, last) => seen.push(last)))
    const ctrl = startRun(rt, project.id, { permissionMode: 'supervisionado', maxSteps: 6, fixRounds: 0 })

    await until(() => (ctrl.run.approvals || []).some(a => a.status === 'pending'), 15_000)
    const req = (ctrl.run.approvals || []).find(a => a.status === 'pending')!
    expect(ctrl.decideApproval(req.id, false)).toBe(true)
    await ctrl.done

    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)
    expect(seen.some(t => t.includes('NEGADO pelo usuário'))).toBe(true)
  }, 40_000)

  it('a mesma decisão não vale duas vezes', async () => {
    const dir = tempProject()
    const project = createProject('Gate dupla', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'supervisionado', maxSteps: 6, fixRounds: 0 })

    await until(() => (ctrl.run.approvals || []).some(a => a.status === 'pending'), 15_000)
    const req = (ctrl.run.approvals || []).find(a => a.status === 'pending')!
    expect(ctrl.decideApproval(req.id, true)).toBe(true)
    expect(ctrl.decideApproval(req.id, true)).toBe(false)
    expect(ctrl.decideApproval('inexistente', true)).toBe(false)
    await ctrl.done
  }, 40_000)
})

describe('modo autônomo', () => {
  it('escreve sem interromper o usuário', async () => {
    const dir = tempProject()
    const project = createProject('Autônomo', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'autonomo', maxSteps: 6, fixRounds: 0 })
    await ctrl.done

    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(true)
    expect((ctrl.run.approvals || []).length).toBe(0)
  }, 40_000)
})

describe('modo restrito', () => {
  it('recusa a escrita sem oferecer aprovação e explica o motivo ao agente', async () => {
    const dir = tempProject()
    const project = createProject('Restrito', dir)
    const seen: string[] = []
    const rt = runtime(writerModel((_step, last) => seen.push(last)))
    const ctrl = startRun(rt, project.id, { permissionMode: 'restrito', maxSteps: 6, fixRounds: 0 })
    await ctrl.done

    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)
    expect((ctrl.run.approvals || []).length).toBe(0)
    expect(seen.some(t => t.includes('RECUSADO') && t.includes('Restrito'))).toBe(true)
  }, 40_000)
})

describe('Plan Mode', () => {
  it('apresenta o plano, não toca no projeto, e executa só depois do aprovar', async () => {
    const dir = tempProject()
    const project = createProject('Plan aprovar', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'autonomo', planFirst: true, maxSteps: 6, fixRounds: 0 })

    await until(() => ctrl.run.status === 'awaiting_plan', 15_000)
    expect(ctrl.run.tasks.length).toBe(1)
    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)

    // Uma espera alheia não aprova o plano por acidente.
    expect(ctrl.decideApproval('nada', true)).toBe(false)
    await sleep(50)
    expect(ctrl.run.status).toBe('awaiting_plan')

    expect(ctrl.approvePlan()).toBe(true)
    await ctrl.done
    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(true)
  }, 40_000)

  it('recusar o plano encerra sem alterar nada', async () => {
    const dir = tempProject()
    const project = createProject('Plan recusar', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'autonomo', planFirst: true, maxSteps: 6, fixRounds: 0 })

    await until(() => ctrl.run.status === 'awaiting_plan', 15_000)
    expect(ctrl.rejectPlan()).toBe(true)
    await ctrl.done

    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)
    expect(ctrl.run.status).toBe('cancelled')
  }, 40_000)
})

describe('cancelamento', () => {
  it('cancelar libera a aprovação pendente — nada fica pendurado', async () => {
    const dir = tempProject()
    const project = createProject('Cancelar', dir)
    const rt = runtime(writerModel())
    const ctrl = startRun(rt, project.id, { permissionMode: 'supervisionado', maxSteps: 6, fixRounds: 0 })

    await until(() => (ctrl.run.approvals || []).some(a => a.status === 'pending'), 15_000)
    ctrl.cancel()
    await ctrl.done

    expect((ctrl.run.approvals || []).every(a => a.status !== 'pending')).toBe(true)
    expect(fs.existsSync(path.join(dir, 'notas.txt'))).toBe(false)
    expect(ctrl.run.status).toBe('cancelled')
  }, 40_000)
})
