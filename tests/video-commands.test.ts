import { describe, expect, it } from 'vitest'
import { matchScenePlanCommand, matchVideoEditCommand } from '@/lib/media/commands'

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
