import { describe, expect, it } from 'vitest'
import { buildTimeline, END_CARD, GAP, LEAD_IN, MIN_SCENE, sceneAt } from '@/lib/studio/timeline'

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
