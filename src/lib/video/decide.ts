/**
 * Decide QUE TIPO de vídeo fazer quando o usuário pede "crie um vídeo…" no chat.
 *
 * O usuário quer só os modelos dele:
 * - animado (padrão): o modelo dos vídeos do TikTok — motion design quadro a quadro
 *   (passos, notícia, dados, analogia);
 * - comercial: anúncio animado de app/produto (motion, app-promo);
 * - publicitário: filme de campanha de marca — SÓ quando ele pede com essa palavra.
 *
 * Vídeos montados com imagens de IA + movimento de câmera (realista, 3D, anime, desenho) foram
 * retirados a pedido do usuário ("não quero este modelo", 20/11): pedidos assim saem no modelo
 * animado, e a resposta avisa. Puro (sem Node) para poder ser testado.
 */
import type { VideoLook } from './types'

export type VideoKind = 'animado' | 'comercial' | 'publicitario'

export interface VideoPlan {
  engine: 'motion' | 'cinema'
  kind: VideoKind
  /** Visual das cenas no motor de imagens (só o publicitário usa) */
  look?: VideoLook
  /** Estilo do motor de animação ('auto' = o JARVIS escolhe passos/notícia/dados/analogia) */
  motionStyle?: 'auto' | 'app-promo'
  /** O usuário pediu esse tipo com todas as letras */
  explicit: boolean
  label: string
  reason: string
  /** Pediu um visual que não é mais feito (realista, 3D, anime, desenho) */
  unsupported?: string
}

export const KIND_LABEL: Record<VideoKind, string> = {
  animado: 'Animado (modelo dos vídeos)',
  comercial: 'Comercial animado',
  publicitario: 'Publicitário',
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const PUBLICITARIO = /\b(publicit\w*|campanha|institucional|brand ?film|branding|filme (da|de|para a|pra) (marca|empresa))\b/
const COMERCIAL = /\b(comercial|propaganda|anuncio|promo\w*|oferta|desconto|compre|baixe|lancamento do (meu |nosso )?(app|produto))\b/
/** Visuais retirados: só para avisar o usuário */
const RETIRED: Array<[string, RegExp]> = [
  ['3D', /\b(3d|3 d|tridimensional|pixar|dreamworks|cgi)\b/],
  ['anime', /\b(anime|animes|manga|ghibli)\b/],
  ['desenho animado', /\b(desenho animado|cartoon|2d)\b/],
  ['realista', /\b(realista|realismo|fotorrealista|live action|filmad[oa]|imagens reais|cenas reais|(video|filme) (real|reais))\b/],
]

export function decideVideo(message: string): VideoPlan {
  const t = norm(message)
  const retired = RETIRED.find(([, re]) => re.test(t))?.[0]
  if (PUBLICITARIO.test(t)) return { engine: 'cinema', kind: 'publicitario', look: 'publicitario', explicit: true, label: KIND_LABEL.publicitario, reason: 'você pediu um filme publicitário de marca' }
  if (COMERCIAL.test(t)) return { engine: 'motion', kind: 'comercial', motionStyle: 'app-promo', explicit: true, label: KIND_LABEL.comercial, reason: 'você pediu um comercial/anúncio', unsupported: retired }
  return {
    engine: 'motion', kind: 'animado', motionStyle: 'auto', explicit: !!retired, label: KIND_LABEL.animado, unsupported: retired,
    reason: retired ? `vídeo ${retired} com imagens foi desativado a seu pedido — fiz no modelo animado` : 'é o seu modelo dos vídeos (estilo TikTok)',
  }
}

/** "refaça como comercial/animado/publicitário" */
export function planFromKind(kind: string, reason = 'você pediu'): VideoPlan | null {
  const k = norm(kind).trim()
  if (k === 'animado' || k === 'motion') return { engine: 'motion', kind: 'animado', motionStyle: 'auto', explicit: true, label: KIND_LABEL.animado, reason }
  if (k === 'comercial') return { engine: 'motion', kind: 'comercial', motionStyle: 'app-promo', explicit: true, label: KIND_LABEL.comercial, reason }
  if (k === 'publicitario') return { engine: 'cinema', kind: 'publicitario', look: 'publicitario', explicit: true, label: KIND_LABEL.publicitario, reason }
  return null
}
