/**
 * Busca de arquivos dentro da pasta do projeto — o que alimenta o `@arquivo`
 * do composer.
 *
 * Enraizada no projeto escolhido, e não na pasta do JARVIS: é do projeto do
 * usuário que ele quer apontar um arquivo. `resolveInside` garante que nada
 * fora da raiz seja lido, mesmo com `..` ou link no caminho.
 *
 * A varredura é guardada por alguns segundos, porque a lista é pedida a cada
 * tecla digitada depois do `@`.
 */
import fs from 'fs'
import path from 'path'
import { IGNORED_DIRS, resolveInside, toRel } from './fsutil'

/** Teto de arquivos varridos: projetos grandes não podem travar a digitação. */
const MAX_WALK = 6000
const CACHE_MS = 8000
/** Conteúdo acima disto não vai para o contexto inteiro. */
export const MAX_FILE_CHARS = 200_000

const cache = new Map<string, { at: number; files: string[] }>()

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svgz',
  '.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.flac',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.class', '.jar', '.pyc',
])

/** Lista os caminhos relativos do projeto, ignorando node_modules, .git e afins. */
export function listProjectFiles(root: string): string[] {
  if (!root || !fs.existsSync(root)) return []
  const hit = cache.get(root)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files

  const files: string[] = []
  const walk = (dir: string, depth: number) => {
    if (files.length >= MAX_WALK || depth > 8) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX_WALK) return
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      if (IGNORED_DIRS.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs, depth + 1)
      else if (e.isFile()) files.push(toRel(root, abs).replace(/\\/g, '/'))
    }
  }
  walk(root, 0)
  files.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  cache.set(root, { at: Date.now(), files })
  return files
}

/** Esquece a varredura guardada (depois de o agente criar ou apagar arquivos). */
export function forgetProjectFiles(root?: string) {
  if (root) cache.delete(root)
  else cache.clear()
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Pontua um caminho para a busca. Menor é melhor; `null` descarta.
 * Prefere, nesta ordem: nome do arquivo começando com o termo, nome contendo,
 * caminho contendo, e por último as letras na ordem (busca "esparsa").
 */
export function scorePath(rel: string, query: string): number | null {
  const q = fold(query)
  if (!q) return 0
  const p = fold(rel)
  const base = fold(path.basename(rel))

  if (base.startsWith(q)) return 0
  if (base.includes(q)) return 1
  if (p.includes(q)) return 2

  // Letras na ordem, não necessariamente juntas: "slr" acha "src/lib/router.ts"
  let i = 0
  for (const ch of p) {
    if (ch === q[i]) i++
    if (i === q.length) return 3
  }
  return null
}

export interface FileHit {
  path: string
  /** Só o nome, para destacar na lista. */
  name: string
}

/** Arquivos do projeto que combinam com o que foi digitado depois do `@`. */
export function searchProjectFiles(root: string, query: string, limit = 12): FileHit[] {
  const all = listProjectFiles(root)
  const scored: Array<{ rel: string; score: number }> = []
  for (const rel of all) {
    const score = scorePath(rel, query)
    if (score === null) continue
    scored.push({ rel, score })
    // Com termo vazio a lista inteira serve: corta cedo.
    if (!query && scored.length >= limit) break
  }
  scored.sort((a, b) => a.score - b.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel, 'pt-BR'))
  return scored.slice(0, limit).map(s => ({ path: s.rel, name: path.basename(s.rel) }))
}

export interface ReadResult {
  path: string
  text: string
  truncated: boolean
}

/** Lê um arquivo do projeto para virar contexto da conversa. */
export function readProjectFile(root: string, rel: string): ReadResult {
  const abs = resolveInside(root, rel)
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) {
    throw new Error(`"${rel}" não é um arquivo de texto`)
  }
  const stat = fs.statSync(abs)
  if (!stat.isFile()) throw new Error(`"${rel}" não é um arquivo`)

  const raw = fs.readFileSync(abs, 'utf-8')
  if (raw.slice(0, 8000).includes('\0')) throw new Error(`"${rel}" parece ser binário`)
  return {
    path: toRel(root, abs).replace(/\\/g, '/'),
    text: raw.slice(0, MAX_FILE_CHARS),
    truncated: raw.length > MAX_FILE_CHARS,
  }
}
