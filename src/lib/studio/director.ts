/**
 * Diretor do estúdio: a IA que transforma o pedido em roteiro e direção.
 *
 * Uma chamada só devolve tudo — objetivo, público, estilo visual, paleta,
 * fonte, clima da trilha, voz e as cenas com fala, texto na tela, imagem,
 * câmera e transição. Formato, duração e quantidade de cenas NÃO são decididos
 * aqui: chegam prontos de plan.ts, para o modelo não inventar "vídeo vertical
 * de 3 minutos" quando o pedido era um Reels.
 */
import { defaultComplete, type ChatMessage } from '../agents/models'
import { extractJson } from '../agents/parse'
import { defaultModelFrom, detectTask, getLiveCatalog, rankModels } from '../ai/catalog'
import { narrationWords, sanitizePlan, voiceGenderHint } from './plan'
import type { Aspect, ProductionPlan, VoiceGender } from './types'

export interface DirectorBrief {
  prompt: string
  aspect: Aspect
  seconds: number
  scenes: number
  words: number
  /** Revisão: o plano anterior e o que o usuário pediu para mudar. */
  previous?: ProductionPlan
  feedback?: string
}

const SISTEMA = `Você é diretor e roteirista de uma produtora de vídeo. Recebe um pedido e devolve o plano completo de produção, em JSON.

Regras do roteiro:
- Introdução que prende nos primeiros segundos, desenvolvimento em sequência lógica, encerramento com chamada para ação quando fizer sentido.
- Fala em português do Brasil, natural para ser narrada: frases curtas, sem siglas soletradas, sem emojis, sem marcação.
- Nada de conteúdo genérico para preencher tempo. Cada cena diz algo do pedido.
- "onScreen" é um destaque curto (até 5 palavras) — não repete a fala inteira. Pode ficar vazio.

Regras da imagem ("image"):
- Em INGLÊS, descrevendo uma fotografia ou ilustração concreta: assunto, ambiente, luz, enquadramento.
- Mantenha o mesmo estilo visual em todas as cenas (diga a técnica e a luz em cada uma).
- Nunca peça texto escrito dentro da imagem (geradores escrevem errado).
- Evite como assunto principal o que naturalmente tem letras: telas com interface, agendas, documentos, placas, painéis, cardápios, livros abertos. O gerador preenche isso com letras falsas. Prefira pessoas, objetos, ambientes, natureza, luz e metáforas visuais.

Direção:
- "camera": zoom-in, zoom-out, pan-left, pan-right, pan-up, pan-down, parallax ou static. Varie entre cenas.
- "transition" (entrada da cena): fade, zoom, slide, blur ou cut. Ritmo acelerado pede cut/slide; documental pede fade.
- "mood" da trilha: epico, inspirador, atmosferico, tenso, documental, publicitario ou tecnologico.
- "font": display, sans, serif ou mono. "palette": 3 cores hex (#rrggbb): fundo escuro, destaque, texto.
- "voice": {"gender": "feminina"|"masculina", "style": "comercial"|"documental"|"cinematografico"|"emocional"|"neutro"}.

Responda SOMENTE com o JSON, neste formato:
{"title":"...","objective":"...","audience":"...","look":"...","palette":["#..","#..","#.."],"font":"sans","mood":"inspirador","voice":{"gender":"feminina","style":"comercial"},"scenes":[{"narration":"...","onScreen":"...","image":"...","camera":"zoom-in","transition":"fade"}],"cta":"..."}`

function pedido(b: DirectorBrief): string {
  const formato = b.aspect === '9:16' ? 'vertical (celular, redes sociais)' : b.aspect === '1:1' ? 'quadrado (feed)' : 'horizontal (YouTube, apresentação)'
  const base = `Pedido: ${b.prompt}

Formato: ${formato}. Duração alvo: ${b.seconds} segundos.
${b.previous && b.feedback ? `Faça ${b.scenes} cenas, a menos que o usuário peça para excluir, duplicar ou mover cenas — aí siga o pedido.` : `Faça exatamente ${b.scenes} cenas.`} A narração inteira deve ter cerca de ${b.words} palavras (divida entre as cenas).`
  if (!b.previous || !b.feedback) return base
  // Duração nova pede fala nova: sem isso o modelo mantém o texto e o vídeo não encurta
  const atuais = narrationWords(b.previous)
  const cabe = atuais > b.words * 1.15
    ? `\n\nA DURAÇÃO MUDOU: a narração atual tem ${atuais} palavras e agora precisa ter cerca de ${b.words}. Reescreva as falas mais curtas, mantendo o sentido. A duração alvo de ${b.seconds} segundos vale mais que qualquer duração citada no pedido original.`
    : atuais < b.words * 0.7
      ? `\n\nA DURAÇÃO MUDOU: a narração atual tem ${atuais} palavras e agora precisa ter cerca de ${b.words}. Desenvolva as falas para preencher o tempo. A duração alvo de ${b.seconds} segundos vale mais que qualquer duração citada no pedido original.`
      : ''
  return `${base}

ESTA É UMA REVISÃO. Plano atual:
${JSON.stringify(b.previous)}

O que o usuário pediu para mudar: ${b.feedback}${cabe}

Mude só o que foi pedido e mantenha o resto igual (mesmas cenas, mesmas imagens), a menos que a mudança exija o contrário.`
}

/** Modelos para o roteiro, do melhor para o pior, só os gratuitos e conectados. */
async function modelos(): Promise<string[]> {
  const catalog = await getLiveCatalog()
  const ranked = rankModels(catalog, detectTask('escreva um roteiro criativo de vídeo em json')).map(m => m.id)
  const padrao = defaultModelFrom(catalog)
  return [...new Set([...ranked.slice(0, 4), padrao].filter(Boolean))]
}

export interface DirectorResult {
  plan: ProductionPlan
  model: string
}

/**
 * Pede o plano à IA. Tenta os melhores modelos em ordem; um JSON quebrado ganha
 * uma segunda chance no mesmo modelo, com o erro explicado.
 */
export async function direct(b: DirectorBrief, signal?: AbortSignal): Promise<DirectorResult> {
  const lista = await modelos()
  if (!lista.length) throw new Error('Nenhum modelo de IA disponível para escrever o roteiro. Configure uma chave gratuita em 🔑 Chaves de API.')

  const gender: VoiceGender | undefined = voiceGenderHint(b.prompt) ?? b.previous?.voice.gender
  const erros: string[] = []

  for (const model of lista) {
    const messages: ChatMessage[] = [{ role: 'system', content: SISTEMA }, { role: 'user', content: pedido(b) }]
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      try {
        const r = await defaultComplete(model, messages, signal, { json: true })
        const raw = extractJson(r.text)
        let plan = sanitizePlan(raw, { scenes: b.scenes, gender })
        if (plan.scenes.length < 2) throw new Error(`o plano veio com ${plan.scenes.length} cena(s)`)

        // Fala longa demais estoura a duração pedida: uma passada para enxugar,
        // mantendo cenas, imagens e direção. Se não melhorar, fica o original.
        const palavras = narrationWords(plan)
        if (palavras > b.words * 1.15) {
          try {
            const r2 = await defaultComplete(model, [
              ...messages,
              { role: 'assistant', content: JSON.stringify(plan) },
              { role: 'user', content: `A narração tem ${palavras} palavras e precisa caber em cerca de ${b.words}. Reescreva SÓ o campo "narration" de cada cena, mais curto e direto, sem perder o sentido. Mantenha todo o resto igual. Responda SOMENTE com o JSON completo.` },
            ], signal, { json: true })
            const enxuto = sanitizePlan(extractJson(r2.text), { scenes: b.scenes, gender })
            if (enxuto.scenes.length === plan.scenes.length && narrationWords(enxuto) < palavras) plan = enxuto
          } catch (e) {
            if ((e as Error).name === 'AbortError') throw e
            // Sem a passada extra, segue com o plano original: a duração fica maior, e a produção avisa
          }
        }
        return { plan, model }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        const msg = (e as Error).message
        erros.push(`${model.split('|').pop()}: ${msg}`)
        // JSON quebrado: mesma tentativa, explicando o erro; erro de rede: próximo modelo
        if (/JSON|cena/i.test(msg) && tentativa === 0) {
          messages.push({ role: 'user', content: `Sua resposta não pôde ser usada (${msg}). Responda de novo SOMENTE com o JSON completo, com ${b.scenes} cenas.` })
          continue
        }
        break
      }
    }
  }
  throw new Error(`Não consegui escrever o roteiro: ${erros.slice(-3).join(' · ')}`)
}
