import { describe, expect, it } from 'vitest'
import { decideVideo, planFromKind } from '@/lib/video/decide'
import { mediaCommandRunner } from '@/lib/media/commands'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'

describe('vídeos pelo chat: só os modelos do usuário', () => {
  it('padrão é o modelo dos vídeos (animado, estilo TikTok)', () => {
    for (const m of ['crie um vídeo: 5 ferramentas de IA para programadores', 'crie um vídeo sobre os juros compostos', 'crie um vídeo sobre as praias de Fernando de Noronha', 'crie um vídeo de uma história de um dragão'])
      expect(decideVideo(m), m).toMatchObject({ engine: 'motion', kind: 'animado', motionStyle: 'auto' })
  })
  it('comercial e publicitário quando pedidos', () => {
    expect(decideVideo('comercial do meu app de finanças')).toMatchObject({ engine: 'motion', motionStyle: 'app-promo' })
    expect(decideVideo('anúncio do fone Pulse X com desconto')).toMatchObject({ engine: 'motion', kind: 'comercial' })
    expect(decideVideo('filme publicitário da minha cafeteria')).toMatchObject({ engine: 'cinema', kind: 'publicitario' })
  })
  it('vídeo montado com imagens (realista, 3D, anime, desenho) não é mais feito: vira animado e avisa', () => {
    expect(decideVideo('crie um vídeo realista sobre a Amazônia')).toMatchObject({ engine: 'motion', kind: 'animado', unsupported: 'realista' })
    expect(decideVideo('crie um vídeo em 3D de um astronauta')).toMatchObject({ engine: 'motion', unsupported: '3D' })
    expect(decideVideo('faça um vídeo estilo anime de um samurai')).toMatchObject({ engine: 'motion', unsupported: 'anime' })
    expect(decideVideo('crie um vídeo sobre os primeiros 100 mil reais').unsupported).toBeUndefined()
  })
  it('"refaça como…" aceita só os modelos existentes', () => {
    expect(planFromKind('comercial')).toMatchObject({ engine: 'motion', motionStyle: 'app-promo' })
    expect(planFromKind('3d')).toBeNull()
  })
})

describe('vídeo direto no chat', () => {
  it('reconhece mais jeitos de pedir', () => {
    for (const m of ['quero um vídeo sobre buracos negros', 'crie um curta sobre um robô', 'faça uma animação 3D de um gato', 'preciso de um vídeo do meu restaurante', 'me manda um vídeo sobre o ChatGPT'])
      expect(mediaCommandRunner(m), m).not.toBeNull()
  })
  it('"refaça como comercial" refaz o último vídeo; "refaça em 3D" não é mais comando', () => {
    expect(mediaCommandRunner('refaça como comercial')).not.toBeNull()
    expect(mediaCommandRunner('refaça em 3D')).toBeNull()
  })
  it('o modo Agente deixa esses pedidos para o chat', () => {
    expect(shouldRunAgent('quero um vídeo sobre buracos negros')).toBe(false)
    expect(shouldRunAgent('refaça como comercial')).toBe(false)
  })
})
