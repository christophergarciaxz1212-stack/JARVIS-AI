/**
 * Estúdio de vídeo do JARVIS — tipos compartilhados entre servidor e interface.
 * Sem imports de Node.
 */

export type Aspect = '16:9' | '9:16' | '1:1'
export type Quality = '720p' | '1080p'

/** Clima da trilha. Define progressão de acordes, pulso e intensidade. */
export type Mood = 'epico' | 'inspirador' | 'atmosferico' | 'tenso' | 'documental' | 'publicitario' | 'tecnologico'

/** Movimento de câmera sobre a imagem da cena. */
export type Camera = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'parallax' | 'static'

/** Transição DE ENTRADA da cena. */
export type Transition = 'fade' | 'zoom' | 'slide' | 'blur' | 'cut'

export type VoiceGender = 'feminina' | 'masculina'
export type VoiceStyle = 'comercial' | 'documental' | 'cinematografico' | 'emocional' | 'neutro'

export interface ScenePlan {
  /** O que a voz diz nesta cena, em português do Brasil. */
  narration: string
  /** Texto curto que aparece na tela (destaque), opcional. */
  onScreen?: string
  /** Descrição da imagem em inglês, para o gerador. */
  image: string
  camera: Camera
  transition: Transition
}

export interface ProductionPlan {
  title: string
  objective: string
  audience: string
  look: string
  /** Cores em hex (#rrggbb): fundo/escuro, destaque, texto. */
  palette: string[]
  font: 'display' | 'sans' | 'serif' | 'mono'
  mood: Mood
  voice: { gender: VoiceGender; style: VoiceStyle }
  scenes: ScenePlan[]
  /** Chamada final (cartão de encerramento), opcional. */
  cta?: string
}

export interface StudioRequest {
  prompt: string
  /** Ausente = o diretor decide pelo pedido. */
  aspect?: Aspect
  /** Ausente = o diretor decide pelo pedido. */
  seconds?: number
  quality?: Quality
  /** Voz do Edge escolhida à mão; ausente = escolhida pelo plano. */
  voice?: string
  narration?: boolean
  captions?: boolean
  /** 'nenhuma' desliga a trilha. */
  music?: Mood | 'auto' | 'nenhuma'
  /** Imagens do usuário (caminhos locais) para usar nas cenas. */
  images?: string[]
}

export type StageId = 'roteiro' | 'imagens' | 'narracao' | 'trilha' | 'montagem' | 'render'

export type StageStatus = 'aguardando' | 'executando' | 'concluido' | 'falhou' | 'pulado'

export interface Stage {
  id: StageId
  label: string
  status: StageStatus
  /** O que está acontecendo agora dentro da etapa ("imagem 3 de 6 · NVIDIA"). */
  detail?: string
  startedAt?: number
  endedAt?: number
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface SceneAsset {
  scene: number
  /** Arquivo da imagem dentro da pasta do trabalho. */
  file: string
  /** Quem gerou ("NVIDIA FLUX", "Pollinations", "sua imagem"). */
  provider: string
  width: number
  height: number
}

export interface SceneTiming {
  scene: number
  start: number
  end: number
}

export interface StudioJob {
  id: string
  request: StudioRequest
  status: JobStatus
  stages: Stage[]
  plan?: ProductionPlan
  title?: string
  aspect: Aspect
  width: number
  height: number
  fps: number
  durationSec?: number
  assets?: SceneAsset[]
  timings?: SceneTiming[]
  /** Voz usada de fato, como o usuário lê. */
  voiceLabel?: string
  output?: string
  sizeBytes?: number
  error?: string
  /** Avisos honestos (marca d'água, imagem que caiu para outro provedor…). */
  notes: string[]
  /** Quadros já renderizados — progresso real do render, não estimado. */
  framesDone?: number
  framesTotal?: number
  /** Trabalho de que este é uma revisão. */
  parentId?: string
  /** Revisão: o que o usuário pediu para mudar, como ele disse. */
  feedback?: string
  /** Revisão: cenas (0-based) que precisam de imagem nova. */
  refresh?: number[]
  /** Quantas vezes foi retomada depois de o app fechar no meio. */
  resumed?: number
  createdAt: number
  finishedAt?: number
}

export const STAGE_LABELS: Record<StageId, string> = {
  roteiro: 'Roteiro e direção',
  imagens: 'Imagens das cenas',
  narracao: 'Narração',
  trilha: 'Trilha e efeitos',
  montagem: 'Montagem e legendas',
  render: 'Renderização',
}

export const STAGE_ORDER: StageId[] = ['roteiro', 'imagens', 'narracao', 'trilha', 'montagem', 'render']
