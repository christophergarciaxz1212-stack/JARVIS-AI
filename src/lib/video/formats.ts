/**
 * Formatos de exportação do Estúdio: plataformas e proporções suportadas.
 * O JARVIS produz em todas elas a partir do mesmo storyboard (as cenas, imagens
 * e narração são geradas no aspecto pedido, sem redimensionamento com corte).
 */

export type AspectId = '9:16' | '16:9' | '1:1' | '4:5'

export interface VideoFormat {
  id: string
  label: string
  aspect: AspectId
  width: number
  height: number
  /** Onde esse formato é usado, para a interface */
  hint: string
}

export const VIDEO_FORMATS: VideoFormat[] = [
  { id: 'youtube', label: 'YouTube', aspect: '16:9', width: 1920, height: 1080, hint: '16:9 · Full HD' },
  { id: 'youtube-4k', label: 'YouTube 4K', aspect: '16:9', width: 3840, height: 2160, hint: '16:9 · Ultra HD (render lento)' },
  { id: 'shorts', label: 'Shorts / Reels / TikTok', aspect: '9:16', width: 1080, height: 1920, hint: '9:16 · vertical' },
  { id: 'shorts-4k', label: 'Reels 4K', aspect: '9:16', width: 2160, height: 3840, hint: '9:16 · Ultra HD (render lento)' },
  { id: 'square', label: 'Feed 1:1', aspect: '1:1', width: 1080, height: 1080, hint: '1:1 · quadrado' },
  { id: 'feed', label: 'Feed do Instagram', aspect: '4:5', width: 1080, height: 1350, hint: '4:5 · retrato' },
  { id: 'presentation', label: 'Apresentação', aspect: '16:9', width: 1920, height: 1080, hint: '16:9 · slides' },
  { id: 'facebook', label: 'Facebook', aspect: '1:1', width: 1080, height: 1080, hint: '1:1 · feed' },
]

export const formatById = (id: string | undefined): VideoFormat =>
  VIDEO_FORMATS.find(f => f.id === id) || VIDEO_FORMATS[0]

/** Preset curto para a IA entender a composição (safe zones). */
export function safeZoneHint(f: VideoFormat): string {
  switch (f.aspect) {
    case '9:16': return 'vídeo vertical: conteúdo principal entre 12% e 88% da altura, legendas acima de 18% da base'
    case '1:1': return 'quadrado: margem de 8% em toda a volta, texto nas faixas central e inferior'
    case '4:5': return 'retrato: conteúdo principal entre 10% e 90% da altura, legendas acima de 14% da base'
    default: return 'horizontal: margem de 6% lateral, faixa inferior para legendas (18% da base)'
  }
}
