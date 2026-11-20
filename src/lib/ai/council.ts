/**
 * JARVIS AI Council: vários modelos respondem a mesma pergunta em paralelo;
 * um juiz consolida a melhor resposta. Cada resposta sai com latência real
 * medida e custo de token real — nada de ranking fictício.
 *
 * Uso no chat: `/council <pergunta>` (ou "/conselho").
 */
import { getLiveCatalog, rankModels, defaultModelFrom, fallbackChain } from '../ai/catalog'
import { completeOnce, classifyModelError } from '../ai/client'
import { budgetTier } from '../ai/freeTier'
import { modelHealth } from '../agents/models'
import type { ChatMessage } from '../agents/models'

export interface CouncilMember {
  model: string
  ok: boolean
  answer?: string
  error?: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

export interface CouncilResult {
  synthesis: string
  members: CouncilMember[]
  judgeModel?: string
  judgeFailed?: boolean
}

const PAID = /^(openai|anthropic|deepseek|xai)\|/
const MAX_ANSWER = 8_000
const ANSWER_TIMEOUT_MS = 20_000

const LOCAL = /^(ollama|lmstudio)\|/i

let modelsFn: () => Promise<string[]> = async () => {
  const catalog = await getLiveCatalog()
  const chain = fallbackChain(catalog, defaultModelFrom(catalog), 8)
  const ranked = rankModels(catalog, 'strong')
    .filter(m => m.free !== false && !PAID.test(m.id) && budgetTier(m.id) !== 'tiny')
    .map(m => m.id)
  // Distinct providers first: the council should not be one vendor talking to itself
  const byProvider = new Map<string, string>()
  for (const id of [...ranked, ...chain]) {
    const provider = id.slice(0, id.indexOf('|'))
    if (!byProvider.has(provider)) byProvider.set(provider, id)
  }
  const all = [...byProvider.values()]
  const cloud = all.filter(id => !LOCAL.test(id))
  // Locais só entram quando faltam especialistas cloud (modelos locais demoram demais para um painel rápido)
  return (cloud.length >= 2 ? cloud : [...cloud, ...all.filter(id => LOCAL.test(id))]).slice(0, 4)
}
let completeImpl: typeof completeOnce = completeOnce

/** Injetado pelos testes: modelos falsos + complete determinístico. */
export function setCouncilLlm(complete: typeof completeOnce, models?: () => Promise<string[]>) {
  completeImpl = complete
  if (models) modelsFn = models
}

async function ask(model: string, messages: ChatMessage[]): Promise<CouncilMember> {
  const started = Date.now()
  try {
    const c = await completeImpl(model, messages, AbortSignal.timeout(ANSWER_TIMEOUT_MS), { json: false })
    return {
      model, ok: true,
      answer: c.text.trim().slice(0, MAX_ANSWER),
      latencyMs: Date.now() - started,
      inputTokens: c.usage?.inputTokens, outputTokens: c.usage?.outputTokens,
    }
  } catch (e) {
    const cls = classifyModelError(e)
    modelHealth.reportFailure(model, cls.kind, cls.message, cls.retryAfterMs)
    return { model, ok: false, error: `${cls.kind}: ${cls.message}`, latencyMs: Date.now() - started }
  }
}

const CONSULTANT = `Você é um dos especialistas consultados pelo JARVIS. Responda à pergunta do usuário de forma direta, objetiva e completa, em português do Brasil, com no máximo 450 palavras. Seja preciso com fatos; se não tiver certeza de um dado, diga explicitamente "não sei". Não invente números, links ou APIs. Não mencione que você é um modelo de IA.`

const JUDGE = `Você é o árbitro de um conselho de especialistas. Recebe uma pergunta e as respostas de vários especialistas.
Sua tarefa: entregar UMA resposta final consolidada, correta e completa, em português do Brasil — sem citar os especialistas nem dizer que houve um "conselho" (a menos que a pergunta peça isso).
Regras:
- Se as respostas concordam, entregue a versão mais completa e limpa.
- Se divergem em fatos, aponte a divergência em uma linha e dê o veredicto com o argumento mais sólido.
- Se alguém disse "não sei", ignore essa resposta.
- Se todas falharem, diga honestamente que o conselho não conseguiu avaliar e por quê.`

export async function runCouncil(question: string): Promise<CouncilResult> {
  const models = (await modelsFn()).filter(m => modelHealth.state(m) !== 'unavailable')
  if (models.length < 2) throw new Error('Conselho precisa de pelo menos 2 modelos conectados. Verifique as Chaves de API.')

  const askMsgs: ChatMessage[] = [
    { role: 'system', content: CONSULTANT },
    { role: 'user', content: question },
  ]
  const members = await Promise.all(models.map(m => ask(m, askMsgs)))
  const ok = members.filter(m => m.ok && m.answer)
  if (!ok.length) {
    return {
      synthesis: `Nenhum dos ${members.length} modelos consultados conseguiu responder agora:\n${members.map(m => `- ${m.model.split('|').pop()}: ${m.error}`).join('\n')}\n\nTente novamente em instantes ou confira as Chaves de API.`,
      members, judgeFailed: true,
    }
  }

  const judge = ok[0].model
  const judgeInput = [
    { role: 'system' as const, content: JUDGE },
    {
      role: 'user' as const,
      content: `# Pergunta\n${question}\n\n${ok.map((m, i) => `# Especialista ${i + 1}\n${m.answer}`).join('\n\n')}`,
    },
  ]
  try {
    const started = Date.now()
    const c = await completeImpl(judge, judgeInput, AbortSignal.timeout(ANSWER_TIMEOUT_MS), { json: false })
    modelHealth.reportLatency(judge, Date.now() - started)
    return { synthesis: c.text.trim(), members, judgeModel: judge }
  } catch {
    // O juiz falhou: entrega a resposta mais rápida e honesta, dizendo de onde veio
    const fastest = [...ok].sort((a, b) => a.latencyMs - b.latencyMs)[0]
    return {
      synthesis: `**${fastest.model.split('|').pop()}** (o árbitro não pôde consolidar):\n\n${fastest.answer}`,
      members, judgeModel: judge, judgeFailed: true,
    }
  }
}

const shortModel = (m: string) => m.split('|').pop() || m
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)

export function formatCouncil(result: CouncilResult): string {
  const okCount = result.members.filter(m => m.ok).length
  const lines = [
    `## 🏛️ Conselho do JARVIS — ${okCount}/${result.members.length} modelos responderam`,
    '',
    result.synthesis,
    '',
    '---',
    '**Modelos consultados**',
    ...result.members.map(m => m.ok
      ? `- \`${shortModel(m.model)}\` — ${fmtMs(m.latencyMs)} · ${(m.inputTokens ?? 0) + (m.outputTokens ?? 0)} tokens`
      : `- \`${shortModel(m.model)}\` — ❌ ${m.error}`),
  ]
  const answers = result.members.filter(m => m.ok && m.answer)
  if (answers.length) {
    lines.push('', '<details><summary>Ver respostas individuais</summary>', '')
    for (const m of answers) {
      lines.push(`### ${shortModel(m.model)}`, m.answer!, '')
    }
    lines.push('</details>')
  }
  return lines.join('\n')
}

const COUNCIL_RE = /^\/(?:council|conselho)(?:\s+([\s\S]+))?$/i

/** `/council <pergunta>`: fan-out determinístico; nunca depende de o modelo decidir usar uma ferramenta. */
export function councilCommandRunner(message: string): (() => Promise<string>) | null {
  const m = COUNCIL_RE.exec(message.trim())
  if (!m) return null
  const question = (m[1] || '').trim()
  if (question.length < 4) {
    return async () => '**Uso:** `/council <pergunta>` — consulto vários modelos e consolido a melhor resposta.\nEx.: `/council qual a complexidade de trocar o banco de produção de Postgres por SQLite?`'
  }
  return async () => formatCouncil(await runCouncil(question))
}
