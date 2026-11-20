import { describe, it, expect } from 'vitest'
import { matchVideoEditCommand } from '@/lib/media/commands'
import { verdict } from '@/lib/video/qa'
import { buildCompositionHtml } from '@/lib/video/composition'
import { clampVideoRequest } from '@/lib/video/produce'
import { VIDEO_FORMATS } from '@/lib/video/formats'
import type { WordTime } from '@/lib/motion/audio'
import type { DirectorBrief } from '@/lib/video/director'

describe('comandos de edição de vídeo no chat', () => {
  it('reconhece "troque a imagem da cena 2" (dígito e ordinal)', () => {
    expect(matchVideoEditCommand('troque a imagem da cena 2')).toEqual({ scene: 2 })
    expect(matchVideoEditCommand('Troque a imagem da segunda cena.')).toEqual({ scene: 2 })
    expect(matchVideoEditCommand('regenere a imagem da terceira cena')).toEqual({ scene: 3 })
    expect(matchVideoEditCommand('mude a cena número 10')).toEqual({ scene: 10 })
  })

  it('reconhece "regenere o vídeo" (regeração completa)', () => {
    expect(matchVideoEditCommand('regenere o vídeo')).toEqual({ scene: null })
    expect(matchVideoEditCommand('gere de novo o video')).toEqual({ scene: null })
  })

  it('não confunde pedidos de criação com edição', () => {
    expect(matchVideoEditCommand('crie um vídeo sobre inteligência artificial')).toBeNull()
    expect(matchVideoEditCommand('gere uma imagem de um gato')).toBeNull()
    expect(matchVideoEditCommand('qual é a cena 2 do seu vídeo?')).toBeNull()
  })
})

describe('QA antes da entrega', () => {
  const samples = [{ frame: 10, luma: 120, stdev: 35 }]
  const base = { samples, durationSec: 30, plannedSec: 30, narrationPlanned: true, audio: { silenceRatio: 0.05, rmsDbfs: -18 } }

  it('vídeo sem NENHUMA imagem de cena falha no QA', () => {
    const qa = verdict({ ...base, failedImages: 4, expectedImages: 4 })
    expect(qa.ok).toBe(false)
    expect(qa.issues.join(' ')).toMatch(/nenhuma imagem/i)
  })

  it('falha parcial vira aviso (vídeo entregue com o que gerou)', () => {
    const qa = verdict({ ...base, failedImages: 1, expectedImages: 4 })
    expect(qa.ok).toBe(true)
    expect(qa.warnings.join(' ')).toMatch(/1\/4/)
  })
})

describe('padrões profissionais', () => {
  it('FPS suportados: 24/25/30/50/60; valores inválidos caem para 30', () => {
    for (const fps of [24, 25, 30, 50, 60] as const) {
      expect(clampVideoRequest({ prompt: 'teste', fps }).fps).toBe(fps)
    }
    expect(clampVideoRequest({ prompt: 'teste', fps: 33 as never }).fps).toBe(30)
  })

  it('formatos incluem 4K para YouTube e Reels, mantendo 16:9 padrão', () => {
    const ids = VIDEO_FORMATS.map(f => f.id)
    expect(ids).toContain('youtube')
    expect(ids).toContain('youtube-4k')
    expect(ids).toContain('shorts-4k')
    expect(VIDEO_FORMATS.find(f => f.id === 'youtube')?.width).toBe(1920)
  })
})

describe('composição cinematográfica', () => {
  const brief: DirectorBrief = {
    title: 'Teste', hook: 'atenção', audience: 'todos', tone: 'direto', visualStyle: 'cinematic', palette: 'teal gold',
    cameraLanguage: 'slow dolly', musicMood: 'epico', voiceGender: 'masculina', voiceStyle: 'grave', cta: 'inscreva-se',
  }
  const scene = {
    name: 'abertura', vo: 'A inteligência artificial chegou.', visual: 'cinematic still of a futuristic city, 35mm, dramatic light, teal and gold palette',
    camera: 'zoom-in' as const, transition: 'fade' as const, sfx: ['impact' as const],
    durationSec: 4, startSec: 0, endSec: 4,
  }
  const words: WordTime[] = [{ word: 'A', start: 0.1, end: 0.3 }, { word: 'inteligência', start: 0.4, end: 1.0 }, { word: 'artificial', start: 1.1, end: 1.7 }, { word: 'chegou.', start: 1.8, end: 2.3 }]

  it('o HTML inclui partículas, lower third, barra de progresso e silhuetas de cenas', () => {
    const html = buildCompositionHtml({
      title: 'Teste', brief,
      scenes: [{ ...scene, imgDataUri: 'data:image/png;base64,AAAA' }],
      words, format: VIDEO_FORMATS[0], fps: 30,
    })
    expect(html).toContain('progressBar')
    expect(html).toContain('lowerThird')
    expect(html).toContain('particle')
    expect(html).toContain('id="sc0"')
    expect(html).toContain('lightSweep')
  })
})
