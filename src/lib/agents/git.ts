/**
 * Ferramentas de Git para o agente.
 *
 * Tudo passa pelo `git` do sistema, com saída em formato estável (`--porcelain`,
 * `--pretty`) em vez da saída bonita para humanos: é o que torna o resultado
 * confiável para o modelo ler. Nenhuma operação aqui envia nada para fora —
 * `git push` é tratado como ação externa e pede aprovação do usuário.
 */
import fs from 'fs'
import path from 'path'
import { runCommand } from '../shell'

export interface GitContext {
  root: string
  signal?: AbortSignal
}

const TIMEOUT = 30_000

async function git(ctx: GitContext, args: string, timeoutMs = TIMEOUT) {
  const r = await runCommand(`git ${args}`, ctx.root, { timeoutMs, signal: ctx.signal, shell: 'cmd' })
  // Só o fim é aparado: em `status --porcelain` o primeiro caractere da linha é o
  // estado no índice, e um espaço ali significa "não preparado" — um trim comum
  // comeria o espaço da primeira linha e deslocaria o nome do arquivo.
  const text = (r.stdout + (r.stderr && r.exitCode !== 0 ? `\n${r.stderr}` : '')).replace(/\s+$/, '')
  return { ...r, text }
}

/** O projeto está sob Git? Evita mensagens de erro cruas para o modelo. */
export function isRepo(root: string): boolean {
  let dir = path.resolve(root)
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return true
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return false
}

const NOT_A_REPO = 'Esta pasta não é um repositório Git. Use run_command com "git init" se o usuário quiser versionar o projeto.'

/** Estado da árvore de trabalho, em formato curto e legível. */
export async function gitStatus(ctx: GitContext): Promise<string> {
  if (!isRepo(ctx.root)) return NOT_A_REPO
  const branch = await git(ctx, 'rev-parse --abbrev-ref HEAD')
  const status = await git(ctx, 'status --porcelain=v1 --untracked-files=all')
  if (status.exitCode !== 0) return `Erro do git: ${status.text}`

  const lines = status.text ? status.text.split('\n') : []
  if (!lines.length) return `Branch: ${branch.text || '(desconhecido)'}\nÁrvore limpa — nada para commitar.`

  // XY caminho: X = índice (staged), Y = árvore de trabalho
  const described = lines.slice(0, 200).map(l => {
    const code = l.slice(0, 2)
    const file = l.slice(3)
    const staged = code[0] !== ' ' && code[0] !== '?'
    const label = code.includes('?') ? 'novo (não rastreado)'
      : code.includes('D') ? 'apagado'
        : code.includes('A') ? 'adicionado'
          : code.includes('R') ? 'renomeado'
            : 'modificado'
    return `- ${file} — ${label}${staged ? ' [no índice]' : ''}`
  })
  const extra = lines.length > 200 ? `\n… e mais ${lines.length - 200} arquivo(s)` : ''
  return `Branch: ${branch.text || '(desconhecido)'}\n${lines.length} arquivo(s) com alteração:\n${described.join('\n')}${extra}`
}

/** Diff da árvore de trabalho (ou do que está no índice). */
export async function gitDiff(ctx: GitContext, opts: { file?: string; staged?: boolean } = {}): Promise<string> {
  if (!isRepo(ctx.root)) return NOT_A_REPO
  const target = opts.file ? ` -- "${opts.file.replace(/"/g, '')}"` : ''
  const r = await git(ctx, `diff --no-color ${opts.staged ? '--cached ' : ''}--stat${target}`)
  const body = await git(ctx, `diff --no-color ${opts.staged ? '--cached ' : ''}--unified=3${target}`)
  if (r.exitCode !== 0) return `Erro do git: ${r.text}`
  if (!body.text) return opts.staged ? 'Nada no índice.' : 'Nenhuma alteração não commitada.'
  // Diff inteiro estoura o contexto do modelo: manda o resumo e o começo.
  const clipped = body.text.length > 12_000 ? `${body.text.slice(0, 12_000)}\n… (diff cortado)` : body.text
  return `${r.text}\n\n${clipped}`
}

/** Commits recentes, um por linha. */
export async function gitLog(ctx: GitContext, limit = 20): Promise<string> {
  if (!isRepo(ctx.root)) return NOT_A_REPO
  const n = Math.min(Math.max(limit, 1), 100)
  const r = await git(ctx, `log --no-color -n ${n} --pretty=format:"%h | %an | %ar | %s"`)
  if (r.exitCode !== 0) return r.text.includes('does not have any commits') ? 'O repositório ainda não tem commits.' : `Erro do git: ${r.text}`
  return r.text || 'Sem commits.'
}

/** Branches locais, com a atual marcada. */
export async function gitBranch(ctx: GitContext): Promise<string> {
  if (!isRepo(ctx.root)) return NOT_A_REPO
  const r = await git(ctx, 'branch --no-color --format="%(HEAD) %(refname:short)"')
  if (r.exitCode !== 0) return `Erro do git: ${r.text}`
  return r.text || 'Nenhuma branch ainda.'
}

/**
 * Cria um commit com os arquivos indicados (ou com tudo que está alterado).
 * Nunca usa `--no-verify` nem assina de forma diferente da configurada: se um
 * hook do projeto recusar, o agente fica sabendo do motivo real.
 */
export async function gitCommit(ctx: GitContext, opts: { message: string; files?: string[] }): Promise<string> {
  if (!isRepo(ctx.root)) return NOT_A_REPO
  const message = opts.message.trim()
  if (!message) return 'Informe a mensagem do commit.'

  const add = opts.files?.length
    ? `add ${opts.files.map(f => `"${f.replace(/"/g, '')}"`).join(' ')}`
    : 'add -A'
  const staged = await git(ctx, add)
  if (staged.exitCode !== 0) return `Erro ao preparar os arquivos: ${staged.text}`

  const pending = await git(ctx, 'diff --cached --name-only')
  if (!pending.text) return 'Nada para commitar — o índice está vazio.'

  // A mensagem vai por arquivo: assim quebras de linha e aspas sobrevivem ao shell.
  const tmp = path.join(ctx.root, `.git`, `JARVIS_COMMIT_MSG_${Date.now()}`)
  try {
    fs.writeFileSync(tmp, message, 'utf-8')
    const r = await git(ctx, `commit --file="${tmp}"`)
    if (r.exitCode !== 0) return `O commit não foi feito: ${r.text}`
    const head = await git(ctx, 'log -1 --pretty=format:"%h %s"')
    return `Commit criado: ${head.text}\nArquivos:\n${pending.text.split('\n').map(f => `- ${f}`).join('\n')}`
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}
