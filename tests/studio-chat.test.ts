import { describe, expect, it } from 'vitest'
import { decideEngine, latestStudioJob, looksLikeRevision, parseRevision } from '@/lib/studio/chat'
import { mediaCommandRunner } from '@/lib/media/commands'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'
import type { StudioJob } from '@/lib/studio/types'

const pai = (over: Partial<StudioJob> = {}): Pick<StudioJob, 'request' | 'voiceLabel' | 'plan'> => ({
  request: { prompt: 'vídeo para o youtube sobre o mar de 45 segundos' },
  voiceLabel: 'Thalita · comercial',
  plan: {
    title: 'O mar', objective: '', audience: '', look: '', palette: ['#000000', '#3366ff', '#ffffff'], font: 'sans', mood: 'inspirador',
    voice: { gender: 'feminina', style: 'comercial' },
    scenes: Array.from({ length: 7 }, (_, i) => ({ narration: `fala ${i}`, onScreen: '', image: `img ${i}`, camera: 'zoom-in', transition: 'fade' })),
  },
  ...over,
})

describe('motor do vídeo pedido no chat', () => {
  it('estúdio por padrão — inclusive realista, 3D, anime e publicitário', () => {
    for (const m of ['crie um vídeo sobre as praias de Noronha', 'vídeo realista sobre a Amazônia', 'um vídeo em 3D de um astronauta', 'estilo anime de um samurai', 'filme publicitário da cafeteria', 'anúncio da minha pizzaria com desconto'])
      expect(decideEngine(m), m).toMatchObject({ engine: 'studio' })
  })

  it('modelos animados do usuário quando o pedido diz', () => {
    expect(decideEngine('vídeo animado sobre juros compostos')).toMatchObject({ engine: 'motion', style: 'auto' })
    expect(decideEngine('no estilo do TikTok: 5 ferramentas de IA')).toMatchObject({ engine: 'motion', style: 'auto' })
    expect(decideEngine('motion design sobre o Supabase')).toMatchObject({ engine: 'motion' })
  })

  it('anúncio de app ou software usa o comercial animado (mostra a tela)', () => {
    expect(decideEngine('comercial do meu app de finanças, baixe grátis')).toMatchObject({ engine: 'motion', style: 'app-promo' })
    expect(decideEngine('anúncio animado do meu aplicativo')).toMatchObject({ engine: 'motion', style: 'app-promo' })
  })
})

describe('ajuste pela conversa: reconhece', () => {
  it('pedidos de ajuste', () => {
    for (const m of ['troque a voz', 'deixe com 30s', 'agora em vertical', 'tire a música', 'coloque voz masculina', 'deixa o vídeo mais curto', 'troque a imagem da cena 2', 'sem legenda, por favor, tire a legenda', 'Ajuste o vídeo “O mar”: mais épico'])
      expect(looksLikeRevision(m), m).toBe(true)
  })

  it('não confunde com pedido novo, pergunta ou outro assunto', () => {
    for (const m of ['crie um vídeo sobre café', 'faça uma música sobre o mar', 'quero uma música calma', 'como faço para mudar a voz do vídeo?', 'troque a cor do botão para azul', 'mude o nome do arquivo', 'qual a melhor voz?'])
      expect(looksLikeRevision(m), m).toBe(false)
  })
})

describe('ajuste pela conversa: entende o que mudar', () => {
  it('duração em segundos, minutos ou relativa', () => {
    expect(parseRevision('deixe com 30s', pai()).overrides.seconds).toBe(30)
    expect(parseRevision('deixe com 1 minuto', pai()).overrides.seconds).toBe(60)
    // o pai tem 45 s: mais curto ≈ 70 %
    expect(parseRevision('deixa mais curto', pai()).overrides.seconds).toBe(31)
    expect(parseRevision('pode deixar mais longo', pai()).overrides.seconds).toBe(63)
  })

  it('formato e qualidade', () => {
    expect(parseRevision('agora em vertical para o reels', pai()).overrides.aspect).toBe('9:16')
    expect(parseRevision('quadrado para o feed', pai()).overrides.aspect).toBe('1:1')
    // já é 16:9: pedir horizontal não muda nada
    expect(parseRevision('deixe horizontal', pai()).overrides.aspect).toBeUndefined()
    expect(parseRevision('exporte em 720p', pai()).overrides.quality).toBe('720p')
  })

  it('"troque a voz" alterna o gênero da voz atual', () => {
    expect(parseRevision('troque a voz', pai()).overrides.voice).toBe('pt-BR-AntonioNeural')
    expect(parseRevision('troque a voz', pai({ voiceLabel: 'Antonio · comercial' })).overrides.voice).toBe('pt-BR-ThalitaMultilingualNeural')
  })

  it('voz pedida pelo nome ou gênero', () => {
    expect(parseRevision('coloque voz masculina', pai()).overrides.voice).toBe('pt-BR-AntonioNeural')
    expect(parseRevision('use a Francisca', pai()).overrides.voice).toBe('pt-BR-FranciscaNeural')
    expect(parseRevision('com uma narradora', pai({ voiceLabel: 'Antonio' })).overrides.voice).toBe('pt-BR-ThalitaMultilingualNeural')
  })

  it('sem narração, trilha e legenda', () => {
    expect(parseRevision('tire a narração', pai()).overrides).toMatchObject({ narration: false })
    expect(parseRevision('tire a música', pai()).overrides).toMatchObject({ music: 'nenhuma' })
    expect(parseRevision('troque a trilha por uma épica', pai()).overrides).toMatchObject({ music: 'epico' })
    expect(parseRevision('remova a legenda', pai()).overrides).toMatchObject({ captions: false })
  })

  it('imagem nova nas cenas citadas (número, lista ou ordinal)', () => {
    expect(parseRevision('troque a imagem da cena 2', pai()).refresh).toEqual([1])
    expect(parseRevision('imagens novas nas cenas 1, 3 e 5', pai()).refresh).toEqual([0, 2, 4])
    expect(parseRevision('regenere a terceira cena', pai()).refresh).toEqual([2])
    expect(parseRevision('quero outras imagens', pai()).refresh).toHaveLength(7)
  })

  it('o que não vira campo segue só como instrução ao diretor', () => {
    const r = parseRevision('deixe o texto da abertura mais emocionante', pai())
    expect(r.overrides).toEqual({})
    expect(r.refresh).toEqual([])
  })

  it('resume o que entendeu para o usuário conferir', () => {
    expect(parseRevision('deixe com 20s e voz masculina', pai()).summary).toEqual(['duração 20 s', 'voz masculina (Antonio)'])
  })
})

describe('qual vídeo ajustar', () => {
  const job = (id: string, createdAt: number): StudioJob => ({ id, createdAt, request: { prompt: id }, status: 'done', stages: [], aspect: '16:9', width: 1, height: 1, fps: 30, notes: [] })
  it('o mais recente das últimas 24 h', () => {
    const agora = 10 * 86400_000
    expect(latestStudioJob([job('a', agora - 3000), job('b', agora - 1000)], agora)?.id).toBe('b')
    expect(latestStudioJob([job('velho', agora - 2 * 86400_000)], agora)).toBeUndefined()
  })
})

describe('vídeo direto no chat', () => {
  it('reconhece os jeitos de pedir', () => {
    for (const m of ['quero um vídeo sobre buracos negros', 'crie um curta sobre um robô', 'faça uma animação de um gato', 'preciso de um vídeo do meu restaurante', 'me manda um vídeo sobre o ChatGPT', '/video praias do nordeste'])
      expect(mediaCommandRunner(m), m).not.toBeNull()
  })

  it('"refaça como animado" refaz o último vídeo no outro modelo', () => {
    expect(mediaCommandRunner('refaça como animado')).not.toBeNull()
    expect(mediaCommandRunner('refaça como comercial')).not.toBeNull()
  })

  it('o modo Agente deixa esses pedidos para o chat', () => {
    expect(shouldRunAgent('quero um vídeo sobre buracos negros')).toBe(false)
    expect(shouldRunAgent('refaça como comercial')).toBe(false)
  })
})

describe('regerar o vídeo inteiro', () => {
  it('"regenere o vídeo" pede imagem nova em todas as cenas', () => {
    expect(parseRevision('regenere o vídeo', pai()).refresh).toHaveLength(7)
    expect(parseRevision('troque a imagem da cena 2', pai()).refresh).toEqual([1])
  })
})

describe('ajuste de vídeo não vai para o modo Agente', () => {
  it('pedidos de ajuste ficam no chat (que tem o estúdio)', () => {
    for (const m of ['Ajuste o vídeo “Padaria Artesanal”: troque a voz e deixe com 15s', 'troque a voz', 'deixe com 30s', 'imagem nova na cena 2'])
      expect(shouldRunAgent(m), m).toBe(false)
  })
  it('trabalho em código com a palavra vídeo continua com o agente', () => {
    expect(looksLikeRevision('corrija o player de vídeo do site')).toBe(false)
    expect(looksLikeRevision('mude a duração no arquivo config.json')).toBe(false)
  })
})
