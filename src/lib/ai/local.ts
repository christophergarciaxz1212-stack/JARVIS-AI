/**
 * Catálogo curado de modelos locais para a máquina do usuário.
 * O foco é eficiência: modelos que cabem nos 6 GB de VRAM da GTX 1660 SUPER
 * (ou que rodam parcialmente na CPU com 32 GB de RAM) sem travar o resto do app.
 */
import os from 'os'
import { execFileSync } from 'child_process'

const GB = 1024 ** 3
const ollamaBase = () => process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

export interface LocalModelSpec {
  id: string
  name: string
  params: string
  sizeGB: number
  category: 'fast' | 'chat' | 'code' | 'reasoning' | 'vision'
  description: string
  useFor: string
  contextWindow: number
  toolSupport: boolean
  minRamGB: number
  recommendedVramGB: number
}

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    params: '3B',
    sizeGB: 2.0,
    category: 'fast',
    description: 'Rápido, cabe inteiro na GPU e responde em segundos. Melhor custo-benefício para o dia a dia.',
    useFor: 'conversa, resumos, classificação, respostas rápidas',
    contextWindow: 131072,
    toolSupport: true,
    minRamGB: 8,
    recommendedVramGB: 3,
  },
  {
    id: 'phi4-mini:3.8b',
    name: 'Phi-4 Mini 3.8B',
    params: '3.8B',
    sizeGB: 2.5,
    category: 'reasoning',
    description: 'Raciocínio acima do tamanho: bom em matemática, lógica e instruções curtas.',
    useFor: 'raciocínio, matemática, análise curta',
    contextWindow: 131072,
    toolSupport: true,
    minRamGB: 8,
    recommendedVramGB: 4,
  },
  {
    id: 'qwen3:4b',
    name: 'Qwen3 4B',
    params: '4B',
    sizeGB: 2.3,
    category: 'chat',
    description: 'Geração atual, 262k de contexto e ferramentas. Pensa antes de responder quando necessário.',
    useFor: 'conversa, raciocínio curto, uso de ferramentas',
    contextWindow: 262144,
    toolSupport: true,
    minRamGB: 8,
    recommendedVramGB: 4,
  },
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 4B',
    params: '4B',
    sizeGB: 3.3,
    category: 'vision',
    description: 'Multimodal: entende imagem e texto. Bom para descrever prints e documentos.',
    useFor: 'visão, conversa geral, descrição de imagens',
    contextWindow: 131072,
    toolSupport: false,
    minRamGB: 12,
    recommendedVramGB: 5,
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen2.5 Coder 7B',
    params: '7B',
    sizeGB: 4.7,
    category: 'code',
    description: 'O melhor local para código: gera, explica e corrige com sintaxe consistente.',
    useFor: 'código, refatoração, revisão, scripts',
    contextWindow: 32768,
    toolSupport: true,
    minRamGB: 16,
    recommendedVramGB: 6,
  },
  {
    id: 'deepseek-r1:8b',
    name: 'DeepSeek R1 8B',
    params: '8B',
    sizeGB: 5.2,
    category: 'reasoning',
    description: 'Raciocínio passo a passo. Mais lento: use quando a resposta precisa de análise profunda.',
    useFor: 'análise profunda, planejamento, problemas difíceis',
    contextWindow: 131072,
    toolSupport: true,
    minRamGB: 16,
    recommendedVramGB: 6,
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    params: '1B',
    sizeGB: 1.3,
    category: 'fast',
    description: 'O menor do catálogo: latência mínima para tarefas simples e máquinas apertadas.',
    useFor: 'classificação, extração, respostas ultra-rápidas',
    contextWindow: 131072,
    toolSupport: true,
    minRamGB: 4,
    recommendedVramGB: 2,
  },
]

export interface HardwareInfo {
  ramGB: number
  cpu: string
  cores: number
  gpu: string | null
  vramGB: number | null
  platform: string
}

const g = globalThis as unknown as {
  __jarvisHardware?: HardwareInfo
  __jarvisPulls?: Map<string, LocalPullState>
}

function detectGpu(): { name: string; vramGB: number } | null {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
    }).trim()
    const [name, vram] = out.split(',').map(s => s.trim())
    if (!name) return null
    return { name, vramGB: Math.round(Number(vram) / 102.4) / 10 }
  } catch {
    return null
  }
}

export function hardwareInfo(): HardwareInfo {
  if (g.__jarvisHardware) return g.__jarvisHardware
  const cpus = os.cpus()
  const gpu = detectGpu()
  g.__jarvisHardware = {
    ramGB: Math.round(os.totalmem() / GB),
    cpu: cpus[0]?.model?.trim() || 'CPU',
    cores: cpus.length,
    gpu: gpu?.name || null,
    vramGB: gpu?.vramGB ?? null,
    platform: process.platform,
  }
  return g.__jarvisHardware
}

export interface InstalledLocalModel {
  id: string
  name: string
  sizeGB: number
  params: string
  contextWindow: number
  family: string
  capabilities: string[]
}

export async function installedLocalModels(): Promise<InstalledLocalModel[]> {
  const res = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`)
  const data: any = await res.json()
  return (data.models || []).map((m: any) => ({
    id: String(m.name || m.model || ''),
    name: String(m.name || m.model || '').split('/').pop(),
    sizeGB: Math.round((Number(m.size) / GB) * 10) / 10,
    params: String(m.details?.parameter_size || ''),
    contextWindow: Number(m.details?.context_length || 0),
    family: String(m.details?.family || ''),
    capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
  }))
}

export interface LocalPullState {
  model: string
  status: 'running' | 'done' | 'error'
  percent: number
  detail: string
  startedAt: number
  updatedAt: number
  error?: string
}

const pulls = (g.__jarvisPulls ??= new Map<string, LocalPullState>())

export function listLocalPulls(): LocalPullState[] {
  return [...pulls.values()].sort((a, b) => b.startedAt - a.startedAt)
}

/** Starts (or rejoins) an Ollama pull. Progress is kept in memory and polled by the UI. */
export function startLocalPull(model: string): LocalPullState {
  const spec = LOCAL_MODELS.find(m => m.id === model)
  if (!spec) throw new Error(`Modelo fora do catálogo local: ${model}`)
  const running = pulls.get(model)
  if (running?.status === 'running') return running

  const state: LocalPullState = {
    model,
    status: 'running',
    percent: 0,
    detail: 'Iniciando download…',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
  pulls.set(model, state)
  void runPull(state)
  return state
}

async function runPull(state: LocalPullState) {
  const update = (patch: Partial<LocalPullState>) => {
    Object.assign(state, patch, { updatedAt: Date.now() })
  }
  try {
    const res = await fetch(`${ollamaBase()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: state.model, stream: true }),
    })
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Ollama ${res.status}: ${detail.slice(0, 200)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines.filter(Boolean)) {
        let event: any
        try { event = JSON.parse(line) } catch { continue }
        if (event.error) throw new Error(String(event.error))
        const total = Number(event.total || 0)
        const completed = Number(event.completed || 0)
        const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : state.percent
        update({ percent, detail: String(event.status || state.detail) })
      }
    }
    update({ status: 'done', percent: 100, detail: 'Instalado' })
  } catch (error) {
    update({ status: 'error', error: (error as Error).message, detail: 'Falhou' })
  }
}
