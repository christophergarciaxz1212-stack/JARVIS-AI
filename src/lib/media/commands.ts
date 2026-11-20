import fs from 'fs'
import { createJob } from '../motion/jobs'
import { generateImages, parseImageRequest, listImages, imageFile, editImage, saveGalleryImage } from './images'
import { getPrefs } from '../prefs'
import { decideVideo, planFromKind, KIND_LABEL, type VideoKind, type VideoPlan } from '../video/decide'

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

/** Recognises "crie um vídeo sobre…" / "gere uma imagem de…"; the runner does the work inside the chat stream. */
/**
 * Qual dos 3 modelos do Estúdio atende o pedido de vídeo:
 * - publicitario: campanha/filme de marca, institucional, cinematográfico;
 * - comercial: vender um produto/app (anúncio, propaganda, oferta, "baixe", "compre");
 * - videos (padrão): explicadores no estilo TikTok — ferramentas, notícias, dados, analogias, tutoriais.
 */
export function videoModelFor(brief: string): 'videos' | 'comercial' | 'publicitario' {
  const t = brief.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/\b(publicit\w*|campanha|filme (da|de|para a|pra) (marca|empresa)|institucional|cinematogr\w*|brand ?film|branding)\b/.test(t)) return 'publicitario'
  if (/\b(comercial|propaganda|anuncio|promo\w*|vend\w*|oferta|desconto|compre|baixe|lancamento do (meu |nosso )?(app|produto)|produto)\b/.test(t)) return 'comercial'
  return 'videos'
}

/** Cria o vídeo no motor certo e devolve a resposta do chat com o cartão ao vivo ([[motion:]] ou [[video:]]). */
async function startVideo(brief: string, fullText: string, p: VideoPlan): Promise<string> {
  const url = brief.match(/https?:\/\/\S+/)?.[0]
  const secs = Number(fullText.match(/(\d{1,3})\s*(?:s\b|seg|segundos)/i)?.[1]) || (/(\d)\s*min/i.test(fullText) ? Number(fullText.match(/(\d)\s*min/i)![1]) * 60 : undefined)
  const female = /feminina|feminino|mulher/i.test(fullText)
  const voice = { provider: 'edge' as const, id: female ? 'pt-BR-FranciscaNeural' : 'pt-BR-AntonioNeural' }
  const wantsVoice = !/sem (voz|narra|locu)/i.test(fullText)
  const why = p.unsupported
    ? `\n\n> **Modelo: ${p.label}** — vídeos ${p.unsupported} montados com imagens foram desativados a seu pedido; fiz no seu modelo animado.`
    : `\n\n> **Modelo: ${p.label}** — ${p.reason}.`
  if (p.engine === 'cinema') {
    const { createVideoJob } = await import('../video/produce')
    // Publicitário: vertical quando pedido, senão horizontal
    const vertical = /vertical|reels?|tiktok|shorts|9:16|stories/i.test(fullText)
    const job = createVideoJob({
      prompt: brief,
      formatId: vertical ? 'shorts' : 'youtube',
      seconds: Math.max(10, Math.min(90, secs ?? 30)),
      fps: 30,
      narration: wantsVoice ? 'auto' : 'none',
      voice,
      music: 'nenhum',
      look: p.look,
    })
    return `🎬 **Vídeo ${p.label.toLowerCase()} iniciado:** “${brief.slice(0, 120)}”\n\nDiretor → Roteirista → Designer → Diretor de Áudio → Editor → Revisor: roteiro cena a cena, imagens no visual ${p.label.toLowerCase()}, movimento de câmera, narração, efeitos e legendas — tudo aqui na conversa. Costuma levar de 2 a 6 minutos.${why}\n\n[[video:${job.id}]]`
  }
  const prefs = getPrefs()
  const comercial = p.motionStyle === 'app-promo'
  const job = createJob({ prompt: brief, brandUrl: url, seconds: Math.min(60, secs ?? (comercial ? 20 : 30)), fps: prefs.motion.fps, style: p.motionStyle || 'auto', narration: wantsVoice ? 'jarvis' : 'none', voice: wantsVoice ? voice : undefined })
  // O cartão na conversa mostra o progresso ao vivo e, no fim, o vídeo para assistir/baixar
  return `🎬 **${comercial ? 'Comercial animado' : 'Vídeo animado'} iniciado:** “${brief.slice(0, 120)}”\n\nEscrevo o roteiro, programo a animação quadro a quadro (vertical 1080×1920, ${job.request.fps} fps)${comercial ? '' : ' no visual que mais combina com o tema (passos, notícia, dados ou analogia)'}, testo os quadros${job.request.narration === 'jarvis' ? ` e gravo a narração (voz ${voice.id.replace(/^pt-BR-|Neural$/g, '')} do Edge)` : ''} e monto o MP4 com legenda — tudo aqui na conversa. Costuma levar de 1 a 4 minutos.${why}\n\n[[motion:${job.id}]]`
}

export function mediaCommandRunner(message: string, attachments: CommandAttachment[] = []): (() => Promise<string>) | null {
  // Built-in slash commands
  const slash = /^\/(video|vídeo|motion|imagem|image|img)\s+([\s\S]+)$/i.exec(message.trim())
  if (slash) message = /^(video|vídeo|motion)$/i.test(slash[1]) ? `crie um vídeo sobre ${slash[2]}` : `gere uma imagem de ${slash[2]}`
  const text = message.trim()
  const s = strip(text)
  if (text.length > 1500) return null
  const edit = matchVideoEditCommand(text)
  if (edit) {
    const scene = edit.scene
    return async () => {
      const { listVideoJobs, regenerateVideoJob } = await import('../video/produce')
      const latest = listVideoJobs()[0]
      if (!latest) return '🎬 Ainda não há nenhum vídeo para ajustar. Peça um primeiro: “crie um vídeo sobre…”.'
      try {
        const job = regenerateVideoJob(latest.id, scene === null ? undefined : scene - 1)
        const titulo = latest.title || latest.request.prompt.slice(0, 60)
        return scene === null
          ? `🔄 **Vídeo “${titulo}” em regeração** a partir do roteiro salvo (cenas, narração e legendas).\n\n[[video:${job.id}]]`
          : `🔄 **Cena ${scene} de “${titulo}”** ganhou uma imagem nova. O restante do vídeo é reutilizado (a narração não é regerada se o texto não mudou).\n\n[[video:${job.id}]]`
      } catch (e) {
        return `Não consegui regerar: ${(e as Error).message}`
      }
    }
  }
  const plan = matchScenePlanCommand(text)
  if (plan) {
    return async () => {
      const { listVideoJobs, moveVideoScene, deleteVideoScene, duplicateVideoScene, regenerateVideoJob } = await import('../video/produce')
      const latest = listVideoJobs()[0]
      if (!latest) return '🎬 Ainda não há nenhum vídeo para ajustar. Peça um primeiro: “crie um vídeo sobre…”.'
      if (latest.status === 'running' || latest.status === 'queued') return '⏳ A produção em andamento ainda não terminou. Espere o vídeo ficar pronto antes de reorganizar as cenas.'
      try {
        if (plan.action === 'move') moveVideoScene(latest.id, plan.scene - 1, plan.to ?? 0)
        else if (plan.action === 'delete') deleteVideoScene(latest.id, plan.scene - 1)
        else duplicateVideoScene(latest.id, plan.scene - 1)
        const job = regenerateVideoJob(latest.id)
        const titulo = latest.title || latest.request.prompt.slice(0, 60)
        const oq = plan.action === 'move' ? `Cena ${plan.scene} reposicionada` : plan.action === 'delete' ? `Cena ${plan.scene} excluída` : `Cena ${plan.scene} duplicada`
        return `🎬 **${oq}** em “${titulo}” — narração, legendas e montagem refeitas a partir do novo roteiro:\n\n[[video:${job.id}]]`
      } catch (e) {
        return `Não consegui reorganizar: ${(e as Error).message}`
      }
    }
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
      const { createVideoJob } = await import('../video/produce')
      const ref = attachments.length
        ? saveGalleryImage({ data: attachments[0].data, mimeType: attachments[0].mimeType, name: attachments[0].name })
        : lastGallery!
      const job = createVideoJob({
        prompt: `Vídeo produzido pelo JARVIS a partir da imagem enviada pelo usuário: ${(ref.prompt || 'cena enviada').slice(0, 300)}. A cena 1 é a imagem do usuário; as demais completam o roteiro visual com o mesmo estilo.`,
        formatId: /vertical|reels?|tiktok|shorts|9:16/i.test(s) ? 'shorts' : 'youtube',
        fps: 30,
        seconds: 20,
        narration: 'auto',
        voice: { provider: 'edge', id: 'pt-BR-AntonioNeural' },
        music: 'nenhum',
        referenceImageId: ref.id,
      })
      return `🎬 **Vídeo a partir da sua imagem** — a primeira cena é ela mesma; o diretor de IA completa roteiro, narração, trilha e legendas:\n\n[[video:${job.id}]]`
    }
  }

  // "refaça em 3D" → o último vídeo pedido (de qualquer motor), agora no visual escolhido
  const restyle = /\b(imagem|imagens|foto|fotos|logo|logotipo|wallpaper|topologia|diagrama|site|planilha|texto|codigo)\b/i.test(s) ? null : VIDEO_RESTYLE.exec(s)
  if (restyle) {
    const want = restyle[1].toLowerCase()
    return async () => {
      const { listVideoJobs } = await import('../video/produce')
      const { listJobs } = await import('../motion/jobs')
      const lastCinema = listVideoJobs()[0]
      const lastMotion = listJobs().sort((a, b) => b.createdAt - a.createdAt)[0]
      const last = !lastCinema ? lastMotion?.request.prompt : !lastMotion ? lastCinema.request.prompt
        : (lastCinema.createdAt > lastMotion.createdAt ? lastCinema.request.prompt : lastMotion.request.prompt)
      if (!last) return '🎬 Ainda não há vídeo para refazer. Peça um: “crie um vídeo sobre…”.'
      const kind = (want === 'motion' ? 'animado' : want) as VideoKind
      const p = planFromKind(kind, `você pediu ${KIND_LABEL[kind]?.toLowerCase() || kind}`)
      if (!p) return 'Não entendi o modelo. Diga “refaça como animado”, “como comercial” ou “como publicitário”.'
      return startVideo(last, last, p)
    }
  }

  const v = VIDEO.exec(s)
  if (v && v[1].trim().length > 2) {
    // Keep the user's original wording (accents) for the brief
    const brief = text.slice(text.length - v[1].length).trim()
    return async () => {
      // Modelos do usuário: animado (padrão, estilo TikTok), comercial e publicitário (só se pedir)
      return startVideo(brief, text, decideVideo(text))
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
