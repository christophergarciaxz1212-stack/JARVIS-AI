import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { gitBranch, gitCommit, gitDiff, gitLog, gitStatus, isRepo } from '@/lib/agents/git'
import { runCommand } from '@/lib/shell'
import { tempProject } from './helpers'

/** Repositório de verdade numa pasta temporária, com um commit inicial. */
async function tempRepo(files: Record<string, string> = {}) {
  const root = tempProject(files)
  const run = (cmd: string) => runCommand(cmd, root, { timeoutMs: 30_000, shell: 'cmd' })
  await run('git init -q')
  await run('git config user.email teste@jarvis.local')
  await run('git config user.name Teste')
  await run('git config commit.gpgsign false')
  await run('git add -A')
  await run('git commit -q -m "inicial"')
  return { root, run }
}

describe('detecção de repositório', () => {
  it('reconhece uma pasta com Git e recusa uma sem', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    expect(isRepo(root)).toBe(true)

    const semGit = tempProject({ 'a.txt': 'um\n' })
    expect(isRepo(semGit)).toBe(false)
    expect(await gitStatus({ root: semGit })).toContain('não é um repositório Git')
    expect(await gitLog({ root: semGit })).toContain('não é um repositório Git')
  }, 60_000)
})

describe('estado da árvore', () => {
  it('árvore limpa diz que não há nada para commitar', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    const out = await gitStatus({ root })
    expect(out).toContain('Árvore limpa')
    expect(out).toContain('Branch:')
  }, 60_000)

  it('lista arquivo modificado e arquivo novo, com rótulo em português', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    fs.writeFileSync(path.join(root, 'a.txt'), 'um alterado\n')
    fs.writeFileSync(path.join(root, 'novo.txt'), 'novo\n')

    const out = await gitStatus({ root })
    expect(out).toContain('a.txt — modificado')
    expect(out).toContain('novo.txt — novo (não rastreado)')
  }, 60_000)
})

describe('diff', () => {
  it('mostra as linhas alteradas e o resumo', async () => {
    const { root } = await tempRepo({ 'a.txt': 'linha um\nlinha dois\n' })
    fs.writeFileSync(path.join(root, 'a.txt'), 'linha um\nLINHA DOIS\n')

    const out = await gitDiff({ root })
    expect(out).toContain('a.txt')
    expect(out).toContain('-linha dois')
    expect(out).toContain('+LINHA DOIS')
  }, 60_000)

  it('sem alteração, avisa em vez de devolver vazio', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    expect(await gitDiff({ root })).toContain('Nenhuma alteração não commitada')
  }, 60_000)
})

describe('histórico e branches', () => {
  it('lista o commit inicial com hash, autor e mensagem', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    const out = await gitLog({ root }, 5)
    expect(out).toContain('inicial')
    expect(out).toContain('Teste')
  }, 60_000)

  it('marca a branch atual', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    const out = await gitBranch({ root })
    expect(out).toMatch(/\*/)
  }, 60_000)
})

describe('commit', () => {
  it('cria um commit de verdade com os arquivos alterados', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    fs.writeFileSync(path.join(root, 'a.txt'), 'dois\n')

    const out = await gitCommit({ root }, { message: 'ajusta a.txt' })
    expect(out).toContain('Commit criado')
    expect(out).toContain('a.txt')

    const log = await gitLog({ root }, 5)
    expect(log).toContain('ajusta a.txt')
    expect(await gitStatus({ root })).toContain('Árvore limpa')
  }, 60_000)

  it('preserva mensagem com várias linhas e aspas', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    fs.writeFileSync(path.join(root, 'a.txt'), 'dois\n')

    await gitCommit({ root }, { message: 'título do commit\n\ncorpo com "aspas" e acento ç' })
    const body = await runCommand('git log -1 --pretty=format:%B', root, { timeoutMs: 30_000, shell: 'cmd' })
    expect(body.stdout).toContain('título do commit')
    expect(body.stdout).toContain('"aspas"')
  }, 60_000)

  it('commita só os arquivos indicados', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n', 'b.txt': 'um\n' })
    fs.writeFileSync(path.join(root, 'a.txt'), 'dois\n')
    fs.writeFileSync(path.join(root, 'b.txt'), 'dois\n')

    const out = await gitCommit({ root }, { message: 'só o a', files: ['a.txt'] })
    expect(out).toContain('a.txt')
    expect(out).not.toContain('b.txt')
    expect(await gitStatus({ root })).toContain('b.txt — modificado')
  }, 60_000)

  it('sem nada alterado, avisa em vez de criar commit vazio', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    expect(await gitCommit({ root }, { message: 'nada' })).toContain('Nada para commitar')
  }, 60_000)

  it('exige mensagem', async () => {
    const { root } = await tempRepo({ 'a.txt': 'um\n' })
    expect(await gitCommit({ root }, { message: '   ' })).toContain('Informe a mensagem')
  }, 60_000)
})
