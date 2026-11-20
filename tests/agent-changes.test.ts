import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject } from '@/lib/agents/store'
import { acceptFile, revertFile, runChanges, runFileChange } from '@/lib/agents/changes'
import type { ChatMessage, CompleteFn } from '@/lib/agents/models'
import { act, acts, completion, fakeProviders, json, sleep, tempProject, whoAmI } from './helpers'

function runtime(complete: CompleteFn) {
  const rt = new AgentRuntime()
  rt.complete = complete
  rt.providers = async () => fakeProviders()
  return rt
}

const plan = json({
  complexity: 'small',
  summary: 'plano',
  decisions: [],
  tasks: [{ id: 'a', title: 'Mexer nos arquivos', description: 'edita e cria', role: 'backend', dependsOn: [], files: ['existente.txt', 'novo.txt'] }],
})

/** Edita um arquivo que já existia e cria outro. */
const editorModel: CompleteFn = async (model, messages: ChatMessage[]) => {
  const me = whoAmI(messages)
  await sleep(10)
  if (me.kind === 'planner') return completion(plan, model)
  if (me.kind === 'report') return completion('# Relatório\nfeito', model)
  if (me.kind === 'answer') return completion('ok', model)
  return completion(
    me.step === 0
      ? acts(
        ['edit_file', { path: 'existente.txt', old_text: 'linha dois', new_text: 'LINHA DOIS' }],
        ['write_file', { path: 'novo.txt', content: 'arquivo novo\n' }],
      )
      : act('finish', { summary: 'pronto' }),
    model,
  )
}

async function runEditor() {
  const dir = tempProject({ 'existente.txt': 'linha um\nlinha dois\nlinha tres\n' })
  const project = createProject(`Diff ${Math.random()}`, dir)
  const rt = runtime(editorModel)
  const ctrl = rt.startRun({
    projectId: project.id,
    request: 'edite e crie',
    options: { permissionMode: 'autonomo', maxSteps: 6, fixRounds: 0 } as never,
  })
  await ctrl.done
  return { dir, run: ctrl.run }
}

describe('alterações de uma execução', () => {
  it('lista o arquivo editado e o criado, com as contagens certas', async () => {
    const { dir, run } = await runEditor()
    expect(fs.readFileSync(path.join(dir, 'novo.txt'), 'utf8')).toContain('arquivo novo')

    const { files } = runChanges(run)
    const nomes = files.map(f => f.path).sort()
    expect(nomes).toEqual(['existente.txt', 'novo.txt'])

    const editado = files.find(f => f.path === 'existente.txt')!
    expect(editado.created).toBe(false)
    expect(editado.added).toBe(1)
    expect(editado.removed).toBe(1)
    // O diff mostra o antes e o depois da linha trocada
    const textos = editado.hunks.flatMap(h => h.lines.map(l => `${l.kind}:${l.text}`))
    expect(textos).toContain('removida:linha dois')
    expect(textos).toContain('adicionada:LINHA DOIS')

    const criado = files.find(f => f.path === 'novo.txt')!
    expect(criado.created).toBe(true)
    expect(criado.removed).toBe(0)
    expect(criado.added).toBe(1)
  }, 40_000)

  it('desfazer devolve o conteúdo original do arquivo editado', async () => {
    const { dir, run } = await runEditor()
    const alvo = path.join(dir, 'existente.txt')
    expect(fs.readFileSync(alvo, 'utf8')).toContain('LINHA DOIS')

    const out = revertFile(run, 'existente.txt')
    expect(out).toEqual({ ok: true, action: 'restaurado' })
    expect(fs.readFileSync(alvo, 'utf8')).toBe('linha um\nlinha dois\nlinha tres\n')

    // Deixa de ser uma alteração pendente
    expect(runChanges(run).files.map(f => f.path)).toEqual(['novo.txt'])
  }, 40_000)

  it('desfazer apaga o arquivo que a execução criou', async () => {
    const { dir, run } = await runEditor()
    const novo = path.join(dir, 'novo.txt')
    expect(fs.existsSync(novo)).toBe(true)

    const out = revertFile(run, 'novo.txt')
    expect(out).toEqual({ ok: true, action: 'removido' })
    expect(fs.existsSync(novo)).toBe(false)
  }, 40_000)

  it('aceitar mantém o arquivo e tira da lista de pendentes', async () => {
    const { dir, run } = await runEditor()
    const out = acceptFile(run, 'existente.txt')
    expect(out).toEqual({ ok: true, action: 'aceito' })
    expect(fs.readFileSync(path.join(dir, 'existente.txt'), 'utf8')).toContain('LINHA DOIS')
    expect(runChanges(run).files.map(f => f.path)).toEqual(['novo.txt'])
  }, 40_000)

  it('aceitar impede que um rollback posterior desfaça a alteração', async () => {
    const { dir, run } = await runEditor()
    acceptFile(run, 'existente.txt')
    const rt = new AgentRuntime()
    rt.rollback(run.id)
    // O aceito continua; o não-aceito voltou atrás
    expect(fs.readFileSync(path.join(dir, 'existente.txt'), 'utf8')).toContain('LINHA DOIS')
    expect(fs.existsSync(path.join(dir, 'novo.txt'))).toBe(false)
  }, 40_000)

  it('arquivo que não foi tocado não tem diff', async () => {
    const { run } = await runEditor()
    expect(runFileChange(run, 'inexistente.txt')).toBeNull()
    expect(revertFile(run, 'inexistente.txt').ok).toBe(false)
  }, 40_000)
})
