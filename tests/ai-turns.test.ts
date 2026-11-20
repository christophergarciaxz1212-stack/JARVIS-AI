import { describe, it, expect } from 'vitest'
import { normalizeTurns } from '@/lib/ai/client'

describe('normalizeTurns', () => {
  it('merges an unanswered user turn with the next one', () => {
    const out = normalizeTurns([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'primeira' },
      { role: 'user', content: 'segunda' },
    ])
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'primeira\n\nsegunda' },
    ])
  })

  it('drops empty turns and a leading assistant turn left by trimming', () => {
    const out = normalizeTurns([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'resposta antiga' },
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'outra' },
    ])
    expect(out.map(m => m.role)).toEqual(['system', 'user'])
    expect(out[1].content).toBe('pergunta\n\noutra')
  })

  it('leaves a well-formed conversation untouched', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
      { role: 'user' as const, content: 'c' },
    ]
    expect(normalizeTurns(msgs)).toEqual(msgs)
  })
})
