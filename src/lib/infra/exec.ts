import { spawn } from 'child_process'
import { scrubbedEnv } from '../shell'

export interface ProgramResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
  /** The executable could not be started (missing, not on PATH, permission). */
  notFound: boolean
}

function killTree(pid: number) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
  else try { process.kill(-pid, 'SIGKILL') } catch {}
}

/**
 * Runs an executable with an argument array — never through a shell, so arguments
 * (hosts, container ids, paths) cannot inject extra commands. Secrets are never
 * inherited, the whole process tree dies on timeout, and output is capped.
 */
export function runProgram(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxOutput?: number; signal?: AbortSignal; input?: string } = {},
): Promise<ProgramResult> {
  const max = opts.maxOutput ?? 200_000
  const started = Date.now()
  return new Promise(resolve => {
    let proc
    try {
      proc = spawn(file, args, { cwd: opts.cwd, env: scrubbedEnv(), windowsHide: true, detached: process.platform !== 'win32' })
    } catch (e) {
      resolve({ stdout: '', stderr: (e as Error).message, exitCode: -1, durationMs: 0, timedOut: false, notFound: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let notFound = false
    let done = false
    const take = (cur: string, chunk: Buffer) => (cur.length >= max ? cur : (cur + chunk.toString('utf8')).slice(0, max))
    proc.stdout?.on('data', (d: Buffer) => { stdout = take(stdout, d) })
    proc.stderr?.on('data', (d: Buffer) => { stderr = take(stderr, d) })
    if (opts.input !== undefined) { proc.stdin?.end(opts.input) } else proc.stdin?.end()

    const timer = setTimeout(() => { timedOut = true; if (proc.pid) killTree(proc.pid) }, opts.timeoutMs ?? 30_000)
    const onAbort = () => { if (proc.pid) killTree(proc.pid) }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started, timedOut, notFound })
    }
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') notFound = true
      stderr += err.message
      finish(-1)
    })
    proc.on('close', finish)
  })
}

/** Runs a short PowerShell script (read-only inventory queries). Output is forced to UTF-8. */
export function runPowerShell(script: string, timeoutMs = 20_000) {
  const prelude = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";$ErrorActionPreference="Continue";'
  return runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prelude + script], { timeoutMs })
}

/** Parses JSON printed by a tool; PowerShell's ConvertTo-Json returns an object for a single item. */
export function parseJsonList<T>(text: string): T[] {
  const t = text.trim()
  if (!t) return []
  try {
    const v = JSON.parse(t)
    return Array.isArray(v) ? v : [v]
  } catch {
    return []
  }
}

const g = globalThis as unknown as { __jarvisWhich?: Map<string, { path: string | null; at: number }> }
const whichCache = (g.__jarvisWhich ??= new Map())

/** Finds an executable on PATH (cached for a minute). */
export async function which(name: string): Promise<string | null> {
  if (!/^[\w.-]+$/.test(name)) return null
  const hit = whichCache.get(name)
  if (hit && Date.now() - hit.at < 60_000) return hit.path
  const r = process.platform === 'win32'
    ? await runProgram('where.exe', [name], { timeoutMs: 5000 })
    : await runProgram('sh', ['-c', `command -v ${name}`], { timeoutMs: 5000 })
  const found = r.exitCode === 0 ? r.stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean) || null : null
  whichCache.set(name, { path: found, at: Date.now() })
  return found
}

export function clearWhichCache() {
  whichCache.clear()
}
