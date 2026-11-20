/**
 * Camada de capacidades por modelo.
 *
 * Nem todo modelo aceita ferramentas, JSON nativo, imagens ou streaming. Em vez de
 * assumir que todos os provedores se comportam igual, o JARVIS resolve as capacidades
 * reais de cada modelo e adapta a requisição. Tudo aqui é puro (sem rede, sem disco)
 * para poder ser testado e reutilizado no servidor e na interface.
 */

export type JsonMode = 'native' | 'prompt' | 'none'

export type ModelFeature = 'stream' | 'tools' | 'json' | 'vision' | 'reasoning' | 'longContext' | 'local'

export interface ModelCapabilities {
  modelId: string
  provider: string
  model: string
  streaming: boolean
  tools: boolean
  json: JsonMode
  vision: boolean
  reasoning: boolean
  /** Tokens de entrada aceitos pelo modelo. */
  contextWindow: number
  maxOutputTokens: number
  local: boolean
  free: boolean
}

export type CapabilityHints = Partial<Omit<ModelCapabilities, 'modelId' | 'provider' | 'model'>>

const SEP = '|'

function split(modelId: string): { provider: string; model: string } {
  const i = modelId.indexOf(SEP)
  if (i > 0) return { provider: modelId.slice(0, i), model: modelId.slice(i + 1) }
  if (modelId.startsWith('gemini')) return { provider: 'gemini', model: modelId }
  return { provider: 'ollama', model: modelId }
}

/**
 * Modelos locais curados: capacidades conferidas contra o cartão do Ollama.
 * O contexto efetivo é limitado pelo `num_ctx` (8k), mas o janela teórica fica
 * registrada para a interface explicar o limite real de cada um.
 */
const LOCAL_OVERRIDES: Record<string, Partial<ModelCapabilities>> = {
  'llama3.2:1b': { tools: true, contextWindow: 131072, maxOutputTokens: 4096 },
  'llama3.2:3b': { tools: true, contextWindow: 131072, maxOutputTokens: 4096 },
  'phi4-mini:3.8b': { tools: true, reasoning: true, contextWindow: 131072, maxOutputTokens: 4096 },
  'qwen3:4b': { tools: true, reasoning: true, contextWindow: 262144, maxOutputTokens: 8192 },
  'gemma3:4b': { tools: false, vision: true, contextWindow: 131072, maxOutputTokens: 4096 },
  'qwen2.5-coder:7b': { tools: true, contextWindow: 32768, maxOutputTokens: 4096 },
  'deepseek-r1:8b': { tools: false, reasoning: true, contextWindow: 131072, maxOutputTokens: 8192 },
  'llava:7b': { vision: true, tools: false, contextWindow: 4096, maxOutputTokens: 2048 },
  'llama3.2-vision:11b': { vision: true, tools: false, contextWindow: 131072, maxOutputTokens: 4096 },
  'qwen2.5vl:7b': { vision: true, tools: false, contextWindow: 32768, maxOutputTokens: 4096 },
  'minicpm-v:8b': { vision: true, tools: false, contextWindow: 32768, maxOutputTokens: 4096 },
  'moondream:1.8b': { vision: true, tools: false, contextWindow: 8192, maxOutputTokens: 2048 },
}

const VISION_RE = /vision|llava|pixtral|gemma3(?!.*text)|qwen2\.?5[-_.]?vl|minicpm-v|moondream|scout|maverick|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|grok-4|llama-4|internvl|molmo/i
const REASONING_RE = /deepseek-r1|r1[-:]|reason|think|qwq|gpt-oss|magistral|o[134](?:\b|-)|phi-4|qwq|qvq/i
const NO_TOOLS_RE = /gemma(?!3:27b)|deepseek-r1|llava|moondream|minicpm-v|codellama|phi-3(?:\.5)?-mini|tinyllama|smollm/i
const LONG_CONTEXT_RE = /gemini|claude|gpt-4\.1|qwen3|qwen2\.5(?!-coder)|llama-3\.[23]|deepseek|mistral-large|command-r/i

const PROVIDER_DEFAULTS: Record<string, Partial<ModelCapabilities>> = {
  gemini: { streaming: true, tools: true, json: 'native', vision: true, contextWindow: 1_048_576, maxOutputTokens: 8192, free: true },
  groq: { streaming: true, tools: true, json: 'native', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  openrouter: { streaming: true, tools: true, json: 'native', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  mistral: { streaming: true, tools: true, json: 'native', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  sambanova: { streaming: true, tools: true, json: 'prompt', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  nvidia: { streaming: true, tools: true, json: 'prompt', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  ollama: { streaming: true, tools: true, json: 'native', contextWindow: 8192, maxOutputTokens: 4096, local: true, free: true },
  lmstudio: { streaming: true, tools: true, json: 'native', contextWindow: 32768, maxOutputTokens: 4096, local: true, free: true },
  antigravity: { streaming: true, tools: true, json: 'prompt', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
  opencode: { streaming: true, tools: false, json: 'prompt', contextWindow: 131_072, maxOutputTokens: 8192, free: true },
}

// Visão: modelos que suportam entrada de imagem nativa ou via inline data
const PROVIDER_VISION_ENFORCE: Record<string, boolean> = {
  openrouter: true,
  groq: false,
  mistral: false,
  cerebras: false,
}

export function resolveCapabilities(modelId: string, hints: CapabilityHints = {}): ModelCapabilities {
  const { provider, model } = split(modelId)
  const base = PROVIDER_DEFAULTS[provider] || {}
  const local = LOCAL_OVERRIDES[model] || {}

  // OpenRouter: somente rotas ":free" são gratuitas; a regra sopra o base.free.
  let free = provider === 'openrouter' ? model.endsWith(':free') : (base.free !== false)

  const caps: ModelCapabilities = {
    modelId,
    provider,
    model,
    streaming: true,
    tools: true,
    json: 'native',
    vision: false,
    reasoning: false,
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    local: provider === 'ollama' || provider === 'lmstudio',
    free: provider === 'openrouter' ? model.endsWith(':free') : (base.free !== false),
  }

  // Aplica base (exceto free, que foi computado acima)
  Object.assign(caps, base)

  // Aplica overrides locais (contexto, tools, vision, etc.)
  Object.assign(caps, local)

  // Garante que a regra do OpenRouter sobrepoe após o Object.assign
  if (provider === 'openrouter') {
    caps.free = model.endsWith(':free')
  } else if (base.free === false) {
    caps.free = false
  } else {
    caps.free = free
  }

  // ... restanti rules

  // --- Regras de visão ---
  // Se o nome do modelo bater com expressão regular, ativar visão
  if (VISION_RE.test(model)) caps.vision = true
  // Provedores que sempre têm visão quando o modelo indica
  if (PROVIDER_VISION_ENFORCE[provider] && caps.vision) caps.tools = false // visão costuma impedir tools

  // --- Regras de raciocínio ---
  if (REASONING_RE.test(model)) caps.reasoning = true

  // --- Regras de tools ---
  // Se o modelo for da lista "no-tools", desativar ferramentas
  if (NO_TOOLS_RE.test(model)) caps.tools = false
  // Provedores que suportam tools apenas quando o modelo permite
  if (provider === 'ollama') {
    // O Ollama expõe tools dependendo do modelo carregado; a LOCAL_OVERRIDES já cobre isso.
    // Apenas garantimos que não anulamos um override local.
    if (!local.tools) caps.tools = false
  }

  // --- Contexto longo ---
  if (LONG_CONTEXT_RE.test(model) && caps.contextWindow < 32_768) caps.contextWindow = 32_768

  // Aplicar dicas do usuário por cima (sempre apertam, nunca liberam)
  if (hints.tools === false) caps.tools = false
  if (hints.vision === true) caps.vision = true
  if (hints.reasoning === true) caps.reasoning = true
  if (hints.contextWindow !== undefined) caps.contextWindow = hints.contextWindow
  if (hints.maxOutputTokens !== undefined) caps.maxOutputTokens = hints.maxOutputTokens

  return { ...caps, ...hints }
}

/** Uma capacidade booleana de alto nível, útil para filtrar a interface. */
export function supports(caps: ModelCapabilities, feature: ModelFeature): boolean {
  switch (feature) {
    case 'stream': return caps.streaming
    case 'tools': return caps.tools
    case 'json': return caps.json !== 'none'
    case 'vision': return caps.vision
    case 'reasoning': return caps.reasoning
    case 'longContext': return caps.contextWindow >= 100_000
    case 'local': return caps.local
  }
}

/** Rótulos curtos para exibir no seletor de modelos. */
export function capabilityLabels(caps: ModelCapabilities): string[] {
  const labels: string[] = []
  if (caps.vision) labels.push('visão')
  if (caps.tools) labels.push('ferramentas')
  if (caps.json === 'native') labels.push('JSON')
  if (caps.reasoning) labels.push('raciocínio')
  if (caps.local) labels.push('local')
  if (caps.contextWindow >= 100_000) labels.push('contexto longo')
  return labels
}

/**
 * Instrução de JSON para provedores sem `response_format`. O agente já espera
 * JSON puro; isso evita que modelos antigos respondam com cercas de markdown.
 */
export function jsonInstruction(caps: ModelCapabilities): string | null {
  return caps.json === 'prompt' ? 'Responda somente com um objeto JSON válido, sem cercas de código.' : null
}
