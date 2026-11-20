import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { classifyModelError, streamAI } from '@/lib/ai/client'
import { formatSSE, SSE_HEARTBEAT } from '@/lib/ai/sse'
import { planRetry, shouldFallback } from '@/lib/ai/resilience'
import { analyzeImages, defaultModelFrom, detectTask, fallbackChain, getLiveCatalog, rankModels } from '@/lib/ai/catalog'
import { recordModelTest } from '@/lib/ai/modelTests'
import type { Usage } from '@/lib/agents/types'
import { getRuntime } from '@/lib/agents/runtime'
import { isProviderWideQuota, modelHealth } from '@/lib/agents/models'
import { engineChatContext, parseEngineCommand, runEngineCommand, slashSkill, type EngineCommand } from '@/lib/engine/chat'
import { hubChatContext, hubCommandRunner } from '@/lib/hub/hub'
import { mediaCommandRunner } from '@/lib/media/commands'
import { waCommandRunner } from '@/lib/wa/commands'
import { netlabCommandRunner } from '@/lib/netlab/commands'
import { localCommandRunner } from '@/lib/local/runner'
import { councilCommandRunner } from '@/lib/ai/council'
import { selfImproveRunner } from '@/lib/ai/selfImprove'
import { lastTopologyIn } from '@/lib/netlab/intent'
import { addContext, buildContextBlock, contextBudgetChars, listContext } from '@/lib/chat/context'
import { budgetTier, maxInputTokensFor } from '@/lib/ai/freeTier'
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateConversationTitle,
  updateSession,
} from '@/lib/db'
import { memoryCommandRunner, memorySystemContext } from '@/lib/chat/memory'
import { promptCraftContext } from '@/lib/chat/promptCraft'

// Older turns add input tokens (= latency) without helping much
// Teto do histórico; cada modelo recebe o quanto cabe na sua janela/cota (messagesFor)
const MAX_HISTORY = 80
const BASE_HISTORY = 30

// A function, not a constant: the server runs for days and the date must be the current one
const jarvisSystem = () => `Você é o JARVIS — um agente de IA pessoal. Você não é um assistente nem um chatbot: você é um agente que executa.

# Identidade
Você recebe uma ordem, decide o caminho e entrega o resultado. Seu produto é a tarefa concluída, não a explicação de como concluí-la.

# Leis de operação (cada uma verificável)
1. EXECUTE. No Modo Agente, pedido executável termina com o artefato pronto (arquivo criado, comando rodado, saída real). Tutorial só quando não existe ferramenta para executar.
2. EVIDÊNCIA. Nunca diga "criei", "rodei" ou "testei" sem um resultado de ferramenta nesta conversa. Sem execução, escreva "não executei" e o primeiro passo exato.
3. UMA PERGUNTA. No máximo uma pergunta por pedido, só para credencial, decisão ou autorização. O resto você resolve com o que já sabe.
4. ALTERNATIVA ANTES DE BLOQUEAR. Se um caminho falhar, tente outro (outro comando, outra API, outra rota). Só reporte bloqueio após 2 tentativas, citando o erro exato.
5. VERIFIQUE ANTES DE ENTREGAR. Releia o arquivo criado, confira a saída do comando e rode o teste quando existir. Se não deu para verificar, diga o que faltou.
6. ESCOPO E SEGURANÇA. Não apague nem sobrescreva fora do que foi pedido. Operação destrutiva, credencial ou MCP remoto: peça autorização; o resto, execute.
7. RELATE CURTO. Ao concluir uma tarefa executada, use exatamente os blocos FEITO, VERIFICADO e PENDENTE. Em pergunta ou conversa, responda direto, sem esses blocos. Nada de oferta genérica de ajuda.

# Execução de verdade
- Tarefas de arquivos, comandos, código, instalação, correção e investigação rodam no **Modo Agente** (ler/editar arquivos, terminal, Git, Skills). Lá você age em passos e cada um aparece no painel ao vivo.
- No Modo Agente você não pede permissão para o óbvio: executa, verifica e reporta. Operações destrutivas, credenciais e MCP remoto seguem a política de aprovação do app.
- Fora do Modo Agente você não tem ferramentas. Nesse caso diga em uma linha que a execução precisa do Modo Agente e entregue o primeiro passo exato — jamais simule que executou.

# Precisão (respostas corretas)
1. Responda exatamente o que foi perguntado: a resposta primeiro, depois o porquê. Pergunta simples, resposta curta.
2. Não invente nada: nomes, números, datas, versões, links, citações, leis, comandos ou APIs. Se não tiver certeza, diga o grau de certeza e como confirmar — "não sei" é melhor que um erro com confiança.
3. Contas, conversões e lógica: resolva passo a passo e confira o resultado antes de escrever (refaça a conta de outro jeito quando for importante).
4. Coisas que mudam com o tempo (preços, versões, notícias, cargos, regras): use a data atual abaixo e avise quando sua informação pode estar desatualizada.
5. Pergunta ambígua: responda a interpretação mais provável e diga em uma linha qual assumiu.
6. Código: completo e funcional para o caso pedido, com imports; sem pseudocódigo quando pediram código.
7. Antes de enviar, releia: responde à pergunta? números e nomes batem? nada contradiz o que o usuário disse antes na conversa?

# Memória
- Você TEM memória de longo prazo. Quando o usuário diz "lembre que…", o sistema guarda; "esqueça que…" apaga; "o que você lembra sobre mim?" lista.
- O bloco "Memória do usuário" (quando existir) traz o que ele pediu para lembrar: use sem que ele precise repetir. Nunca diga que não tem memória ou que esquece entre conversas.

# Estilo
- Português do Brasil, direto, sem preâmbulo, sem bajulação e sem encerrar com ofertas genéricas.
- Markdown quando útil (código, listas, tabelas).

Data e hora atual: ${new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}`

const ENGINE_MODEL = 'jarvis-engine'

const engineHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

interface ImageAttachment { name: string; mimeType: string; data: Buffer }

/** Valida anexos de imagem (máx. 2, JPEG/PNG/WebP, 2 MB decodificados cada). null = inválido. */
function decodeImageAttachments(raw: unknown): ImageAttachment[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > 2) return null
  const out: ImageAttachment[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null
    const rec = a as Record<string, unknown>
    const name = String(rec.name || 'imagem.jpg').slice(0, 120)
    if (typeof rec.data !== 'string' || rec.data.length > 3_000_000) return null
    let mime = String(rec.mimeType || '').toLowerCase()
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
      const ext = (name.toLowerCase().split('.').pop() || '')
      mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    }
    const data = Buffer.from(rec.data, 'base64')
    if (data.length < 32 || data.length > 2_200_000) return null
    out.push({ name, mimeType: mime, data })
  }
  return out
}

/** Runs a deterministic command (Skill Engine or Hub) and streams the answer with the same SSE contract as the model. */
function engineCommandResponse(opts: {
  command?: EngineCommand
  run?: () => Promise<string | null>
  conversationId: string
  assistantMsgId: string
  userText: string
  firstMessage: boolean
  /** Rótulo gravado como modelo na mensagem (padrão: ENGINE_MODEL). */
  model?: string
}) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(formatSSE(data))) } catch {}
      }
      const done = () => { try { controller.close() } catch {} }
      let answer = ''
      try {
        answer = (opts.run ? await opts.run() : await runEngineCommand(opts.command!)) || 'Feito.'
        // Small frames: the client paints while long catalogue answers arrive
        for (let i = 0; i < answer.length; i += 3500) {
          send({ type: 'chunk', content: answer.slice(i, i + 3500), conversationId: opts.conversationId, messageId: opts.assistantMsgId })
        }
        const model = opts.model || ENGINE_MODEL
        addMessage({
          id: opts.assistantMsgId,
          conversationId: opts.conversationId,
          role: 'assistant',
          content: answer,
          model,
        })
        if (opts.firstMessage) {
          updateConversationTitle(opts.conversationId, opts.userText.slice(0, 60) + (opts.userText.length > 60 ? '...' : ''))
        }
        send({ type: 'done', conversationId: opts.conversationId, messageId: opts.assistantMsgId, model: opts.model || ENGINE_MODEL })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Erro no Skill Engine'
        try {
          addMessage({
            id: opts.assistantMsgId,
            conversationId: opts.conversationId,
            role: 'assistant',
            content: `❌ **Erro:** ${msg}`,
            model: opts.model || ENGINE_MODEL,
          })
        } catch {}
        send({ type: 'error', message: msg, conversationId: opts.conversationId })
      } finally {
        done()
      }
    },
  })
  return new Response(stream, { headers: engineHeaders })
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0)
    if (contentLength > 8_500_000) {
      return Response.json({ error: 'Pedido grande demais (máx. 8 MB)' }, { status: 413 })
    }
    const body = await req.json()
    const {
      conversationId: existingId,
      message,
      model: requestedModel,
      projectId,
    } = body
    // Anexos de imagem (máx. 2, JPEG/PNG/WebP, 2 MB cada) — o chat entende o que você envia
    const imageAttachments = decodeImageAttachments(body.attachments)
    if (imageAttachments === null) {
      return Response.json({ error: 'Anexos inválidos: máx. 2 imagens JPEG/PNG/WebP de até 2 MB cada.' }, { status: 400 })
    }
    // Contexto jogado antes da conversa existir (arquivos/textos): vem junto da primeira mensagem
    const pendingContext = Array.isArray(body.context)
      ? (body.context as unknown[]).filter((c): c is { name?: string; text: string; kind?: string } => !!c && typeof (c as { text?: unknown }).text === 'string').slice(0, 20)
      : []
    if (!imageAttachments.length && !pendingContext.length && contentLength > 512_000) {
      return Response.json({ error: 'Mensagem grande demais (máx. 500 KB)' }, { status: 413 })
    }
    const savePendingContext = (id: string) => {
      if (pendingContext.length) addContext(id, pendingContext)
    }

    // The whole pipeline assumes a string message; reject anything else instead of crashing with a 500
    if (typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'Mensagem vazia' }, { status: 400 })
    }
    if (message.length > 32_000) {
      return Response.json({ error: 'Mensagem muito longa (máx. 32.000 caracteres)' }, { status: 400 })
    }
    if (existingId !== undefined && existingId !== null && !/^[\w-]+$/.test(String(existingId))) {
      return Response.json({ error: 'conversationId inválido' }, { status: 400 })
    }

    const userText = message.trim()
    const engineCommand = parseEngineCommand(userText)
    const lastTopology = existingId ? lastTopologyIn(getMessages(String(existingId)).map(m => m.content)) : undefined
    const hubRunner = engineCommand ? null : (memoryCommandRunner(userText) || hubCommandRunner(userText) || localCommandRunner(userText) || netlabCommandRunner(userText, lastTopology) || waCommandRunner(userText) || mediaCommandRunner(userText, imageAttachments) || councilCommandRunner(userText) || selfImproveRunner(userText))

    // Natural-language management of Skills/plugins/MCP and Hub commands never need a model,
    // so they work even with no provider configured and cost nothing.
    if (engineCommand || hubRunner) {
      const conversationId = existingId || uuidv4()
      const userMsgId = uuidv4()
      const assistantMsgId = uuidv4()
      const isNew = !existingId || !getConversation(conversationId)
      if (isNew) {
        createConversation(conversationId, ENGINE_MODEL, userText.slice(0, 60) + (userText.length > 60 ? '...' : ''), {
          projectId: typeof projectId === 'string' && projectId ? projectId : undefined,
          kind: 'chat',
        })
      } else {
        updateSession(conversationId, { status: 'active' })
      }
      const firstMessage = getMessages(conversationId).length === 0
      savePendingContext(conversationId)
      addMessage({ id: userMsgId, conversationId, role: 'user', content: userText })
      return engineCommandResponse({ command: engineCommand || undefined, run: hubRunner || undefined, conversationId, assistantMsgId, userText, firstMessage })
    }

    // Mensagem com imagem anexada e sem comando reconhecido: análise multimodal (Gemini)
    if (imageAttachments.length) {
      const conversationId = existingId || uuidv4()
      const userMsgId = uuidv4()
      const assistantMsgId = uuidv4()
      const isNew = !existingId || !getConversation(conversationId)
      if (isNew) {
        createConversation(conversationId, 'gemini|auto', userText.slice(0, 60) + (userText.length > 60 ? '...' : ''), {
          projectId: typeof projectId === 'string' && projectId ? projectId : undefined,
          kind: 'chat',
        })
      } else {
        updateSession(conversationId, { status: 'active' })
      }
      const firstMessage = getMessages(conversationId).length === 0
      savePendingContext(conversationId)
      addMessage({ id: userMsgId, conversationId, role: 'user', content: userText })
      const attachNote = imageAttachments.map(a => a.name).join(', ')
      const prompt = `O usuário anexou ${imageAttachments.length === 1 ? 'uma imagem' : `${imageAttachments.length} imagens`} nesta mensagem (${attachNote}). Analise o que está visível com detalhes concretos e responda ao pedido dele.\n\nPedido: ${userText}`
      return engineCommandResponse({
        run: async () => {
          const { text } = await analyzeImages(imageAttachments, prompt, jarvisSystem())
          return text || 'Não consegui interpretar a imagem.'
        },
        conversationId,
        assistantMsgId,
        userText,
        firstMessage,
        model: 'gemini|vision',
      })
    }

    // "Melhor IA automática": resolve o modelo pela tarefa no catálogo vivo.
    const catalog = await getLiveCatalog()
    const model =
      requestedModel === 'auto'
        ? rankModels(catalog, detectTask(userText))[0]?.id || ''
        : requestedModel || defaultModelFrom(catalog)
    let chain = fallbackChain(catalog, model)
    const conversationId = existingId || uuidv4()
    const userMsgId = uuidv4()
    const assistantMsgId = uuidv4()

    // Ensure conversation exists
    if (!existingId || !getConversation(conversationId)) {
      const text = String(message || '')
      createConversation(conversationId, model, text.slice(0, 60) + (text.length > 60 ? '...' : ''), {
        projectId: typeof projectId === 'string' && projectId ? projectId : undefined,
        kind: 'chat',
      })
    } else {
      updateSession(conversationId, { status: 'active' })
    }

    // Stoppable from the session list (Encerrar) as well as from the client disconnecting
    const rt = getRuntime()
    rt.chatStreams.get(conversationId)?.abort()
    const streamAbort = new AbortController()
    rt.chatStreams.set(conversationId, streamAbort)
    req.signal.addEventListener('abort', () => streamAbort.abort(), { once: true })

    // Load history
    const history = getMessages(conversationId)

    // Memória de longo prazo: tudo que o usuário pediu para lembrar (as mais relevantes primeiro)
    const memoryContext = memorySystemContext(userText) + promptCraftContext(userText)

    // "/skill pedido": the user activated an installed Skill for this message
    const slash = slashSkill(userText)

    // Build messages array
    const systemBase = jarvisSystem() + memoryContext + engineChatContext(userText) + hubChatContext(userText) + (slash?.context || '')
    const baseMessages = [
      { role: 'system' as const, content: systemBase },
      ...history.slice(-BASE_HISTORY).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: slash ? slash.message : userText },
    ]

    // Contexto da conversa (arquivos/textos jogados para a IA): cada modelo recebe o quanto cabe nele
    savePendingContext(conversationId)
    const contextItems = listContext(conversationId)
    const baseChars = baseMessages.reduce((n, m) => n + m.content.length, 0)
    const windowOf = (id: string) => catalog.flatMap(p => p.models).find(m => m.id === id)?.contextWindow
    const contextFor = (candidate: string) => buildContextBlock(contextItems, contextBudgetChars(candidate, windowOf(candidate), baseChars))
    if (contextItems.length && requestedModel === 'auto') {
      // Modo automático: modelos onde o material inteiro cabe vão primeiro (ordem original mantida)
      const fits = (c: string) => !contextFor(c).clipped
      chain = [...chain.filter(fits), ...chain.filter(c => !fits(c))]
    }
    // Memória da conversa sob medida para cada modelo: janelas grandes recebem até 80 mensagens;
    // cotas pequenas (Groq free) recebem só o que cabe — antes eram sempre 30, o que estourava a cota
    // de uns e desperdiçava a memória de outros
    const historyAll = history.slice(-MAX_HISTORY).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const messagesFor = (candidate: string) => {
      const system = systemBase + (contextItems.length ? contextFor(candidate).block : '')
      const last = { role: 'user' as const, content: slash ? slash.message : userText }
      const window = windowOf(candidate) || 32_000
      const tokens = Math.min(window * 0.7, maxInputTokensFor(budgetTier(candidate))) - 1_500
      let room = tokens * (4 / 1.15) - system.length - last.content.length
      const kept: typeof historyAll = []
      for (let i = historyAll.length - 1; i >= 0; i--) {
        const len = historyAll[i].content.length + 20
        // As 4 mais recentes sempre entram (sem elas a resposta perde o fio da conversa)
        if (len > room && kept.length >= 4) break
        kept.unshift(historyAll[i])
        room -= len
      }
      return [{ role: 'system' as const, content: system }, ...kept, last]
    }

    // Save user message
    addMessage({
      id: userMsgId,
      conversationId,
      role: 'user',
      content: userText,
    })

    // Stream response
    const encoder = new TextEncoder()
    const MAX_OUTPUT = 256_000
    // Prazo para o PRIMEIRO sinal do modelo (texto ou raciocínio); modelos locais carregam na GPU antes
    const FIRST_SIGNAL_CLOUD_MS = 45_000
    const FIRST_SIGNAL_LOCAL_MS = 120_000
    const HEARTBEAT_MS = 15_000
    let fullContent = ''

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(formatSSE(data))) } catch {}
        }
        // Modelos locais podem passar de 30s carregando sem enviar o primeiro byte;
        // o heartbeat impede que proxies e o app fechem a conexão ociosa.
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(SSE_HEARTBEAT)) } catch { clearInterval(heartbeat) }
        }, HEARTBEAT_MS)
        const close = () => {
          clearInterval(heartbeat)
          if (rt.chatStreams.get(conversationId) === streamAbort) rt.chatStreams.delete(conversationId)
          try { controller.close() } catch {}
        }
        // Espera cancelável: interromper a geração não deixa um timer pendente.
        const wait = (ms: number) => new Promise<void>(resolve => {
          if (streamAbort.signal.aborted) return resolve()
          const timer = setTimeout(finish, ms)
          function finish() {
            clearTimeout(timer)
            streamAbort.signal.removeEventListener('abort', onAbort)
            resolve()
          }
          function onAbort() { finish() }
          streamAbort.signal.addEventListener('abort', onAbort, { once: true })
        })

        let lastError: unknown = new Error('Nenhuma IA conectada. Clique no botão 🔑 Chaves de API para adicionar uma chave.')
        let saved = false
        let lastCandidate: string | undefined

        for (const candidate of chain) {
          // Provider whose daily/account quota is gone: its other models fail the same way — skip
          // them, unless every remaining candidate is in the same situation (then still try)
          const rest = chain.slice(chain.indexOf(candidate))
          if (modelHealth.providerCooling(candidate) && rest.some(c => !modelHealth.providerCooling(c))) continue
          let emitted = false
          let finalUsage: Usage | undefined
          let attempt = 0
          const startedAt = Date.now()
          lastCandidate = candidate
          if (candidate === chain[0]) send({ type: 'status', phase: 'connecting', model: candidate, conversationId })

          for (;;) {
            // Vigia da primeira resposta: um provedor que aceita a conexão e fica mudo (Gemini sob
            // demanda alta ficou 2 min assim) não pode segurar a mensagem — sem nenhum sinal (texto ou
            // raciocínio) no prazo, este modelo é abandonado e o próximo da cadeia assume.
            const attemptAbort = new AbortController()
            const relayAbort = () => attemptAbort.abort()
            streamAbort.signal.addEventListener('abort', relayAbort, { once: true })
            const silenceMs = /^(ollama|lmstudio)\|/.test(candidate) ? FIRST_SIGNAL_LOCAL_MS : FIRST_SIGNAL_CLOUD_MS
            let heard = false
            let stalled = false
            const watchdog = setTimeout(() => { if (!heard) { stalled = true; attemptAbort.abort() } }, silenceMs)
            const settle = () => { clearTimeout(watchdog); streamAbort.signal.removeEventListener('abort', relayAbort) }
            try {
              if (contextItems.length && attempt === 0) {
                // Diz à tela quanto do contexto este modelo recebeu (nada é cortado em silêncio)
                const c = contextFor(candidate)
                send({ type: 'context', model: candidate, items: contextItems.length, usedChars: c.usedChars, totalChars: c.totalChars, clipped: c.clipped, conversationId })
              }
              await streamAI(candidate, messagesFor(candidate), (chunk) => {
                if (chunk.content || chunk.reasoning) heard = true
                if (chunk.content) {
                  emitted = true
                  fullContent = (fullContent + chunk.content).slice(-MAX_OUTPUT)
                  send({ type: 'chunk', content: chunk.content, conversationId, messageId: assistantMsgId })
                }
                // Thinking is shown live but is not the answer: a model switch after it is still allowed
                if (chunk.reasoning) send({ type: 'reasoning', content: chunk.reasoning, conversationId, messageId: assistantMsgId })

                if (chunk.done) {
                  saved = true
                  finalUsage = chunk.usage
                  addMessage({
                    id: assistantMsgId,
                    conversationId,
                    role: 'assistant',
                    content: streamAbort.signal.aborted ? `${fullContent}\n\n_(resposta interrompida)_` : fullContent,
                    model: candidate,
                  })

                  if (history.length === 0) {
                    const title = userText.slice(0, 60) + (userText.length > 60 ? '...' : '')
                    updateConversationTitle(conversationId, title)
                  }

                  send({
                    type: 'done',
                    conversationId,
                    messageId: assistantMsgId,
                    model: candidate,
                    usage: finalUsage,
                    elapsedMs: Date.now() - startedAt,
                  })
                }
              }, attemptAbort.signal)
              settle()
              if (streamAbort.signal.aborted && fullContent && !saved) {
                saved = true
                addMessage({ id: assistantMsgId, conversationId, role: 'assistant', content: `${fullContent}\n\n_(resposta interrompida)_`, model: candidate })
              }
              close()
              return
            } catch (error) {
              settle()
              lastError = error
              if (streamAbort.signal.aborted) break
              if (stalled && !emitted) {
                const message = `${candidate.split('|').pop()} não respondeu em ${Math.round(silenceMs / 1000)} s`
                lastError = new Error(message)
                send({ type: 'status', phase: 'fallback', from: candidate, reason: 'timeout', message, conversationId })
                break
              }
              const info = classifyModelError(error)
              if (info.kind === 'rate_limit' && isProviderWideQuota(info.message)) {
                modelHealth.reportFailure(candidate, info.kind, info.message, info.retryAfterMs)
                if (!emitted) {
                  send({ type: 'status', phase: 'fallback', from: candidate, reason: info.kind, message: info.message, conversationId })
                  break
                }
              }
              // Depois que texto chegou ao usuário, repetir ou trocar emendaria duas respostas.
              if (emitted) break

              const plan = planRetry(info.kind, attempt + 1, { retryAfterMs: info.retryAfterMs })
              if (plan.retry) {
                attempt += 1
                send({
                  type: 'status',
                  phase: 'retry',
                  model: candidate,
                  attempt,
                  delayMs: plan.delayMs,
                  reason: info.kind,
                  message: info.message,
                  conversationId,
                })
                await wait(plan.delayMs)
                if (streamAbort.signal.aborted) break
                continue
              }

              // A falha definitiva de um modelo vira evidência no catálogo, como num teste.
              try { recordModelTest(candidate, { ok: false, error: info.message }) } catch {}
              if (shouldFallback(info.kind, emitted, false)) {
                send({
                  type: 'status',
                  phase: 'fallback',
                  from: candidate,
                  reason: info.kind,
                  message: info.message,
                  conversationId,
                })
              }
              break
            }
          }
        }

        if (streamAbort.signal.aborted) {
          if (fullContent && !saved) addMessage({ id: assistantMsgId, conversationId, role: 'assistant', content: `${fullContent}\n\n_(resposta interrompida)_`, model: lastCandidate })
          send({ type: 'error', message: 'Resposta interrompida', conversationId })
        } else {
          const message = lastError instanceof Error ? lastError.message : 'Erro desconhecido'
          // The user already read part of the answer: keep it in the history too
          if (fullContent && !saved) addMessage({ id: assistantMsgId, conversationId, role: 'assistant', content: `${fullContent}\n\n_(resposta incompleta: ${message})_`, model: lastCandidate })
          send({ type: 'error', message, conversationId })
        }
        close()
      },
      // Client went away → stop burning tokens on a response nobody will read
      cancel() {
        streamAbort.abort()
        if (rt.chatStreams.get(conversationId) === streamAbort) rt.chatStreams.delete(conversationId)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')

  if (!conversationId) {
    return Response.json({ error: 'conversationId required' }, { status: 400 })
  }

  try {
    const messages = getMessages(conversationId)
    return Response.json({ messages })
  } catch (error) {
    return Response.json({ error: 'Erro ao buscar mensagens' }, { status: 500 })
  }
}
