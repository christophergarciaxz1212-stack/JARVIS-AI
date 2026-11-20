/**
 * Camada de compatibilidade para APIs "OpenAI-compatible" — que na prática divergem bastante:
 * - campos opcionais que uns aceitam e outros rejeitam com 400 (stream_options, reasoning_effort,
 *   response_format, tools, usage, parallel_tool_calls…);
 * - modelos que não aceitam a função "system" (Gemma, o1-mini, alguns via OpenRouter/NVIDIA);
 * - servidores que não fazem streaming;
 * - raciocínio dentro do texto (<think>…</think>) em vez de um campo separado;
 * - `content` como lista de partes ([{type:'text',text}, {type:'thinking',…}]) em vez de string.
 *
 * Cada recusa ensina uma "peculiaridade" ao par provedor|modelo: a chamada é refeita sem o campo
 * ofensivo e as próximas já saem certas, sem pagar o erro de novo.
 */

export type Quirk =
  | 'no_stream_options' | 'no_reasoning_effort' | 'no_response_format' | 'no_tools' | 'no_usage'
  | 'no_system_role' | 'no_stream' | `drop:${string}`

const learned = new Map<string, Set<Quirk>>()

export function quirksOf(key: string): Set<Quirk> {
  let s = learned.get(key)
  if (!s) { s = new Set(); learned.set(key, s) }
  return s
}

export function resetQuirks() { learned.clear() }

type Msg = { role: string; content: unknown }

/** Funde as instruções de sistema na primeira mensagem do usuário (para modelos sem "system"). */
export function mergeSystemIntoUser<T extends Msg>(messages: T[]): T[] {
  const system = messages.filter(m => m.role === 'system').map(m => String(m.content)).join('\n\n')
  const rest = messages.filter(m => m.role !== 'system')
  if (!system) return rest
  const i = rest.findIndex(m => m.role === 'user')
  if (i < 0) return [{ ...(messages[0]), role: 'user', content: system } as T, ...rest]
  return rest.map((m, j) => (j === i ? { ...m, content: `[Instruções]\n${system}\n\n[Mensagem]\n${String(m.content)}` } : m))
}

/** Aplica ao corpo da requisição o que já se sabe sobre este provedor|modelo. */
export function adaptBody(body: Record<string, unknown>, quirks: Set<Quirk>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  if (quirks.has('no_stream_options')) delete out.stream_options
  if (quirks.has('no_reasoning_effort')) delete out.reasoning_effort
  if (quirks.has('no_response_format')) delete out.response_format
  if (quirks.has('no_usage')) delete out.usage
  if (quirks.has('no_tools')) { delete out.tools; delete out.tool_choice; delete out.parallel_tool_calls }
  if (quirks.has('no_stream')) { out.stream = false; delete out.stream_options }
  for (const q of quirks) if (q.startsWith('drop:')) delete out[q.slice(5)]
  if (quirks.has('no_system_role') && Array.isArray(out.messages)) out.messages = mergeSystemIntoUser(out.messages as Msg[])
  return out
}

const KNOWN_FIELDS: Array<[RegExp, Quirk]> = [
  [/stream_options|include_usage/i, 'no_stream_options'],
  [/reasoning_effort|reasoning effort/i, 'no_reasoning_effort'],
  [/response_format|json_object|json mode|json_schema/i, 'no_response_format'],
  [/tool_choice|\btools?\b.*(not supported|unsupported|not enabled|does not support)|function calling|does not support tools/i, 'no_tools'],
  [/["'`]usage["'`]|\busage\b.*(unknown|not permitted|unrecognized)/i, 'no_usage'],
  [/system (role|message|prompt|instruction)s? (is |are )?(not |un)supported|role.{0,12}system.{0,40}(not |un)(supported|allowed)|developer instruction is not enabled|does not support system/i, 'no_system_role'],
]

/**
 * Lê o erro de uma requisição recusada e devolve a peculiaridade a contornar, ou null se o erro
 * não é de formato (chave inválida, cota, modelo inexistente… — esses vão para a troca de modelo).
 */
export function detectQuirk(err: unknown, body: Record<string, unknown>, quirks: Set<Quirk>): Quirk | null {
  const e = err as { status?: number; message?: string; error?: { message?: string } }
  const status = e?.status || 0
  const message = String(e?.error?.message || e?.message || err)
  // Só erros de validação do pedido; 401/403/404/429/5xx não se resolvem tirando campos
  if (status && status !== 400 && status !== 422) return null
  if (!status && !/invalid|unsupported|not supported|unrecognized|unknown|not permitted|extra inputs|not allowed/i.test(message)) return null

  for (const [re, quirk] of KNOWN_FIELDS) {
    if (quirks.has(quirk) || !re.test(message)) continue
    if (quirk === 'no_stream_options' && !('stream_options' in body)) continue
    if (quirk === 'no_reasoning_effort' && !('reasoning_effort' in body)) continue
    if (quirk === 'no_response_format' && !('response_format' in body)) continue
    if (quirk === 'no_tools' && !('tools' in body)) continue
    if (quirk === 'no_usage' && !('usage' in body)) continue
    if (quirk === 'no_system_role' && !(Array.isArray(body.messages) && (body.messages as Msg[]).some(m => m.role === 'system'))) continue
    return quirk
  }

  // Campo nomeado pelo servidor: "Unrecognized request argument supplied: foo", "unknown field `foo`",
  // "Extra inputs are not permitted ... 'foo'", "property 'foo' is unsupported"
  const named = message.match(/argument supplied:\s*([a-z_]+)/i)
    || message.match(/unknown (?:field|parameter|property|argument)[:\s]+[`'"]?([a-z_]+)/i)
    || message.match(/[`'"]([a-z_]+)[`'"]\s*(?:is not supported|is unsupported|not permitted|is not allowed|is not a valid)/i)
    || message.match(/(?:property|parameter|field)\s+[`'"]?([a-z_]+)[`'"]?\s+(?:is not supported|is unsupported|not permitted|is not allowed)/i)
  const field = named?.[1]
  if (field && field in body && !['model', 'messages'].includes(field) && !quirks.has(`drop:${field}`)) return `drop:${field}`

  // Servidor que não faz streaming
  if (body.stream === true && !quirks.has('no_stream') && /stream(ing)?\b.*(not supported|unsupported|not available|disabled)|does not support stream/i.test(message)) return 'no_stream'
  return null
}

/** Texto de um `content` que pode vir como string ou lista de partes. */
export function contentParts(content: unknown): { text: string; reasoning: string } {
  if (typeof content === 'string') return { text: content, reasoning: '' }
  if (!Array.isArray(content)) return { text: '', reasoning: '' }
  let text = ''
  let reasoning = ''
  for (const p of content as Array<Record<string, unknown>>) {
    if (!p || typeof p !== 'object') continue
    if (p.type === 'thinking' || p.type === 'reasoning') {
      const t = p.thinking ?? p.text ?? p.reasoning
      reasoning += Array.isArray(t) ? t.map(x => (x as { text?: string })?.text || '').join('') : String(t || '')
    } else if (typeof p.text === 'string') text += p.text
  }
  return { text, reasoning }
}

/**
 * Separa <think>…</think> (DeepSeek R1 e destilados, QwQ, alguns Qwen3 servidos como texto)
 * do texto da resposta, inclusive quando a marca chega partida entre dois pedaços do stream.
 */
export class ThinkSplitter {
  private buf = ''
  private inThink = false
  private seenText = false

  push(chunk: string): { text: string; reasoning: string } {
    this.buf += chunk
    let text = ''
    let reasoning = ''
    for (;;) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>')
        if (end < 0) {
          const keep = partialSuffix(this.buf, '</think>')
          reasoning += this.buf.slice(0, this.buf.length - keep)
          this.buf = this.buf.slice(this.buf.length - keep)
          break
        }
        reasoning += this.buf.slice(0, end)
        this.buf = this.buf.slice(end + 8)
        this.inThink = false
        continue
      }
      const start = this.seenText ? -1 : this.buf.indexOf('<think>')
      // Só um <think> no começo da resposta conta como raciocínio; no meio do texto é conteúdo
      if (start >= 0 && !this.buf.slice(0, start).trim()) {
        this.buf = this.buf.slice(start + 7)
        this.inThink = true
        continue
      }
      const keep = this.seenText ? 0 : partialSuffix(this.buf, '<think>')
      const out = this.buf.slice(0, this.buf.length - keep)
      if (out.trim()) this.seenText = true
      text += out
      this.buf = this.buf.slice(this.buf.length - keep)
      break
    }
    return { text, reasoning }
  }

  flush(): { text: string; reasoning: string } {
    const rest = this.buf
    this.buf = ''
    return this.inThink ? { text: '', reasoning: rest } : { text: rest, reasoning: '' }
  }
}

function partialSuffix(s: string, tag: string) {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n
  return 0
}

/** Remove o raciocínio em <think> de uma resposta completa (agentes precisam do JSON limpo). */
export function stripThink(text: string) {
  const s = new ThinkSplitter()
  const a = s.push(text)
  const b = s.flush()
  return (a.text + b.text).trim() || text.replace(/<\/?think>/g, '').trim()
}

/**
 * Aceita o endereço como o usuário colar: com ou sem barra final, com o caminho do endpoint
 * (…/chat/completions, …/models, …/messages) — devolve só a base da API.
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim()
  if (!url) throw new Error('Informe o endereço da API')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) throw new Error('Use um endereço http:// ou https://')
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(url) ? 'http' : 'https'}://${url}`
  let u: URL
  try { u = new URL(url) } catch { throw new Error('Endereço inválido — use algo como https://api.exemplo.com/v1') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Use um endereço http:// ou https://')
  u.hash = ''
  u.search = ''
  u.pathname = u.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models|messages|responses)$/i, '')
  return u.toString().replace(/\/+$/, '')
}

/** Motivo de parada que significa "o modelo não respondeu por filtro de conteúdo". */
export function emptyAnswerError(finishReason: string | null | undefined, model: string) {
  if (finishReason === 'content_filter' || finishReason === 'safety') return new Error(`${model}: resposta bloqueada pelo filtro de conteúdo do provedor`)
  return new Error(`${model}: o modelo terminou sem responder${finishReason ? ` (finish_reason=${finishReason})` : ''}`)
}
