/**
 * Montagem do prompt de cada cena para o gerador de imagens.
 * A consistência visual entre as cenas é o ponto mais frágil do pipeline: o LLM
 * escreve prompts diferentes para cada cena e o resultado divergente. Aqui o
 * estilo do briefing (direção de arte, paleta, linguagem de câmera) é injetado
 * deterministicamente em TODA cena — o que o modelo decide não pode
 * "esquecer" o mundo visual do vídeo.
 */
import type { DirectorBrief } from './director'

export const SCENE_STYLE_SUFFIX = 'cinematic lighting, highly detailed, professional color grade, no text, no watermark, no logo'

/** Âncora compartilhada pelo vídeo inteiro: mesma direcao de arte, paleta e linguagem de câmera. */
export function styleAnchor(brief: Pick<DirectorBrief, 'visualStyle' | 'palette' | 'cameraLanguage'>): string {
  const parts = [brief.visualStyle, brief.palette, brief.cameraLanguage]
    .map(s => String(s || '').trim())
    .filter(Boolean)
  // Última peça: lembrete de continuidade mundana (mesmo mundo, mesma iluminação)
  parts.push('consistent world, same lighting and color grade across shots')
  return parts.join(', ')
}

/** Prompt final de uma cena: visão do roteirista + âncora compartilhada + qualidade/limpeza. */
export function buildScenePrompt(visual: string, anchor: string): string {
  const v = String(visual || '').trim()
  const a = String(anchor || '').trim()
  return [v, a, SCENE_STYLE_SUFFIX].filter(Boolean).join(', ')
}
