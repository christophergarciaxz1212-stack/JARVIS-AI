import fs from 'fs'
import path from 'path'

/** Root for everything JARVIS persists. Overridable so tests never touch real data. */
export function dataDir() {
  if (process.env.JARVIS_DATA_DIR) return process.env.JARVIS_DATA_DIR
  const raw = path.join(process.cwd(), 'data')
  if (realData?.raw === raw) return realData.real
  // No app instalado, "data" é uma junção para Documents\JARVIS\data — e o mkdir recursivo
  // do Node falha com ENOENT através de junções. Usar o caminho real evita isso.
  let real = raw
  try { real = fs.realpathSync.native(raw) } catch { /* ainda não existe: usa o caminho direto */ }
  realData = { raw, real }
  return real
}
let realData: { raw: string; real: string } | null = null

export function sessionDir(sessionId: string) {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error(`Id de sessão inválido: ${sessionId}`)
  return path.join(dataDir(), 'sessions', sessionId)
}

export function runsDir(sessionId: string) {
  return path.join(sessionDir(sessionId), 'runs')
}

/** Write via temp file + rename so a crash mid-write never leaves a truncated JSON file. */
export function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf-8')
  fs.renameSync(tmp, file)
}

/**
 * Read and parse a JSON file ({}-style stores). A missing file returns `fallback`.
 * A file that exists but fails to parse is quarantined to `<name>.corrupt-<timestamp>`
 * and this THROWS — callers must not silently "start empty" and later overwrite
 * the user's data with a fresh fallback.
 */
export function readJson<T>(file: string, fallback: T): T {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`Não foi possível ler o arquivo de dados ${path.basename(file)}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    const quarantine = `${file}.corrupt-${Date.now()}`
    try { fs.renameSync(file, quarantine) } catch {}
    throw new Error(`Arquivo de dados corrompido: ${path.basename(file)} (movido para ${path.basename(quarantine)}). Nenhum dado foi sobrescrito.`)
  }
}

/** Resolve a path given by an agent and refuse lexical or symlink escapes from the project root. */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel || '.')
  const lexicalRoot = path.resolve(root)
  // On Windows, some test runners/filesystems do not permit creating symlinks;
  // use lstat-based traversal below whenever the path can actually be inspected.
  const lexicalRelative = path.relative(lexicalRoot, abs)
  if (lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Caminho fora do projeto: ${rel}`)
  }
  // Preserve lexical behavior for callers validating a project path before the root exists.
  if (!fs.existsSync(root)) return abs
  const rootReal = fs.realpathSync(root)

  // Resolve existing ancestors. A junction can make existsSync('root/link/file')
  // true while realpath(link) reveals that it points outside the project.
  let ancestor = abs
  const suffix: string[] = []
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    suffix.unshift(path.basename(ancestor))
    ancestor = parent
  }
  if (!fs.existsSync(ancestor)) return abs

  const ancestorReal = fs.realpathSync(ancestor)
  const resolved = path.resolve(ancestorReal, ...suffix)
  const realRelative = path.relative(rootReal, resolved)
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Caminho fora do projeto (atalho simbólico): ${rel}`)
  }
  return path.join(lexicalRoot, realRelative)
}

export function toRel(root: string, abs: string) {
  return path.relative(root, abs).split(path.sep).join('/') || '.'
}

const globCache = new Map<string, RegExp>()

/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. Patterns are project-relative. */
export function globToRegExp(glob: string): RegExp {
  const hit = globCache.get(glob)
  if (hit) return hit
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i++ }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  const compiled = new RegExp(`^${re}$`, 'i')
  globCache.set(glob, compiled)
  return compiled
}

export function matchesAny(relPath: string, globs: string[]) {
  const p = relPath.split('\\').join('/')
  return globs.some(g => !g.startsWith('!') && globToRegExp(g).test(p))
}

/** Scope check with exclusions: allowed when a positive glob matches and no "!glob" does. */
export function matchesScope(relPath: string, globs: string[]) {
  const p = relPath.split('\\').join('/')
  const negatives = globs.filter(g => g.startsWith('!')).map(g => g.slice(1))
  return matchesAny(p, globs) && !negatives.some(g => globToRegExp(g).test(p))
}

export const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.next-dev', 'dist', 'build', 'out', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.freebuff'])

// Windows briefly locks files that just ran or are being scanned by the antivirus (EPERM/EBUSY)
export function removeDir(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
