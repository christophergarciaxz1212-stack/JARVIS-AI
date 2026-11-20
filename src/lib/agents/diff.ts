/**
 * Diff entre o original (guardado no snapshot antes da primeira escrita da execução)
 * e o conteúdo atual do arquivo.
 *
 * O cálculo é do `jsdiff` (BSD-3, maduro, usado em toda parte) em vez de um LCS
 * escrito aqui: ele já trata os casos chatos — fim de arquivo sem quebra de linha,
 * CRLF, blocos movidos — e entrega os trechos com contexto prontos.
 *
 * O que este módulo acrescenta é o que o jsdiff não faz: recusar binário, limitar
 * o tamanho do que vai para a tela e traduzir o formato para o que a interface usa.
 *
 * Sem imports de Node: roda no servidor, no cliente e nos testes.
 */
import { structuredPatch } from 'diff'

export type LineKind = 'igual' | 'adicionada' | 'removida'

export interface DiffLine {
  kind: LineKind
  text: string
  /** Número da linha no arquivo original (undefined quando foi adicionada). */
  before?: number
  /** Número da linha no arquivo atual (undefined quando foi removida). */
  after?: number
}

/** Trecho alterado com algumas linhas de contexto em volta. */
export interface DiffHunk {
  beforeStart: number
  afterStart: number
  lines: DiffLine[]
}

export interface FileDiff {
  /** Caminho relativo à raiz do projeto. */
  path: string
  /** O arquivo não existia antes da execução. */
  created: boolean
  /** O arquivo foi apagado durante a execução. */
  deleted: boolean
  added: number
  removed: number
  hunks: DiffHunk[]
  /** Binário: não dá para mostrar linhas. */
  binary: boolean
  /** O diff é maior do que o que coube na tela. */
  truncated: boolean
}

/** Linhas de contexto em volta de cada alteração. */
const CONTEXT = 3
/** Teto de linhas enviadas para a interface — acima disso a conversa trava. */
const MAX_LINES = 400

/** Heurística de binário: byte nulo no começo do arquivo. */
export function looksBinary(s: string): boolean {
  return s.slice(0, 8000).includes('\0')
}

/**
 * Converte o resultado do jsdiff para as linhas numeradas que a interface mostra.
 * Exportada para teste: é aqui que um erro de numeração passaria despercebido.
 */
export function toHunks(before: string, after: string, context = CONTEXT): DiffHunk[] {
  const patch = structuredPatch('antes', 'depois', before, after, '', '', { context })
  return patch.hunks.map(h => {
    let b = h.oldStart
    let a = h.newStart
    const lines: DiffLine[] = []
    for (const raw of h.lines) {
      // jsdiff usa o primeiro caractere como marcador: ' ' igual, '-' removida, '+' adicionada.
      // Uma linha "\ No newline at end of file" começa com '\' e não representa conteúdo.
      const marker = raw[0]
      const text = raw.slice(1)
      if (marker === '\\') continue
      if (marker === '-') lines.push({ kind: 'removida', text, before: b++ })
      else if (marker === '+') lines.push({ kind: 'adicionada', text, after: a++ })
      else lines.push({ kind: 'igual', text, before: b++, after: a++ })
    }
    return { beforeStart: h.oldStart, afterStart: h.newStart, lines }
  })
}

/** Diff completo de um arquivo, pronto para a interface. */
export function fileDiff(opts: { path: string; before: string | null; after: string | null }): FileDiff {
  const created = opts.before === null
  const deleted = opts.after === null
  const before = opts.before ?? ''
  const after = opts.after ?? ''
  const base = { path: opts.path, created, deleted }

  if (looksBinary(before) || looksBinary(after)) {
    return { ...base, added: 0, removed: 0, hunks: [], binary: true, truncated: false }
  }

  const all = toHunks(before, after)
  let added = 0
  let removed = 0
  for (const h of all) {
    for (const l of h.lines) {
      if (l.kind === 'adicionada') added++
      else if (l.kind === 'removida') removed++
    }
  }

  // Conta tudo, mostra o começo: o número de linhas alteradas continua honesto
  // mesmo quando o conteúdo é cortado.
  const hunks: DiffHunk[] = []
  let shown = 0
  for (const h of all) {
    if (shown >= MAX_LINES) break
    const room = MAX_LINES - shown
    hunks.push(h.lines.length <= room ? h : { ...h, lines: h.lines.slice(0, room) })
    shown += Math.min(h.lines.length, room)
  }
  const total = all.reduce((n, h) => n + h.lines.length, 0)

  return { ...base, added, removed, hunks, binary: false, truncated: shown < total }
}
