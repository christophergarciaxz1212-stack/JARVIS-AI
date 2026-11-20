import type { PadSpec, SfxEvent, WordTime } from './audio'
import type { KitStyle } from './kit'
import type { VoiceSelection } from '../video/types'

/**
 * Modelos do motor de animação: as 4 variações do "modelo dos vídeos" (explicadores de tecnologia no
 * estilo TikTok, com kit visual próprio) e o Comercial ('app-promo'). 'auto' escolhe a variação pelo tema.
 * (Os antigos cinema/continua/kinetic foram retirados; pedidos salvos com eles viram 'auto'.)
 */
export type MotionStyle = 'auto' | KitStyle | 'app-promo'
export const MOTION_STYLES: MotionStyle[] = ['auto', 'tech-passos', 'tech-news', 'minimal-dados', 'tech-analogia', 'app-promo']
export type NarrationMode = 'none' | 'jarvis' | 'file'

export interface Brand {
  url: string
  name: string
  description?: string
  colors: string[]
  font?: string
  logoDataUri?: string
  notes: string[]
}

/** What the model writes: one HTML page whose scene is a pure function of the frame number. */
export interface Composition {
  title: string
  scenes: Array<{ name: string; start: number; end: number; idea?: string }>
  css: string
  html: string
  js: string
  sfx: SfxEvent[]
  pad?: PadSpec
  /** Kit visual carregado na página (peças K.* e cores do modelo). */
  kit?: KitStyle
}

export interface MotionRequest {
  prompt: string
  brandUrl?: string
  style: MotionStyle
  seconds: number
  fps: 30 | 60
  narration: NarrationMode
  narrationText?: string
  audioPath?: string
  /** Voz escolhida no Estúdio (Edge/Gemini/Windows). Sem ela, vale a voz das Configurações. */
  voice?: VoiceSelection
  model?: string
  /** Revision of an earlier video: its composition is adjusted instead of written from scratch. */
  parentId?: string
  feedback?: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface MotionJob {
  id: string
  request: MotionRequest
  status: JobStatus
  stage: string
  progress: number
  log: Array<{ at: number; text: string }>
  title?: string
  model?: string
  frames?: number
  previews: string[]
  output?: string
  sizeBytes?: number
  error?: string
  words?: WordTime[]
  createdAt: number
  finishedAt?: number
}
