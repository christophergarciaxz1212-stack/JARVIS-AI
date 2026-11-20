/** Roteador inteligente de modelos de geração de imagens.
 * Avalia a tarefa e seleciona o melhor provedor disponível.
 */
import { getLiveCatalog } from './catalog'
import type { Provider } from '@/types'

export type ImageTask =
  | 'realistic'
  | 'cinematic'
  | 'illustration'
  | 'logo'
  | 'character'
  | 'scene'
  | 'instagram'
  | 'youtube-thumb'
  | 'design'
  | 'artistic'

export interface ImageRouterResult {
  provider: string
  model: string
  reason: string
}

const TASK_MODEL_MAP: Record<ImageTask, string> = {
  realistic: 'gemini-1.5-flash',
  cinematic: 'gemini-1.5-pro',
  illustration: 'gemini-1.5-flash',
  logo: 'pollinations',
  character: 'gemini-1.5-flash',
  scene: 'gemini-1.5-flash',
  instagram: 'pollinations',
  'youtube-thumb': 'pollinations',
  design: 'gemini-1.5-flash',
  artistic: 'pollinations',
}

export async function routeImageTask(
  task: ImageTask,
  prompt: string,
  aspect?: string
): Promise<ImageRouterResult> {
  const catalog = await getLiveCatalog()

  // Encontra o provedor conectado com modelos disponíveis
  const connectedProviders = catalog.filter((p): p is Provider => p.status === 'connected' && p.models && p.models.length > 0)

  if (connectedProviders.length === 0) {
    throw new Error('Nenhum modelo de imagem disponível no catálogo')
  }

  // Tenta encontrar um modelo preferencial para a tarefa
  let selectedModel: AIModel | null = null
  let selectedProvider: Provider | null = null

  for (const provider of connectedProviders) {
    const taskPreferred = TASK_MODEL_MAP[task]
    const model = provider.models.find((m: AIModel) => m.id === taskPreferred || m.id.startsWith(taskPreferred.split('-')[0]))
    if (model) {
      selectedModel = model
      selectedProvider = provider
      break
    }
  }

  // Fallback: usa o primeiro modelo disponível do provedor mais rápido
  if (!selectedModel && connectedProviders.length > 0) {
    const firstProvider = connectedProviders[0]
    const fastModels = firstProvider.models.filter((m: AIModel) => m.category === 'fast' || m.category === 'code')
    selectedModel = fastModels[0] || firstProvider.models[0] || null
    selectedProvider = firstProvider || null
  }

  if (!selectedModel) {
    throw new Error('Nenhum modelo de imagem disponível no catálogo')
  }

  return {
    provider: selectedProvider!.id,
    model: selectedModel!.id,
    reason: `Modelo selecionado para tarefa ${task}: ${selectedModel!.id} via ${selectedProvider!.id}`,
  }
}

interface AIModel {
  id: string
  provider: string
  category?: string
  [key: string]: any
}