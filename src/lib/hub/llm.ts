import { defaultModelFrom, fallbackChain, getLiveCatalog } from '../ai/catalog'
import { classifyModelError } from '../ai/client'
import { defaultComplete, modelHealth, type ChatMessage, type CompleteFn } from '../agents/models'
import { extractJson } from '../agents/parse'

/** Injectable so tests run without network. */
let completeFn: CompleteFn = defaultComplete
let modelsFn: () => Promise<string[]> = async () => {
  const catalog = await getLiveCatalog()
  return fallbackChain(catalog, defaultModelFrom(catalog), 5, 'json')
}

export function setHubLlm(complete: CompleteFn, models?: () => Promise<string[]>) {
  completeFn = complete
  if (models) modelsFn = models
}

/** One call with automatic fallback across the fastest connected models. */
export async function hubComplete(messages: ChatMessage[], opts: { json?: boolean; signal?: AbortSignal } = {}): Promise<{ text: string; model: string }> {
  const models = (await modelsFn()).filter(m => modelHealth.state(m) !== 'unavailable')
  if (!models.length) throw new Error('Nenhuma IA conectada. Adicione uma chave em 🔑 Chaves de API.')
  let last: unknown
  for (const model of models) {
    try {
      const c = await completeFn(model, messages, opts.signal, { json: opts.json })
      modelHealth.reportSuccess(model)
      return { text: c.text, model }
    } catch (e) {
      if (opts.signal?.aborted) throw e
      const cls = classifyModelError(e)
      modelHealth.reportFailure(model, cls.kind, cls.message, cls.retryAfterMs)
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('Falha ao consultar a IA')
}

export async function hubJson<T>(system: string, user: string): Promise<T> {
  const messages: ChatMessage[] = [{ role: 'system', content: `${system}\nResponda SOMENTE com JSON válido.` }, { role: 'user', content: user }]
  const { text } = await hubComplete(messages, { json: true })
  return extractJson(text) as T
}
