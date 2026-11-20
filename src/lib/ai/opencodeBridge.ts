/**
 * Ponte OpenCode → JARVIS.
 *
 * O OpenCode Desktop instalado nesta máquina expõe um pool de modelos gratuitos
 * (`opencode/*-free`, big-pickle incluso) num tier sem custo, autenticado pela
 * própria sessão do desktop — o JARVIS não toca em credenciais nem guarda chaves.
 *
 * Não é HTTP: cada chamada spawna o CLI (`opencode run`). Duas decisões de design:
 * - o prompt vai por stdin (prompts de agente têm 5–8 mil tokens; o limite de
 *   linha de comando do Windows estoura antes disso);
 * - o agente `plan` (somente leitura) opera num diretório neutro vazio, então o
 *   pool grátis nunca edita arquivos do usuário nem executa ferramentas — as
 *   ações continuam sendo do JARVIS, não do OpenCode.
 *
 * Cota: "Free usage limit reached" é um pool diário compartilhado. O CLI devolve
 * a espera em `retryAfterMs`; a ponte a repassa como `status: 429` + `Retry-After`
 * para o classificador de erros do JARVIS esfriar o modelo e trocar automaticamente.
 */
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildBridgePrompt, type BridgeMessage } from './bridgePrompt'
import type { Usage } from '../agents/types'
import type { AIModel, Provider } from '@/types'

export const OPENCODE_PROVIDER = { id: 'opencode', name: 'OpenCode (grátis)', icon: '◼️' } as const
const SEP = '|'

export interface OpencodeSpec {
  id: string
  name: string
  category: AIModel['category']
  contextWindow: number
  speed: AIModel['speed']
  multimodal: boolean
}

// IDs verificados em `opencode models` (17/11/2026). Contexto real não é publicado
// pelo pool; registra-se 128k como teto conservador. Disponibilidade é volátil:
// o probe cruza esta lista com o que o CLI oferece e esconde o que sumiu.
export const OPENCODE_FREE_MODELS: OpencodeSpec[] = [
  { id: 'big-pickle', name: 'Big Pickle (stealth) — grátis', category: 'reasoning', contextWindow: 131_072, speed: 'medium', multimodal: false },
  { id: 'beam-free', name: 'Beam Free — grátis', category: 'chat', contextWindow: 131_072, speed: 'medium', multimodal: false },
  { id: 'iceman-free', name: 'Iceman Free — grátis', category: 'chat', contextWindow: 131_072, speed: 'medium', multimodal: false },
  { id: 'longcat-2.5-free', name: 'LongCat 2.5 — grátis', category: 'chat', contextWindow: 131_072, speed: 'medium', multimodal: false },
  { id: 'flint-40b-free', name: 'Flint 40B — grátis', category: 'code', contextWindow: 131_072, speed: 'medium', multimodal: false },
  { id: 'hy4-flash-free', name: 'Hy4 Flash — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'inkling-2-small-free', name: 'Inkling 2 Small — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'glm-5.3-flash-free', name: 'GLM 5.3 Flash — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning — grátis', category: 'fast', contextWindow: 131_072, speed: 'fast', multimodal: false },
  { id: 'nemotron-3.5-super-vl-free', name: 'Nemotron 3.5 Super VL — grátis', category: 'vision', contextWindow: 131_072, speed: 'medium', multimodal: true },
]

/** Diretório neutro para as sessões do bridge: nada para ler/escrever no projeto do usuário. */
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'jarvis-opencode-scratch')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* o CLI falha com erro claro se não puder criar */ }
  return dir
}

/** Localiza o opencode-cli: OPENCODE_CLI tem precedência; senão caminhos conhecidos; senão o PATH. */
export function opencodeCliPath(): string | null {
  const fromEnv = process.env.OPENCODE_CLI
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null
  const candidates: string[] = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ai.opencode.desktop', 'opencode-cli.exe'),
      ]
    : [
        '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
        path.join(os.homedir(), '.local', 'bin', 'opencode'),
        '/usr/local/bin/opencode',
      ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(finder, process.platform === 'win32' ? ['opencode-cli'] : ['opencode'], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] })
    const first = out.split(/\r?\n/).map(l => l.trim()).find(Boolean)
    if (first && fs.existsSync(first)) return first
  } catch { /* não está no PATH */ }
  return null
}

export interface BridgeParse {
  text: string
  inputTokens: number
  outputTokens: number
  cost: number
  /** Presente quando o CLI reporta um erro (ex.: cota grátis esgotada). */
  error?: { status: number; message: string; retryAfterMs?: number }
}

/** Interpreta o NDJSON do `opencode run --format json`. Linhas inválidas são ignoradas. */
export function parseNdjson(stdout: string): BridgeParse {
  const out: BridgeParse = { text: '', inputTokens: 0, outputTokens: 0, cost: 0 }
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t || t[0] !== '{') continue
    let evt: { type?: string; part?: { text?: string; cost?: number; tokens?: { input?: number; output?: number } }; error?: { status?: number; message?: string; retryAfterMs?: number } }
    try { evt = JSON.parse(t) } catch { continue }
    if (evt.type === 'text' && evt.part?.text) out.text += evt.part.text
    else if (evt.type === 'step_finish') {
      const tokens = evt.part?.tokens
      if (tokens) {
        out.inputTokens = tokens.input ?? out.inputTokens
        out.outputTokens = tokens.output ?? out.outputTokens
      }
      if (typeof evt.part?.cost === 'number') out.cost = evt.part.cost
    } else if (evt.type === 'error' && evt.error) {
      out.error = {
        status: Number(evt.error.status) || 0,
        message: String(evt.error.message || 'Erro do OpenCode'),
        retryAfterMs: typeof evt.error.retryAfterMs === 'number' ? evt.error.retryAfterMs : undefined,
      }
    }
  }
  return out
}

type StdioMsg = { role: 'user' | 'assistant' | 'system'; content: string }

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

function runCli(exe: string, args: string[], input: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelado'), { name: 'AbortError' }))
    let out = ''
    let err = ''
    let done = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(exe, args, { windowsHide: true, env: process.env })
    } catch (e) {
      return reject(e as Error)
    }
    const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn() }
    const fail = (e: Error) => finish(() => reject(e))
    const ok = (s: string) => finish(() => resolve(s))
    const onAbort = () => { try { child.kill('SIGTERM') } catch { /* já morto */ } fail(Object.assign(new Error('Cancelado'), { name: 'AbortError' })) }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch { /* já morto */ }
      fail(new Error(`OpenCode excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s.`))
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      out += d
      if (out.length > MAX_OUTPUT_BYTES) { try { child.kill('SIGTERM') } catch { /* já morto */ } fail(new Error('OpenCode devolveu saída grande demais.')) }
    })
    child.stderr?.on('data', (d: string) => { err += d })
    child.on('error', (e) => fail(new Error(`OpenCode CLI falhou: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0 || out.trim()) return ok(out)
      const detail = err.replace(/^opencode(-cli)?(\.exe)?\s*:\s*/i, '').replace(/\s+/g, ' ').trim()
      fail(new Error(detail || `OpenCode saiu com código ${code}.`))
    })
    child.stdin?.on('error', () => { /* EPIPE: o CLI fechou antes; o 'close' decide */ })
    child.stdin?.write(input)
    child.stdin?.end()
    signal?.addEventListener('abort', onAbort)
  })
}

/** Uma chamada de chat completa pelo pool grátis do OpenCode. Retorna o texto e o uso real reportado pelo CLI. */
export async function callOpencode(model: string, messages: StdioMsg[], timeoutMs = 180_000, signal?: AbortSignal): Promise<{ text: string; usage: Usage }> {
  const exe = opencodeCliPath()
  if (!exe) throw new Error('OpenCode CLI não encontrado. Instale o OpenCode Desktop (opencode.ai) — ele assina o pool grátis desta máquina.')
  const prompt = buildBridgePrompt(messages)
  const args = ['run', '--agent', 'plan', '-m', `opencode/${model}`, '--format', 'json', '--archived', '--title', 'jarvis-bridge', scratchDir()]
  const stdout = await runCli(exe, args, prompt, timeoutMs, signal)
  const parsed = parseNdjson(stdout)
  if (parsed.error) {
    const err = new Error(parsed.error.message) as Error & { status?: number; headers?: Record<string, string> }
    if (parsed.error.status) err.status = parsed.error.status
    if (parsed.error.retryAfterMs) err.headers = { 'retry-after': String(Math.max(1, Math.round(parsed.error.retryAfterMs / 1000))) }
    throw err
  }
  const text = parsed.text.trim()
  if (!text) throw new Error('OpenCode não devolveu texto.')
  return { text, usage: { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, cost: parsed.cost } }
}

/** Probe para o catálogo: CLI presente e `opencode models` responde = conectado; só entram na lista os grátis que o CLI ainda oferece. */
export async function probeOpencode(): Promise<Provider> {
  const base = { id: OPENCODE_PROVIDER.id, name: OPENCODE_PROVIDER.name, icon: OPENCODE_PROVIDER.icon, envKey: '', baseUrl: '', free: true, models: [] as AIModel[] }
  const exe = opencodeCliPath()
  if (!exe) return { ...base, status: 'disconnected' }
  try {
    const stdout = await runCli(exe, ['models'], '', 20_000)
    const listed = new Set(stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('opencode/')))
    const models: AIModel[] = OPENCODE_FREE_MODELS
      .filter(spec => listed.has(`opencode/${spec.id}`))
      .map(spec => ({
        id: `${OPENCODE_PROVIDER.id}${SEP}${spec.id}`,
        name: spec.name,
        provider: OPENCODE_PROVIDER.id,
        providerName: OPENCODE_PROVIDER.name,
        category: spec.category,
        contextWindow: spec.contextWindow,
        maxTokens: 8192,
        free: true,
        multimodal: spec.multimodal,
        toolSupport: false,
        streaming: true,
        speed: spec.speed,
        status: 'available' as const,
      }))
    return { ...base, status: models.length ? 'connected' : 'disconnected', models }
  } catch {
    return { ...base, status: 'disconnected' }
  }
}
