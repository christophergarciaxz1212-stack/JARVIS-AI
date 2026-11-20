// Text utilities for the Hub: normalisation, BM25 search and Portuguese date extraction.

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const STOP = new Set('a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem e ou que se ao aos à às é foi ser ter tem sao são vai vou isso essa esse esta este aquele aquela eu voce você ele ela eles elas nos nós me te lhe mas mais menos muito pouco ja já ainda tambem também so só como quando onde qual quais quem the and of to in is it on for at by this that what tudo todo toda sobre ate até entre'.split(' ').map(normalize))

export function tokenize(s: string): string[] {
  return normalize(s).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t))
}

/** Okapi BM25 over in-memory documents. */
export class Bm25<T> {
  private docs: Array<{ doc: T; len: number; tf: Map<string, number> }> = []
  private df = new Map<string, number>()
  private avg = 0

  constructor(items: T[], text: (t: T) => string) {
    let total = 0
    for (const doc of items) {
      const toks = tokenize(text(doc))
      const tf = new Map<string, number>()
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
      this.docs.push({ doc, len: toks.length, tf })
      total += toks.length
    }
    this.avg = this.docs.length ? total / this.docs.length : 0
  }

  search(query: string, limit = 20): Array<{ doc: T; score: number }> {
    const q = [...new Set(tokenize(query))]
    if (!q.length) return []
    const N = this.docs.length
    const k1 = 1.4
    const b = 0.75
    const out: Array<{ doc: T; score: number }> = []
    for (const d of this.docs) {
      let s = 0
      for (const term of q) {
        // Prefix match lets "banc" find "banco", "prova" find "provas"
        let f = d.tf.get(term) || 0
        if (!f && term.length >= 4) for (const [t, n] of d.tf) if (t.startsWith(term) || term.startsWith(t) && t.length >= 4) f += n
        if (!f) continue
        const df = this.df.get(term) || 1
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / (this.avg || 1)))
      }
      if (s > 0) out.push({ doc: d.doc, score: s })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

export function snippet(text: string, query: string, size = 220) {
  const n = normalize(text)
  const terms = tokenize(query)
  let pos = -1
  for (const t of terms) { pos = n.indexOf(t); if (pos >= 0) break }
  if (pos < 0) return text.slice(0, size)
  const start = Math.max(0, pos - size / 3)
  return `${start > 0 ? '…' : ''}${text.slice(start, start + size)}${start + size < text.length ? '…' : ''}`
}

// ─── Academic signals ────────────────────────────────────────────────────────

const EXAM = /\b(prova|provas|avaliacao|avaliacoes|av1|av2|av3|avf|np1|np2|n1|n2|a1|a2|exame|simulado|recuperacao|teste avaliativo|segunda chamada)\b/
const TASK = /\b(trabalho|trabalhos|atividade|atividades|entrega|entregar|prazo|lista de exercicios|seminario|relatorio|projeto|tarefa|enviar ate|postar ate|data limite|deadline|resenha|estudo de caso|portfolio|apresentacao)\b/
const MATERIAL = /\b(material|materiais|slide|slides|apostila|pdf|gravacao|video aula|videoaula|leitura|capitulo|bibliografia|link da aula|conteudo da aula)\b/

export function academicSignals(text: string) {
  const n = normalize(text)
  return { exam: EXAM.test(n), task: TASK.test(n), material: MATERIAL.test(n) }
}

// ─── Dates in Portuguese ─────────────────────────────────────────────────────

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

export interface FoundDate {
  date: Date
  text: string
  hasTime: boolean
}

function withTime(d: Date, n: string, idx: number) {
  const after = n.slice(idx, idx + 40)
  const m = after.match(/(?:as|a partir das|ate as)?\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/)
  if (m && Number(m[1]) <= 23) {
    d.setHours(Number(m[1]), Number(m[2] || 0), 0, 0)
    return true
  }
  d.setHours(23, 59, 0, 0)
  return false
}

/** Finds dates in a message, resolved against the message's own date (`ref`). */
export function extractDates(text: string, ref: Date = new Date()): FoundDate[] {
  const n = normalize(text)
  const out: FoundDate[] = []
  const year = ref.getFullYear()

  const push = (d: Date, matchText: string, idx: number) => {
    if (isNaN(d.getTime())) return
    const hasTime = withTime(d, n, idx + matchText.length)
    out.push({ date: d, text: matchText.trim(), hasTime })
  }

  // 12/11, 12/11/2026, 12-11-26, 12.11
  for (const m of n.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)) {
    const dd = Number(m[1]); const mm = Number(m[2])
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue
    let yy = m[3] ? Number(m[3]) : year
    if (yy < 100) yy += 2000
    const d = new Date(yy, mm - 1, dd)
    // Without a year, a date far in the past most likely means next year
    if (!m[3] && d.getTime() < ref.getTime() - 120 * 86400_000) d.setFullYear(yy + 1)
    push(d, m[0], m.index!)
  }

  // 12 de novembro (de 2026)
  for (const m of n.matchAll(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?`, 'g'))) {
    const d = new Date(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[2]), Number(m[1]))
    if (!m[3] && d.getTime() < ref.getTime() - 120 * 86400_000) d.setFullYear(year + 1)
    push(d, m[0], m.index!)
  }

  // "dia 12" (this month, or next month if already past)
  for (const m of n.matchAll(/\bdia\s+(\d{1,2})\b(?!\s*(?:\/|de\s))/g)) {
    const dd = Number(m[1])
    if (dd < 1 || dd > 31) continue
    const d = new Date(year, ref.getMonth(), dd)
    if (d.getTime() < new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime()) d.setMonth(d.getMonth() + 1)
    push(d, m[0], m.index!)
  }

  const day0 = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const rel: Array<[RegExp, number]> = [[/\bdepois de amanha\b/, 2], [/\bamanha\b/, 1], [/\bhoje\b/, 0]]
  for (const [re, add] of rel) {
    const m = re.exec(n)
    if (m) { const d = new Date(day0); d.setDate(d.getDate() + add); push(d, m[0], m.index); break }
  }

  // "(na|nesta|próxima) sexta(-feira)"
  for (const m of n.matchAll(/\b(proxima|proximo|nesta|nessa|esta|essa|na|no|ate)\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\b/g)) {
    const target = WEEKDAYS.indexOf(m[2])
    const d = new Date(day0)
    let diff = (target - d.getDay() + 7) % 7
    if (diff === 0) diff = 7
    if (/proxim/.test(m[1]) && diff < 3) diff += 7
    d.setDate(d.getDate() + diff)
    push(d, m[0], m.index!)
  }

  // Bare weekday ("entrega sexta 23h"). "segunda" alone also means "second" (segunda chamada), so it needs "-feira".
  for (const m of n.matchAll(/\b(terca|quarta|quinta|sexta|sabado|domingo|segunda(?=-feira))(?:-feira)?\b/g)) {
    const target = WEEKDAYS.indexOf(m[1])
    const d = new Date(day0)
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7 || 7))
    push(d, m[0], m.index!)
  }

  const nextWeek = /\b(semana que vem|proxima semana)\b/.exec(n)
  if (nextWeek && !out.length) { const d = new Date(day0); d.setDate(d.getDate() + 7); push(d, nextWeek[0], nextWeek.index) }

  // Deduplicate same day
  const seen = new Set<string>()
  return out.filter(f => { const k = f.date.toDateString(); if (seen.has(k)) return false; seen.add(k); return true })
}

export function fmtDate(ms?: number) {
  if (!ms) return 'sem data'
  const d = new Date(ms)
  const time = d.getHours() === 23 && d.getMinutes() === 59 ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}${time}`
}
