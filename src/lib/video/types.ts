/** Tipos do Estúdio de Vídeo do JARVIS. */
import type { MusicMood } from './audioMix'
import type { QaReport } from './qa'

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface VoiceSelection {
  /** Provedor da voz: 'edge' (grátis, natural), 'gemini' (já usada no chat), 'windows' (offline) */
  provider: 'edge' | 'gemini' | 'windows'
  id: string
}

export type VideoNarration = 'auto' | 'none' | 'file'

/** Visual do motor de imagens de IA: escolhido pelo JARVIS (video/decide.ts) ou pedido pelo usuário. */
export type VideoLook = 'publicitario' | 'realista' | '3d' | 'anime' | 'cartoon'
export const VIDEO_LOOKS: VideoLook[] = ['publicitario', 'realista', '3d', 'anime', 'cartoon']

export interface VideoRequest {
  prompt: string
  formatId: string
  seconds: number
  fps: 24 | 25 | 30 | 50 | 60
  narration: VideoNarration
  narrationText?: string
  audioPath?: string
  voice: VoiceSelection
  /** 'auto' deixa o diretor escolher pelo roteiro */
  music: 'auto' | MusicMood
  seed?: number
  /** Direção extra para a IA (tom, público-alvo, o que evitar) */
  direction?: string
  /** ID de uma imagem da galeria usada como cena 1 (ex.: "transforme essa imagem em vídeo") */
  referenceImageId?: string
  /** Visual das cenas (padrão: publicitário) */
  look?: VideoLook
}

export interface VideoJob {
  id: string
  request: VideoRequest
  status: VideoJobStatus
  stage: string
  progress: number
  log: Array<{ at: number; text: string }>
  title?: string
  model?: string
  formatId: string
  frames?: number
  durationSec?: number
  previews: string[]
  output?: string
  sizeBytes?: number
  error?: string
  qa?: Pick<QaReport, 'ok' | 'issues' | 'warnings' | 'blackFrames' | 'durationSec' | 'plannedSec'>
  /** Roteiro editável (ver script.json no diretório do trabalho) */
  scriptEdited?: boolean
  createdAt: number
  finishedAt?: number
}

export interface VideoManifest {
  version: 1
  engine: 'cinematic-v1'
  request: VideoRequest
  brief: import('./director').DirectorBrief
  scenes: Array<import('./director').StoryboardScene & { startSec?: number; endSec?: number }>
  baseSeed: number
  model?: string
  dirty?: boolean
  /** Tempos das palavras já sintetizadas — regerações com a mesma fala reusam a narração */
  words?: import('../motion/audio').WordTime[]
  /** Hash das falas das cenas na síntese original */
  voHash?: string
  /** Incrementos de seed por cena (regerar uma cena não mexe nas outras) */
  seedBumps?: Record<number, number>
  createdAt: number
}
