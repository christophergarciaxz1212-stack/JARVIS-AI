/**
 * Gerador de legendas para posts de vídeo (Instagram/TikTok).
 * Usa o LLM com injeção por dependência; se a rede/modelo falhar,
 * cai no fallback determinístico — a publicação nunca trava por causa de uma legenda.
 */
import fs from 'fs'
import path from 'path'
import { dataDir as sharedDataDir } from '../agents/fsutil'
import { defaultComplete, type ChatMessage } from '../agents/models'
import { defaultModelFrom, getLiveCatalog, rankModels } from '../ai/catalog'

export interface CaptionInput {
  /** Título do vídeo ou pedido original do usuário */
  prompt: string
  /** Opcional: campos do storyboard reutilizado pelo Estúdio de Vídeo */
  title?: string
  scenes?: Array<{ name: string; vo: string }>
  /** Sé de hashtags sugerida (plataforma limita IG/TikTok a 30, recomendamos ≤ 5 efetivas) */
  hashtags?: string[]
  /** Varia por plataforma */
  platformHints?: string
  signal?: AbortSignal
}

export interface CaptionResult {
  caption: string
  title?: string
  hashtags: string[]
  model: string
}

const FALLBACK_HASHTAGS = ['jorvishall', 'jarvisai', 'ia', 'inteligenciaartificial', 'automacao']

function fallbackCaption(input: CaptionInput): CaptionResult {
  const hook = input.title || input.prompt || 'O JARVIS fez mais um vídeo'
  const body = input.scenes?.slice(0, 3).map(s => `· ${s.vo.slice(0, 120)}`).join('\n') || 'Um vídeo criado pelo JARVIS a partir de um pedido simples.'
  return {
    caption: `${hook}\n\n${body}\n\n👇 Segue mais conteúdo acadêmico & tecnologia`,
    title: input.title || input.prompt.slice(0, 90),
    hashtags: FALLBACK_HASHTAGS,
    model: 'fallback',
  }
}

let completeImpl: typeof defaultComplete = defaultComplete
let modelsFn = async (): Promise<string[]> => {
  const catalog = await getLiveCatalog()
  return rankModels(catalog, 'fast').map(m => m.id).slice(0, 3)
}

export function setCaptionLlm(complete: typeof defaultComplete, models?: () => Promise<string[]>) {
  completeImpl = complete
  if (models) modelsFn = models
}

export async function generateCaption(input: CaptionInput): Promise<CaptionResult> {
  const models = (await modelsFn()).filter(Boolean)
  if (!models.length) return fallbackCaption(input)
  const scenes = input.scenes?.slice(0, 6).map(s => `- ${s.name}: ${s.vo.slice(0, 200)}`).join('\n') || '(sem storyboard)'
  const prompt = `Você escreve legendas para posts de vídeo no Instagram e TikTok da própria marca do usuário. Faça tudo em português do Brasil, direto ao ponto, sem clichês corporativos.

Formato exato (três blocos, todos obrigatórios):
1) HOOK: uma frase forte (até 120 caracteres) que prende no feed nos primeiros segundos.
2) CORPO: 1–3 frases descrevendo o que o vídeo mostra — pode citar conteúdo acadêmico, tecnológico, produtividade ou IA.
3) CTA + HASHTAGS: uma chamada à ação curta (comentar, salvar, seguir) e de 3 a 6 hashtags relevantes separadas por espaço.

Os hashtags devem ser curtos e reais (ex.: #IA #TCC #projetointegrador), nunca inventados.

Pedido original do JARVIS (não invente — só use o que está aqui):
${input.prompt}
${input.title ? `Título do vídeo: ${input.title}` : ''}
Cenas:\n${scenes}
${input.platformHints ? `\nNotas da plataforma: ${input.platformHints}` : ''}

Responda APENAS com JSON: {"hook": "...", "body": "...", "cta": "...", "hashtags": ["IA","TCC","..."]}`

  for (const model of models) {
    try {
      const messages: ChatMessage[] = [{ role: 'system', content: 'Você escreve legendas de rede social em pt-BR. Devolve JSON válido e nada mais.' }, { role: 'user', content: prompt }]
      const c = await completeImpl(model, messages, input.signal, { json: true })
      try {
        const parsed = JSON.parse(c.text) as { hook?: string; body?: string; cta?: string; hashtags?: string[] }
        const hook = parsed.hook?.trim()
        const body = parsed.body?.trim()
        const cta = parsed.cta?.trim() || 'Siga para mais conteúdo'
        const hashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : []).filter(t => /^[#\wÀ-ÿ]{2,30}$/i.test(t.replace(/^#/, ''))).slice(0, 8)
        if (!hook || !body || !hashtags.length) continue
        return { caption: `${hook}\n\n${body}\n\n${cta}${hashtags.length ? `\n${hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}` : ''}`, title: input.title || input.prompt.slice(0, 90), hashtags, model }
      } catch {
        continue
      }
    } catch {
      continue
    }
  }
  return fallbackCaption(input)
}

/** Carrega o manifesto do Estúdio de Vídeo (se existir) para alimentar a legenda. */
export function loadStoryboard(videoId: string): { title?: string; scenes?: Array<{ name: string; vo: string }>; prompt?: string } | null {
  if (!/^[\w-]{1,80}$/.test(videoId)) return null
  // Estúdio: o plano do diretor tem título e a fala de cada cena
  try {
    const f = path.join(dataPath(), 'studio', videoId, 'job.json')
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { request?: { prompt?: string }; title?: string; plan?: { scenes?: Array<{ narration: string; onScreen?: string }> } }
      return { title: j.title || j.request?.prompt?.slice(0, 120), scenes: j.plan?.scenes?.map((s, i) => ({ name: s.onScreen || `Cena ${i + 1}`, vo: s.narration })), prompt: j.request?.prompt }
    }
  } catch {}
  try {
    const f = path.join(dataPath(), 'video', videoId, 'script.json')
    if (!fs.existsSync(f)) return null
    const m = JSON.parse(fs.readFileSync(f, 'utf8')) as { request?: { prompt?: string }; brief?: { title?: string }; scenes?: Array<{ name: string; vo: string }> }
    return { title: m.brief?.title || m.request?.prompt?.slice(0, 120), scenes: m.scenes?.map(s => ({ name: s.name, vo: s.vo })), prompt: m.request?.prompt }
  } catch {
    return null
  }
}

const dataPath = () => sharedDataDir()
