import type { GpuInfo } from './inventory'

const OLLAMA = process.env.OLLAMA_HOST?.startsWith('http') ? process.env.OLLAMA_HOST : 'http://127.0.0.1:11434'

export interface OllamaModel { name: string; sizeMb: number; params?: string; quant?: string; family?: string }
export interface OllamaLoaded { name: string; sizeMb: number; vramMb: number; expiresAt?: string }
export interface OllamaStatus { running: boolean; version?: string; models: OllamaModel[]; loaded: OllamaLoaded[]; error?: string }

async function getJson<T>(path: string, timeoutMs = 3000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${OLLAMA}${path}`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const [ver, tags, ps] = await Promise.all([
      getJson<{ version: string }>('/api/version'),
      getJson<{ models: Array<{ name: string; size: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }> }>('/api/tags'),
      getJson<{ models: Array<{ name: string; size: number; size_vram: number; expires_at?: string }> }>('/api/ps').catch(() => ({ models: [] })),
    ])
    return {
      running: true,
      version: ver.version,
      models: (tags.models || []).map(m => ({ name: m.name, sizeMb: Math.round(m.size / 1048576), params: m.details?.parameter_size, quant: m.details?.quantization_level, family: m.details?.family })),
      loaded: (ps.models || []).map(m => ({ name: m.name, sizeMb: Math.round(m.size / 1048576), vramMb: Math.round(m.size_vram / 1048576), expiresAt: m.expires_at })),
    }
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'sem resposta' : (e as Error).message
    return { running: false, models: [], loaded: [], error: `Ollama não está respondendo em ${OLLAMA} (${msg}). Abra o Ollama ou rode "ollama serve".` }
  }
}

export interface ModelAdvice {
  tier: string
  maxParamsB: number
  where: 'GPU' | 'GPU+CPU' | 'CPU'
  examples: string[]
  notes: string[]
}

/**
 * Rough sizing for GGUF Q4_K_M weights (~0.6 GB per billion parameters) plus
 * ~1.5 GB of KV cache/runtime for an 8k context. Conservative by design.
 */
export function recommendModels(input: { vramMb?: number; ramMb: number }): ModelAdvice {
  const vramGb = (input.vramMb || 0) / 1024
  const ramGb = input.ramMb / 1024
  const fitB = (gb: number) => Math.max(0, Math.floor(((gb - 1.5) / 0.6) * 10) / 10)
  const gpuB = fitB(vramGb)
  const offloadB = fitB(vramGb + Math.max(0, ramGb * 0.5))
  const cpuB = fitB(ramGb * 0.6)
  const notes: string[] = []
  let where: ModelAdvice['where'] = 'CPU'
  let maxParamsB = cpuB
  if (gpuB >= 3) { where = 'GPU'; maxParamsB = gpuB }
  else if (vramGb >= 2) { where = 'GPU+CPU'; maxParamsB = Math.min(offloadB, 14); notes.push('VRAM pequena: parte das camadas roda na CPU (mais lento).') }
  if (where === 'CPU') notes.push('Sem GPU dedicada utilizável: prefira modelos pequenos (1–4B) e quantização Q4.')
  if (where === 'GPU' && offloadB > gpuB * 1.5) notes.push(`Modelos até ~${Math.floor(offloadB)}B cabem com offload parcial para a RAM, mas ficam bem mais lentos.`)
  notes.push('Contexto longo (32k+) consome muita memória extra: reduza num_ctx se travar.')

  // Keyed by parameter count; 10% tolerance because the sizing above is deliberately conservative
  const catalog: Array<[number, string]> = [
    [1.7, 'qwen3:1.7b / gemma3:1b (respostas rápidas, tarefas simples)'],
    [4, 'qwen3:4b / gemma3:4b / phi4-mini (assistente geral leve)'],
    [8, 'qwen3:8b / llama3.1:8b / qwen2.5-coder:7b (bom equilíbrio; código)'],
    [14, 'qwen3:14b / phi4:14b / qwen2.5-coder:14b (raciocínio melhor)'],
    [27, 'gemma3:27b / qwen3:30b-a3b (MoE, rápido para o tamanho)'],
    [32, 'qwen2.5-coder:32b / qwen3:32b (código de alto nível)'],
    [70, 'llama3.3:70b / qwen2.5:72b (precisa de GPU grande ou várias)'],
  ]
  const examples = catalog.filter(([b], i) => i === 0 || b <= maxParamsB * 1.1).slice(-3).map(([, ex]) => ex).reverse()
  const tier = maxParamsB >= 30 ? 'Alto (30B+)' : maxParamsB >= 13 ? 'Médio-alto (13–30B)' : maxParamsB >= 7 ? 'Médio (7–13B)' : maxParamsB >= 3 ? 'Leve (3–7B)' : 'Mínimo (≤ 3B)'
  return { tier, maxParamsB: Math.round(maxParamsB * 10) / 10, where, examples, notes }
}

export function bestGpu(gpus: GpuInfo[]): GpuInfo | undefined {
  return [...gpus].filter(g => g.memoryTotalMb).sort((a, b) => (b.memoryTotalMb || 0) - (a.memoryTotalMb || 0))[0]
}
