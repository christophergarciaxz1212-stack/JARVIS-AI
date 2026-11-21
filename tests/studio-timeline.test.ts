import { describe, expect, it } from 'vitest'
import { buildTimeline, END_CARD, GAP, LEAD_IN, MAX_SPEEDUP, MIN_SCENE, sceneAt, speedupFor, voicedSeconds, withRate } from '@/lib/studio/timeline'

const fala = (seg: number, palavras = ['um', 'dois']) => ({
  speech: seg,
  words: palavras.map((w, i) => ({ word: w, start: (i * seg) / palavras.length, end: ((i + 1) * seg) / palavras.length })),
})

describe('duração vinda da fala real', () => {
  it('cada cena dura a fala mais o respiro, a primeira com a entrada do título', () => {
    const t = buildTimeline([fala(4), fala(5)], { target: 0 })
    expect(t.timings[0].end - t.timings[0].start).toBeCloseTo(LEAD_IN + 4 + GAP)
    expect(t.timings[1].end - t.timings[1].start).toBeCloseTo(5 + GAP)
    expect(t.duration).toBeCloseTo(LEAD_IN + 4 + GAP + 5 + GAP)
  })

  it('cenas encadeadas sem buraco nem sobreposição', () => {
    const t = buildTimeline([fala(3), fala(4), fala(5)], { target: 0 })
    for (let i = 1; i < t.timings.length; i++) expect(t.timings[i].start).toBeCloseTo(t.timings[i - 1].end)
  })

  it('fala curta demais não vira piscada', () => {
    const t = buildTimeline([fala(0.4), fala(4)], { target: 0 })
    expect(t.timings[0].end - t.timings[0].start).toBeGreaterThanOrEqual(MIN_SCENE)
  })
})

describe('palavras em tempo absoluto (legenda sincronizada)', () => {
  it('desloca as palavras de cada cena para o instante em que a fala dela entra', () => {
    const t = buildTimeline([fala(4, ['ola', 'mundo']), fala(2, ['tchau'])], { target: 0 })
    expect(t.words[0]).toMatchObject({ word: 'ola', start: LEAD_IN })
    const tchau = t.words.find(w => w.word === 'tchau')!
    expect(tchau.start).toBeCloseTo(t.speechAt[1])
    expect(t.speechAt[1]).toBeCloseTo(t.timings[1].start)
  })

  it('nenhuma palavra passa do fim da própria cena', () => {
    const t = buildTimeline([fala(4, ['a', 'b', 'c']), fala(3, ['d', 'e'])], { target: 0 })
    const cenaDa = (w: { start: number }) => sceneAt(t.timings, w.start)
    for (const w of t.words) expect(w.end).toBeLessThanOrEqual(t.timings[cenaDa(w)].end + 1e-9)
  })
})

describe('chegar à duração pedida', () => {
  it('fala curta: estica as cenas para se aproximar do pedido', () => {
    const t = buildTimeline([fala(3), fala(3), fala(3)], { target: 20 })
    expect(t.duration).toBeGreaterThan(12)
    expect(t.duration).toBeLessThanOrEqual(20 + 1e-9)
  })

  it('não estica além do limite por cena — melhor mais curto que parado', () => {
    const t = buildTimeline([fala(2), fala(2)], { target: 120 })
    expect(t.duration).toBeLessThan(20)
  })

  it('fala longa: a fala manda, o vídeo passa do pedido em vez de cortar fala', () => {
    const t = buildTimeline([fala(20), fala(20)], { target: 15 })
    expect(t.duration).toBeGreaterThan(40)
  })
})

describe('cartão final e vídeo sem narração', () => {
  it('cartão final prolonga a última cena', () => {
    const sem = buildTimeline([fala(4)], { target: 0 })
    const com = buildTimeline([fala(4)], { target: 0, endCard: true })
    expect(com.duration - sem.duration).toBeCloseTo(END_CARD)
    expect(com.endCardFrom).toBeCloseTo(sem.duration)
  })

  it('sem narração divide o tempo pedido igualmente', () => {
    const t = buildTimeline([fala(0, []), fala(0, []), fala(0, [])], { target: 30, narrated: false })
    expect(t.duration).toBeCloseTo(30)
    expect(t.words).toHaveLength(0)
    expect(t.timings[1].end - t.timings[1].start).toBeCloseTo(10)
  })

  it('lista vazia não quebra', () => {
    expect(buildTimeline([], { target: 30 }).duration).toBe(0)
  })
})

describe('cena no instante', () => {
  it('acha a cena visível', () => {
    const t = buildTimeline([fala(4), fala(4), fala(4)], { target: 0 })
    expect(sceneAt(t.timings, 0)).toBe(0)
    expect(sceneAt(t.timings, t.timings[1].start + 0.1)).toBe(1)
    expect(sceneAt(t.timings, t.duration)).toBe(2)
  })
})

describe('fala sem o silêncio do fim', () => {
  const SR = 1000
  const audio = (voz: number, silencio: number) => {
    const pcm = new Float32Array(Math.round((voz + silencio) * SR))
    for (let i = 0; i < voz * SR; i++) pcm[i] = Math.sin(i) * 0.5
    return pcm
  }

  it('desconta o silêncio que o serviço de voz deixa no fim', () => {
    // 2 s de voz + 0,9 s de silêncio → 2,15 s (folga de 0,15 s)
    expect(voicedSeconds(audio(2, 0.9), SR)).toBeCloseTo(2.15, 2)
  })

  it('nunca corta antes do fim da última palavra', () => {
    expect(voicedSeconds(audio(2, 0.9), SR, 2.5)).toBeCloseTo(2.65, 2)
  })

  it('nunca passa do áudio que existe', () => {
    expect(voicedSeconds(audio(2, 0), SR, 5)).toBeCloseTo(2, 2)
    expect(voicedSeconds(new Float32Array(0), SR)).toBe(0)
  })
})

describe('acelerar a fala para caber', () => {
  it('não mexe quando o vídeo já cabe (até 10 % a mais)', () => {
    expect(speedupFor(16, 15, 10)).toBe(0)
  })

  it('acelera o necessário: 22 s para 15 s com 13 s de fala', () => {
    // sobram 6 s de fala → 13/6 − 1 passa do teto
    expect(speedupFor(22, 15, 13)).toBe(MAX_SPEEDUP)
    // 17 s para 15 s com 20 s de fala → 20/18 − 1 ≈ 0,11
    expect(speedupFor(17, 15, 20)).toBeCloseTo(0.11, 2)
  })

  it('soma à velocidade do estilo da voz', () => {
    expect(withRate('+6%', 0.12)).toBe('+18%')
    expect(withRate('-8%', 0.05)).toBe('-3%')
    expect(withRate('+0%', 0)).toBe('+0%')
  })
})
