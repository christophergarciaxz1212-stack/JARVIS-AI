import { describe, expect, it } from 'vitest'
import {
  chooseVoice, contrast, decideAspect, decideFormat, decideSeconds, fixedOverhead, legiblePalette, luminance,
  narrationWords, parseSeconds, sanitizePlan, sceneCount, voiceGenderHint, wordBudget,
} from '@/lib/studio/plan'

describe('proporção pelo pedido', () => {
  it('redes verticais viram 9:16', () => {
    for (const p of ['vídeo para Instagram', 'um reels sobre café', 'faça um TikTok', 'youtube shorts de IA', 'stories da loja']) {
      expect(decideAspect(p), p).toBe('9:16')
    }
  })

  it('YouTube e apresentação viram 16:9, quadrado vira 1:1', () => {
    expect(decideAspect('vídeo para o youtube')).toBe('16:9')
    expect(decideAspect('apresentação da empresa')).toBe('16:9')
    expect(decideAspect('post quadrado para o feed')).toBe('1:1')
  })

  it('sem pista nenhuma, 16:9; e o que o usuário escolheu à mão vence', () => {
    expect(decideAspect('um vídeo sobre o mar')).toBe('16:9')
    expect(decideAspect('vídeo para Instagram', '16:9')).toBe('16:9')
  })
})

describe('duração', () => {
  it('lê segundos e minutos em português', () => {
    expect(parseSeconds('vídeo de 60 segundos')).toBe(60)
    expect(parseSeconds('com 45s')).toBe(45)
    expect(parseSeconds('um vídeo de 1 minuto')).toBe(60)
    expect(parseSeconds('2 minutos de vídeo')).toBe(120)
    expect(parseSeconds('1min30')).toBe(90)
    expect(parseSeconds('meio minuto')).toBe(30)
    expect(parseSeconds('sem duração')).toBeUndefined()
  })

  it('sem duração pedida: 30 s no vertical, 45 s no horizontal', () => {
    expect(decideSeconds('um reels', '9:16')).toBe(30)
    expect(decideSeconds('um vídeo', '16:9')).toBe(45)
  })

  it('limita a faixa que o render aguenta', () => {
    expect(decideSeconds('vídeo de 2 segundos', '16:9')).toBe(8)
    expect(decideSeconds('vídeo de 10 minutos', '16:9')).toBe(180)
  })
})

describe('cenas e palavras', () => {
  it('uma cena a cada ~6,5 s, entre 3 e 14', () => {
    expect(sceneCount(45)).toBe(7)
    expect(sceneCount(60)).toBe(9)
    expect(sceneCount(10)).toBe(3)
    expect(sceneCount(180)).toBe(14)
  })

  it('orçamento de fala desconta abertura, pausas e cartão final', () => {
    // 60 s com 9 cenas: 7,35 s não são fala → 52,65 s × 2,4 palavras/s
    expect(fixedOverhead(9)).toBeCloseTo(7.35)
    expect(wordBudget(60)).toBe(126)
  })

  it('no vídeo curto o desconto pesa mais — foi o que estourou o primeiro vídeo real', () => {
    // 20 s: 4,65 s fixos; sem o desconto o orçamento seria 48 palavras
    expect(wordBudget(20)).toBe(37)
  })

  it('nunca menos que 6 palavras por cena', () => {
    expect(wordBudget(8, 3)).toBeGreaterThanOrEqual(18)
  })
})

describe('voz', () => {
  it('feminina comercial e cinematográfica usam Thalita; documental usa Francisca', () => {
    expect(chooseVoice('feminina', 'comercial').id).toBe('pt-BR-ThalitaMultilingualNeural')
    expect(chooseVoice('feminina', 'cinematografico').id).toBe('pt-BR-ThalitaMultilingualNeural')
    expect(chooseVoice('feminina', 'documental').id).toBe('pt-BR-FranciscaNeural')
  })

  it('masculina usa Antonio, com velocidade e tom pelo estilo', () => {
    const v = chooseVoice('masculina', 'cinematografico')
    expect(v.id).toBe('pt-BR-AntonioNeural')
    expect(v.rate).toBe('-8%')
    expect(v.pitch).toBe('-3Hz')
    expect(v.label).toContain('Antonio')
  })

  it('voz escolhida à mão vence, mantendo o estilo', () => {
    const v = chooseVoice('masculina', 'comercial', 'pt-BR-FranciscaNeural')
    expect(v.id).toBe('pt-BR-FranciscaNeural')
    expect(v.rate).toBe('+6%')
  })

  it('lê o gênero pedido na frase', () => {
    expect(voiceGenderHint('com narração feminina em português')).toBe('feminina')
    expect(voiceGenderHint('voz masculina grave')).toBe('masculina')
    expect(voiceGenderHint('uma narradora calma')).toBe('feminina')
    expect(voiceGenderHint('um vídeo bonito')).toBeUndefined()
  })
})

describe('plano devolvido pela IA', () => {
  const bom = {
    title: 'Café do Bairro',
    objective: 'divulgar a cafeteria',
    audience: 'moradores',
    look: 'quente e aconchegante',
    palette: ['#1a120b', '#d4a373', '#ffffff'],
    font: 'serif',
    mood: 'inspirador',
    voice: { gender: 'masculina', style: 'comercial' },
    scenes: [
      { narration: 'Todo dia começa aqui.', onScreen: 'Café do Bairro', image: 'cozy coffee shop', camera: 'zoom-in', transition: 'fade' },
      { narration: 'Grãos torrados na casa.', image: 'coffee beans roasting', camera: 'pan-left', transition: 'zoom' },
    ],
    cta: 'Venha nos visitar',
  }

  it('aceita um plano bem formado', () => {
    const p = sanitizePlan(bom, { scenes: 2 })
    expect(p.title).toBe('Café do Bairro')
    expect(p.scenes).toHaveLength(2)
    expect(p.scenes[1].transition).toBe('zoom')
    expect(p.voice).toEqual({ gender: 'masculina', style: 'comercial' })
    expect(p.mood).toBe('inspirador')
  })

  it('o gênero pedido pelo usuário vence o da IA', () => {
    expect(sanitizePlan(bom, { scenes: 2, gender: 'feminina' }).voice.gender).toBe('feminina')
  })

  it('a primeira cena sempre entra com fade', () => {
    const p = sanitizePlan({ ...bom, scenes: [{ ...bom.scenes[0], transition: 'slide' }] }, { scenes: 1 })
    expect(p.scenes[0].transition).toBe('fade')
  })

  it('conserta campos inválidos em vez de quebrar', () => {
    const p = sanitizePlan({
      palette: ['vermelho', '#ZZZ'],
      font: 'comic sans',
      mood: 'alegria',
      voice: { gender: 'robô', style: 'gritado' },
      scenes: [{ narration: 'oi', camera: 'voando', transition: 'explosão' }, {}, { image: 'só imagem' }],
    }, { scenes: 3 })
    expect(p.title).toBe('Vídeo do JARVIS')
    expect(p.palette).toHaveLength(3)
    expect(p.font).toBe('sans')
    expect(p.mood).toBe('inspirador')
    expect(p.voice).toEqual({ gender: 'feminina', style: 'neutro' })
    // Cena vazia sai; câmera inválida cai no ciclo; imagem ausente usa a fala
    expect(p.scenes).toHaveLength(2)
    expect(p.scenes[0].camera).toBe('zoom-in')
    expect(p.scenes[0].image).toBe('oi')
  })

  it('aguenta lixo sem lançar', () => {
    expect(() => sanitizePlan(null, { scenes: 3 })).not.toThrow()
    expect(() => sanitizePlan('texto qualquer', { scenes: 3 })).not.toThrow()
    expect(sanitizePlan(undefined, { scenes: 3 }).scenes).toEqual([])
  })

  it('corta plano com cenas demais', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => ({ narration: `cena ${i}`, image: 'x' }))
    expect(sanitizePlan({ scenes: muitas }, { scenes: 6 }).scenes).toHaveLength(8)
  })

  it('conta as palavras da narração', () => {
    expect(narrationWords(sanitizePlan(bom, { scenes: 2 }))).toBe(8)
  })
})

describe('formato final', () => {
  it('pedido completo de Reels', () => {
    const f = decideFormat({ prompt: 'Reels de 30 segundos sobre a loja' })
    expect(f).toMatchObject({ aspect: '9:16', seconds: 30, quality: '1080p', width: 1080, height: 1920, scenes: 5 })
    expect(f.words).toBe(wordBudget(30, 5))
  })

  it('720p quando pedido', () => {
    expect(decideFormat({ prompt: 'vídeo', quality: '720p' })).toMatchObject({ width: 1280, height: 720 })
  })
})


describe('paleta legível', () => {
  it('a paleta que estragou o primeiro vídeo vira legível', () => {
    // Destaque azul-marinho #0f3460: a palavra destacada da legenda sumia
    const p = legiblePalette(['#1a1a2e', '#0f3460', '#e94560'])
    expect(luminance(p.accent)).toBeGreaterThanOrEqual(0.3)
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7)
  })

  it('texto sem contraste AAA sobre o fundo vira branco', () => {
    expect(legiblePalette(['#101010', '#ffcc00', '#555555']).text).toBe('#ffffff')
  })

  it('texto com bom contraste é mantido', () => {
    expect(legiblePalette(['#000000', '#ffcc00', '#f0f0f0']).text).toBe('#f0f0f0')
  })

  it('palavra destacada usa preto sobre destaque claro e branco sobre destaque escuro', () => {
    expect(legiblePalette(['#000000', '#ffee88', '#ffffff']).onAccent).toBe('#0b0b0f')
  })

  it('fundo claro proposto pela IA não vira fundo do vídeo', () => {
    expect(luminance(legiblePalette(['#fafafa', '#3366ff', '#000000']).bg)).toBeLessThan(0.05)
  })

  it('paleta inválida ou vazia não quebra', () => {
    const p = legiblePalette([])
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7)
    expect(legiblePalette(['azul', '#zzz']).accent).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('contraste segue a WCAG: preto contra branco é 21', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
  })
})

describe('o destaque mantém o tom da marca', () => {
  it('usa a cor de destaque escolhida, não a cor do texto', () => {
    // Cafeteria: caramelo é o destaque; creme é o texto
    expect(legiblePalette(['#4a2c2a', '#d4a373', '#f5f1e6']).accent).toBe('#d4a373')
  })

  it('destaque escuro é clareado mantendo o tom (azul continua azulado)', () => {
    const a = legiblePalette(['#1a1a2e', '#0f3460', '#e94560']).accent
    const [r, , b] = [parseInt(a.slice(1, 3), 16), 0, parseInt(a.slice(5, 7), 16)]
    expect(b).toBeGreaterThan(r)
    expect(luminance(a)).toBeGreaterThanOrEqual(0.3)
  })
})
