import fs from 'fs'
import { createJob } from '../motion/jobs'
import { generateImages, parseImageRequest, listImages, imageFile, editImage, saveGalleryImage } from './images'
import { getPrefs } from '../prefs'
import { createStudioJob, listStudioJobs, reviseStudioJob } from '../studio/producer'
import { decideEngine, latestStudioJob, looksLikeRevision, type VideoEngine } from '../studio/chat'
import { decideFormat } from '../studio/plan'
import type { StudioJob, StudioRequest } from '../studio/types'

/** Anexo de imagem desacoplado da camada HTTP (rota passa nome/mime/bytes). */
export interface CommandAttachment { name: string; mimeType: string; data: Buffer }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Edição do último vídeo pelo chat: "troque a imagem da cena 2", "regenere o vídeo"…
const ORDINALS: Record<string, number> = {
  primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, decima: 10,
}
const ord = 'primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima'
const SCENE_EDIT = new RegExp(`(?:troque|regenere|regenerar|refaca|refazer|gere de novo|faz de novo|mude|muda)\\s+(?:a\\s+)?(?:imagem\\s+|foto\\s+|ilustracao\\s+)?(?:da\\s+|do\\s+|de\\s+)?(?:cena\\s*(?:numero\\s*|n[ºo]?\\s*|#)?(\\d{1,2}|${ord})|(\\d{1,2}|${ord})\\s+cena)\\b`, 'i')
const VIDEO_REGEN = /(?:regere|regenere|regenerar|refaca|refazer|gere de novo|faz de novo)\s+(?:o\s+|esse\s+|este\s+|o\s+ultimo\s+)?video\b/i

/** Reconhece pedidos de edição de vídeo; devolve a cena (1-based) ou null para o vídeo inteiro. Exportado para testes. */
export function matchVideoEditCommand(text: string): { scene: number | null } | null {
  const s = strip(String(text || '')).replace(/\s+/g, ' ').trim()
  if (!s || s.length > 300) return null
  const m = SCENE_EDIT.exec(s)
  if (m) {
    const raw = m[1] || m[2]
    const n = Number(raw) || ORDINALS[raw]
    if (n && n >= 1 && n <= 20) return { scene: n }
    return null
  }
  if (VIDEO_REGEN.test(s)) return { scene: null }
  return null
}

// ── Edição estrutural de cenas: "mova a cena 3 para o início", "exclua a cena 2", "duplique a cena 1"
export interface ScenePlanCommand { action: 'move' | 'delete' | 'duplicate'; scene: number; to?: number }
export function matchScenePlanCommand(text: string): ScenePlanCommand | null {
  const s = strip(String(text || '')).replace(/\s+/g, ' ').trim()
  if (!s || s.length > 300) return null
  const num = 'primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima|\\d{1,2}'
  const toNum = (raw: string | undefined): number | null => {
    if (!raw) return null
    const n = Number(raw) || ORDINALS[raw]
    return n && n >= 1 && n <= 20 ? n : null
  }
  const verbMatch = /^(mova|mover|move|desloque|reposicione|mude|duplique|duplicar|duplica|clone|clonar|exclua|excluir|remova|remover|apague|apagar)\s+/i.exec(s)
  if (!verbMatch) return null
  const verb = verbMatch[1].toLowerCase()
  const restOf = s.slice(verbMatch[0].length).trim()
  const isMove = /^(mova|mover|move|desloque|reposicione|mude)$/.test(verb)
  const isDelete = /^(exclua|excluir|remova|remover|apague|apagar)$/.test(verb)
  const isDup = /^(duplique|duplicar|duplica|clone|clonar)$/.test(verb)
  const sceneRe = new RegExp(`^(?:a\\s+)?(?:da\\s+|do\\s+|de\\s+)?(?:cena\\s*(?:numero\\s*|n[ºo]?\\s*|#)?(${num})|(${num})\\s+cena)\\s*(.*)$`, 'i')
  const m = sceneRe.exec(restOf)
  if (!m) return null
  const scene = toNum(m[1] || m[2])
  if (!scene) return null
  const tail = (m[3] || '').trim()
  if (isMove) {
    const dest = /^(?:para|pra|pro)\s+(?:o\s+|a\s+)?(inicio|comeco|início|fim|final|ultima|pos(?:i[cç][aã]o)?\s*\d{1,2})$/i.exec(tail)
    if (!dest) return null
    const d = dest[1]
    if (/^(inicio|comeco|início)$/i.test(d)) return { action: 'move', scene, to: 0 }
    if (/^(fim|final|ultima)$/i.test(d)) return { action: 'move', scene, to: Number.MAX_SAFE_INTEGER }
    const pos = Number(d.match(/\d{1,2}/)?.[0])
    return pos && pos >= 1 ? { action: 'move', scene, to: pos - 1 } : null
  }
  if (isDelete && !tail) return { action: 'delete', scene }
  if (isDup && !tail) return { action: 'duplicate', scene }
  return null
}

const VIDEO = /^\s*(?:jarvis[\s,:]*)?(?:por favor[\s,]*)?(?:crie|cria|criar|gere|gera|gerar|faca|faz|fazer|produza|produz|monte|anime|me faz|me faca|me manda|manda|quero|eu quero|preciso de|preciso|me de|me da)\s+(?:um|uma|o|a)?\s*(?:video|videozinho|motion|animacao|animacao 3d|reels?|tiktok|shorts?|curta(?:-metragem)?|clipe|anuncio em video|promo em video)\b[\s,:]*(?:de|do|da|sobre|para|pro|pra|com|mostrando)?\s*([\s\S]*)$/i
/** "refaça como comercial", "agora em animado" → o último pedido de vídeo, noutro modelo */
const VIDEO_RESTYLE = /^\s*(?:jarvis[\s,:]*)?(?:refaca|refaz|refazer|faca|faz|agora|quero|transforma|transforme|muda|mude|troca|troque)\b[^\n]{0,40}?\b(?:em|como|no estilo|estilo|para|pra|versao)\s+(?:de\s+|um\s+)?(animado|motion|publicitario|comercial)\b\s*[.!]?\s*$/i
const IMAGE = /^\s*(?:jarvis[\s,:]*)?(?:por favor[\s,]*)?(?:gere|gera|crie|cria|desenhe|desenha|faca|faz|me faz|me faca|ilustre)\s+(?:uma|um|[2-4]|duas|tres|quatro)?\s*(?:imagem|imagens|fotos?|ilustracao|ilustracoes|desenhos?|artes?|wallpaper|papel de parede|logo|logotipo|variacoes)\b[\s,:]*(?:de|do|da|sobre|com|mostrando)?\s*([\s\S]*)$/i

/** Opções que o pedido já diz ("sem narração", "720p", "sem música"). */
function studioOptions(text: string): Partial<StudioRequest> {
  const t = strip(text)
  const o: Partial<StudioRequest> = {}
  if (/\bsem (voz|narra\w*|locu\w*)/.test(t)) o.narration = false
  if (/\bsem (musica|trilha)/.test(t)) o.music = 'nenhuma'
  if (/\bsem legendas?\b/.test(t)) o.captions = false
  if (/\b720p?\b/.test(t)) o.quality = '720p'
  return o
}

const fmtDur = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`)

/** Cria o vídeo no motor certo e devolve a resposta do chat com o cartão ao vivo ([[video:]] ou [[motion:]]). */
async function startVideo(brief: string, fullText: string, e: VideoEngine, images?: string[]): Promise<string> {
  if (e.engine === 'studio') {
    const job = createStudioJob({ prompt: brief, ...studioOptions(fullText), images })
    const f = decideFormat(job.request)
    const voz = job.request.narration === false ? 'sem narração' : 'narração em português'
    return `🎬 **Produzindo:** “${brief.slice(0, 120)}”\n\n${f.aspect} · ${f.width}×${f.height} · cerca de ${fmtDur(f.seconds)} · ${f.scenes} cenas · ${voz}. O diretor escreve o roteiro e a direção de arte; depois vêm as imagens, a narração, a trilha, a montagem com legendas e o render. Acompanhe as etapas no cartão abaixo. Quando terminar, peça ajustes do jeito que quiser: “troque a voz”, “deixe com 30s”, “imagem nova na cena 2”.\n\n[[video:${job.id}]]`
  }
  const url = brief.match(/https?:\/\/\S+/)?.[0]
  const secs = Number(fullText.match(/(\d{1,3})\s*(?:s\b|seg|segundos)/i)?.[1]) || (/(\d)\s*min/i.test(fullText) ? Number(fullText.match(/(\d)\s*min/i)![1]) * 60 : undefined)
  const female = /feminina|feminino|mulher|narradora|locutora/i.test(fullText)
  const voice = { provider: 'edge' as const, id: female ? 'pt-BR-FranciscaNeural' : 'pt-BR-AntonioNeural' }
  const wantsVoice = !/sem (voz|narra|locu)/i.test(fullText)
  const prefs = getPrefs()
  const comercial = e.style === 'app-promo'
  const job = createJob({ prompt: brief, brandUrl: url, seconds: Math.min(60, secs ?? (comercial ? 20 : 30)), fps: prefs.motion.fps, style: e.style, narration: wantsVoice ? 'jarvis' : 'none', voice: wantsVoice ? voice : undefined })
  return `🎬 **${e.label} iniciado:** “${brief.slice(0, 120)}”\n\nEscrevo o roteiro, programo a animação quadro a quadro (vertical 1080×1920, ${job.request.fps} fps)${comercial ? '' : ' no visual que mais combina com o tema (passos, notícia, dados ou analogia)'}, testo os quadros${job.request.narration === 'jarvis' ? ` e gravo a narração (voz ${voice.id.replace(/^pt-BR-|Neural$/g, '')} do Edge)` : ''} e monto o MP4 com legenda — tudo aqui na conversa. Costuma levar de 1 a 4 minutos.\n\n> **Modelo: ${e.label}** — ${e.reason}. Para o vídeo com imagens, câmera, narração e trilha, peça sem “animado”.\n\n[[motion:${job.id}]]`
}

/** O vídeo que a frase quer ajustar: o citado pelo título (“…”), senão o último. */
function revisionTarget(text: string, jobs: StudioJob[]): StudioJob | undefined {
  const citado = /[“"]([^”"]{3,120})[”"]/.exec(text)?.[1]
  if (citado) {
    const alvo = jobs.find(j => j.title && strip(j.title) === strip(citado))
    if (alvo) return alvo
  }
  return latestStudioJob(jobs)
}

export function mediaCommandRunner(message: string, attachments: CommandAttachment[] = []): (() => Promise<string>) | null {
  // Built-in slash commands
  const slash = /^\/(video|vídeo|motion|imagem|image|img)\s+([\s\S]+)$/i.exec(message.trim())
  if (slash) message = /^(video|vídeo|motion)$/i.test(slash[1]) ? `crie um vídeo sobre ${slash[2]}` : `gere uma imagem de ${slash[2]}`
  const text = message.trim()
  const s = strip(text)
  if (text.length > 1500) return null
  // Ajuste do último vídeo do estúdio: "troque a voz", "deixe com 30s", "imagem nova na cena 2", "exclua a cena 3"…
  const comandoDeCena = !!(matchVideoEditCommand(text) || matchScenePlanCommand(text))
  if (comandoDeCena || (looksLikeRevision(text) && !VIDEO.test(s) && !VIDEO_RESTYLE.test(s))) {
    const jobs = listStudioJobs()
    const alvo = revisionTarget(text, jobs)
    if (alvo) {
      return async () => {
        if (alvo.status === 'queued' || alvo.status === 'running') {
          return `⏳ “${alvo.title || alvo.request.prompt.slice(0, 60)}” ainda está em produção. Quando o cartão mostrar o vídeo pronto, peça o ajuste de novo (ou cancele a produção no cartão).`
        }
        try {
          const { job, summary } = reviseStudioJob(alvo.id, text)
          const entendi = summary.length ? `Entendi: ${summary.join(' · ')}. ` : ''
          return `🔄 **Ajustando “${alvo.title || 'o vídeo'}”.** ${entendi}O diretor mexe só no que você pediu; imagens de cenas iguais são reaproveitadas, e narração, trilha, legendas e render são refeitos.\n\n[[video:${job.id}]]`
        } catch (e) {
          return `Não consegui ajustar o vídeo: ${(e as Error).message}`
        }
      }
    }
    if (comandoDeCena) return async () => '🎬 Ainda não há nenhum vídeo recente para ajustar. Peça um primeiro: “crie um vídeo sobre…”.'
  }
  // ── Multimodal: edição / variação / vídeo-da-imagem (antes de qualquer outro executor)
  const lastGallery = attachments.length ? undefined : listImages()[0]
  const videoFromImage =
    /v[íi]deo[^\n]{0,80}(com|a partir|basead|usando)[^\n]{0,40}(essa|esta|a)?\s*(imagem|foto|anexo)/i.test(s) ||
    /(transforme|transforma|vire|virar|anime)[^\n]{0,60}(essa|esta|a)\s+(imagem|foto|anexo)[^\n]{0,40}(v[íi]deo|cli?pe)/i.test(s)
  const VISUAL_EDIT = /(edite|editar|edita|remove|remova|tira|tire|troque|mude|altere|aplique|transforme|melhore|corrija|adicione|coloque|substitua|pinte|retoque|aprimore)/i
  const mentionsImage = /(imagem|foto|fotografia|ilustra|arte|desenho|anexo|essa imagem|esta imagem|anexada|anexado)/i.test(s)
  if (VISUAL_EDIT.test(s) && !videoFromImage && (attachments.length || mentionsImage)) {
    const instruction = text
    return async () => {
      let source: { data: Buffer; mimeType: string } | null = attachments[0]
        ? { data: attachments[0].data, mimeType: attachments[0].mimeType }
        : null
      if (!source && lastGallery) {
        const ref = imageFile(lastGallery.id)
        if (!ref) return 'Não encontrei a última imagem no disco da galeria (ela pode ter sido apagada). Anexe a imagem para eu editar.'
        source = { data: fs.readFileSync(ref.file), mimeType: ref.type }
      }
      if (!source) return 'Anexe a imagem que você quer editar (ou gere uma primeiro com “gere uma imagem de …”).'
      try {
        const img = await editImage(source, instruction)
        return `✏️ **Imagem editada** — “${instruction.slice(0, 120)}”\n\n![${instruction.slice(0, 80)}](/api/media?image=${img.id})\n\n*O que não foi mencionado foi preservado (${img.provider}). Peça refinamentos: “mais escura”, “remova o objeto à direita”, “agora em outro estilo”.*`
      } catch (e) {
        return `A edição de imagem falhou: ${(e as Error).message}`
      }
    }
  }
  const wantsVariation = /(outra vers|varia[cç][aã]o|variar|refa[cç]a|nova vers|regere( essa| a)? imagem|gera( essa| a)? de novo)/i.test(s)
  if (wantsVariation && (lastGallery || attachments.length)) {
    return async () => {
      if (!lastGallery) return 'Para variar, anexe a imagem ou gere uma primeiro com “gere uma imagem de …”.'
      try {
        const [img] = await generateImages(lastGallery.englishPrompt || lastGallery.prompt, 1, { aspect: lastGallery.aspect || '1:1', seed: Math.floor(Math.random() * 1e9), skipEnhance: true })
        return `🎲 **Variação pronta** — mesma ideia, nova composição e semente\n\n![variação](/api/media?image=${img.id})\n\n*(gerada do mesmo prompt: “${(lastGallery.englishPrompt || '').slice(0, 140)}”)*`
      } catch (e) {
        return `Não consegui gerar a variação: ${(e as Error).message}`
      }
    }
  }
  if (videoFromImage && (lastGallery || attachments.length)) {
    return async () => {
      const ref = attachments.length
        ? saveGalleryImage({ data: attachments[0].data, mimeType: attachments[0].mimeType, name: attachments[0].name })
        : lastGallery!
      const arquivo = imageFile(ref.id)?.file
      if (!arquivo) return 'Não encontrei a imagem no disco. Anexe de novo para eu montar o vídeo.'
      const brief = `${text}\n\nA primeira cena usa a imagem enviada pelo usuário (${(ref.prompt || 'imagem enviada').slice(0, 300)}); as demais seguem o mesmo estilo.`
      return startVideo(brief, text, { engine: 'studio', label: 'Estúdio', reason: 'vídeo a partir da sua imagem' }, [arquivo])
    }
  }

  // "refaça em 3D" → o último vídeo pedido (de qualquer motor), agora no visual escolhido
  const restyle = /\b(imagem|imagens|foto|fotos|logo|logotipo|wallpaper|topologia|diagrama|site|planilha|texto|codigo)\b/i.test(s) ? null : VIDEO_RESTYLE.exec(s)
  if (restyle) {
    const want = restyle[1].toLowerCase()
    return async () => {
      const { listJobs } = await import('../motion/jobs')
      const lastStudio = listStudioJobs().sort((a, b) => b.createdAt - a.createdAt)[0]
      const lastMotion = listJobs().sort((a, b) => b.createdAt - a.createdAt)[0]
      const ultimo = !lastStudio ? lastMotion : !lastMotion ? lastStudio : lastStudio.createdAt > lastMotion.createdAt ? lastStudio : lastMotion
      const pedido = ultimo?.request.prompt
      if (!pedido) return '🎬 Ainda não há vídeo para refazer. Peça um: “crie um vídeo sobre…”.'
      if (want === 'animado' || want === 'motion') return startVideo(pedido, pedido, { engine: 'motion', style: 'auto', label: 'Animado (seu modelo dos vídeos)', reason: 'você pediu a versão animada' })
      return startVideo(`${pedido} — em estilo publicitário, de campanha de marca`, pedido, { engine: 'studio', label: 'Estúdio', reason: 'você pediu a versão publicitária' })
    }
  }

  const v = VIDEO.exec(s)
  if (v && v[1].trim().length > 2) {
    // Keep the user's original wording (accents) for the brief
    const brief = text.slice(text.length - v[1].length).trim()
    return async () => {
      // Estúdio por padrão; os modelos animados do usuário quando o pedido diz "animado"
      return startVideo(brief, text, decideEngine(text))
    }
  }
  const im = IMAGE.exec(s)
  if (im && im[1].trim().length > 2) {
    const brief = text.slice(text.length - im[1].length).trim()
    const { aspect, count } = parseImageRequest(text)
    return async () => {
      const imgs = await generateImages(brief, count, { aspect })
      const alt = brief.replace(/[[\]]/g, '').slice(0, 80)
      const pics = imgs.map((img, i) => `![${alt}${imgs.length > 1 ? ` (${i + 1})` : ''}](/api/media?image=${img.id})`).join('\n\n')
      const first = imgs[0]
      const skipped = first.fallbacks?.length ? `\n\n> Provedor alternativo usado porque ${first.fallbacks.map(f => f.replace(/^\w+: /, '')).join('; ')}.` : ''
      return `${pics}\n\n*${imgs.length > 1 ? `${imgs.length} variações` : 'Imagem'} em ${aspect} gerada com ${first.provider}. Prompt usado: “${first.englishPrompt.slice(0, 220)}”. Peça outro estilo (realista, anime, 3D, aquarela, logo…), formato (vertical, horizontal, feed) ou "4 variações".*${skipped}`
    }
  }
  return null
}
