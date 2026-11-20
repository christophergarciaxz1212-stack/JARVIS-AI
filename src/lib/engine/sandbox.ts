import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { engineDir } from './registry'

/**
 * Third-party code never inherits JARVIS's environment: it gets a minimal one with its own
 * HOME/TEMP inside the engine folder and only the credentials the user granted by name.
 * (Windows offers no OS-level sandbox without admin rights; isolation here is environment,
 * working directory, timeouts, static analysis and per-agent permissions.)
 */
export function sandboxEnv(extId: string, grantedEnv: string[] = []): Record<string, string> {
  const home = path.join(engineDir(), 'home', extId)
  const tmp = path.join(home, 'tmp')
  fs.mkdirSync(tmp, { recursive: true })
  const sys = process.env.SystemRoot || 'C:\\Windows'
  const env: Record<string, string> = {
    PATH: [path.dirname(nodeBinary().command), 'C:\\Program Files\\nodejs', `${sys}\\System32`, sys, `${sys}\\System32\\WindowsPowerShell\\v1.0`].join(';'),
    SystemRoot: sys,
    windir: sys,
    ComSpec: process.env.ComSpec || `${sys}\\System32\\cmd.exe`,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: tmp,
    TMP: tmp,
    NODE_ENV: 'production',
    // npm's cache stays outside the sandbox home so repeated installs don't re-download
    npm_config_cache: path.join(engineDir(), 'npm-cache'),
  }
  for (const name of grantedEnv) {
    const v = process.env[name]
    if (v) env[name] = v
  }
  return env
}

export function nodeBinary(): { command: string; env: Record<string, string> } {
  const system = 'C:\\Program Files\\nodejs\\node.exe'
  if (fs.existsSync(system)) return { command: system, env: {} }
  // Inside the packaged desktop app the server itself runs on Electron's Node
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

export interface ProcResult { code: number; stdout: string; stderr: string; timedOut: boolean }

function killTree(pid: number) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  else try { process.kill(-pid, 'SIGKILL') } catch {}
}

export function runProcess(command: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs?: number; input?: string; maxOutput?: number; signal?: AbortSignal }): Promise<ProcResult> {
  const max = opts.maxOutput ?? 400_000
  return new Promise(resolve => {
    const proc = spawn(command, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    proc.stdout.on('data', (d: Buffer) => { if (stdout.length < max) stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { if (stderr.length < max) stderr += d.toString() })
    const timer = setTimeout(() => { timedOut = true; if (proc.pid) killTree(proc.pid) }, opts.timeoutMs ?? 120_000)
    const onAbort = () => { if (proc.pid) killTree(proc.pid) }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    proc.on('error', e => { stderr += e.message })
    proc.on('close', code => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
    if (opts.input !== undefined) proc.stdin.end(opts.input)
    else proc.stdin.end()
  })
}

/** npm through cmd.exe (npm is a .cmd shim). Arguments are built by the engine, never from model text. */
export function npm(args: string[], cwd: string, extId: string, timeoutMs = 300_000) {
  for (const a of args) if (!/^[@\w./:=^~<>\-]+$/.test(a)) throw new Error(`Argumento npm inválido: ${a}`)
  const sys = process.env.SystemRoot || 'C:\\Windows'
  return runProcess(`${sys}\\System32\\cmd.exe`, ['/d', '/s', '/c', 'npm', ...args], { cwd, env: sandboxEnv(extId), timeoutMs })
}

export async function extractTarGz(file: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  const sys = process.env.SystemRoot || 'C:\\Windows'
  // bsdtar refuses absolute paths and ".." entries by default (no -P), so archives can't escape dest
  const r = await runProcess(`${sys}\\System32\\tar.exe`, ['-xzf', file, '-C', dest], { cwd: dest, env: { SystemRoot: sys, PATH: `${sys}\\System32` }, timeoutMs: 120_000 })
  if (r.code !== 0) throw new Error(`Falha ao extrair pacote: ${r.stderr.slice(0, 300)}`)
  const entries = fs.readdirSync(dest, { withFileTypes: true }).filter(e => e.name !== 'pax_global_header')
  return entries.length === 1 && entries[0].isDirectory() ? path.join(dest, entries[0].name) : dest
}

/**
 * Download a (possibly large) package archive. Capped — a runaway download must not fill the disk.
 * 250 MB → 600 MB because legitimate scientific-agent skill collections (large embedded
 * reference data) exceed even 250 MB; user-directed reinstalls only.
 */
export async function download(url: string, file: string, headers: Record<string, string> = {}, maxBytes = 600_000_000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'jarvis-skill-engine', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(600_000) })
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status}) em ${new URL(url).host}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > maxBytes) throw new Error(`Pacote grande demais (${Math.round(len / 1e6)} MB)`)
  const chunks: Buffer[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) throw new Error(`Pacote grande demais (limite ${Math.round(maxBytes / 1e6)} MB)`)
    chunks.push(Buffer.from(value))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat(chunks))
  return total
}
