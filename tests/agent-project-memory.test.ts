import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  appendMemory, clearMemory, memorySummary, projectContext, readInstructions,
  readMemory, removeMemory, sanitizeMemory, writeMemory,
} from '@/lib/agents/projectMemory'
import { dataDir } from '@/lib/agents/fsutil'
import { tempProject } from './helpers'

const novoId = () => `proj-${Math.random().toString(36).slice(2)}`

describe('arquivos de instrução do projeto', () => {
  it('lê JARVIS.md da raiz', () => {
    const dir = tempProject({ 'JARVIS.md': '# Regras\nUse tabs.\n' })
    const out = readInstructions(dir)!
    expect(out.file).toBe('JARVIS.md')
    expect(out.content).toContain('Use tabs')
  })

  it('aceita CLAUDE.md e AGENTS.md, que já são padrão entre agentes', () => {
    expect(readInstructions(tempProject({ 'CLAUDE.md': 'regra A' }))!.file).toBe('CLAUDE.md')
    expect(readInstructions(tempProject({ 'AGENTS.md': 'regra B' }))!.file).toBe('AGENTS.md')
    expect(readInstructions(tempProject({ '.github/copilot-instructions.md': 'regra C' }))!.file)
      .toBe('.github/copilot-instructions.md')
  })

  it('JARVIS.md tem precedência sobre os outros', () => {
    const dir = tempProject({ 'JARVIS.md': 'do jarvis', 'CLAUDE.md': 'do claude' })
    const out = readInstructions(dir)!
    expect(out.file).toBe('JARVIS.md')
    expect(out.content).toContain('do jarvis')
  })

  it('ignora arquivo vazio e pasta sem instrução', () => {
    expect(readInstructions(tempProject({ 'JARVIS.md': '   \n' }))).toBeNull()
    expect(readInstructions(tempProject({ 'README.md': 'nada aqui' }))).toBeNull()
    expect(readInstructions('')).toBeNull()
  })
})

describe('memória guardada', () => {
  it('começa vazia e guarda o que foi escrito', () => {
    const id = novoId()
    expect(readMemory(id).objetivo).toBe('')

    writeMemory(id, { objetivo: 'App financeiro', tecnologias: 'Next.js, SQLite' })
    const m = readMemory(id)
    expect(m.objetivo).toBe('App financeiro')
    expect(m.tecnologias).toBe('Next.js, SQLite')
    expect(m.updatedAt).toBeGreaterThan(0)
  })

  it('escrita parcial não apaga os outros campos', () => {
    const id = novoId()
    writeMemory(id, { objetivo: 'A', arquitetura: 'B' })
    writeMemory(id, { objetivo: 'A2' })
    const m = readMemory(id)
    expect(m.objetivo).toBe('A2')
    expect(m.arquitetura).toBe('B')
  })

  it('acrescenta decisões sem repetir', () => {
    const id = novoId()
    appendMemory(id, 'decisoes', 'Usar SQLite')
    appendMemory(id, 'decisoes', 'usar sqlite')
    appendMemory(id, 'decisoes', 'Evitar ORM')
    expect(readMemory(id).decisoes).toEqual(['Usar SQLite', 'Evitar ORM'])
  })

  it('remove e apaga o que não vale mais', () => {
    const id = novoId()
    appendMemory(id, 'pendencias', 'Escrever testes')
    appendMemory(id, 'pendencias', 'Revisar CSS')
    removeMemory(id, 'pendencias', 'Revisar CSS')
    expect(readMemory(id).pendencias).toEqual(['Escrever testes'])

    clearMemory(id)
    expect(readMemory(id).pendencias).toEqual([])
    expect(readMemory(id).objetivo).toBe('')
  })

  it('recusa registro vazio', () => {
    expect(() => appendMemory(novoId(), 'decisoes', '   ')).toThrow('Escreva o que registrar')
    expect(() => writeMemory('', { objetivo: 'x' })).toThrow('Informe o projeto')
  })

  it('não confunde a memória de projetos diferentes', () => {
    const a = novoId()
    const b = novoId()
    writeMemory(a, { objetivo: 'Projeto A' })
    writeMemory(b, { objetivo: 'Projeto B' })
    expect(readMemory(a).objetivo).toBe('Projeto A')
    expect(readMemory(b).objetivo).toBe('Projeto B')
  })

  it('sobrevive a um arquivo corrompido no disco', () => {
    const id = novoId()
    writeMemory(id, { objetivo: 'ok' })
    const file = path.join(dataDir(), 'projects', id, 'memory.json')
    fs.writeFileSync(file, '{ isso não é json', 'utf-8')
    expect(readMemory(id).objetivo).toBe('')
  })
})

describe('higienização', () => {
  it('descarta o que não é do formato e limita as listas', () => {
    const m = sanitizeMemory({
      objetivo: 'ok', decisoes: ['uma', '', null, 'duas'], pendencias: 'não é lista',
      lixo: 'ignorado',
    })
    expect(m.objetivo).toBe('ok')
    expect(m.decisoes).toEqual(['uma', 'duas'])
    expect(m.pendencias).toEqual([])
    expect('lixo' in m).toBe(false)
  })
})

describe('bloco enviado ao agente', () => {
  it('junta instruções do arquivo e memória guardada', () => {
    const id = novoId()
    const dir = tempProject({ 'CLAUDE.md': '# Convenções\nSempre em português.' })
    writeMemory(id, { objetivo: 'Sistema de notas', convencoes: 'Sem any' })
    appendMemory(id, 'decisoes', 'Banco em SQLite')
    appendMemory(id, 'pendencias', 'Falta login')

    const ctx = projectContext({ projectId: id, root: dir })
    expect(ctx).toContain('CLAUDE.md')
    expect(ctx).toContain('Sempre em português')
    expect(ctx).toContain('Sistema de notas')
    expect(ctx).toContain('Sem any')
    expect(ctx).toContain('- Banco em SQLite')
    expect(ctx).toContain('- Falta login')
  })

  it('projeto sem nada devolve bloco vazio, sem poluir o prompt', () => {
    expect(projectContext({ projectId: novoId(), root: tempProject() })).toBe('')
  })

  it('campos vazios não viram seções vazias', () => {
    const id = novoId()
    writeMemory(id, { objetivo: 'Só isso' })
    const ctx = projectContext({ projectId: id, root: tempProject() })
    expect(ctx).toContain('Objetivo')
    expect(ctx).not.toContain('Arquitetura')
    expect(ctx).not.toContain('Pendências')
  })
})

describe('resumo para a interface', () => {
  it('conta o que está preenchido e aponta o arquivo de instrução', () => {
    const id = novoId()
    const dir = tempProject({ 'AGENTS.md': 'regras' })
    writeMemory(id, { objetivo: 'A', arquitetura: 'B' })
    appendMemory(id, 'decisoes', 'X')

    const s = memorySummary(id, dir)
    expect(s.instructionsFile).toBe('AGENTS.md')
    expect(s.filled).toBe(2)
    expect(s.decisoes).toBe(1)
    expect(s.pendencias).toBe(0)
  })
})

describe('o agente recebe a memória na execução', () => {
  it('instruções do projeto e memória chegam ao planejador e à tarefa', async () => {
    const { AgentRuntime } = await import('@/lib/agents/runtime')
    const { createProject } = await import('@/lib/agents/store')
    const { act, completion, fakeProviders, json, whoAmI } = await import('./helpers')
    const type = await import('@/lib/agents/models')

    const dir = tempProject({ 'CLAUDE.md': '# Regra de ouro\nNunca use a palavra proibida XYZZY.' })
    const project = createProject(`Memo ${Math.random()}`, dir)
    writeMemory(project.id, { convencoes: 'Indentar com 2 espaços' })
    appendMemory(project.id, 'decisoes', 'Banco escolhido: SQLite')

    const prompts: string[] = []
    const rt = new AgentRuntime()
    rt.providers = async () => fakeProviders()
    rt.complete = (async (model: string, messages: Array<{ role: string; content: string }>) => {
      prompts.push(messages.map(m => m.content).join('\n'))
      const me = whoAmI(messages as never)
      if (me.kind === 'planner') {
        return completion(json({
          complexity: 'small', summary: 's', decisions: [],
          tasks: [{ id: 'a', title: 'Olhar o projeto', description: 'ler', role: 'backend', dependsOn: [], files: [] }],
        }), model)
      }
      if (me.kind === 'report') return completion('ok', model)
      return completion(act('finish', { summary: 'li tudo' }), model)
    }) as typeof type.defaultComplete

    const ctrl = rt.startRun({
      projectId: project.id,
      request: 'analise o projeto',
      options: { permissionMode: 'restrito', maxSteps: 4, fixRounds: 0 } as never,
    })
    await ctrl.done

    const tudo = prompts.join('\n---\n')
    expect(tudo).toContain('CLAUDE.md')
    expect(tudo).toContain('XYZZY')
    expect(tudo).toContain('Indentar com 2 espaços')
    expect(tudo).toContain('Banco escolhido: SQLite')
  }, 40_000)
})
