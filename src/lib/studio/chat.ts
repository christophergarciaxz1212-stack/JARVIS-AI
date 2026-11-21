/**
 * O estúdio dentro da conversa: qual motor atende o pedido de vídeo e como uma
 * frase como "troque a voz" ou "deixe com 30s" vira uma revisão do último vídeo.
 *
 * Puro (sem Node): as decisões daqui são testadas sem render.
 */
import { decideFormat, parseSeconds } from './plan'
import type { Aspect, Mood, StudioJob, StudioRequest } from './types'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ─── Motor ──────────────────────────────────────────────────────────────────

export type VideoEngine =
  /** Estúdio: roteiro, imagens de IA com câmera, narração, trilha e legenda. */
  | { engine: 'studio'; label: string; reason: string }
  /** Os modelos animados do usuário (motion design quadro a quadro). */
  | { engine: 'motion'; style: 'auto' | 'app-promo'; label: string; reason: string }

const MOTION = /\b(animad[oa]s?|motion( design| graphics?)?|animacao|estilo (do )?tiktok|modelo dos (meus )?videos|meu modelo|explicativo animado|kinetic|tipografia animada)\b/
const COMERCIAL = /\b(comercial|propaganda|anuncio|promo\w*|oferta|desconto|compre|baixe|lancamento)\b/
const SOFTWARE = /\b(app|aplicativo|software|saas|site|plataforma|sistema|extensao)\b/

/**
 * Estúdio por padrão. Os modelos animados do usuário entram quando o pedido diz
 * "animado"/"motion"/"estilo TikTok", e no anúncio de app ou software, que mostra tela.
 */
export function decideEngine(message: string): VideoEngine {
  const t = fold(message)
  if (MOTION.test(t)) {
    const promo = COMERCIAL.test(t) && SOFTWARE.test(t)
    return { engine: 'motion', style: promo ? 'app-promo' : 'auto', label: promo ? 'Comercial animado' : 'Animado (seu modelo dos vídeos)', reason: 'você pediu um vídeo animado' }
  }
  if (COMERCIAL.test(t) && SOFTWARE.test(t)) {
    return { engine: 'motion', style: 'app-promo', label: 'Comercial animado', reason: 'anúncio de app ou software mostra a tela em movimento' }
  }
  return { engine: 'studio', label: 'Estúdio', reason: 'roteiro, imagens com câmera, narração, trilha e legenda' }
}

// ─── Revisão pela conversa ──────────────────────────────────────────────────

/** O que mudar no último vídeo: campos do pedido e cenas que precisam de imagem nova. */
export interface Revision {
  overrides: Partial<StudioRequest>
  /** Cenas (0-based) cuja imagem deve ser gerada de novo. */
  refresh: number[]
  /** Resumo legível do que foi entendido ("duração 30 s · voz masculina"). */
  summary: string[]
}

const ORD: Record<string, number> = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, decima: 10 }
const ORD_RE = Object.keys(ORD).join('|')

const VERBO = /\b(ajuste|ajusta|ajustar|troque|troca|trocar|mude|muda|mudar|deixe|deixa|coloque|coloca|ponha|poe|tire|tira|remova|remove|retire|aumente|aumenta|diminua|diminui|reduza|encurte|encurta|alongue|estenda|acelere|desacelere|use|usa|adicione|adiciona|inclua|refaca|refaz|refazer|regere|regenere|regerar|regenerar|gere de novo|faz de novo|faca|faz|exclua|exclui|apague|apaga|mova|move|duplique|duplica|altere|altera|corrija|corrige|melhore|melhora|agora)\b/
/** Assuntos que só existem num vídeo: com eles, a frase é edição mesmo sem dizer "vídeo". */
const ASSUNTO = /\b(voz|narracao|narrador|narradora|locucao|locutor|locutora|trilha|musica|legenda|legendas|cena|cenas|vertical|horizontal|quadrado|duracao|segundos|720p|1080p|ritmo)\b|\b\d{1,3}\s*(s|seg)\b|\bmais (curto|longo|rapido|lento)\b/
const MENCIONA_VIDEO = /\b(video|videos|clipe|reels?|shorts?|tiktok)\b/

/** A frase pede para mexer no último vídeo? (Só faz sentido quando há um.) */
export function looksLikeRevision(message: string): boolean {
  const t = fold(message).trim()
  if (!t || t.length > 400) return false
  // Pedido novo ("faça um vídeo…", "quero uma música…") não é ajuste
  if (/^(jarvis[\s,:]*)?(crie|cria|criar|gere|gera|gerar|produza|monte|me faz|me faca|faca|faz|escreva|componha|quero|preciso de|me manda|manda)\s+(um|uma|uns|umas|outro|outra)\s/.test(t)) return false
  // Pergunta sobre como fazer não é ordem
  if (/\?\s*$/.test(t) || /^(como|qual|quais|o que|por que|porque|quando|onde|da pra|da para|e possivel|tem como|voce consegue|consegue)\b/.test(t)) return false
  // O cartão do vídeo manda "Ajuste o vídeo “Título”: …"
  if (/^ajuste o video\b/.test(t)) return true
  // Sem verbo: "imagem nova na cena 2", "outra voz", "voz masculina", "com 30 segundos"
  if (/^((imagem|imagens|foto|fotos) novas?|novas? (imagem|imagens)|outras? (imagem|imagens)) (nas? )?cenas?\b|^(outra voz|voz (masculina|feminina)|sem (musica|trilha|legenda|narracao)|com \d{1,3}\s*(s|seg|segundos)\b|mais (curto|longo))/.test(t)) return true
  // Trabalho em código ou arquivos ("corrija o player de vídeo do site") é do agente
  if (/\b(codigo|arquivo|arquivos|site|bug|componente|funcao|player|pagina|projeto|repositorio|script|css|html|api|endpoint|tela do app)\b|\.(tsx?|jsx?|py|json|md)\b/.test(t)) return false
  if (!VERBO.test(t)) return false
  return ASSUNTO.test(t) || MENCIONA_VIDEO.test(t)
}

const MOODS: Array<[RegExp, Mood]> = [
  [/\bepic\w*/, 'epico'], [/\binspira\w*|\bmotivac\w*/, 'inspirador'], [/\batmosf\w*|\bcalm\w*|\bambient\w*/, 'atmosferico'],
  [/\btens\w*|\bsuspense\b|\bdramatic\w*/, 'tenso'], [/\bdocumental\b/, 'documental'], [/\bpublicit\w*|\bcomercial\b|\balegre\b|\banimad[oa]\b/, 'publicitario'],
  [/\btecnolog\w*|\beletronic\w*|\bfuturist\w*/, 'tecnologico'],
]

/**
 * Lê a frase do usuário como mudanças concretas. O que não vira campo (trocar uma
 * fala, mudar o tom do texto) segue como instrução para o diretor.
 */
export function parseRevision(message: string, parent: Pick<StudioJob, 'request' | 'voiceLabel' | 'plan'>): Revision {
  const t = fold(message)
  const overrides: Partial<StudioRequest> = {}
  const summary: string[] = []
  const atual = decideFormat(parent.request)

  // Duração
  const segundos = parseSeconds(t)
  if (segundos) {
    overrides.seconds = segundos
    summary.push(`duração ${segundos} s`)
  } else if (/\bmais curt\w*|\bencurt\w*|\bdiminu\w* (a )?(duracao|tempo)|\breduz\w* (a )?(duracao|tempo)|\bmais rapido\b/.test(t)) {
    overrides.seconds = Math.max(8, Math.round(atual.seconds * 0.7))
    summary.push(`duração ${overrides.seconds} s`)
  } else if (/\bmais long\w*|\balongu\w*|\bestend\w*|\baument\w* (a )?(duracao|tempo)/.test(t)) {
    overrides.seconds = Math.min(180, Math.round(atual.seconds * 1.4))
    summary.push(`duração ${overrides.seconds} s`)
  }

  // Formato
  const aspect: Aspect | undefined = /\b(vertical|9[:x]16|reels?|tiktok|stories|shorts?)\b/.test(t) ? '9:16'
    : /\b(quadrad\w*|1[:x]1)\b/.test(t) ? '1:1'
      : /\b(horizontal|16[:x]9|widescreen|youtube)\b/.test(t) ? '16:9' : undefined
  if (aspect && aspect !== atual.aspect) {
    overrides.aspect = aspect
    summary.push(`formato ${aspect}`)
  }
  if (/\b1080p?\b|\bfull ?hd\b/.test(t)) { overrides.quality = '1080p'; summary.push('1080p') }
  else if (/\b720p?\b/.test(t)) { overrides.quality = '720p'; summary.push('720p') }

  // Voz
  const semNarracao = /\b(sem|tire|tira|remova|remove|retire)\b[^.]{0,20}\b(narracao|voz|locucao|narrador)\b/.test(t)
  if (semNarracao) {
    overrides.narration = false
    summary.push('sem narração')
  } else {
    const atualMasc = /Antonio/i.test(parent.voiceLabel || '') || parent.plan?.voice.gender === 'masculina'
    const pedeMasc = /\b(masculin\w*|de homem|narrador|locutor|antonio)\b/.test(t)
    const pedeFem = /\b(feminin\w*|de mulher|narradora|locutora|thalita|francisca)\b/.test(t)
    const trocaVoz = /\b(troque|troca|trocar|mude|muda|mudar|outra)\b[^.]{0,20}\b(voz|narracao|narrador|narradora|locucao)\b/.test(t)
    let voz: string | undefined
    if (/\bfrancisca\b/.test(t)) voz = 'pt-BR-FranciscaNeural'
    else if (/\bthalita\b/.test(t)) voz = 'pt-BR-ThalitaMultilingualNeural'
    else if (pedeMasc) voz = 'pt-BR-AntonioNeural'
    else if (pedeFem) voz = 'pt-BR-ThalitaMultilingualNeural'
    else if (trocaVoz) voz = atualMasc ? 'pt-BR-ThalitaMultilingualNeural' : 'pt-BR-AntonioNeural'
    if (voz) {
      overrides.voice = voz
      overrides.narration = true
      summary.push(`voz ${voz.includes('Antonio') ? 'masculina (Antonio)' : voz.includes('Francisca') ? 'feminina (Francisca)' : 'feminina (Thalita)'}`)
    } else if (/\b(com|coloque|coloca|ponha|adicione|volte)\b[^.]{0,15}\b(narracao|voz|locucao)\b/.test(t) && parent.request.narration === false) {
      overrides.narration = true
      summary.push('com narração')
    }
  }

  // Trilha
  if (/\b(sem|tire|tira|remova|remove|retire)\b[^.]{0,20}\b(musica|trilha)\b/.test(t)) {
    overrides.music = 'nenhuma'
    summary.push('sem trilha')
  } else if (/\b(musica|trilha)\b/.test(t)) {
    const mood = MOODS.find(([re]) => re.test(t))?.[1]
    if (mood) { overrides.music = mood; summary.push(`trilha ${mood}`) }
    else if (parent.request.music === 'nenhuma') { overrides.music = 'auto'; summary.push('com trilha') }
  }

  // Legendas
  if (/\b(sem|tire|tira|remova|remove|retire)\b[^.]{0,20}\blegendas?\b/.test(t)) { overrides.captions = false; summary.push('sem legenda') }
  else if (/\b(com|coloque|coloca|ponha|adicione|volte)\b[^.]{0,15}\blegendas?\b/.test(t) && parent.request.captions === false) { overrides.captions = true; summary.push('com legenda') }

  // Imagem nova de cenas citadas ("troque a imagem da cena 2", "regenere a terceira cena")
  const refresh: number[] = []
  const pedeImagem = /\b(imagem|imagens|foto|fotos|visual|ilustracao)\b/.test(t) || /\b(regere|regenere|regenerar|regerar|refaca|refaz|refazer|gere de novo|faz de novo)\b/.test(t)
  if (pedeImagem) {
    const re = new RegExp(`\\bcenas?\\s*(?:n[ºo]?\\s*|#)?(\\d{1,2}(?:\\s*(?:,|e)\\s*\\d{1,2})*)|\\b(${ORD_RE})\\s+cena`, 'g')
    for (const m of t.matchAll(re)) {
      const nums = m[1] ? m[1].split(/\s*(?:,|e)\s*/).map(Number) : [ORD[m[2]]]
      for (const n of nums) if (n >= 1 && n <= 20 && !refresh.includes(n - 1)) refresh.push(n - 1)
    }
    if (refresh.length) summary.push(`imagem nova na${refresh.length > 1 ? 's cenas' : ' cena'} ${refresh.map(i => i + 1).join(', ')}`)
    else if (/\b(todas as imagens|imagens novas|outras imagens|novas imagens)\b/.test(t) || /\b(regere|regenere|regerar|regenerar|refaca|refaz|refazer|gere de novo|faz de novo)\s+(o\s+|esse\s+|este\s+)?video\b/.test(t)) {
      const total = parent.plan?.scenes.length ?? 0
      for (let i = 0; i < total; i++) refresh.push(i)
      if (total) summary.push('imagens novas em todas as cenas')
    }
  }

  return { overrides, refresh, summary }
}

/** O último vídeo do estúdio pedido nas últimas 24 h (em produção ou não). */
export function latestStudioJob(jobs: StudioJob[], now = Date.now(), maxAgeMs = 24 * 3600_000): StudioJob | undefined {
  return jobs.filter(j => now - j.createdAt < maxAgeMs).sort((a, b) => b.createdAt - a.createdAt)[0]
}
