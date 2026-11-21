import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject } from '@/lib/agents/store'
import { assignAutoModels } from '@/lib/agents/models'
import type { ChatMessage, CompleteFn } from '@/lib/agents/models'
import type { Provider as LiveProvider, AIModel } from '@/types'
import { act, completion, fakeProviders, json, sleep, tempProject, whoAmI } from './helpers'

function runtime(complete: CompleteFn, providers = fakeProviders()) {
  const rt = new AgentRuntime()
  rt.complete = complete
  rt.providers = async () => providers
  return rt
}

const planoEmEquipe = json({
  complexity: 'medium',
  summary: 'api, tela e testes',
  decisions: [],
  tasks: [
    { id: 'a', title: 'Criar API', description: 'rota', role: 'backend', dependsOn: [], files: ['api.js'] },
    { id: 'b', title: 'Criar tela', description: 'html', role: 'frontend', dependsOn: [], files: ['tela.html'] },
    { id: 'c', title: 'Testar', description: 'valida', role: 'qa', dependsOn: ['a', 'b'], files: [] },
  ],
})

/** Cada agente escreve o seu arquivo e finaliza. */
const modeloEquipe: CompleteFn = async (model, messages: ChatMessage[]) => {
  const me = whoAmI(messages)
  await sleep(10)
  if (me.kind === 'planner') return completion(planoEmEquipe, model)
  if (me.kind === 'report') return completion('# Relatório\npronto', model)
  if (me.kind === 'answer') return completion('ok', model)
  if (me.step > 0) return completion(act('finish', { summary: 'feito' }), model)

  if (me.role === 'Desenvolvedor Backend') return completion(act('write_file', { path: 'api.js', content: 'export const api = 1\n' }), model)
  if (me.role === 'Desenvolvedor Frontend') return completion(act('write_file', { path: 'tela.html', content: '<h1>oi</h1>\n' }), model)
  return completion(act('finish', { summary: 'revisado' }), model)
}

describe('equipe automática a partir do chat', () => {
  it('sem teamId, o plano cria os especialistas que faltam e cada um faz a sua parte', async () => {
    const dir = tempProject()
    const project = createProject(`Equipe ${Math.random()}`, dir)
    const rt = runtime(modeloEquipe)

    // É exatamente o que o chat manda quando decideTeam devolve 'equipe'
    const ctrl = rt.startRun({
      projectId: project.id,
      request: 'crie a api, a tela e os testes',
      teamId: undefined,
      options: { permissionMode: 'autonomo', maxSteps: 6, fixRounds: 0 } as never,
    })
    await ctrl.done

    expect(ctrl.run.autoTeam).toBe(true)
    const papeis = ctrl.run.agents.map(a => a.roleId)
    expect(papeis).toContain('backend')
    expect(papeis).toContain('frontend')
    expect(new Set(papeis).size).toBeGreaterThan(1)

    // Cada especialista entregou o seu arquivo
    expect(fs.existsSync(path.join(dir, 'api.js'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'tela.html'))).toBe(true)

    // E o trabalho ficou registrado por agente, não num monte só
    const autores = new Set(ctrl.run.changes.map(c => c.agentId))
    expect(autores.size).toBeGreaterThan(1)
  }, 60_000)

  it('preset-solo mantém um agente só, como antes', async () => {
    const dir = tempProject()
    const project = createProject(`Solo ${Math.random()}`, dir)
    const rt = runtime(modeloEquipe)
    const ctrl = rt.startRun({
      projectId: project.id,
      request: 'faça algo simples',
      teamId: 'preset-solo',
      options: { permissionMode: 'autonomo', maxSteps: 6, fixRounds: 0 } as never,
    })
    await ctrl.done
    expect(ctrl.run.autoTeam).toBe(false)
  }, 60_000)
})

describe('modelos por agente', () => {
  const agentes = [
    { id: '1', roleId: 'architect', model: 'auto' },
    { id: '2', roleId: 'backend', model: 'auto' },
    { id: '3', roleId: 'frontend', model: 'auto' },
    { id: '4', roleId: 'qa', model: 'auto' },
  ]

  it('com poucos agentes, todos ficam no modelo mais adequado ao papel', () => {
    // A vantagem de casar com o papel (+40) pesa mais que a penalização por
    // reuso (-18 por uso): com 4 agentes ainda compensa usar o melhor modelo.
    const escolhas = assignAutoModels(agentes, fakeProviders())
    expect(escolhas.size).toBe(4)
    expect(new Set(escolhas.values()).size).toBe(1)
  })

  it('com equipe grande, espalha para não concentrar num provedor só', () => {
    // A partir daí a penalização acumulada vence, e a carga se divide — o que
    // também evita estourar a cota por minuto de um provedor gratuito.
    const muitos = Array.from({ length: 8 }, (_, i) => ({
      id: String(i), roleId: ['architect', 'backend', 'frontend', 'qa'][i % 4], model: 'auto',
    }))
    const escolhas = assignAutoModels(muitos, fakeProviders())
    expect(escolhas.size).toBe(8)
    expect(new Set(escolhas.values()).size).toBeGreaterThan(1)
  })

  it('funciona com UM único modelo conectado — todos recebem ele', () => {
    const umModelo: AIModel = {
      id: 'groq|unico', name: 'unico', provider: 'groq', providerName: 'Groq', category: 'chat',
      contextWindow: 128000, maxTokens: 8192, free: true, multimodal: false,
      toolSupport: true, streaming: true, speed: 'fast', status: 'available',
    }
    const soUm: LiveProvider[] = [{ id: 'groq', name: 'Groq', icon: '', envKey: 'X', free: true, status: 'connected', models: [umModelo] }]

    const escolhas = assignAutoModels(agentes, soUm)
    expect(escolhas.size).toBe(4)
    expect([...new Set(escolhas.values())]).toEqual(['groq|unico'])
  })

  it('respeita o modelo escolhido à mão para um agente', () => {
    const escolhas = assignAutoModels(
      [{ id: '1', roleId: 'backend', model: 'gemini|gemini-3.5-flash-lite' }, { id: '2', roleId: 'qa', model: 'auto' }],
      fakeProviders(),
    )
    expect(escolhas.get('1')).toBe('gemini|gemini-3.5-flash-lite')
  })

  it('sem nenhum provedor conectado, ninguém recebe modelo (e o agente reporta o bloqueio)', () => {
    expect(assignAutoModels(agentes, []).size).toBe(0)
  })
})

describe('execução iniciada pelo chat fica na conversa', () => {
  it('conversa nova: a sessão criada é do tipo chat, e reabre no chat', async () => {
    const { getSession } = await import('@/lib/db')
    const dir = tempProject()
    const project = createProject(`Chat kind ${Math.random()}`, dir)
    const rt = runtime(modeloEquipe)
    const ctrl = rt.startRun({
      projectId: project.id, request: 'faça algo', teamId: 'preset-solo', kind: 'chat',
      options: { permissionMode: 'autonomo', maxSteps: 4, fixRounds: 0 } as never,
    })
    await ctrl.done
    expect(getSession(ctrl.run.sessionId)?.kind).toBe('chat')
  }, 60_000)

  it('conversa existente: a execução entra nela, sem criar sessão solta', async () => {
    const { createConversation, getMessages } = await import('@/lib/db')
    const { v4 } = await import('uuid')
    const dir = tempProject()
    const project = createProject(`Chat existente ${Math.random()}`, dir)
    const conversa = v4()
    createConversation(conversa, 'modelo', 'Minha conversa', { projectId: project.id, kind: 'chat' })

    const rt = runtime(modeloEquipe)
    const primeira = rt.startRun({
      sessionId: conversa, projectId: project.id, request: 'primeiro pedido', teamId: 'preset-solo', kind: 'chat',
      options: { permissionMode: 'autonomo', maxSteps: 4, fixRounds: 0 } as never,
    })
    await primeira.done
    const segunda = rt.startRun({
      sessionId: conversa, projectId: project.id, request: 'segundo pedido', teamId: 'preset-solo', kind: 'chat',
      options: { permissionMode: 'autonomo', maxSteps: 4, fixRounds: 0 } as never,
    })
    await segunda.done

    // As duas execuções moram na mesma conversa
    expect(primeira.run.sessionId).toBe(conversa)
    expect(segunda.run.sessionId).toBe(conversa)
    const textos = getMessages(conversa).map(m => m.content)
    expect(textos).toContain('primeiro pedido')
    expect(textos).toContain('segundo pedido')
  }, 60_000)

  it('sem dizer o tipo, continua criando sessão de equipe (workspace)', async () => {
    const { getSession } = await import('@/lib/db')
    const dir = tempProject()
    const project = createProject(`Team kind ${Math.random()}`, dir)
    const rt = runtime(modeloEquipe)
    const ctrl = rt.startRun({
      projectId: project.id, request: 'faça algo', teamId: 'preset-solo',
      options: { permissionMode: 'autonomo', maxSteps: 4, fixRounds: 0 } as never,
    })
    await ctrl.done
    expect(getSession(ctrl.run.sessionId)?.kind).toBe('team')
  }, 60_000)
})
