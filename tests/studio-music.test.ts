import { describe, expect, it } from 'vitest'
import { SR } from '@/lib/motion/audio'
import { composeScore, duck, mixdown, MOOD_LABELS, placeVoice } from '@/lib/studio/music'
import type { Mood } from '@/lib/studio/types'

const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

const cenas = [
  { scene: 0, start: 0, end: 5 },
  { scene: 1, start: 5, end: 10 },
  { scene: 2, start: 10, end: 16 },
]

describe('trilha por clima', () => {
  it('todos os climas produzem som, do tamanho certo, sem estourar', () => {
    for (const mood of Object.keys(MOOD_LABELS) as Mood[]) {
      const m = composeScore(mood, cenas, 16, 30)
      expect(m.length, mood).toBe(Math.ceil(16 * SR))
      expect(rms(m), mood).toBeGreaterThan(0.004)
      let pico = 0
      for (const v of m) pico = Math.max(pico, Math.abs(v))
      expect(pico, mood).toBeLessThan(1)
    }
  })

  it('entra e sai suave: começo e fim mais baixos que o meio', () => {
    const m = composeScore('inspirador', cenas, 16, 30)
    const meio = rms(m, 6 * SR, 9 * SR)
    expect(rms(m, Math.round(15.8 * SR), m.length)).toBeLessThan(meio)
  })

  it('o som muda no corte de cena (o acorde acompanha a edição)', () => {
    // Antes era um acorde só do começo ao fim. Agora cada cena tem o seu:
    // o espectro perto do corte é diferente dos dois lados.
    const m = composeScore('atmosferico', cenas, 16, 30)
    const antes = m.slice(Math.round(3.5 * SR), Math.round(4.0 * SR))
    const depois = m.slice(Math.round(6.5 * SR), Math.round(7.0 * SR))
    let dif = 0
    for (let i = 0; i < antes.length; i++) dif += Math.abs(antes[i] - depois[i])
    expect(dif / antes.length).toBeGreaterThan(0.001)
  })
})

describe('ducking', () => {
  it('a música abaixa onde a voz fala e volta onde ela para', () => {
    const dur = 6
    const music = new Float32Array(dur * SR).fill(0.1)
    const voice = new Float32Array(dur * SR)
    // Voz só entre 2 s e 4 s
    for (let i = 2 * SR; i < 4 * SR; i++) voice[i] = 0.5 * Math.sin(i / 20)

    const d = duck(music, voice)
    const comVoz = rms(d, Math.round(3.0 * SR), Math.round(3.8 * SR))
    const semVoz = rms(d, Math.round(0.5 * SR), Math.round(1.5 * SR))
    expect(comVoz).toBeLessThan(semVoz * 0.5)
    // Depois que a voz para, a música volta (soltura lenta, mas volta)
    expect(rms(d, Math.round(5.5 * SR), 6 * SR)).toBeGreaterThan(comVoz)
  })
})

describe('voz e mixagem', () => {
  it('posiciona a fala de cada cena no tempo certo', () => {
    const fala = new Float32Array(SR).fill(0.3)
    const v = placeVoice(5, [{ pcm: fala, at: 2 }])
    expect(v[Math.round(1.5 * SR)]).toBe(0)
    expect(v[Math.round(2.5 * SR)]).toBeCloseTo(0.3)
  })

  it('mixagem não estoura mesmo com voz e trilha altas', () => {
    const dur = 4
    const voz = new Float32Array(dur * SR).fill(0.9)
    const trilha = new Float32Array(dur * SR).fill(0.9)
    const m = mixdown(dur, voz, trilha)
    let pico = 0
    for (const s of m) pico = Math.max(pico, Math.abs(s))
    expect(pico).toBeLessThanOrEqual(0.9)
  })

  it('funciona sem voz e sem trilha', () => {
    expect(mixdown(2, null, new Float32Array(2 * SR).fill(0.1)).length).toBe(2 * SR)
    expect(mixdown(2, new Float32Array(2 * SR).fill(0.1), null).length).toBe(2 * SR)
  })
})
