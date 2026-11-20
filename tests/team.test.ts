import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject, readEvents, saveRun, listRuns } from '@/lib/agents/store'
import { createConversation, getMessages, getSession, listSessions, updateSession, duplicateSession, addMessage } from '@/lib/db'
import { sessionDir } from '@/lib/agents/fsutil'
import type { ChatMessage, CompleteFn } from '@/lib/agents/models'
import type { Run } from '@/lib/agents/types'
import { act, acts, completion, fakeProviders, json, sleep, tempProject, until, whoAmI } from './helpers'

function runtime(complete: CompleteFn) {
  const rt = new AgentRuntime()
  rt.complete = complete
  rt.providers = async () => fakeProviders()
  return rt
}

const plan = (complexity: string, tasks: unknown[]) => json({ complexity, summary: 'plano de teste', decisions: ['decisão A'], tasks })

describe('equipe completa (planejamento, paralelismo, comunicação, correção, relatório)', () => {
  it('executa um pedido de ponta a ponta com agentes reais do runtime', async () => {
    const dir = tempProject({ 'README.md': '# Projeto original\n' })
    const project = createProject('Teste', dir)
    const calls: Array<{ who: string; at: number }> = []

    const complete: CompleteFn = async (model, messages: ChatMessage[]) => {
      const me = whoAmI(messages)
      calls.push({ who: me.kind === 'agent' ? `${me.role}:${me.task}` : me.kind, at: Date.now() })
      await sleep(40)
      if (me.kind === 'planner') {
        return completion(plan('medium', [
          { id: 'a', title: 'Criar API', description: 'função soma', role: 'backend', dependsOn: [], files: ['server/api.js'] },
          { id: 'b', title: 'Criar página', description: 'html', role: 'frontend', dependsOn: [], files: ['web/index.html'] },
          { id: 'c', title: 'Testar', description: 'validar', role: 'qa', dependsOn: ['a', 'b'], files: [] },
        ]), model)
      }
      if (me.kind === 'answer') return completion('Use a rota /api/soma.', model)
      if (me.kind === 'report') return completion('# Relatório\nTudo certo.', model)

      if (me.role === 'Desenvolvedor Backend') {
        if (me.last.includes('Corrija os problemas')) {
          return completion(me.step === 0
            ? act('edit_file', { path: 'server/api.js', old_text: 'a+b', new_text: 'Number(a)+Number(b)' })
            : act('finish', { summary: 'validação adicionada' }), model)
        }
        return completion(me.step === 0
          ? acts(['write_file', { path: 'server/api.js', content: 'export const soma=(a,b)=>a+b\n' }], ['send_message', { to: 'architect', kind: 'question', content: 'Qual rota usar?' }])
          : act('finish', { summary: 'API criada em server/api.js' }), model)
      }
      if (me.role === 'Desenvolvedor Frontend') {
        return completion(me.step === 0
          ? acts(['write_file', { path: 'web/index.html', content: '<h1>Soma</h1>\n' }], ['write_file', { path: 'server/hack.js', content: 'x' }])
          : act('finish', { summary: 'página criada' }), model)
      }
      if (me.role === 'QA / Tester') {
        if (me.last.includes('Confirme se os problemas')) return completion(act('finish', { summary: 'correção confirmada', status: 'done' }), model)
        return completion(me.step === 0
          ? act('read_file', { path: 'server/api.js' })
          : act('finish', { summary: 'falta validar entrada', status: 'issues', issues: [{ description: 'soma não valida números', role: 'backend' }] }), model)
      }
      return completion(act('finish', { summary: 'ok' }), model)
    }

    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'Crie uma API de soma, uma página e testes' })
    await ctrl.done
    const run = ctrl.run

    expect(run.status).toBe('completed')
    expect(run.complexity).toBe('medium')
    expect(run.agents.map(a => a.roleId).sort()).toEqual(['architect', 'backend', 'frontend', 'qa'])

    // Real parallelism: backend and frontend tasks overlapped in time
    const t1 = run.tasks.find(t => t.id === 't1')!
    const t2 = run.tasks.find(t => t.id === 't2')!
    expect(t1.startedAt! < t2.finishedAt! && t2.startedAt! < t1.finishedAt!).toBe(true)
    // QA only started after both
    const t3 = run.tasks.find(t => t.id === 't3')!
    expect(t3.startedAt!).toBeGreaterThanOrEqual(Math.max(t1.finishedAt!, t2.finishedAt!))

    // Fix round: a fix task for backend and a verification task for QA, both done
    const fix = run.tasks.find(t => t.kind === 'fix')!
    expect(fix.roleId).toBe('backend')
    expect(fix.status).toBe('done')
    expect(run.tasks.find(t => t.kind === 'verify' && t.dependsOn.includes(fix.id))?.status).toBe('done')

    // Files really written, scope enforced
    expect(fs.readFileSync(path.join(dir, 'server/api.js'), 'utf-8')).toContain('Number(a)+Number(b)')
    expect(fs.existsSync(path.join(dir, 'web/index.html'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'server/hack.js'))).toBe(false)
    expect(run.changes.map(c => c.path)).toEqual(expect.arrayContaining(['server/api.js', 'web/index.html']))

    // Communication: question answered by the idle architect, decision + done messages
    const q = run.messages.find(m => m.kind === 'question')!
    expect(q.to).toBe('architect')
    expect(run.messages.some(m => m.kind === 'answer' && m.from === 'architect' && m.to === 'backend')).toBe(true)
    expect(run.messages.some(m => m.kind === 'decision')).toBe(true)
    expect(run.messages.filter(m => m.kind === 'done').length).toBeGreaterThanOrEqual(3)

    // Usage, logs, report, session history
    expect(run.usage.inputTokens).toBeGreaterThan(0)
    const events = readEvents(run.sessionId, run.id, 1000)
    expect(events.some(e => e.type === 'tool_error' && /fora do seu escopo/.test(e.message))).toBe(true)
    expect(events.some(e => e.type === 'llm_call')).toBe(true)
    expect(run.report).toContain('Relatório')
    const msgs = getMessages(run.sessionId)
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(getSession(run.sessionId)?.status).toBe('completed')

    // Rollback restores the project: created files removed, original README untouched
    const rb = rt.rollback(run.id)
    expect(rb.removed).toBe(2)
    expect(fs.existsSync(path.join(dir, 'server/api.js'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8')).toBe('# Projeto original\n')
  })
})

describe('modelos', () => {
  it('troca automaticamente um modelo com limite de requisições (429)', async () => {
    const dir = tempProject()
    const project = createProject('Fallback', dir)
    const used: string[] = []
    const complete: CompleteFn = async (model, messages) => {
      used.push(model)
      if (model === 'gemini|gemini-3.5-flash-lite') throw Object.assign(new Error('Rate limit reached for model. Please try again in 20s'), { status: 429 })
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(plan('trivial', [{ id: 'x', title: 'Ajuste', description: 'css', role: 'fullstack', dependsOn: [], files: ['a.css'] }]), model)
      if (me.kind === 'report') return completion('ok', model)
      return completion(me.step === 0 ? act('write_file', { path: 'a.css', content: 'body{}' }) : act('finish', { summary: 'feito' }), model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'corrija o css' })
    await ctrl.done
    expect(ctrl.run.status).toBe('completed')
    // Trivial request: only planner + one worker, not the whole team
    expect(ctrl.run.agents.length).toBe(2)
    const events = readEvents(ctrl.run.sessionId, ctrl.run.id, 1000)
    expect(events.some(e => e.type === 'model_switched')).toBe(true)
    expect(used.filter(m => m === 'gemini|gemini-3.5-flash-lite').length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(dir, 'a.css'))).toBe(true)
  })
})

describe('concorrência e controle', () => {
  it('impede dois agentes de escreverem o mesmo arquivo ao mesmo tempo', async () => {
    const dir = tempProject()
    const project = createProject('Locks', dir)
    const complete: CompleteFn = async (model, messages) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') {
        return completion(plan('small', [
          { id: 'a', title: 'A', description: 'a', role: 'backend', dependsOn: [], files: ['shared.js'] },
          { id: 'b', title: 'B', description: 'b', role: 'fullstack', dependsOn: [], files: ['shared.js'] },
        ]), model)
      }
      if (me.kind === 'report') return completion('ok', model)
      if (me.role === 'Desenvolvedor Backend') {
        if (me.step === 0) return completion(act('write_file', { path: 'shared.js', content: 'backend\n' }), model)
        await sleep(250) // keeps its task (and the lock) open
        return completion(act('finish', { summary: 'a' }), model)
      }
      if (me.step === 0) { await sleep(60); return completion(act('write_file', { path: 'shared.js', content: 'fullstack\n' }), model) }
      return completion(act('finish', { summary: 'b' }), model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'editar shared' })
    await ctrl.done
    const run = ctrl.run
    const backendTask = run.tasks.find(t => t.roleId === 'backend')!
    const fsChange = run.changes.find(c => c.agentId === 'fullstack')!
    expect(fsChange.at).toBeGreaterThanOrEqual(backendTask.finishedAt!)
    expect(readEvents(run.sessionId, run.id, 1000).some(e => e.type === 'lock_wait')).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'shared.js'), 'utf-8')).toBe('fullstack\n')
  })

  it('escrita fora do escopo só acontece depois da aprovação do usuário', async () => {
    const dir = tempProject()
    const project = createProject('Escopo', dir)
    let ctrlRef: { run: Run } | undefined
    const complete: CompleteFn = async (model, messages) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(plan('trivial', [{ id: 'a', title: 'UI', description: 'ui', role: 'frontend', dependsOn: [], files: [] }]), model)
      if (me.kind === 'report') return completion('ok', model)
      if (me.step === 0) return completion(act('request_scope', { path: 'server/config.js', reason: 'precisa da porta' }), model)
      if (me.step === 1) {
        await until(() => ctrlRef!.run.scopeRequests.some(r => r.status === 'approved'))
        return completion(act('write_file', { path: 'server/config.js', content: 'export default 3000\n' }), model)
      }
      return completion(act('finish', { summary: 'ok' }), model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'ui' })
    ctrlRef = ctrl
    await until(() => ctrl.run.scopeRequests.length > 0)
    expect(fs.existsSync(path.join(dir, 'server/config.js'))).toBe(false)
    expect(ctrl.decideScope(ctrl.run.scopeRequests[0].id, true)).toBe(true)
    await ctrl.done
    expect(fs.readFileSync(path.join(dir, 'server/config.js'), 'utf-8')).toContain('3000')
  })

  it('pausa, retoma e cancela de verdade', async () => {
    const dir = tempProject()
    const project = createProject('Controle', dir)
    let agentCalls = 0
    const complete: CompleteFn = async (model, messages, signal) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(plan('trivial', [{ id: 'a', title: 'loop', description: 'x', role: 'fullstack', dependsOn: [], files: [] }]), model)
      agentCalls++
      // Long call that only ends when aborted
      await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      return completion('', model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'x' })
    await until(() => agentCalls === 1)
    ctrl.pause()
    expect(ctrl.run.status).toBe('paused')
    ctrl.resume()
    expect(ctrl.run.status).toBe('running')
    const t0 = Date.now()
    ctrl.cancel()
    await ctrl.done
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(ctrl.run.status).toBe('cancelled')
    expect(rt.locks.held().length).toBe(0)
  })

  it('interromper um agente devolve a tarefa à fila e reiniciar retoma', async () => {
    const dir = tempProject()
    const project = createProject('Interromper', dir)
    let calls = 0
    const complete: CompleteFn = async (model, messages, signal) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(plan('trivial', [{ id: 'a', title: 'w', description: 'x', role: 'fullstack', dependsOn: [], files: ['w.txt'] }]), model)
      if (me.kind === 'report') return completion('ok', model)
      calls++
      if (calls === 1) {
        await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      }
      return completion(me.step === 0 ? act('write_file', { path: 'w.txt', content: 'ok' }) : act('finish', { summary: 'ok' }), model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'x' })
    await until(() => calls === 1)
    ctrl.stopAgent('fullstack')
    await until(() => ctrl.run.tasks[0].status === 'pending')
    expect(ctrl.run.agents.find(a => a.id === 'fullstack')!.status).toBe('paused')
    ctrl.restartAgent('fullstack')
    await ctrl.done
    expect(ctrl.run.status).toBe('completed')
    expect(fs.readFileSync(path.join(dir, 'w.txt'), 'utf-8')).toBe('ok')
  })

  it('marca como interrompidas as execuções abertas quando o app fechou', () => {
    const project = createProject('Recover', tempProject())
    const sid = 'sess-recover'
    createConversation(sid, 'equipe', 'x', { projectId: project.id, kind: 'team' })
    const run = { id: 'run-recover', sessionId: sid, projectId: project.id, projectPath: project.path, request: 'x', status: 'running', autoTeam: true, agents: [], tasks: [{ id: 't1', status: 'running' }], messages: [], changes: [], scopeRequests: [], decisions: [], options: { maxParallel: 1, maxSteps: 3, fixRounds: 0, autoFallback: true }, usage: { inputTokens: 0, outputTokens: 0 }, createdAt: 1, eventCount: 0 } as unknown as Run
    saveRun(run)
    new AgentRuntime().recover()
    const after = listRuns(sid)[0]
    expect(after.status).toBe('interrupted')
    expect(after.tasks[0].status).toBe('pending')
    expect(getSession(sid)?.status).toBe('paused')
  })
})

describe('sessões', () => {
  it('cria, renomeia, arquiva, pesquisa, duplica e exclui de verdade', async () => {
    const dir = tempProject({ 'keep.txt': 'não apague' })
    const project = createProject('Sessões', dir)
    createConversation('s1', 'm', 'Banco de dados', { projectId: project.id })
    createConversation('s2', 'm', 'Outra', { projectId: project.id })
    addMessage({ id: 'm1', conversationId: 's2', role: 'user', content: 'pergunta sobre normalização' })

    updateSession('s1', { title: 'Trabalho de BD' })
    expect(getSession('s1')?.title).toBe('Trabalho de BD')

    expect(listSessions({ projectId: project.id, q: 'normalização' }).map(s => s.id)).toEqual(['s2'])
    expect(listSessions({ projectId: project.id, q: 'trabalho' }).map(s => s.id)).toEqual(['s1'])

    updateSession('s1', { archived: true })
    expect(listSessions({ projectId: project.id, archived: false }).map(s => s.id)).toEqual(['s2'])
    updateSession('s1', { archived: false, status: 'completed' })
    expect(listSessions({ projectId: project.id, status: 'completed' }).map(s => s.id)).toEqual(['s1'])

    const copy = duplicateSession('s2', 's3', () => `m-${Math.random()}`)!
    expect(copy.title).toContain('(cópia)')
    expect(getMessages('s3')[0].content).toContain('normalização')

    // Session with run data on disk
    fs.mkdirSync(path.join(sessionDir('s2'), 'runs'), { recursive: true })
    fs.writeFileSync(path.join(sessionDir('s2'), 'runs', 'r.json'), '{}')
    const rt = runtime(async (m) => completion('', m))
    const removed = await rt.deleteSessions(['s2', 's3'])
    expect(removed.sessions).toBe(2)
    expect(removed.messages).toBe(2)
    expect(getSession('s2')).toBeUndefined()
    expect(getMessages('s3')).toEqual([])
    expect(fs.existsSync(sessionDir('s2'))).toBe(false)
    // Project files are never touched by session deletion
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf-8')).toBe('não apague')
  })

  it('excluir uma sessão em execução para o trabalho antes de apagar', async () => {
    const project = createProject('ExcluirAtiva', tempProject())
    const complete: CompleteFn = async (model, messages, signal) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(plan('trivial', [{ id: 'a', title: 'x', description: 'x', role: 'fullstack', dependsOn: [], files: [] }]), model)
      await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      return completion('', model)
    }
    const rt = runtime(complete)
    const ctrl = rt.startRun({ projectId: project.id, request: 'x' })
    await until(() => ctrl.run.status === 'running' && ctrl.run.tasks.some(t => t.status === 'running'))
    const removed = await rt.deleteSessions([ctrl.run.sessionId])
    expect(removed.sessions).toBe(1)
    expect(ctrl.run.status).toBe('cancelled')
    expect(fs.existsSync(sessionDir(ctrl.run.sessionId))).toBe(false)
    expect(rt.isSessionRunning(ctrl.run.sessionId)).toBe(false)
  })
})
