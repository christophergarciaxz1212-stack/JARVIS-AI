import { startInfraCore } from './lib/infra/core'
import { refreshModelsDev } from './lib/ai/models-dev'

try {
  startInfraCore()
} catch (e) {
  console.error('[infra] Infrastructure Core não iniciou:', (e as Error).message)
}

// Baixa o catálogo aberto do models.dev (MIT) se o cache tiver mais de 24h:
// enriquece contexto/saída/capacidades dos modelos antes da primeira mensagem.
refreshModelsDev(false).catch(() => {})
