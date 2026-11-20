import { describe, expect, it } from 'vitest'
import { backoffDelay, planRetry, shouldFallback } from '@/lib/ai/resilience'

const fixed = { random: () => 0.5, maxDelayMs: 1_500 }

describe('recuperação de conversas', () => {
  it('repete falha de rede com backoff limitado', () => {
    expect(planRetry('network', 1, fixed)).toMatchObject({ retry: true })
    expect(planRetry('network', 1, fixed).delayMs).toBeLessThanOrEqual(1_500)
    expect(planRetry('network', 2, fixed).delayMs).toBeGreaterThan(planRetry('network', 1, fixed).delayMs)
    expect(backoffDelay(10, fixed)).toBe(1_500)
  })

  it('respeita o retry-after curto e desiste de um reset distante', () => {
    expect(planRetry('rate_limit', 1, { ...fixed, retryAfterMs: 800 })).toMatchObject({ retry: true, delayMs: 800 })
    expect(planRetry('rate_limit', 1, { ...fixed, retryAfterMs: 60_000 })).toMatchObject({ retry: false })
  })

  it('nunca repete erro definitivo', () => {
    for (const kind of ['auth', 'context', 'unavailable', 'format', 'cancelled', 'other'] as const) {
      expect(planRetry(kind, 1, fixed).retry).toBe(false)
    }
  })

  it('para depois do número máximo de tentativas', () => {
    expect(planRetry('network', 3, { ...fixed, maxAttempts: 2 }).retry).toBe(false)
  })

  it('só troca de modelo quando nada foi emitido e a geração não foi cancelada', () => {
    expect(shouldFallback('rate_limit', false, false)).toBe(true)
    expect(shouldFallback('rate_limit', true, false)).toBe(false)
    expect(shouldFallback('network', false, true)).toBe(false)
    expect(shouldFallback('cancelled', false, false)).toBe(false)
  })
})
