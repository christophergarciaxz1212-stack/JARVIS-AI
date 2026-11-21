/**
 * Decisões do estúdio que não dependem de IA nem de disco: formato, duração,
 * quantas cenas, qual voz — e a validação do plano que o diretor (IA) devolve.
 *
 * Fica fora do modelo de propósito. "Vídeo para Instagram" sempre vira 9:16,
 * não "às vezes", e um plano malformado é consertado aqui em vez de quebrar a
 * produção no meio.
 *
 * Puro (sem imports de Node): testável.
 */
import type { Aspect, Camera, Mood, ProductionPlan, Quality, ScenePlan, StudioRequest, Transition, VoiceGender, VoiceStyle } from './types'
import { END_CARD, GAP, LEAD_IN } from './timeline'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ─── Formato ─────────────────────────────────────────────────────────────────

const VERTICAL = /\b(instagram|reels?|tiktok|tik tok|shorts?|stories|story|status do whatsapp|vertical|9[:x]16|celular)\b/
const SQUARE = /\b(quadrado|feed|1[:x]1|post quadrado)\b/
const WIDE = /\b(youtube|apresentacao|apresentacoes|horizontal|16[:x]9|widescreen|tv|palestra|institucional)\b/

/** Proporção pelo pedido. Sem pista: 16:9, o formato mais versátil. */
export function decideAspect(prompt: string, explicit?: Aspect): Aspect {
  if (explicit) return explicit
  const t = fold(prompt)
  // "youtube shorts" é vertical: o vertical é checado antes do horizontal
  if (VERTICAL.test(t)) return '9:16'
  if (SQUARE.test(t)) return '1:1'
  if (WIDE.test(t)) return '16:9'
  return '16:9'
}

/** Duração pedida em segundos ("60 segundos", "1 minuto", "1min30", "30s"). */
export function parseSeconds(prompt: string): number | undefined {
  const t = fold(prompt)
  const minSeg = /(\d+)\s*min(?:uto|utos)?\s*(?:e\s*)?(\d+)\s*(?:s|seg|segundos?)?\b/.exec(t)
  if (minSeg) return Number(minSeg[1]) * 60 + Number(minSeg[2])
  const min = /(\d+(?:[.,]\d+)?)\s*min(?:uto|utos)?\b/.exec(t)
  if (min) return Math.round(Number(min[1].replace(',', '.')) * 60)
  if (/\bum minuto\b|\b1 minuto\b/.test(t)) return 60
  if (/\bmeio minuto\b/.test(t)) return 30
  const seg = /(\d+)\s*(?:s|seg|segundos?)\b/.exec(t)
  if (seg) return Number(seg[1])
  return undefined
}

/** Duração final: o pedido manda, dentro de um teto que o render aguenta. */
export function decideSeconds(prompt: string, aspect: Aspect, explicit?: number): number {
  const pedido = explicit ?? parseSeconds(prompt)
  const padrao = aspect === '9:16' ? 30 : 45
  return Math.max(8, Math.min(180, Math.round(pedido ?? padrao)))
}

/** Uma cena a cada ~6,5 s: o suficiente para a imagem respirar sem virar slide. */
export function sceneCount(seconds: number): number {
  return Math.max(3, Math.min(14, Math.round(seconds / 6.5)))
}

/**
 * Tempo do vídeo que NÃO é fala: a abertura com o título, a pausa entre cenas
 * e o cartão final. Num vídeo de 20 s isso passa de 4 s — ignorar esse tempo
 * fez o primeiro vídeo real sair com 29 s.
 */
export function fixedOverhead(scenes: number): number {
  return LEAD_IN + scenes * GAP + END_CARD
}

/** Palavras de narração que cabem na duração (fala natural ~2,4 palavras/s), descontado o tempo fixo. */
export function wordBudget(seconds: number, scenes = sceneCount(seconds)): number {
  const fala = Math.max(seconds * 0.5, seconds - fixedOverhead(scenes))
  return Math.max(scenes * 6, Math.round(fala * 2.4))
}

const SIZES: Record<Quality, Record<Aspect, [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] },
}

export function frameSize(aspect: Aspect, quality: Quality = '1080p'): { width: number; height: number } {
  const [width, height] = SIZES[quality][aspect]
  return { width, height }
}

// ─── Voz ─────────────────────────────────────────────────────────────────────

export interface VoiceChoice {
  /** Id da voz no Edge. */
  id: string
  /** Velocidade no formato do Edge ("+6%"). */
  rate: string
  /** Tom no formato do Edge ("-2Hz"). */
  pitch: string
  /** Como o usuário lê. */
  label: string
}

/**
 * Vozes pt-BR nativas do Edge: Thalita e Francisca (femininas), Antonio
 * (masculina). O estilo de interpretação vira velocidade e tom — é o controle
 * que o serviço gratuito oferece, e é dito assim, sem prometer "emoção".
 */
export function chooseVoice(gender: VoiceGender, style: VoiceStyle, explicit?: string): VoiceChoice {
  const ajuste: Record<VoiceStyle, { rate: string; pitch: string; nome: string }> = {
    comercial: { rate: '+6%', pitch: '+0Hz', nome: 'comercial' },
    documental: { rate: '-4%', pitch: '-1Hz', nome: 'documental' },
    cinematografico: { rate: '-8%', pitch: '-3Hz', nome: 'cinematográfica' },
    emocional: { rate: '-6%', pitch: '+1Hz', nome: 'emocional' },
    neutro: { rate: '+0%', pitch: '+0Hz', nome: 'neutra' },
  }
  const a = ajuste[style]
  if (explicit) {
    const curto = explicit.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/(Multilingual)?Neural$/, '')
    return { id: explicit, rate: a.rate, pitch: a.pitch, label: `${curto} · ${a.nome}` }
  }
  const id = gender === 'masculina'
    ? 'pt-BR-AntonioNeural'
    // Thalita soa mais viva (comercial, cinema); Francisca mais sóbria (documental, emoção)
    : style === 'comercial' || style === 'cinematografico' || style === 'neutro' ? 'pt-BR-ThalitaMultilingualNeural' : 'pt-BR-FranciscaNeural'
  const nome = id.includes('Antonio') ? 'Antonio' : id.includes('Thalita') ? 'Thalita' : 'Francisca'
  return { id, rate: a.rate, pitch: a.pitch, label: `${nome} · ${a.nome}` }
}

/** Pista de gênero de voz no pedido ("narração feminina", "voz masculina"). */
export function voiceGenderHint(prompt: string): VoiceGender | undefined {
  const t = fold(prompt)
  if (/\b(voz|narracao|narradora|locutora)\s+(feminina|de mulher)|\bnarradora\b|\blocutora\b/.test(t)) return 'feminina'
  if (/\b(voz|narracao|narrador|locutor)\s+(masculina|de homem)|\bnarrador\b|\blocutor\b/.test(t)) return 'masculina'
  return undefined
}

// ─── Validação do plano devolvido pela IA ───────────────────────────────────

const CAMERAS: Camera[] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'parallax', 'static']
const TRANSITIONS: Transition[] = ['fade', 'zoom', 'slide', 'blur', 'cut']
const MOODS: Mood[] = ['epico', 'inspirador', 'atmosferico', 'tenso', 'documental', 'publicitario', 'tecnologico']
const STYLES: VoiceStyle[] = ['comercial', 'documental', 'cinematografico', 'emocional', 'neutro']
const FONTS = ['display', 'sans', 'serif', 'mono'] as const

const pick = <T extends string>(v: unknown, ok: readonly T[], def: T): T =>
  (typeof v === 'string' && (ok as readonly string[]).includes(fold(v).replace(/[^a-z-]/g, '')) ? fold(v).replace(/[^a-z-]/g, '') as T : def)

const txt = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const HEX = /^#[0-9a-f]{6}$/i

/** Ciclo de câmeras usado quando o plano não traz uma válida: nada fica parado. */
const CAMERA_CYCLE: Camera[] = ['zoom-in', 'pan-right', 'parallax', 'zoom-out', 'pan-left', 'pan-up']

/**
 * Conserta o plano: campo faltando vira um padrão sensato, lista longa demais é
 * cortada, cena sem fala nem imagem sai. Nunca lança — um plano ruim de IA não
 * pode derrubar a produção; o que não dá para consertar vira erro claro depois.
 */
export function sanitizePlan(raw: unknown, ctx: { scenes: number; gender?: VoiceGender }): ProductionPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const voz = (r.voice && typeof r.voice === 'object' ? r.voice : {}) as Record<string, unknown>

  const cenasCruas = Array.isArray(r.scenes) ? r.scenes : []
  const scenes: ScenePlan[] = cenasCruas
    .map((c, i): ScenePlan | null => {
      const s = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
      const narration = txt(s.narration, 600)
      const image = txt(s.image, 500)
      if (!narration && !image) return null
      return {
        narration,
        onScreen: txt(s.onScreen, 70) || undefined,
        image: image || narration,
        camera: pick(s.camera, CAMERAS, CAMERA_CYCLE[i % CAMERA_CYCLE.length]),
        // A primeira cena entra com fade; as outras herdam do plano
        transition: i === 0 ? 'fade' : pick(s.transition, TRANSITIONS, 'fade'),
      }
    })
    .filter((s): s is ScenePlan => !!s)
    .slice(0, Math.max(ctx.scenes + 2, 3))

  const palette = (Array.isArray(r.palette) ? r.palette : [])
    .map(c => String(c).trim())
    .filter(c => HEX.test(c))
    .slice(0, 4)

  return {
    title: txt(r.title, 80) || 'Vídeo do JARVIS',
    objective: txt(r.objective, 200),
    audience: txt(r.audience, 160),
    look: txt(r.look, 200),
    palette: palette.length >= 2 ? palette : ['#0b0b0f', '#f5f5f5', '#ffffff'],
    font: pick(r.font, FONTS, 'sans'),
    mood: pick(r.mood, MOODS, 'inspirador'),
    voice: {
      // O que o usuário pediu na frase vale mais que a escolha da IA
      gender: ctx.gender ?? pick(voz.gender, ['feminina', 'masculina'] as const, 'feminina'),
      style: pick(voz.style, STYLES, 'neutro'),
    },
    scenes,
    cta: txt(r.cta, 90) || undefined,
  }
}

// ─── Cores legíveis ──────────────────────────────────────────────────────────

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** Luminância relativa (WCAG 2.x), de 0 (preto) a 1 (branco). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (la + 0.05) / (lb + 0.05)
}

/** Clareia a cor misturando com branco até chegar à luminância pedida, mantendo o tom. */
function clareia(hex: string, alvo: number): string {
  const base = rgb(hex)
  for (let k = 0; k <= 20; k++) {
    const t = k / 20
    const c = toHex(base.map(v => v + (255 - v) * t))
    if (luminance(c) >= alvo) return c
  }
  return '#ffffff'
}

/**
 * Paleta que dá para LER. A IA escolhe cores pelo clima, não pelo contraste —
 * no primeiro vídeo real ela devolveu um azul-marinho como destaque, e a palavra
 * destacada da legenda sumiu (texto escuro sobre fundo escuro).
 *
 * Regras: o fundo é a cor mais escura; o texto é branco quando a cor de texto
 * proposta não tem contraste AAA sobre o fundo; o destaque é clareado até ser
 * visível sobre imagem escurecida; e a palavra destacada usa preto ou branco,
 * o que contrastar mais com o destaque.
 */
export function legiblePalette(palette: string[]): { bg: string; accent: string; text: string; onAccent: string } {
  const cores = palette.filter(c => HEX.test(c))
  const bg = [...cores].sort((a, b) => luminance(a) - luminance(b))[0] || '#0b0b0f'
  const escuro = luminance(bg) > 0.2 ? '#0b0b0f' : bg

  const propostoTexto = cores[2] || '#ffffff'
  const text = contrast(propostoTexto, escuro) >= 7 ? propostoTexto : '#ffffff'

  // Destaque: a cor que a IA escolheu PARA destaque (2ª da paleta), clareada só
  // o necessário para aparecer. Pegar "a mais clara" levava à cor do texto e
  // apagava o tom da marca (o caramelo de uma cafeteria virava creme).
  const proposto = cores[1] && cores[1] !== bg ? cores[1] : [...cores.filter(c => c !== bg)].sort((a, b) => luminance(b) - luminance(a))[0]
  const base = proposto || '#ffffff'
  const accent = luminance(base) >= 0.3 ? base : clareia(base, 0.3)

  const onAccent = contrast('#0b0b0f', accent) >= contrast('#ffffff', accent) ? '#0b0b0f' : '#ffffff'
  return { bg: escuro, accent, text, onAccent }
}

/** Contagem de palavras de toda a narração. */
export function narrationWords(plan: ProductionPlan): number {
  return plan.scenes.reduce((n, s) => n + (s.narration ? s.narration.split(/\s+/).filter(Boolean).length : 0), 0)
}

/** Formato final de produção, decidido uma vez e gravado no trabalho. */
export function decideFormat(req: StudioRequest) {
  const aspect = decideAspect(req.prompt, req.aspect)
  const seconds = decideSeconds(req.prompt, aspect, req.seconds)
  const quality: Quality = req.quality ?? '1080p'
  const scenes = sceneCount(seconds)
  return { aspect, seconds, quality, scenes, words: wordBudget(seconds, scenes), ...frameSize(aspect, quality) }
}
