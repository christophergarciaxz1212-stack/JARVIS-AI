/**
 * Orçamento gratuito por modelo.
 *
 * O JARVIS opera só com provedores gratuitos, cujas cotas por minuto variam
 * drasticamente. O Groq free aceita ~7–8 mil tokens/min por modelo (observado:
 * gpt-oss-120b → 8.000 TPM, qwen3.8-27b → 7.000 ITPM); o OpenRouter ":free" e os
 * demais (Cerebras, SambaNova, Mistral, NVIDIA, Hugging Face) ficam na casa dos
 * milhares; o Gemini free tem folga ampla; e modelos locais não têm cota.
 *
 * Um prompt de agente tem 5–8 mil tokens — maior que a cota inteira do Groq.
 * Enviar esse prompt para um modelo assim garante o 429 antes da resposta, e o
 * roteamento automático insistir nele vira ping-pong entre modelos do mesmo
 * provedor. Este módulo classifica o orçamento e estima o tamanho de cada
 * requisição para que o roteador escolha onde a chamada cabe de verdade.
 */

export type FreeTier = 'tiny' | 'small' | 'roomy' | 'unlimited'

/** Groq free: ~7–8 mil tokens/min por modelo — qualquer chamada acima disso é recusada. */
const GROQ = /^groq\|/i
/** OpenCode free pool: cota grátis compartilhada ("Free usage limit reached"), sem TPM pública garantida. */
const OPENCODE = /^opencode\|/i
/** Modelos locais rodam na máquina: sem cota, a limitação é o tempo de resposta. */
const LOCAL = /^(ollama|lmstudio)\|/i
/** Gemini free tem folga ampla nos modelos flash. */
const GEMINI = /^gemini\|/i

export function budgetTier(modelId: string): FreeTier {
  const id = String(modelId || '')
  if (LOCAL.test(id)) return 'unlimited'
  if (GEMINI.test(id)) return 'roomy'
  if (GROQ.test(id)) return 'tiny'
  if (OPENCODE.test(id)) return 'small'
  // OpenRouter ":free", Cerebras, SambaNova, Mistral, NVIDIA, Hugging Face…
  return 'small'
}

/**
 * Teto estimado de tokens de ENTRADA por chamada, com folga para a resposta.
 * Acima disso o modelo gratuito recusa a requisição no meio da janela de 1 minuto.
 */
export function maxInputTokensFor(tier: FreeTier): number {
  switch (tier) {
    case 'unlimited': return Number.POSITIVE_INFINITY
    case 'roomy': return 80_000
    case 'small': return 16_000
    case 'tiny': return 5_500
  }
}

/**
 * Piso de espera após um 429, por faixa. O "try again in 6s" que o provedor
 * devolve mede uma sub-janela, não o minuto inteiro: respeitar só ele faz o
 * agente ser re-escolhido para o mesmo modelo segundos depois, falhando de novo.
 */
export function rateLimitFloorMs(tier: FreeTier): number {
  switch (tier) {
    case 'unlimited': return 1_000
    case 'roomy': return 20_000
    case 'small': return 30_000
    case 'tiny': return 60_000
  }
}

/** Bônus/penalidade no roteador: quem não aguenta o prompt perde a vaga, sempre. */
export function budgetScore(tier: FreeTier): number {
  switch (tier) {
    case 'unlimited': return 15
    case 'roomy': return 18
    case 'small': return 0
    case 'tiny': return -30
  }
}

/** Estimativa conservadora de tokens de entrada (≈4 chars/token + 15% de margem). */
export function estimateInputTokens(messages: Array<{ content: string }>): number {
  let chars = 0
  for (const m of messages || []) chars += m?.content?.length || 0
  return Math.ceil((chars / 4) * 1.15) + 16
}
