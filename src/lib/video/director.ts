/**
 * Diretor de produção de IA: transforma o pedido em português num briefing criativo
 * e num storyboard completo (cena a cena, com narração, câmera, trilha e efeitos).
 * Dois passos de IA com saída JSON e fallback determinístico — o JARVIS sempre
 * produz algo coerente, mesmo se o modelo falhar.
 */
import { defaultModelFrom, fallbackChain, getLiveCatalog, rankModels } from '../ai/catalog'
import { classifyModelError } from '../ai/client'
import { defaultComplete, modelHealth, type ChatMessage, type CompleteFn } from '../agents/models'
import { extractJson } from '../agents/parse'
import type { MusicMood } from './audioMix'
import type { VideoFormat } from './formats'
import type { VideoLook } from './types'
import { safeZoneHint } from './formats'

export interface DirectorBrief {
  title: string
  hook: string
  audience: string
  tone: string
  visualStyle: string
  palette: string
  cameraLanguage: string
  musicMood: MusicMood
  voiceGender: 'masculina' | 'feminina'
  voiceStyle: string
  cta: string
}

export type CameraMove =
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down'
  | 'static'
  | 'orbit'
  | 'dolly-in'
  | 'dolly-out'
  | 'tilt-up'
  | 'tilt-down'
  | 'crane-up'
  | 'crane-down'

export type SfxName = 'pop' | 'tick' | 'whoosh' | 'shimmer' | 'impact' | 'rise' | 'swish' | 'rumble'

export interface StoryboardScene {
  name: string
  vo: string
  visual: string // prompt EN detalhado para a imagem
  camera: CameraMove
  transition: 'fade' | 'wipe' | 'zoom' | 'iris'
  sfx: string[]
  durationSec: number
}

export interface Storyboard {
  brief: DirectorBrief
  scenes: StoryboardScene[]
  title: string
}

const MOODS: MusicMood[] = ['epico', 'inspirador', 'atmosferico', 'tenso', 'documental', 'publicitario']

function normalizeBrief(raw: Record<string, unknown>, prompt: string): DirectorBrief {
  const str = (v: unknown, fallback: string, max = 300) => String(v || '').trim().slice(0, max) || fallback
  const mood = MOODS.find(m => m === String(raw.musicMood || '').toLowerCase()) || 'atmosferico'
  const voiceGender = String(raw.voiceGender || '').toLowerCase().startsWith('f') ? 'feminina' : 'masculina'
  return {
    title: str(raw.title, prompt.slice(0, 60), 80),
    hook: str(raw.hook, 'o que vem a seguir vai mudar como você vê este assunto', 160),
    audience: str(raw.audience, 'público geral interessado no tema', 120),
    tone: str(raw.tone, 'inspirador e direto', 80),
    visualStyle: str(raw.visualStyle, 'cinematic photoreal photography', 120),
    palette: str(raw.palette, 'rich cinematic contrast', 80),
    cameraLanguage: str(raw.cameraLanguage, 'calm deliberate camera moves', 120),
    musicMood: mood,
    voiceGender,
    voiceStyle: str(raw.voiceStyle, 'narrador grave e seguro', 80),
    cta: str(raw.cta, 'inscreva-se no canal', 120),
  }
}

const FALLBACK_BRIEF = (prompt: string): DirectorBrief => ({
  title: prompt.slice(0, 60),
  hook: 'vale a pena assistir até o fim',
  audience: 'público geral',
  tone: 'inspirador e direto',
  visualStyle: 'cinematic photoreal photography',
  palette: 'rich cinematic contrast',
  cameraLanguage: 'calm deliberate camera moves',
  musicMood: 'atmosferico',
  voiceGender: 'masculina',
  voiceStyle: 'narrador grave e seguro',
  cta: 'inscreva-se para não perder os próximos',
})

/**
 * Estilo visual do modelo Publicitário (o único que usa este motor de imagens de IA): filme de campanha
 * de marca. Os outros gêneros (documentário, educativo, reels…) foram retirados — explicadores vão para
 * o "modelo dos vídeos" e vendas de produto para o "Comercial" (motor de animação).
 */
const PUBLICITY_STYLE = 'premium brand campaign film still, aspirational lifestyle, real people and authentic moments, cinematic lighting, shallow depth of field, rich color grade, 35mm lens, polished advertising photography'

/**
 * Visuais do motor de imagens de IA. O JARVIS escolhe um deles pelo pedido (ver video/decide.ts)
 * ou usa o que o usuário pediu ("em 3D", "realista", "estilo anime"…). O estilo é FORÇADO no
 * briefing para que todas as cenas saiam com o mesmo visual, mesmo que a IA sugira outro.
 */
export const LOOKS: Record<VideoLook, { label: string; style: string; director: string; story: string }> = {
  publicitario: {
    label: 'Publicitário',
    style: PUBLICITY_STYLE,
    director: 'diretor de criação de uma agência de publicidade premiada: cria filmes de campanha de marca que emocionam e fazem lembrar da marca',
    story: 'filme PUBLICITÁRIO de campanha de marca (conceito criativo, emoção, valores da marca, assinatura no final)',
  },
  realista: {
    label: 'Realista',
    style: 'photorealistic cinematic film still, real world location, natural light, documentary realism, shot on ARRI Alexa, 35mm lens, shallow depth of field, true-to-life colors and textures',
    director: 'diretor de documentários e curtas cinematográficos: imagens reais, emocionantes e informativas',
    story: 'vídeo REALISTA cinematográfico, como filmado de verdade (documentário/curta), fiel ao tema',
  },
  '3d': {
    label: 'Animação 3D',
    style: '3D animated film still, Pixar-style CGI render, expressive stylized characters, soft global illumination, subsurface scattering, vibrant colors, cinematic depth of field, octane render',
    director: 'diretor de curtas de animação 3D (estilo Pixar/DreamWorks): personagens carismáticos, mundo encantador, história com começo, meio e fim',
    story: 'curta de ANIMAÇÃO 3D (CGI estilo Pixar), com personagens e cenários 3D consistentes',
  },
  anime: {
    label: 'Anime',
    style: 'anime film still, Studio Ghibli and Makoto Shinkai inspired, hand-drawn cel shading, detailed painted backgrounds, dramatic sky, soft cinematic lighting, vivid colors',
    director: 'diretor de anime: cenas expressivas, cenários pintados e emoção',
    story: 'curta em estilo ANIME japonês, com o mesmo traço e personagens em todas as cenas',
  },
  cartoon: {
    label: 'Desenho animado 2D',
    style: '2D cartoon illustration, flat vector animation style, bold clean outlines, bright playful colors, friendly characters, simple shapes, children\'s animated series look',
    director: 'diretor de desenho animado 2D: humor leve, personagens simpáticos e cenas claras',
    story: 'DESENHO ANIMADO 2D colorido, com os mesmos personagens e traço em todas as cenas',
  },
}

// ─── LLM access (injectable para testes) ──────────────────────────────────────

let completeJsonFn: CompleteFn = defaultComplete
let modelsJsonFn: (preferred?: string) => Promise<string[]> = async preferred => {
  const catalog = await getLiveCatalog()
  const chain = fallbackChain(catalog, defaultModelFrom(catalog), 6, 'json')
  const free = rankModels(catalog, 'code').filter(m => !/(lite|mini|nano|tiny|[^\d](1|2|3|4|7|8|9|12|20)b\b|allam)/i.test(m.id) && !/^(openai|anthropic|deepseek|xai)\|/.test(m.id)).slice(0, 4).map(m => m.id)
  const order = [...(preferred ? [preferred] : []), ...free, ...chain]
  return [...new Set(order)].slice(0, 8)
}

export function setDirectorLlm(complete: CompleteFn, models?: (preferred?: string) => Promise<string[]>) {
  completeJsonFn = complete
  if (models) modelsJsonFn = models
}

async function completeJson(messages: ChatMessage[], opts: { model?: string; signal?: AbortSignal } = {}): Promise<{ text: string; model: string }> {
  const models = (await modelsJsonFn(opts.model)).filter(m => modelHealth.state(m) !== 'unavailable')
  if (!models.length) throw new Error('Nenhuma IA conectada. Adicione uma chave em 🔑 Chaves de API.')
  let last: unknown
  for (const model of models) {
    try {
      const c = await completeJsonFn(model, messages, opts.signal, { json: true })
      modelHealth.reportSuccess(model)
      return { text: c.text, model }
    } catch (e) {
      if (opts.signal?.aborted) throw e
      const cls = classifyModelError(e)
      modelHealth.reportFailure(model, cls.kind, cls.message, cls.retryAfterMs)
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('Falha ao consultar a IA')
}

// ─── Qual tipo de vídeo (quando o usuário não diz) ───────────────────────────

/**
 * Pergunta a uma IA qual formato deixa ESTE vídeo melhor. Rápido (timeout curto) e opcional:
 * quem chama usa a escolha por palavras (video/decide.ts) se falhar ou demorar.
 */
export async function askVideoKind(message: string, heuristic: string, timeoutMs = 8000): Promise<{ kind: string; reason: string } | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const { text } = await completeJson([
      { role: 'system', content: 'Você é diretor de vídeos curtos virais. Escolha o FORMATO que deixa o vídeo pedido com a melhor qualidade e retenção. Devolva SOMENTE JSON.' },
      { role: 'user', content: `Pedido: "${message.slice(0, 600)}"\n\nFormatos possíveis:\n- animado: motion design vertical estilo TikTok (textos, ícones, gráficos, passos, notícias, dados, tutoriais de tecnologia)\n- comercial: anúncio animado de um app/produto à venda\n- realista: cenas fotorrealistas como filmadas (lugares, natureza, comida, pessoas, história, esportes, documentário, motivacional)\n- 3d: animação 3D estilo Pixar (histórias com personagens, infantil, fantasia, mascotes)\n- anime: estilo anime japonês\n- cartoon: desenho animado 2D\n- publicitario: filme de campanha de marca/empresa\n\nPalpite inicial pelas palavras: ${heuristic}.\nResponda {"kind":"animado|comercial|realista|3d|anime|cartoon|publicitario","reason":"motivo curto em português"}` },
    ], { signal: ctl.signal })
    const raw = extractJson(text) as { kind?: unknown; reason?: unknown }
    return typeof raw?.kind === 'string' ? { kind: raw.kind, reason: String(raw.reason || '').slice(0, 160) } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Briefing criativo ────────────────────────────────────────────────────────

export async function writeBrief(prompt: string, format: VideoFormat, totalSeconds: number, opts: { model?: string; signal?: AbortSignal; look?: VideoLook } = {}): Promise<{ brief: DirectorBrief; model: string }> {
  const look = LOOKS[opts.look || 'publicitario']
  const styleHint = look.style
  const forceLook = (b: DirectorBrief): DirectorBrief => ({ ...b, visualStyle: look.style })

  try {
    const { text, model } = await completeJson([
      { role: 'system', content: `Você é ${look.director}. Devolva SOMENTE JSON válido, sem comentários.` },
      { role: 'user', content: `Pedido do usuário: "${prompt}"\nFormato: ${format.label} (${format.aspect}). Duração-alvo: ~${totalSeconds}s.\nModelo: ${look.story}.\n\nCrie o briefing. Campos: {"title":"título do vídeo (curto, forte)","hook":"frase de abertura que prende a atenção em 3 segundos","audience":"público-alvo","tone":"tom (ex.: inspirador, direto, épico, documental)","visualStyle":"estilo visual em INGLÊS para geração de imagem - use: ${styleHint}","palette":"paleta de cores em inglês (ex.: deep teal and gold / warm amber and charcoal)","cameraLanguage":"linguagem de câmera em inglês (ex.: slow dolly-in moves / dynamic whip pans / orbital glide)","musicMood":"epico|inspirador|atmosferico|tenso|documental|publicitario","voiceGender":"masculina|feminina","voiceStyle":"estilo de narração em português (ex.: narrador documental grave / voz calorosa e próxima / apresentador vibrante)","cta":"chamada final de ação (ex.: inscreva-se no canal / baixe agora / assista tudo)"}\n` },
    ], opts)
    return { brief: forceLook(normalizeBrief(extractJson(text) as Record<string, unknown>, prompt)), model }
  } catch (e) {
    if (opts.signal?.aborted) throw e
    return { brief: forceLook(FALLBACK_BRIEF(prompt)), model: 'fallback' }
  }
}

// ─── Storyboard ───────────────────────────────────────────────────────────────

export async function writeStoryboard(
  prompt: string, brief: DirectorBrief, format: VideoFormat, totalSeconds: number,
  opts: { model?: string; signal?: AbortSignal; look?: VideoLook } = {},
): Promise<{ storyboard: Storyboard; model: string }> {
  const words = Math.round(totalSeconds * 2.4)
  const lookId = opts.look || 'publicitario'
  const system = lookId === 'publicitario'
    ? 'Você é roteirista e storyboard artist de filmes publicitários de marca (campanhas premiadas): história curta com emoção, a marca como heroína discreta e assinatura com o CTA no final. Devolva SOMENTE JSON válido.'
    : `Você é roteirista e storyboard artist (${LOOKS[lookId].director}). Faça um ${LOOKS[lookId].story}: história curta, clara e envolvente, fiel ao pedido, com gancho forte e fecho marcante. Os prompts de imagem descrevem SEMPRE esse visual. Devolva SOMENTE JSON válido.`
  const { text, model } = await completeJson([
    { role: 'system', content: system },
    { role: 'user', content: `Pedido: "${prompt}"\nBriefing: ${JSON.stringify(brief)}\nFormato: ${format.label} (${format.aspect}, ${safeZoneHint(format)}). Duração total: ${totalSeconds}s.\n\nEscreva o storyboard em cenas de 2,5 a 6 s (3 a ${Math.min(12, Math.floor(totalSeconds / 2.5))} cenas). A soma das durações DEVE ser ~${totalSeconds} s e a narração ("vo") DEVE ter cerca de ${words} palavras no TOTAL (cada cena com ~${Math.max(8, Math.round(words / Math.max(3, Math.floor(totalSeconds / 3))))} palavras, aproximadamente ${Math.round(words / totalSeconds)} palavras por segundo, frases curtas, português do Brasil, sem marcadores de cena).\n\nCada cena: {"name":"nome curto","vo":"narração da cena","visual":"prompt DE IMAGEM em INGLÊS, detalhado: sujeito, ação, ambiente, iluminação, composição, lente — 25 a 45 palavras, SEM texto no quadro","camera":"zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|static|orbit|dolly-in|dolly-out|tilt-up|tilt-down","transition":"fade|wipe|zoom|iris","sfx":["whoosh"],"durationSec":4}\n\nRegras:\n- Coerência visual entre cenas: MESMO estilo, paleta e nível de realismo (repita 2-3 termos do briefing em todos os prompts).\n- O primeiro frame deve ser impactante (hook). O último termina com o CTA.\n- Narração em português do Brasil, natural, fluida e concreta; nada de clichês vazios.\n- sfx apenas de: pop, tick, whoosh, shimmer, impact, rise.\n- Nenhum texto escrito dentro da imagem (a legenda é renderizada por cima).` },
  ], opts)
  const raw = extractJson(text) as Record<string, unknown>
  const scenes = clampStoryboard(raw, brief, totalSeconds)
  return { storyboard: { brief, scenes, title: brief.title }, model }
}

// Clamp storyboard do modelo ou fallback estruturado
function clampStoryboard(raw: Record<string, unknown>, brief: DirectorBrief, totalSeconds: number): StoryboardScene[] {
  const list = Array.isArray(raw.scenes) ? raw.scenes : []
  const maxScenes = Math.max(3, Math.min(12, Math.floor(totalSeconds / 3)))
  let scenes: StoryboardScene[] = list.slice(0, maxScenes).map((s: Record<string, unknown>, i: number) => {
    const dur = Number(s.durationSec)
    const camera = CAMERAS.find(c => c === String(s.camera || '').toLowerCase()) || 'zoom-in'
    const rawSfx: string[] = Array.isArray(s.sfx) ? s.sfx.map((x: unknown) => String(x).toLowerCase()).filter(x => ['pop', 'tick', 'whoosh', 'shimmer', 'impact', 'rise'].includes(x)) : []
    return {
      name: String(s.name || `cena ${i + 1}`).slice(0, 60),
      vo: String(s.vo || '').trim(),
      visual: String(s.visual || '').trim(),
      camera,
      transition: (['fade', 'wipe', 'zoom', 'iris'] as const).find(t => t === String(s.transition || '').toLowerCase()) || (i === 0 ? 'zoom' : 'fade'),
      sfx: rawSfx.length ? rawSfx : ['whoosh'],
      durationSec: Number.isFinite(dur) && dur > 0.8 ? Math.min(30, dur) : Math.max(2.5, totalSeconds / maxScenes),
    }
  }).filter(s => s.vo.length > 0 && s.visual.length > 10)
  if (!scenes.length) {
    // Fallback: estrutura clássica abertura → 3 atos → fecho, com VOs genéricos mas coerentes
    const third = Math.floor(totalSeconds / 3)
    scenes = [
      { name: 'abertura', vo: `${brief.hook}.`, visual: `${brief.visualStyle}, ${brief.hook}, ${brief.palette}, ${brief.cameraLanguage}, cinematic still`, camera: 'zoom-in', transition: 'zoom', sfx: ['impact', 'rise'], durationSec: third },
      { name: 'desenvolvimento', vo: 'Entender este tema por dentro muda a forma como você decide.', visual: `${brief.visualStyle}, layered environment, deep detail, ${brief.palette}, slow deliberate camera`, camera: 'pan-right', transition: 'fade', sfx: ['whoosh'], durationSec: third },
      { name: 'fecho', vo: brief.cta, visual: `${brief.visualStyle}, dramatic final vista, ${brief.palette}, horizon light`, camera: 'zoom-out', transition: 'fade', sfx: ['shimmer'], durationSec: totalSeconds - third * 2 },
    ]
  }
  // Distribui a duração restante se o modelo errou a soma
  const sum = scenes.reduce((s, x) => s + x.durationSec, 0)
  if (Math.abs(sum - totalSeconds) > 0.75 && sum > 0) {
    const k = totalSeconds / sum
    scenes = scenes.map(s => ({ ...s, durationSec: Math.max(1.5, s.durationSec * k) }))
  }
  return scenes
}

// Camera moves supported in the composition system - extended list
const CAMERAS: CameraMove[] = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'static', 'orbit', 'dolly-in', 'dolly-out', 'tilt-up', 'tilt-down']

// Enhanced SFX list with more variety (used in clampStoryboard filter)
const ENHANCED_SFX: string[] = ['pop', 'tick', 'whoosh', 'shimmer', 'impact', 'rise', 'swish', 'rumble', 'swoosh']