import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { matchScenePlanCommand, matchVideoEditCommand } from '@/lib/media/commands'
import { buildScenePrompt, styleAnchor } from '@/lib/video/scenePrompt'
import { moveVideoScene, deleteVideoScene, duplicateVideoScene } from '@/lib/video/produce'
import type { DirectorBrief } from '@/lib/video/director'

describe('comandos de cena no chat', () => {
  it('reconhece mover para o início, para o fim e para uma posição', () => {
    expect(matchScenePlanCommand('mova a cena 3 para o início')).toEqual({ action: 'move', scene: 3, to: 0 })
    expect(matchScenePlanCommand('mova a cena 2 para o começo')).toEqual({ action: 'move', scene: 2, to: 0 })
    expect(matchScenePlanCommand('mova a cena 2 para o fim')).toEqual({ action: 'move', scene: 2, to: Number.MAX_SAFE_INTEGER })
    expect(matchScenePlanCommand('mova a cena 4 para a posição 1')).toEqual({ action: 'move', scene: 4, to: 0 })
    expect(matchScenePlanCommand('mova a segunda cena para o início')).toEqual({ action: 'move', scene: 2, to: 0 })
  })

  it('reconhece excluir e duplicar cenas', () => {
    expect(matchScenePlanCommand('exclua a cena 2')).toEqual({ action: 'delete', scene: 2 })
    expect(matchScenePlanCommand('remova a cena número 4')).toEqual({ action: 'delete', scene: 4 })
    expect(matchScenePlanCommand('duplique a cena 1')).toEqual({ action: 'duplicate', scene: 1 })
    expect(matchScenePlanCommand('apague a cena 2')).toEqual({ action: 'delete', scene: 2 })
  })

  it('não confunde com outros pedidos', () => {
    expect(matchScenePlanCommand('crie um vídeo sobre café')).toBeNull()
    expect(matchScenePlanCommand('regenere o vídeo')).toBeNull()
    expect(matchScenePlanCommand('mova meu arquivo para o início')).toBeNull()
    expect(matchScenePlanCommand('troque a imagem da cena 2')).toBeNull()
  })

  it('matchVideoEditCommand e matchScenePlanCommand são disjuntos', () => {
    expect(matchVideoEditCommand('mova a cena 2 para o início')).toBeNull()
    expect(matchScenePlanCommand('troque a imagem da cena 2')).toBeNull()
  })
})

describe('consistência visual entre cenas', () => {
  const brief: DirectorBrief = {
    title: 't', hook: 'h', audience: 'a', tone: 'direto', visualStyle: 'cinematic photoreal photography', palette: 'deep teal and gold',
    cameraLanguage: 'slow dolly-in', musicMood: 'epico', voiceGender: 'masculina', voiceStyle: 'grave', cta: 'cta',
  }

  it('a âncora carrega direção de arte, paleta e linguagem de câmera + lembrete de continuidade', () => {
    const a = styleAnchor(brief)
    expect(a).toContain('cinematic photoreal photography')
    expect(a).toContain('deep teal and gold')
    expect(a).toContain('slow dolly-in')
    expect(a).toContain('consistent world')
  })

  it('o prompt final da cena injeta a âncora e o sufixo de qualidade/limpeza', () => {
    const p = buildScenePrompt('wide shot of a cat astronaut floating in orbit', styleAnchor(brief))
    expect(p).toMatch(/^wide shot of a cat astronaut/)
    expect(p).toContain('deep teal and gold')
    expect(p).toMatch(/no text|no watermark/)
  })
})

describe('reindexação estrutural de cenas', () => {
  let tmp: string
  let oldEnv: string | undefined

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-scenes-'))
    oldEnv = process.env.JARVIS_DATA_DIR
    process.env.JARVIS_DATA_DIR = tmp
    fs.mkdirSync(path.join(tmp, 'video'), { recursive: true })
  })
  afterEach(() => {
    if (oldEnv === undefined) delete process.env.JARVIS_DATA_DIR
    else process.env.JARVIS_DATA_DIR = oldEnv
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function makeJob(id: string, scenes: number) {
    const dir = path.join(tmp, 'video', id)
    fs.mkdirSync(dir, { recursive: true })
    const brief: DirectorBrief = {
      title: 't', hook: 'h', audience: 'a', tone: 'direto', visualStyle: 'cinematic', palette: 'teal', cameraLanguage: 'slow',
      musicMood: 'epico', voiceGender: 'masculina', voiceStyle: 'grave', cta: 'cta',
    }
    const manifest = {
      version: 1, engine: 'cinematic-v1',
      request: { prompt: 'teste', formatId: 'youtube', seconds: 30, fps: 30, narration: 'auto', voice: { provider: 'edge', id: 'pt-BR-AntonioNeural' }, music: 'auto' },
      brief,
      scenes: Array.from({ length: scenes }, (_, i) => ({ name: `cena-${i}`, vo: `fala ${i}`, visual: `visual ${i}`, camera: 'zoom-in', transition: 'fade', sfx: [], durationSec: 2 })),
      baseSeed: 42, createdAt: Date.now(),
    }
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(manifest))
    for (let i = 0; i < scenes; i++) fs.writeFileSync(path.join(dir, `cena_${String(i).padStart(2, '0')}.jpg`), Buffer.from(`imagem-${i}`))
    return manifest
  }

  const bytes = (id: string, i: number) => fs.readFileSync(path.join(tmp, 'video', id, `cena_${String(i).padStart(2, '0')}.jpg`)).toString()
  const readManifest = (id: string) => JSON.parse(fs.readFileSync(path.join(tmp, 'video', id, 'script.json'), 'utf8'))

  it('mover a primeira cena para o fim reordena cenas e imagens', () => {
    makeJob('mv1', 4)
    moveVideoScene('mv1', 0, 3)
    const m = readManifest('mv1')
    expect(m.scenes.map((s: { name: string }) => s.name)).toEqual(['cena-1', 'cena-2', 'cena-3', 'cena-0'])
    expect(bytes('mv1', 0)).toBe('imagem-1')
    expect(bytes('mv1', 3)).toBe('imagem-0')
  })

  it('to fora do intervalo é limitado às bordas (não lança erro)', () => {
    makeJob('mv2', 3)
    const m = moveVideoScene('mv2', 2, Number.MAX_SAFE_INTEGER)
    expect(m.scenes.map(s => s.name)).toEqual(['cena-0', 'cena-1', 'cena-2'])
  })

  it('excluir uma cena rebaixa as seguintes e suas imagens', () => {
    makeJob('del1', 4)
    deleteVideoScene('del1', 1)
    const m = readManifest('del1')
    expect(m.scenes.map((s: { name: string }) => s.name)).toEqual(['cena-0', 'cena-2', 'cena-3'])
    expect(bytes('del1', 0)).toBe('imagem-0')
    expect(bytes('del1', 1)).toBe('imagem-2')
    expect(bytes('del1', 2)).toBe('imagem-3')
  })

  it('a última cena não pode ser excluída (mínimo uma)', () => {
    makeJob('del2', 1)
    expect(() => deleteVideoScene('del2', 0)).toThrow(/pelo menos uma cena/i)
  })

  it('duplicar copia a imagem para a nova cena e marca seedBump nela', () => {
    makeJob('dup1', 3)
    duplicateVideoScene('dup1', 0)
    const m = readManifest('dup1')
    expect(m.scenes.map((s: { name: string }) => s.name)).toEqual(['cena-0', 'cena-0 (cópia)', 'cena-1', 'cena-2'])
    expect(bytes('dup1', 0)).toBe(bytes('dup1', 1))
    expect(m.seedBumps && m.seedBumps[1]).toBe(1)
  })
})
