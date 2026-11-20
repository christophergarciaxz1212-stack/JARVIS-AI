import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { extractTarGz } from '../engine/sandbox'
import { runProcess } from '../engine/sandbox'
import { hubDir } from './store'
import { fetchPublicText } from '../net'
import type { HubItem, HubSource } from './types'

export const hash = (...parts: unknown[]) => crypto.createHash('sha1').update(parts.map(String).join('|')).digest('hex').slice(0, 16)

const strip = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '')

// ─── ZIP (Windows bsdtar reads .zip too) ─────────────────────────────────────

export async function unzip(file: string): Promise<string> {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hub-import-'))
  const sys = process.env.SystemRoot || 'C:\\Windows'
  const r = await runProcess(`${sys}\\System32\\tar.exe`, ['-xf', file, '-C', dest], { cwd: dest, env: { SystemRoot: sys, PATH: `${sys}\\System32` }, timeoutMs: 300_000 })
  if (r.code !== 0) throw new Error(`Não consegui abrir o arquivo compactado: ${r.stderr.slice(0, 200)}`)
  return dest
}

export function walkFiles(dir: string, max = 5000, depth = 8): string[] {
  const out: string[] = []
  const walk = (d: string, level: number) => {
    if (level > depth || out.length >= max) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, level + 1)
      else out.push(abs)
      if (out.length >= max) return
    }
  }
  walk(dir, 0)
  return out
}

// ─── WhatsApp chat export ────────────────────────────────────────────────────

const ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([AaPp])\.?\s?[Mm]\.?)?\s+-\s+(.*)$/
const IOS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([AaPp])\.?\s?[Mm]\.?)?\]\s+(.*)$/
const ATTACH = [
  /^(.+?\.[a-z0-9]{2,5})\s+\((?:arquivo anexado|file attached)\)/i,
  /<anexado:\s*(.+?)>/i,
  /<attached:\s*(.+?)>/i,
]
const OMITTED = /<(arquivo de m[ií]dia oculto|media omitted|m[ií]dia oculta)>/i

export interface WhatsAppMessage { at: number; author: string; text: string; attachments: string[] }

export function parseWhatsAppExport(raw: string): WhatsAppMessage[] {
  const out: WhatsAppMessage[] = []
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = strip(lineRaw)
    const m = ANDROID.exec(line) || IOS.exec(line)
    if (m) {
      let [, dd, mm, yy, hh, mi, ss, ampm, rest] = m
      let year = Number(yy)
      if (year < 100) year += 2000
      let hour = Number(hh)
      if (ampm && /p/i.test(ampm) && hour < 12) hour += 12
      if (ampm && /a/i.test(ampm) && hour === 12) hour = 0
      const at = new Date(year, Number(mm) - 1, Number(dd), hour, Number(mi), Number(ss || 0)).getTime()
      const sep = rest.indexOf(': ')
      // Lines without "author: " are system notices (someone joined, group renamed…)
      if (sep < 0) continue
      out.push({ at, author: rest.slice(0, sep).trim(), text: rest.slice(sep + 2), attachments: [] })
    } else if (out.length && line.trim()) {
      out[out.length - 1].text += `\n${line}`
    }
  }
  for (const msg of out) {
    for (const re of ATTACH) {
      const a = re.exec(msg.text)
      if (a) msg.attachments.push(a[1].trim())
    }
    if (OMITTED.test(msg.text)) msg.attachments.push('(mídia não incluída na exportação)')
  }
  return out
}

export async function importWhatsApp(filePath: string, chatNameInput?: string): Promise<{ items: HubItem[]; chat: string; attachmentsSaved: number }> {
  let txt = filePath
  let mediaDir = ''
  let tmp = ''
  if (/\.zip$/i.test(filePath)) {
    tmp = await unzip(filePath)
    const found = walkFiles(tmp).find(f => /\.txt$/i.test(f))
    if (!found) throw new Error('O .zip não contém o .txt da conversa')
    txt = found
    mediaDir = path.dirname(found)
  }
  const base = path.basename(filePath).replace(/\.(zip|txt)$/i, '')
  const chat = (chatNameInput || base.replace(/^(conversa do whatsapp com|whatsapp chat with|whatsapp chat -)\s*/i, '')).trim() || 'WhatsApp'
  const messages = parseWhatsAppExport(fs.readFileSync(txt, 'utf-8'))
  if (!messages.length) throw new Error('Não reconheci mensagens nesse arquivo. Use “Exportar conversa” do WhatsApp (com ou sem mídia).')

  // Attachments go to the Hub's own folder so they stay available after the temp folder is removed
  let saved = 0
  const store = path.join(hubDir(), 'files', 'whatsapp', hash(chat))
  const items = messages.map((m, i) => {
    const attachments = m.attachments.map(name => {
      if (!mediaDir || name.startsWith('(')) return { name }
      const src = path.join(mediaDir, path.basename(name))
      if (!fs.existsSync(src)) return { name }
      fs.mkdirSync(store, { recursive: true })
      const dest = path.join(store, path.basename(name))
      if (!fs.existsSync(dest)) { fs.copyFileSync(src, dest); saved++ }
      return { name: path.basename(name), path: dest, type: path.extname(name).slice(1).toLowerCase() }
    })
    const item: HubItem = {
      id: `wa-${hash(chat, m.at, m.author, i)}`,
      source: 'whatsapp',
      kind: attachments.length && /\.(pdf|docx?|pptx?|xlsx?)$/i.test(attachments[0].name) ? 'material' : 'message',
      title: `${m.author} em ${chat}`,
      text: m.text.slice(0, 8000),
      origin: { source: 'whatsapp', where: chat, author: m.author, at: m.at, ref: `exportação · mensagem ${i + 1}` },
      attachments,
      importedAt: Date.now(),
    }
    return item
  })
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  return { items, chat, attachmentsSaved: saved }
}

// ─── ChatGPT data export (conversations.json) ────────────────────────────────

interface GptNode { id: string; parent?: string | null; message?: { author?: { role?: string }; content?: { content_type?: string; parts?: unknown[]; text?: string }; create_time?: number | null } | null }
interface GptConversation { id?: string; conversation_id?: string; title?: string; create_time?: number; update_time?: number; mapping?: Record<string, GptNode>; current_node?: string }

function gptThread(c: GptConversation) {
  const mapping = c.mapping || {}
  const out: Array<{ role: string; text: string }> = []
  let node = c.current_node ? mapping[c.current_node] : undefined
  const seen = new Set<string>()
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    const m = node.message
    const role = m?.author?.role
    const parts = m?.content?.parts?.filter((p): p is string => typeof p === 'string') || (m?.content?.text ? [m.content.text] : [])
    const text = parts.join('\n').trim()
    if (text && (role === 'user' || role === 'assistant')) out.unshift({ role, text })
    node = node.parent ? mapping[node.parent] : undefined
  }
  return out
}

export function parseChatGptExport(json: unknown): HubItem[] {
  const list = (Array.isArray(json) ? json : []) as GptConversation[]
  return list.map((c, i) => {
    const thread = gptThread(c)
    const text = thread.map(t => `${t.role === 'user' ? 'Você' : 'ChatGPT'}: ${t.text}`).join('\n\n')
    const id = c.id || c.conversation_id || hash('gpt', c.title, c.create_time, i)
    return {
      id: `gpt-${id}`,
      source: 'chatgpt' as HubSource,
      kind: 'conversation' as const,
      title: c.title || 'Conversa sem título',
      text: text.slice(0, 30_000),
      origin: { source: 'chatgpt' as HubSource, where: `ChatGPT (exportação oficial) › ${c.title || 'sem título'}`, at: ((c.update_time || c.create_time || 0) * 1000) || undefined, ref: id },
      meta: { messages: thread.length, hasCode: /```/.test(text), access: 'exportação' },
      importedAt: Date.now(),
    }
  }).filter(i => i.text)
}

export async function importChatGpt(filePath: string): Promise<HubItem[]> {
  let file = filePath
  let tmp = ''
  if (/\.zip$/i.test(filePath)) {
    tmp = await unzip(filePath)
    const found = walkFiles(tmp).find(f => /conversations\.json$/i.test(f))
    if (!found) throw new Error('O .zip não contém conversations.json (use a exportação oficial: Configurações › Controles de dados › Exportar)')
    file = found
  }
  try {
    return parseChatGptExport(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ─── Gemini (Google Takeout › "Atividade nos apps do Gemini") ────────────────

const htmlText = (h: string) => h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()

export function parseGeminiActivity(content: string, isJson: boolean): HubItem[] {
  if (isJson) {
    const list = JSON.parse(content) as Array<{ header?: string; title?: string; time?: string; safeHtmlItem?: Array<{ html?: string }>; subtitles?: Array<{ name?: string }> }>
    return list.filter(e => e.title).map((e, i) => {
      const prompt = String(e.title).replace(/^(perguntou|prompted|você perguntou|asked)[:\s]*/i, '').trim()
      const answer = (e.safeHtmlItem || []).map(x => htmlText(x.html || '')).join('\n').trim()
      const at = e.time ? Date.parse(e.time) : undefined
      return {
        id: `gem-${hash(e.time, prompt, i)}`,
        source: 'gemini' as HubSource,
        kind: 'conversation' as const,
        title: prompt.slice(0, 140) || 'Atividade do Gemini',
        text: `Você: ${prompt}${answer ? `\n\nGemini: ${answer}` : ''}`.slice(0, 30_000),
        origin: { source: 'gemini' as HubSource, where: 'Gemini (Google Takeout)', at, ref: e.time },
        meta: { access: 'exportação', hasCode: /```|<code>/.test(answer) },
        importedAt: Date.now(),
      }
    })
  }
  // HTML Takeout: one "outer-cell" block per activity
  const blocks = content.split(/<div class="outer-cell/).slice(1)
  return blocks.map((b, i) => {
    const text = htmlText(`<div ${b}`)
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean).filter(l => !/^(gemini apps|apps do gemini|produtos:|products:)/i.test(l))
    const prompt = (lines[0] || '').replace(/^(perguntou|prompted|você perguntou|asked)[:\s]*/i, '')
    const dateLine = lines.find(l => /\d{4}/.test(l) && /\d{1,2}:\d{2}/.test(l))
    return {
      id: `gem-${hash(prompt, dateLine, i)}`,
      source: 'gemini' as HubSource,
      kind: 'conversation' as const,
      title: prompt.slice(0, 140) || 'Atividade do Gemini',
      text: lines.join('\n').slice(0, 30_000),
      origin: { source: 'gemini' as HubSource, where: 'Gemini (Google Takeout)', ref: dateLine },
      meta: { access: 'exportação' },
      importedAt: Date.now(),
    }
  }).filter(i => i.text.length > 3)
}

export async function importGemini(filePath: string): Promise<HubItem[]> {
  let tmp = ''
  let file = filePath
  if (/\.zip$/i.test(filePath)) {
    tmp = await unzip(filePath)
    const files = walkFiles(tmp)
    const found = files.find(f => /gemini/i.test(f) && /\.json$/i.test(f)) || files.find(f => /gemini/i.test(f) && /\.html?$/i.test(f))
    if (!found) throw new Error('Não encontrei a atividade do Gemini no Takeout (marque “Apps do Gemini” em Minha atividade)')
    file = found
  }
  try {
    return parseGeminiActivity(fs.readFileSync(file, 'utf-8'), /\.json$/i.test(file))
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ─── Calendars (iCal/ICS feed or file) ───────────────────────────────────────

function icsDate(value: string, params: string): number | undefined {
  const v = value.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s, z] = m
  if (!h) return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0).getTime()
  if (z) return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  void params // TZID times are treated as local time (the student's own timezone)
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
}

export function parseIcs(raw: string, calendarName: string): HubItem[] {
  const lines = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const out: HubItem[] = []
  let ev: Record<string, { value: string; params: string }> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue }
    if (line === 'END:VEVENT' && ev) {
      const start = ev.DTSTART ? icsDate(ev.DTSTART.value, ev.DTSTART.params) : undefined
      const unescape = (s?: string) => (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';')
      const title = unescape(ev.SUMMARY?.value) || 'Evento'
      out.push({
        id: `cal-${hash(calendarName, ev.UID?.value || title, start)}`,
        source: 'calendar',
        kind: 'event',
        title,
        text: [title, unescape(ev.DESCRIPTION?.value), ev.LOCATION ? `Local: ${unescape(ev.LOCATION.value)}` : ''].filter(Boolean).join('\n'),
        origin: { source: 'calendar', where: calendarName, at: start, ref: ev.UID?.value, url: ev.URL?.value },
        meta: { start, end: ev.DTEND ? icsDate(ev.DTEND.value, ev.DTEND.params) : undefined },
        importedAt: Date.now(),
      })
      ev = null
      continue
    }
    if (!ev) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const [name, ...params] = line.slice(0, idx).split(';')
    ev[name.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(';') }
  }
  return out
}

export async function fetchIcs(url: string): Promise<string> {
  const u = url.replace(/^webcal:/i, 'https:')
  if (!/^https:\/\//i.test(u)) throw new Error('Use o link iCal (https:// ou webcal://) do seu calendário')
  // SSRF guard: https only, no private/reserved hosts (blocks cloud metadata endpoints), redirects re-checked, body capped
  return fetchPublicText(u, { maxBytes: 8 * 1024 * 1024, timeoutMs: 20_000 })
}

// ─── Local materials folder ──────────────────────────────────────────────────

async function officeText(file: string): Promise<string> {
  const tmp = await unzip(file).catch(() => '')
  if (!tmp) return ''
  try {
    const xmls = walkFiles(tmp).filter(f => /(word[\\/]document\.xml|ppt[\\/]slides[\\/]slide\d+\.xml)$/i.test(f))
    return xmls.map(x => fs.readFileSync(x, 'utf-8').replace(/<\/w:p>|<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).join('\n').slice(0, 20_000)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function decodePdfString(value: string) {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue }
    const next = value[i + 1]
    if (!next) { out += '\\'; break }
    if (/[nrtbf()\\]/.test(next)) {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
      out += map[next] ?? next
      i += 1
      continue
    }
    if (/[0-7]/.test(next)) {
      let octal = next
      let j = i + 2
      while (j < value.length && value[j] && /[0-7]/.test(value[j]) && octal.length < 3) { octal += value[j]; j++ }
      out += String.fromCharCode(parseInt(octal, 8))
      i = j - 1
      continue
    }
    out += next
    i += 1
  }
  return out.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function extractTextFromPdf(file: string): Promise<string> {
  const raw = fs.readFileSync(file)
  const text = raw.toString('latin1')
  const markers: string[] = []
  for (const match of text.matchAll(/\((?:\\.|[^()\\])*\)/g)) {
    const s = match[0].slice(1, -1)
    markers.push(decodePdfString(s))
  }
  const joined = markers.filter(Boolean).join(' ')
  if (joined) return joined.slice(0, 20_000)
  return ''
}

export async function indexFolder(folder: string): Promise<HubItem[]> {
  if (!fs.existsSync(folder)) throw new Error(`Pasta não encontrada: ${folder}`)
  const files = walkFiles(folder, 2000, 5).filter(f => /\.(pdf|docx|pptx|txt|md|xlsx|odt|odp|png|jpg|jpeg)$/i.test(f))
  const out: HubItem[] = []
  for (const f of files) {
    const rel = path.relative(folder, f)
    const stat = fs.statSync(f)
    let text = ''
    if (/\.(txt|md)$/i.test(f) && stat.size < 2_000_000) text = fs.readFileSync(f, 'utf-8').slice(0, 20_000)
    else if (/\.pdf$/i.test(f) && stat.size < 60_000_000) text = await extractTextFromPdf(f)
    else if (/\.(docx|pptx)$/i.test(f) && stat.size < 40_000_000) text = await officeText(f)
    out.push({
      id: `file-${hash(f, stat.mtimeMs)}`,
      source: 'files',
      kind: 'material',
      title: path.basename(f),
      text: `${rel}\n${text}`,
      origin: { source: 'files', where: path.dirname(rel) === '.' ? path.basename(folder) : path.dirname(rel), at: stat.mtimeMs, ref: f },
      attachments: [{ name: path.basename(f), path: f, type: path.extname(f).slice(1).toLowerCase() }],
      importedAt: Date.now(),
    })
  }
  return out
}

export { extractTarGz }
