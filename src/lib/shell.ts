import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /del\s+\/[sqf]/i,
  /rmdir\s+\/[sq]/i,
  /erase\s+\S/i,
  /format\s+[a-zA-Z]:/i,
  /format\s+[a-zA-Z]\s*[.,]\s*(nome|drive)/i,
  /shutdown/i,
  /net\s+user\s+.*\s+\/add/i,
  /reg\s+(add|delete)/i,
  /Set-ItemProperty\b.*HK(LM|CU)/i,
  /Remove-Item\s+-Recurse\s+-Force/i,
  /Invoke-Expression|iex\s*\(/i,
  /curl\b.*\|\s*(sh|bash|iex)/i,
]

export function isSafeCommand(command: string): boolean {
  return !DANGEROUS_PATTERNS.some(p => p.test(command))
}

// Agents run with more restrictions than the user's own terminal: nothing that deletes
// files, rewrites git history or touches the registry/system. Deletion needs the user.
const AGENT_BLOCKED = [
  /\bRemove-Item\b/i,
  /\brm\s+\S/i,
  /\brmdir\b/i,
  /\brd\s+\/s/i,
  /\bdel\s+\S/i,
  /\berase\s+\S/i,
  /\bgit\s+(push|rm|reset\s+--hard|clean|checkout\s+--|rebase)/i,
  /\breg\s+(add|delete)/i,
  /\bSet-ItemProperty\b.*HK(LM|CU)/i,
  /\bformat\b\s+[a-z]:/i,
  /\bInvoke-WebRequest\b.*\|\s*(iex|Invoke-Expression)/i,
  /\bcurl\b.*\|\s*(sh|bash|iex)/i,
]

export function isSafeAgentCommand(command: string): string | null {
  if (!isSafeCommand(command)) return 'Comando bloqueado por segurança'
  const hit = AGENT_BLOCKED.find(p => p.test(command))
  return hit ? 'Agentes não podem apagar arquivos nem executar comandos destrutivos. Peça ao usuário para fazer a exclusão.' : null
}

/**
 * Environment for child shells/processes. The JARVIS server process holds provider
 * API keys and tokens in its env — a child must never inherit them, otherwise any
 * “harmless” command (Get-ChildItem env:, echo %GROQ_API_KEY%) would exfiltrate them.
 */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE)/i

export function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (SECRET_NAME.test(k)) continue
    env[k] = v
  }
  return env as NodeJS.ProcessEnv
}

export function shellEnv() {
  return { ...scrubbedEnv(), PATH: [process.env.PATH, 'C:\\Program Files\\nodejs'].join(';') }
}

/** Encerra o processo e sua árvore: resolve false se não foi possível (sem permissão / já acabado). */
export function killTree(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      const p = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      p.on('error', () => resolve(false))
      p.on('close', code => resolve(code === 0))
      if (!p.pid) resolve(false)
    })
  }
  try { process.kill(-pid, 'SIGKILL'); return Promise.resolve(true) } catch { return Promise.resolve(false) }
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
  cancelled: boolean
}

export type ShellKind = 'powershell' | 'cmd'

/**
 * cmd.exe starts ~10x faster than PowerShell and accepts `a && b` (PowerShell 5.1 does not),
 * but only plain calls to real programs behave the same in both shells. PowerShell aliases
 * (ls, cat, rm, pwd…), variables, `;` chains, single quotes and subexpressions stay in PowerShell.
 */
const CMD_PROGRAMS = new Set([
  'cd', 'dir', 'echo', 'type', 'where', 'findstr', 'tar', 'curl',
  'npm', 'npx', 'node', 'git', 'tsc', 'yarn', 'pnpm', 'bun', 'deno',
  'python', 'py', 'pip', 'pip3', 'uv', 'cargo', 'go', 'dotnet', 'java', 'mvn', 'gradle',
  'ping', 'ipconfig', 'nslookup', 'tracert', 'netstat', 'tasklist', 'whoami', 'hostname', 'systeminfo',
])

export function preferredShell(command: string): ShellKind {
  if (/[$`]|\.ps1\b/i.test(command)) return 'powershell'
  const bare = command.replace(/"[^"]*"/g, '""')
  if (/[;'(){}^]/.test(bare)) return 'powershell'
  const segments = bare.split(/&&|\|\|?/).map(s => s.trim())
  const plain = segments.every(s => {
    const program = (s.split(/\s+/)[0] || '').toLowerCase().replace(/\.(?:exe|cmd)$/, '')
    // cmd's echo prints the quotes themselves
    return CMD_PROGRAMS.has(program) && !(program === 'echo' && s.includes('"'))
  })
  return plain ? 'cmd' : 'powershell'
}

// UTF-8 output keeps accents intact; progress bars would otherwise leak CLIXML into stderr
const PS_PRELUDE = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";'

/** Executable, arguments and quoting mode that run `command` in the given shell. */
export function shellInvocation(kind: ShellKind, command: string) {
  if (kind === 'powershell') {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_PRELUDE + command], verbatim: false }
  }
  // cmd.exe does not understand the \" escaping Node applies by default, so pass the line as-is
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true }
}

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  maxOutput?: number
  onOutput?: (chunk: string) => void
  /** Defaults to 'auto' (see preferredShell). */
  shell?: ShellKind | 'auto'
}

export function runWithShell(command: string, cwd: string, opts: RunOptions = {}): Promise<CommandResult> {
  const max = opts.maxOutput ?? 12_000
  const started = Date.now()
  const kind = !opts.shell || opts.shell === 'auto' ? preferredShell(command) : opts.shell
  const { file, args, verbatim } = shellInvocation(kind, command)
  return new Promise(resolve => {
    const proc = spawn(file, args, {
      cwd,
      env: shellEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let cancelled = false
    let done = false
    // Decoders keep multi-byte characters intact when they straddle two chunks
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    const take = (cur: string, text: string) => (cur.length >= max ? cur : (cur + text).slice(0, max))
    proc.stdout.on('data', (d: Buffer) => { const t = outDecoder.write(d); stdout = take(stdout, t); if (t) opts.onOutput?.(t) })
    proc.stderr.on('data', (d: Buffer) => { const t = errDecoder.write(d); stderr = take(stderr, t); if (t) opts.onOutput?.(t) })

    const timer = setTimeout(() => { timedOut = true; if (proc.pid) killTree(proc.pid) }, opts.timeoutMs ?? 120_000)
    const onAbort = () => { cancelled = true; if (proc.pid) killTree(proc.pid) }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      stdout = take(stdout, outDecoder.end())
      stderr = take(stderr, errDecoder.end())
      resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started, timedOut, cancelled })
    }
    proc.on('close', finish)
    proc.on('error', err => { stderr += err.message; finish(-1) })
  })
}

/** Runs a shell command (cmd.exe fast path when safe, PowerShell otherwise); the whole process tree is killed on timeout or abort. */
export function runCommand(command: string, cwd: string, opts: RunOptions = {}): Promise<CommandResult> {
  return runWithShell(command, cwd, opts)
}
