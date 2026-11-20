import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MAX_READ = 300_000
const MAX_WRITE = 1_000_000
// Never let the agent/file panel clobber these — keys and config live here
const PROTECTED = [/^\.env(\.|$)/i, /^data[\\/]/i, /^\.git[\\/]/i]

function safePath(input: string) {
  const target = path.resolve(ROOT, input || '.')
  const relative = path.relative(ROOT, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Caminho fora do projeto')
  return target
}

/** Canonical path (links and 8.3 short names resolved) of `p`, or of its nearest existing ancestor plus the rest. */
function canonical(p: string): string {
  let existing = p
  const rest: string[] = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    rest.unshift(path.basename(existing))
    existing = parent
  }
  return path.join(fs.realpathSync.native(existing), ...rest)
}

/**
 * Like safePath but checks the canonical path, so neither a link pointing outside the
 * project nor a short-name alias (ENV~1.LOC for .env.local) gets around the checks.
 */
function safeRealPath(input: string) {
  const target = safePath(input)
  const rel = path.relative(fs.realpathSync.native(ROOT), canonical(target))
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Atalho aponta para fora do projeto')
  return { target, rel }
}

function blockedRel(rel: string) {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  return PROTECTED.some(re => re.test(p))
}

/** Lista diretório, lê ou grava arquivo do projeto para o painel de arquivos. */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const file = searchParams.get('file')

    if (file) {
      const { target, rel } = safeRealPath(file)
      if (blockedRel(rel)) return Response.json({ error: 'Arquivo protegido' }, { status: 403 })
      const stat = fs.statSync(target)
      if (!stat.isFile()) return Response.json({ error: 'Não é um arquivo' }, { status: 400 })
      if (stat.size > MAX_READ) return Response.json({ error: 'Arquivo grande demais' }, { status: 400 })
      return Response.json({ file, content: fs.readFileSync(target, 'utf8') })
    }

    const { target: dir } = safeRealPath(searchParams.get('path') || '.')
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(dir, entry.name)
        let size = 0
        try {
          size = entry.isFile() ? fs.statSync(full).size : 0
        } catch {}
        return {
          name: entry.name,
          dir: entry.isDirectory(),
          size,
          rel: path.relative(ROOT, full).replace(/\\/g, '/'),
        }
      })
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

    return Response.json({
      path: path.relative(ROOT, dir).replace(/\\/g, '/') || '.',
      entries,
    })
  } catch (error) {
    return Response.json({ error: String((error as Error).message) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { path: file, content } = await req.json()
    if (!file || typeof file !== 'string') return Response.json({ error: 'Informe o caminho' }, { status: 400 })
    if (content !== undefined && typeof content !== 'string') return Response.json({ error: 'Conteúdo deve ser texto' }, { status: 400 })
    if ((content?.length || 0) > MAX_WRITE) return Response.json({ error: `Arquivo grande demais (máx. ${Math.round(MAX_WRITE / 1024)} KB)` }, { status: 400 })
    const { target, rel } = safeRealPath(file)
    if (blockedRel(rel)) return Response.json({ error: 'Arquivo protegido (dados e chaves não podem ser alterados pelo painel)' }, { status: 403 })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    // Atomic replace (temp + rename) so an interrupted write never truncates the file
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, content ?? '', 'utf8')
    fs.renameSync(tmp, target)
    return Response.json({ success: true, file })
  } catch (error) {
    return Response.json({ error: String((error as Error).message) }, { status: 400 })
  }
}
