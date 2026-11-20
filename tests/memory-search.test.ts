import { describe, it, expect, beforeAll } from 'vitest'
import { addMemory, searchMemory } from '@/lib/db'

beforeAll(() => {
  addMemory({ id: 'm1', type: 'fact', content: 'O roteador de casa é um TP-Link Archer C6 no IP 192.168.0.1', tags: ['rede', 'casa'] })
  addMemory({ id: 'm2', type: 'preference', content: 'Prefiro respostas curtas e em português', tags: ['estilo'] })
  addMemory({ id: 'm3', type: 'fact', content: 'A faculdade é a UNAMA, curso de Redes de Computadores', tags: ['faculdade'] })
})

describe('searchMemory', () => {
  it('finds memories from a whole chat message', () => {
    const hits = searchMemory('como eu configuro os roteadores da minha casa?', 5)
    expect(hits[0]?.id).toBe('m1')
    expect(hits.some(m => m.id === 'm2')).toBe(false)
  })

  it('ignores accents and case', () => {
    expect(searchMemory('PORTUGUES', 5).map(m => m.id)).toEqual(['m2'])
  })

  it('ranks memories sharing more terms first', () => {
    const hits = searchMemory('rede da faculdade unama', 5)
    expect(hits[0]?.id).toBe('m3')
  })

  it('returns nothing for a message with only filler words', () => {
    expect(searchMemory('como que é isso?', 5)).toEqual([])
  })

  it('still finds short literal searches from the memory panel', () => {
    expect(searchMemory('C6', 5).map(m => m.id)).toEqual(['m1'])
  })
})
