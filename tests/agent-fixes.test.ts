import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject } from '@/lib/agents/store'
import { parseAgentTurn } from '@/lib/agents/parse'
import { canWrite, commandWriteTargets, executeTool, type ToolHost } from '@/lib/agents/tools'
import { retryable } from '@/lib/agents/orchestrator'
import type { CompleteFn } from '@/lib/agents/models'
import { act, completion, fakeProviders, json, tempProject, whoAmI } from './helpers'

describe('ferramentas dos agentes: formatos que os modelos usam na prática', () => {
  it('argumentos soltos, "arguments" em texto, "parameters", "input" e "function"', () => {
    const cases: Array<[string, string]> = [
      ['{"actions":[{"tool":"write_file","path":"a.js","content":"x"}]}', 'soltos ao lado de "tool"'],
      ['{"actions":[{"tool":"write_file","arguments":"{\\"path\\":\\"a.js\\",\\"content\\":\\"x\\",}"}]}', '"arguments" como texto com vírgula sobrando'],
      ['{"actions":[{"tool":"write_file","parameters":{"path":"a.js","content":"x"}}]}', '"parameters"'],
      ['{"actions":[{"name":"write_file","input":{"path":"a.js","content":"x"}}]}', '"name" + "input"'],
      ['{"tool_calls":[{"function":{"name":"write_file","arguments":"{\\"path\\":\\"a.js\\",\\"content\\":\\"x\\"}"}}]}', 'tool_calls estilo OpenAI'],
      ['{"tool":"write_file","path":"a.js","content":"x"}', 'ação única sem lista'],
    ]
    for (const [text, label] of cases) {
      const t = parseAgentTurn(text)
      expect(t.actions[0], label).toEqual({ tool: 'write_file', args: { path: 'a.js', content: 'x' } })
    }
    // o formato oficial continua igual
    expect(parseAgentTurn('{"thought":"t","actions":[{"tool":"read_file","args":{"path":"b.ts"}}]}').actions[0].args).toEqual({ path: 'b.ts' })
  })

  it('parâmetro faltando: o erro diz o que chegou e mostra o formato certo', async () => {
    const host = { root: '.', agent: { scope: [] }, extraScope: () => [] } as unknown as ToolHost
    await expect(executeTool(host, { tool: 'write_file', args: { content: 'x' } }))
      .rejects.toThrow(/"path" é obrigatório \(recebi: content\)\. Formato: \{"tool": "write_file", "args": \{"path": "src\/a\.ts", "content"/)
    await expect(executeTool(host, { tool: 'send_message', args: {} })).rejects.toMatchObject({ name: 'ToolArgsError', message: expect.stringMatching(/recebi: nenhum argumento/) })
  })

  it('.env.example pode ser criado por qualquer agente; o .env de verdade continua protegido', () => {
    const host = { agent: { scope: ['**/ai/**', '**/*.ts'] }, extraScope: () => [] } as unknown as Pick<ToolHost, 'agent' | 'extraScope'>
    expect(canWrite(host, 'backend/.env.example')).toBe(true)
    expect(canWrite(host, '.env.sample')).toBe(true)
    expect(canWrite(host, 'backend/.env')).toBe(false)
  })

  it('acha os arquivos que um comando vai gravar (para criar a pasta antes)', () => {
    expect(commandWriteTargets(`Set-Content -Path "backend\\src\\routes\\whatsapp.js" -Value 'const x = () => 1'`)).toEqual(['backend\\src\\routes\\whatsapp.js'])
    expect(commandWriteTargets('echo {"a":1} > backend\\package.json')).toEqual(['backend\\package.json'])
    expect(commandWriteTargets('npm test 2> $null')).toEqual([])
    // "=>" dentro de código não é redirecionamento
    expect(commandWriteTargets(`node -e "const f = x => require('a/b')"`)).toEqual([])
  })

  it('falhas que valem uma segunda tentativa', () => {
    expect(retryable('Limite de 14 passos atingido antes de concluir')).toBe(true)
    expect(retryable('gemini-3.5-flash-lite falhou (overloaded): 503 Service Unavailable')).toBe(true)
    expect(retryable('Nenhum modelo disponível. Configure uma chave em 🔑 Chaves de API.')).toBe(false)
  })
})

describe('equipe: erros de formato não gastam passos e tarefa falha ganha segunda tentativa', () => {
  it('reproduz o log: write_file sem "path", passos esgotados e tarefas seguintes bloqueadas', async () => {
    const dir = tempProject({ 'README.md': '# Projeto\n' })
    const project = createProject('Teste fixes', dir)
    const complete: CompleteFn = async (model, messages) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') {
        return completion(json({ complexity: 'medium', summary: 'p', decisions: [], tasks: [
          { id: 'a', title: 'API', description: 'criar api', role: 'backend', dependsOn: [], files: ['server/api.js'] },
          { id: 'b', title: 'IA', description: 'integrar IA', role: 'ai', dependsOn: ['a'], files: [] },
          { id: 'c', title: 'Testar', description: 'validar', role: 'qa', dependsOn: ['b'], files: [] },
        ] }), model)
      }
      if (me.kind === 'report') return completion('# Relatório', model)
      if (me.kind !== 'agent') return completion('ok', model)
      const firstTry = !messages[1].content.includes('SEGUNDA TENTATIVA')
      if (me.role === 'Desenvolvedor Backend') {
        // 3 turnos só com write_file sem "path" (como o Gemini Flash-Lite), depois o formato certo
        if (me.step < 3) return completion(act('write_file', { content: 'export const ok = 1\n' }), model)
        if (me.step === 3) return completion(json({ thought: '', actions: [{ tool: 'write_file', path: 'server/api.js', content: 'export const ok = 1\n' }] }), model)
        return completion(act('finish', { summary: 'api criada' }), model)
      }
      if (me.role === 'Engenheiro de IA') {
        // Primeira tentativa: enrola até acabar os passos (como no log); segunda: termina
        if (firstTry) return completion(act('read_file', { path: 'README.md' }), model)
        return completion(act('finish', { summary: 'IA integrada' }), model)
      }
      return completion(act('finish', { summary: 'ok' }), model)
    }
    const rt = new AgentRuntime()
    rt.complete = complete
    rt.providers = async () => fakeProviders()
    const ctrl = rt.startRun({ projectId: project.id, request: 'API com IA', options: { permissionMode: 'autonomo', maxSteps: 4, fixRounds: 0 } as never })
    await ctrl.done
    const run = ctrl.run
    const byRole = (r: string) => run.tasks.find(t => t.roleId === r)!
    // Backend: 3 turnos com erro de formato não contaram; com 4 passos ainda terminou
    expect(byRole('backend').status).toBe('done')
    expect(fs.readFileSync(path.join(dir, 'server/api.js'), 'utf8')).toContain('ok = 1')
    // IA: estourou os passos, ganhou segunda tentativa e terminou — e o QA não ficou bloqueado
    expect(byRole('ai')).toMatchObject({ status: 'done', attempts: 2 })
    expect(byRole('qa').status).toBe('done')
  }, 30_000)
})
