/**
 * Ponte Antigravity → JARVIS.
 * O Antigravity CLI (`agy`) oferece um tier gratuito nesta máquina com modelos reais:
 * Claude Sonnet 4.6 (thinking), Claude Opus 4.6 (thinking), GPT-OSS 120B e Gemini 3.8 Flash
 * (quota do tier grátis compartilhada com a IDE e sujeita a "Individual quota reached").
 * Não é HTTP: cada chamada spawna o CLI com --print. A autenticação é a do próprio CLI
 * (conta Google do usuário) — o JARVIS não toca em credenciais.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildBridgePrompt, type BridgeMessage } from './bridgePrompt'
import type { AIModel, Provider } from '@/types'

export const AGY_PROVIDER = { id: 'antigravity', name: 'Antigravity (grátis)', icon: '🚀' } as const
const SEP = '|'

// Medidos em 17/11/2026 nesta máquina (agy v1.5.10, tier Free): os 3 Gemini 3.8 Flash
// respondem "Individual quota reached" (reset em ~88h); os outros 3 respondem normalmente.
export interface AntigravitySpec {
  id: string
  name: string
  category: AIModel['category']
  contextWindow: number
  toolSupport: boolean
  multimodal: boolean
  speed: AIModel['speed']
}

export const ANTIGRAVITY_MODELS: AntigravitySpec[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking) — grátis', category: 'reasoning', contextWindow: 200_000, toolSupport: true, multimodal: true, speed: 'medium' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking) — grátis', category: 'reasoning', contextWindow: 200_000, toolSupport: true, multimodal: true, speed: 'slow' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium) — grátis', category: 'code', contextWindow: 131_072, toolSupport: true, multimodal: false, speed: 'medium' },
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High) — grátis', category: 'fast', contextWindow: 1_048_576, toolSupport: true, multimodal: true, speed: 'fast' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium) — grátis', category: 'fast', contextWindow: 1_048_576, toolSupport: true, multimodal: true, speed: 'fast' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low) — grátis', category: 'fast', contextWindow: 1_048_576, toolSupport: true, multimodal: true, speed: 'fast' },
]

/** Localiza o agy.exe; AGY_PATH no ambiente tem precedência e é tratado como override absoluto (útil em testes). */
export function agyPath(): string | null {
  const fromEnv = process.env.AGY_PATH
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null
  const fallback = path.join(os.homedir(), '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy')
  return fs.existsSync(fallback) ? fallback : null
}

type Message = BridgeMessage

export const buildPrompt = buildBridgePrompt

// O prompt vai como argumento e o Windows corta a linha de comando em 32.767 caracteres
const MAX_PROMPT_CHARS = 30_000

/**
 * Pasta vazia própria: o agy é um agente com ferramentas, e a pasta de trabalho dele é o
 * "projeto" que ele enxerga. Rodar na pasta do JARVIS exporia código e data/ (chaves).
 */
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'jarvis-agy-scratch')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* o CLI falha com erro claro se não puder usar a pasta */ }
  return dir
}

const cancelled = () => Object.assign(new Error('Cancelado'), { name: 'AbortError' })

async function runAgy(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const exe = agyPath()
  if (!exe) throw new Error('Antigravity CLI não encontrado. Instale/conecte o Antigravity (agy).')
  if (signal?.aborted) throw cancelled()
  return new Promise((resolve, reject) => {
    execFile(exe, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, cwd: scratchDir(), signal }, (error, stdout, stderr) => {
      if (signal?.aborted || error?.name === 'AbortError') return reject(cancelled())
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error('Antigravity CLI não encontrado (agy).'))
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), ok: !error })
    })
  })
}

/**
 * Lê o erro que o agy imprime no stderr: a linha `AGY_ERROR: {json}` (código HTTP real) e o
 * "Resets in 139h50m29s" da cota individual, para o JARVIS esfriar o modelo pelo tempo certo
 * em vez de gastar uma chamada de ~5 s a cada mensagem até a cota voltar.
 */
export function parseAgyError(stderr: string): { status: number; message: string; retryAfterMs?: number } | null {
  const lines = stderr.split(/\r?\n/).map(l => l.trim())
  let status = 0
  let message = ''
  const tagged = lines.find(l => l.startsWith('AGY_ERROR:'))
  if (tagged) {
    try {
      const j = JSON.parse(tagged.slice('AGY_ERROR:'.length)) as { short_error?: unknown; error_code?: unknown }
      status = Number(j.error_code) || 0
      message = String(j.short_error || '')
    } catch { /* linha truncada: usa a linha "error:" */ }
  }
  if (!message) message = (lines.find(l => /^error:/i.test(l)) || '').replace(/^error:\s*/i, '')
  if (!message && !status) return null
  const reset = /resets? in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i.exec(message)
  const retryAfterMs = reset && (reset[1] || reset[2] || reset[3])
    ? ((Number(reset[1] || 0) * 60 + Number(reset[2] || 0)) * 60 + Number(reset[3] || 0)) * 1000
    : undefined
  if (!status && /quota|rate.?limit|resource.?exhausted/i.test(message)) status = 429
  return { status, message: message || `Antigravity recusou a chamada (${status})`, retryAfterMs }
}

/** Uma chamada de chat completa. Retorna o texto; lança Error com o motivo real (quota, rede, timeout). */
export async function callAntigravity(model: string, messages: Message[], timeoutMs = 180_000, signal?: AbortSignal): Promise<string> {
  const prompt = buildPrompt(messages)
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Conversa longa demais para a ponte Antigravity (${prompt.length.toLocaleString('pt-BR')} caracteres; o Windows limita a linha de comando a ~32 mil).`)
  }
  const { stdout, stderr, ok } = await runAgy(['-p', prompt, '--print-timeout', `${Math.floor(timeoutMs / 1000)}s`, '--model', model], timeoutMs + 5_000, signal)
  const text = stdout.trim()
  if (ok && text) return text
  const parsed = parseAgyError(stderr)
  if (parsed) {
    const err = new Error(`Antigravity: ${parsed.message}`) as Error & { status?: number; headers?: Record<string, string> }
    if (parsed.status) err.status = parsed.status
    if (parsed.retryAfterMs) err.headers = { 'retry-after': String(Math.max(1, Math.round(parsed.retryAfterMs / 1000))) }
    throw err
  }
  const detail = stderr.replace(/^agy(\.exe)?\s*:\s*/i, '').replace(/\s+/g, ' ').trim()
  throw new Error(detail || 'Antigravity não devolveu texto.')
}

/** Probe para o catálogo: binário presente e `agy --version` responde = conectado. */
export async function probeAntigravity(): Promise<Provider> {
  const base = { id: AGY_PROVIDER.id, name: AGY_PROVIDER.name, icon: AGY_PROVIDER.icon, envKey: '', baseUrl: '', free: true, models: [] as AIModel[] }
  const exe = agyPath()
  if (!exe) return { ...base, status: 'disconnected' }
  try {
    const { ok, stdout, stderr } = await runAgy(['--version'], 15_000)
    if (!ok) throw new Error(stderr.trim() || 'agy --version falhou')
    const models = ANTIGRAVITY_MODELS.map(spec => ({
      id: `${AGY_PROVIDER.id}${SEP}${spec.id}`,
      name: spec.name,
      provider: AGY_PROVIDER.id,
      providerName: AGY_PROVIDER.name,
      category: spec.category,
      contextWindow: spec.contextWindow,
      maxTokens: 8192,
      free: true,
      multimodal: spec.multimodal,
      toolSupport: spec.toolSupport,
      streaming: true,
      speed: spec.speed,
      status: 'available' as const,
    }))
    return { ...base, status: 'connected', models }
  } catch {
    return { ...base, status: 'disconnected' }
  }
}
