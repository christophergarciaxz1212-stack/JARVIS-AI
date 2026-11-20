/**
 * Política de recuperação de conversas.
 *
 * Curto e previsível: erro transitório (rede/sobrecarga) ganha no máximo duas
 * tentativas com backoff; limite de taxa só espera se o provedor disser que o
 * reset é próximo — acima disso é mais rápido trocar de modelo. Erro de chave,
 * contexto ou modelo inexistente nunca é repetido no mesmo modelo.
 */
import type { ModelErrorKind } from './client'

export interface RetryPlan {
  retry: boolean
  delayMs: number
  /** Motivo legível para o evento de status enviado ao cliente. */
  reason: string
}

export interface RetryOptions {
  retryAfterMs?: number
  maxAttempts?: number
  /** Teto de espera para não travar a conversa antes de trocar de modelo. */
  maxDelayMs?: number
  random?: () => number
}

export const DEFAULT_MAX_ATTEMPTS = 2
export const DEFAULT_MAX_DELAY_MS = 1_500

/** Espera exponencial com jitter: 300ms, 600ms, 1200ms… limitada ao teto. */
export function backoffDelay(attempt: number, opts: RetryOptions = {}): number {
  const base = 300
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitter = opts.random ? opts.random() : Math.random()
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  if (raw >= max) return max
  // Jitter entre 85% e 100% evita que várias abas reconectem no mesmo instante
  return Math.max(50, Math.round(raw * (0.85 + jitter * 0.15)))
}

export function planRetry(kind: ModelErrorKind, attempt: number, opts: RetryOptions = {}): RetryPlan {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  if (attempt > maxAttempts) return { retry: false, delayMs: 0, reason: 'tentativas esgotadas' }
  if (kind === 'cancelled') return { retry: false, delayMs: 0, reason: 'cancelado pelo usuário' }

  if (kind === 'network' || kind === 'overloaded') {
    return { retry: true, delayMs: backoffDelay(attempt, opts), reason: kind === 'network' ? 'falha de rede' : 'provedor sobrecarregado' }
  }

  if (kind === 'rate_limit') {
    const wait = opts.retryAfterMs
    // Sem prazo informado, uma espera curta ainda pode resolver; com prazo longo,
    // trocar de modelo entrega a resposta mais rápido.
    if (wait !== undefined && wait > (opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS)) {
      return { retry: false, delayMs: 0, reason: 'limite de taxa com reset distante' }
    }
    return { retry: true, delayMs: wait ?? backoffDelay(attempt, opts), reason: 'limite de taxa' }
  }

  return { retry: false, delayMs: 0, reason: kind }
}

/** Modelos diferentes podem resolver estes erros, mesmo sem repetir o atual. */
export function shouldFallback(kind: ModelErrorKind, emitted: boolean, aborted: boolean): boolean {
  if (aborted) return false
  // Depois que o usuário leu texto, trocar de modelo emendaria duas respostas.
  if (emitted) return false
  return kind !== 'cancelled'
}
