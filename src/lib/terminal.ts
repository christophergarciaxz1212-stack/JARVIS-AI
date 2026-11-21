/**
 * Sessões de terminal do JARVIS.
 *
 * Um shell de verdade que **fica vivo** entre comandos: `cd` muda a pasta para
 * os próximos, variáveis continuam valendo, e um programa que pergunta algo
 * (`Read-Host`, `npm init`) recebe a resposta pelo stdin.
 *
 * Sem módulo nativo de propósito. O servidor do JARVIS roda na Node embutida
 * do Electron (`ELECTRON_RUN_AS_NODE`), então um `node-pty` precisaria ser
 * compilado para o ABI do Electron — risco de quebrar o instalador inteiro por
 * uma dependência. Com `spawn` e stdin aberto cobrimos o que importa.
 *
 * O que NÃO temos sem PTY, e é melhor dizer do que fingir: cores e controle de
 * cursor (barras de progresso saem como texto solto) e programas que só aceitam
 * entrada de um terminal real, como a senha do `ssh`.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { StringDecoder } from 'string_decoder'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { isSafeCommand, killTree, shellEnv } from './shell'

export type TerminalShell = 'powershell' | 'cmd'

export interface TerminalChunk {
  id: number
  at: number
  kind: 'saida' | 'erro' | 'comando' | 'aviso'
  text: string
}

export interface TerminalInfo {
  id: string
  shell: TerminalShell
  /**
   * Pasta em que a sessão foi aberta. NÃO acompanha os `cd` do usuário: sem PTY
   * não há como saber a pasta atual sem rodar um comando por fora e sujar a
   * saída. A interface diz "aberto em" por isso.
   */
  cwd: string
  title: string
  /** Processo ainda vivo. */
  alive: boolean
  createdAt: number
  lastUsedAt: number
  exitCode?: number | null
}

/** Teto de saída guardada por sessão: o suficiente para rolar, sem comer memória. */
const MAX_BUFFER_CHARS = 200_000
const MAX_SESSIONS = 8
/** Sessão parada por muito tempo é encerrada: nada de processo órfão. */
const IDLE_MS = 60 * 60 * 1000

const INVOCATION: Record<TerminalShell, { file: string; args: string[] }> = {
  // Sem -NonInteractive: é ele que impede o Read-Host de funcionar.
  powershell: { file: 'powershell.exe', args: ['-NoProfile', '-NoLogo', '-Command', '-'] },
  cmd: { file: 'cmd.exe', args: ['/q', '/k'] },
}

const PRELUDE: Record<TerminalShell, string> = {
  powershell: '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue"',
  cmd: 'chcp 65001>nul',
}

class TerminalSession {
  readonly id = uuidv4()
  readonly createdAt = Date.now()
  lastUsedAt = Date.now()
  title: string
  cwd: string
  exitCode: number | null | undefined
  private proc: ChildProcessWithoutNullStreams | null = null
  private chunks: TerminalChunk[] = []
  private seq = 0
  private chars = 0
  private listeners = new Set<(c: TerminalChunk) => void>()
  private outDecoder = new StringDecoder('utf8')
  private errDecoder = new StringDecoder('utf8')

  constructor(readonly shell: TerminalShell, cwd: string, title?: string) {
    this.cwd = cwd
    this.title = title || (shell === 'cmd' ? 'CMD' : 'PowerShell')
    const { file, args } = INVOCATION[shell]
    this.proc = spawn(file, args, {
      cwd,
      env: shellEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc.stdout.on('data', (d: Buffer) => this.push('saida', this.outDecoder.write(d)))
    this.proc.stderr.on('data', (d: Buffer) => this.push('erro', this.errDecoder.write(d)))
    this.proc.on('error', e => { this.push('aviso', `Não foi possível iniciar o shell: ${e.message}`); this.proc = null })
    this.proc.on('close', code => {
      this.exitCode = code
      this.proc = null
      this.push('aviso', `Sessão encerrada (código ${code ?? 'desconhecido'})`)
    })
    this.write(PRELUDE[shell])
  }

  get alive() {
    return !!this.proc && !this.proc.killed
  }

  info(): TerminalInfo {
    return {
      id: this.id, shell: this.shell, cwd: this.cwd, title: this.title,
      alive: this.alive, createdAt: this.createdAt, lastUsedAt: this.lastUsedAt, exitCode: this.exitCode,
    }
  }

  private push(kind: TerminalChunk['kind'], rawText: string) {
    // Windows manda CRLF; o retorno de carro solto suja o texto na tela.
    const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '')
    if (!text) return
    const chunk: TerminalChunk = { id: ++this.seq, at: Date.now(), kind, text }
    this.chunks.push(chunk)
    this.chars += text.length
    // Descarta o começo quando passa do teto
    while (this.chars > MAX_BUFFER_CHARS && this.chunks.length > 1) {
      this.chars -= this.chunks[0].text.length
      this.chunks.shift()
    }
    for (const l of this.listeners) { try { l(chunk) } catch { /* ouvinte morto */ } }
  }

  /** Histórico guardado; `after` devolve só o que veio depois daquele id. */
  history(after = 0): TerminalChunk[] {
    return after ? this.chunks.filter(c => c.id > after) : [...this.chunks]
  }

  subscribe(fn: (c: TerminalChunk) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Manda uma linha para o shell. Serve tanto para um comando quanto para
   * responder a uma pergunta de um programa em execução — o shell não distingue,
   * e é justamente isso que torna a sessão interativa.
   */
  write(line: string, { echo = false } = {}) {
    if (!this.proc) throw new Error('Esta sessão já foi encerrada')
    this.lastUsedAt = Date.now()
    if (echo) this.push('comando', line)
    this.proc.stdin.write(line.endsWith('\n') ? line : `${line}\n`)
  }

  /**
   * Interrompe o programa que a sessão está rodando, sem derrubar a sessão.
   *
   * Escrever `\x03` no stdin NÃO funciona sem PTY: no Windows o Ctrl+C é um
   * evento de console, não um byte, e o processo simplesmente ignora (medido).
   * O que funciona é matar os processos-filhos do shell — poupando o
   * `conhost.exe`, que é infraestrutura do console: matá-lo derruba o shell.
   *
   * Devolve quantos processos foram encerrados. Zero significa que não havia
   * programa externo rodando: ou a sessão está ociosa, ou o próprio shell está
   * ocupado (um `Start-Sleep` na linha, por exemplo) e aí só fechando a sessão.
   */
  async interrupt(): Promise<number> {
    const pid = this.proc?.pid
    if (!pid) return 0
    this.lastUsedAt = Date.now()

    const filhos = await childrenOf(pid)
    if (!filhos.length) {
      this.push('aviso', 'Nada para interromper: nenhum programa externo rodando. Se o próprio shell está ocupado, feche a sessão.')
      return 0
    }
    for (const filho of filhos) killTree(filho)
    this.push('aviso', `^C — ${filhos.length} processo(s) encerrado(s)`)
    return filhos.length
  }

  close() {
    const pid = this.proc?.pid
    try { this.proc?.stdin.end() } catch { /* já fechado */ }
    if (pid) killTree(pid)
    this.proc = null
    this.listeners.clear()
  }
}

/**
 * PIDs dos processos-filhos diretos de `pid`, sem o `conhost.exe`.
 * O conhost é o host de console do próprio shell: encerrá-lo mata a sessão
 * junto, que é o oposto do que "interromper" deve fazer.
 */
function childrenOf(pid: number): Promise<number[]> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`],
      { windowsHide: true, timeout: 10_000 },
      (_e, stdout) => {
        const pids = String(stdout || '').trim().split(/\r?\n/)
          .map(l => l.trim().split(/\s+/))
          .filter(([, nome]) => nome && !/^conhost\.exe$/i.test(nome))
          .map(([p]) => Number(p))
          .filter(n => Number.isFinite(n) && n > 0)
        resolve(pids)
      },
    )
  })
}

interface Registry { sessions: Map<string, TerminalSession> }

const g = globalThis as unknown as { __jarvisTerminals?: Registry }

function registry(): Registry {
  if (!g.__jarvisTerminals) g.__jarvisTerminals = { sessions: new Map() }
  return g.__jarvisTerminals
}

/** Encerra o que ficou parado tempo demais. */
function reapIdle() {
  const { sessions } = registry()
  for (const [id, s] of sessions) {
    if (!s.alive || Date.now() - s.lastUsedAt > IDLE_MS) {
      s.close()
      sessions.delete(id)
    }
  }
}

export function createTerminal(opts: { shell?: TerminalShell; cwd?: string; title?: string } = {}): TerminalInfo {
  reapIdle()
  const { sessions } = registry()
  if (sessions.size >= MAX_SESSIONS) throw new Error(`Limite de ${MAX_SESSIONS} terminais abertos. Feche um antes de abrir outro.`)

  const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : process.cwd()
  const shell: TerminalShell = opts.shell === 'cmd' ? 'cmd' : 'powershell'
  const session = new TerminalSession(shell, cwd, opts.title)
  sessions.set(session.id, session)
  return session.info()
}

export function getTerminal(id: string) {
  return registry().sessions.get(id)
}

export function listTerminals(): TerminalInfo[] {
  reapIdle()
  return [...registry().sessions.values()].map(s => s.info()).sort((a, b) => a.createdAt - b.createdAt)
}

export function closeTerminal(id: string): boolean {
  const { sessions } = registry()
  const s = sessions.get(id)
  if (!s) return false
  s.close()
  sessions.delete(id)
  return true
}

export function closeAllTerminals() {
  const { sessions } = registry()
  for (const s of sessions.values()) s.close()
  sessions.clear()
}

/**
 * Envia uma linha para a sessão. O piso de segurança é o mesmo do resto do
 * JARVIS: o que destrói a máquina não passa, nem aqui.
 */
export function writeTerminal(id: string, line: string) {
  const s = getTerminal(id)
  if (!s) throw new Error('Terminal não encontrado')
  if (line.length > 8000) throw new Error('Linha longa demais')
  if (!isSafeCommand(line)) throw new Error('Comando bloqueado por segurança: formatar disco, apagar a raiz ou desligar a máquina não são permitidos.')
  s.write(line, { echo: true })
  return s.info()
}
