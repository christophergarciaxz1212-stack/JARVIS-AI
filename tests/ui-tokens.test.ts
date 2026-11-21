import { describe, expect, it } from 'vitest'
import { STATUS_META, MODULE_META, CATEGORY_LABELS, LEVEL_TO_STATUS } from '@/lib/ui/tokens'

describe('tokens e primitivos de UI', () => {
  it('todo status tem texto e símbolo, não apenas cor', () => {
    for (const s of ['ok', 'error', 'attention', 'unknown'] as const) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0)
      expect(STATUS_META[s].icon.length).toBeGreaterThan(0)
      expect(STATUS_META[s].className).toContain('text-')
    }
  })

  it('todo status de módulo e categoria tem rótulo em pt-BR', () => {
    for (const s of ['ok', 'error', 'attention', 'unknown'] as const) expect(MODULE_META[s].label.length).toBeGreaterThan(0)
    for (const c of ['nucleo', 'ia', 'agentes', 'integracoes', 'dados', 'build'] as const) expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0)
  })

  it('converte níveis do diagnóstico rico para o mapa simples', () => {
    expect(LEVEL_TO_STATUS).toEqual({ ok: 'ok', warn: 'attention', fail: 'error' })
  })
})
