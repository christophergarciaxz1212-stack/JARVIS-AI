/**
 * Busca na web e leitura de páginas para o agente.
 *
 * Rotas, da melhor para a que sempre funciona:
 *  1. Brave Search API — lista de resultados de verdade. Plano gratuito (2.000
 *     buscas/mês) em brave.com/search/api; usa `BRAVE_SEARCH_API_KEY` se existir.
 *  2. Sem chave: APIs oficiais e abertas — resposta direta do DuckDuckGo e busca
 *     na Wikipédia. Não substituem uma busca completa, e o agente é avisado disso.
 *
 * Nada aqui raspa HTML de buscador: além de frágil (eles servem captcha para
 * tráfego automatizado), seria contra os termos de uso.
 */

export interface WebResult {
  title: string
  url: string
  snippet: string
}

export interface SearchOutcome {
  results: WebResult[]
  /** De onde vieram os resultados, para o agente saber o que tem em mãos. */
  source: 'brave' | 'aberta'
  /** Aviso a repassar quando a rota é limitada. */
  note?: string
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT = 20_000

async function getJson<T>(url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json() as T
  } finally {
    clearTimeout(timer)
  }
}

const clean = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// ─── Brave ───────────────────────────────────────────────────────────────────

interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
}

async function braveSearch(query: string, limit: number, key: string, signal?: AbortSignal): Promise<WebResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`
  const d = await getJson<BraveResponse>(url, { 'X-Subscription-Token': key }, signal)
  return (d.web?.results || []).map(r => ({
    title: clean(r.title) || r.url || '',
    url: String(r.url || ''),
    snippet: clean(r.description),
  })).filter(r => r.url)
}

// ─── Sem chave: APIs oficiais abertas ────────────────────────────────────────

interface DdgResponse {
  Abstract?: string
  AbstractURL?: string
  Heading?: string
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>
}

async function duckInstant(query: string, signal?: AbortSignal): Promise<WebResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const d = await getJson<DdgResponse>(url, {}, signal)
  const out: WebResult[] = []
  if (d.Abstract && d.AbstractURL) {
    out.push({ title: clean(d.Heading) || query, url: d.AbstractURL, snippet: clean(d.Abstract) })
  }
  // RelatedTopics mistura itens soltos e grupos aninhados
  const flat = (d.RelatedTopics || []).flatMap(t => (t.Topics?.length ? t.Topics : [t]))
  for (const t of flat) {
    if (!t.FirstURL || !t.Text) continue
    out.push({ title: clean(t.Text).slice(0, 90), url: t.FirstURL, snippet: clean(t.Text) })
  }
  return out
}

interface WikiResponse {
  query?: { search?: Array<{ title?: string; snippet?: string }> }
}

async function wikipediaSearch(query: string, limit: number, lang = 'pt', signal?: AbortSignal): Promise<WebResult[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}&origin=*`
  const d = await getJson<WikiResponse>(url, {}, signal)
  return (d.query?.search || []).map(r => ({
    title: clean(r.title),
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(r.title || '').replace(/ /g, '_'))}`,
    snippet: clean(r.snippet),
  }))
}

const SEM_CHAVE = 'Busca aberta (resposta direta + Wikipédia): cobre fatos e conceitos, não a web inteira. Para resultados completos, o usuário pode gerar uma chave gratuita em brave.com/search/api e salvá-la como BRAVE_SEARCH_API_KEY em 🔑 Chaves de API.'

/** Busca na web pela melhor rota disponível. */
export async function webSearch(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchOutcome> {
  const q = query.trim()
  if (!q) throw new Error('Informe o que procurar')
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10)

  const key = (process.env.BRAVE_SEARCH_API_KEY || '').trim()
  if (key) {
    try {
      const results = await braveSearch(q, limit, key, opts.signal)
      if (results.length) return { results, source: 'brave' }
    } catch {
      // Chave inválida, cota estourada ou fora do ar: cai para a rota aberta.
    }
  }

  const [instant, wiki] = await Promise.allSettled([
    duckInstant(q, opts.signal),
    wikipediaSearch(q, limit, 'pt', opts.signal),
  ])
  const results = [
    ...(instant.status === 'fulfilled' ? instant.value : []),
    ...(wiki.status === 'fulfilled' ? wiki.value : []),
  ]
  // Mesma página por duas rotas conta uma vez só
  const seen = new Set<string>()
  const unique = results.filter(r => !seen.has(r.url) && seen.add(r.url)).slice(0, limit)
  return { results: unique, source: 'aberta', note: SEM_CHAVE }
}

// ─── Leitura de página ───────────────────────────────────────────────────────

const BLOCK_TAGS = /<\/(?:p|div|section|article|h[1-6]|li|tr|br)>/gi
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
}

/** HTML para texto legível: tira script/estilo/marcação e normaliza o espaçamento. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, '')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#\d+;/gi, m => ENTITIES[m.toLowerCase()] ?? ' ')
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Endereços que o `web_fetch` não busca: a própria máquina, a rede local e o
 * serviço de metadados das nuvens.
 *
 * O agente escolhe URLs a partir de buscas e de páginas que leu, e uma página
 * pode trazer instrução injetada. A requisição sai do servidor Node, sem Origin
 * nem sec-fetch-site, então o middleware de CSRF do JARVIS a aceitaria: sem
 * esta barreira, bastava uma página pedir `http://127.0.0.1:3001/api/...` para
 * a própria API do JARVIS ser lida de dentro.
 */
export function isInternalHost(hostname: string): boolean {
  let h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  // IPv4-mapeado em IPv6 (::ffff:127.0.0.1): normaliza para IPv4 antes da checagem
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  if (v4mapped) h = v4mapped[1]
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '0.0.0.0') return true
  // IPv6 local: ::1, fc00::/7 (único/local), fe80::/10 (link-local)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!v4) return false
  const [a, b] = v4.slice(1).map(Number)
  if (a === 127 || a === 0 || a === 10) return true           // loopback, "este host", privada
  if (a === 192 && b === 168) return true                      // privada
  if (a === 172 && b >= 16 && b <= 31) return true             // privada
  if (a === 169 && b === 254) return true                      // link-local e metadados de nuvem
  if (a === 100 && b >= 64 && b <= 127) return true            // CGNAT (VPNs, containers)
  return false
}

export interface PageContent {
  url: string
  title: string
  text: string
  truncated: boolean
}

const MAX_PAGE = 20_000

/** Busca uma página e devolve o texto legível. Só http/https. */
export async function webFetch(rawUrl: string, opts: { signal?: AbortSignal } = {}): Promise<PageContent> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Endereço inválido')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Só endereços http e https')
  if (isInternalHost(url.hostname)) {
    throw new Error(`"${url.hostname}" é um endereço da própria máquina ou da rede local — web_fetch só busca na internet pública. Para ler um arquivo do projeto use read_file.`)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
  let current = url
  try {
    // Redirects seguidos manualmente, validando cada salto contra a lista de
    // endereços internos: sem 302 para 127.0.0.1/metadados de nuvem (ALT-3).
    for (let hop = 0; hop < 4; hop++) {
      const r = await fetch(current, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain,*/*' }, signal: ctrl.signal, redirect: 'manual' })
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        const next = new URL(r.headers.get('location')!, current)
        try { r.body?.cancel?.() } catch {}
        if (isInternalHost(next.hostname)) throw new Error(`Redirecionamento para endereço interno não permitido: ${next.hostname}`)
        current = next
        continue
      }
      if (!r.ok) throw new Error(`A página respondeu HTTP ${r.status}`)
      const type = r.headers.get('content-type') || ''
      if (!/text\/|json|xml/.test(type)) throw new Error(`Conteúdo não é texto (${type.split(';')[0] || 'desconhecido'})`)

      const raw = await r.text()
      const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]) || current.hostname
      const text = /html/i.test(type) ? htmlToText(raw) : raw
      return {
        url: r.url || current.toString(),
        title,
        text: text.slice(0, MAX_PAGE),
        truncated: text.length > MAX_PAGE,
      }
    }
    throw new Error('Redirecionamento demais (máx. 4)')
  } finally {
    clearTimeout(timer)
  }
}

/** Formata o resultado da busca para o agente ler. */
export function formatSearch(outcome: SearchOutcome): string {
  if (!outcome.results.length) return `Nenhum resultado.${outcome.note ? `\n${outcome.note}` : ''}`
  const lines = outcome.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
  return `${lines.join('\n\n')}${outcome.note ? `\n\n(${outcome.note})` : ''}`
}
