/**
 * Extrai o texto de um arquivo jogado como contexto: texto/código puro, Word (.docx), PowerPoint
 * (.pptx), Excel (.xlsx), HTML e PDF (texto embutido). Sem dependências novas: jszip e exceljs já
 * estão no projeto, e o PDF é lido direto (fluxos FlateDecode + operadores de texto).
 *
 * Nunca finge: se o arquivo não tem texto legível (PDF escaneado, binário), lança um erro claro.
 */
import zlib from 'zlib'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { cleanText } from './context'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'mdx', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env', 'properties',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ipynb', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'm', 'r', 'lua', 'pl', 'dart',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'tex', 'srt', 'vtt',
  'dockerfile', 'makefile', 'gitignore', 'editorconfig', 'gradle', 'tf', 'hcl', 'nix', 'cmake', 'asm', 's', 'vb', 'fs', 'ex', 'exs', 'erl', 'hs', 'clj', 'groovy', 'zig', 'nim', 'v', 'sol',
])

export function extOf(name: string) {
  const base = name.toLowerCase().split(/[\\/]/).pop() || ''
  if (!base.includes('.')) return base // Dockerfile, Makefile
  return base.slice(base.lastIndexOf('.') + 1)
}

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/** Texto UTF-8 (com BOM ou UTF-16 detectados); recusa binários. */
export function decodeTextBuffer(buf: Buffer): string {
  let text: string
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le')
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le')
  else text = buf.toString('utf8').replace(/^﻿/, '')
  const sample = text.slice(0, 20_000)
  const bad = (sample.match(/[\u0000-\u0008\u000e-\u001a�]/g) || []).length
  if (sample.length && bad / sample.length > 0.02) {
    // Talvez Windows-1252 (arquivos antigos do Bloco de Notas)
    const latin = buf.toString('latin1')
    const latinBad = (latin.slice(0, 20_000).match(/[\u0000-\u0008\u000e-\u001a]/g) || []).length
    if (latinBad / Math.max(1, Math.min(latin.length, 20_000)) > 0.02) throw new Error('O arquivo parece binário — não tem texto legível')
    return latin
  }
  return text
}

export function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

async function docxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const parts = ['word/document.xml', ...Object.keys(zip.files).filter(f => /^word\/(header|footer|footnotes)\d*\.xml$/.test(f))]
  let out = ''
  for (const p of parts) {
    const xml = await zip.file(p)?.async('string')
    if (!xml) continue
    out += decodeEntities(xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')) + '\n'
  }
  return out
}

async function pptxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const slides = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
  const out: string[] = []
  for (const [i, s] of slides.entries()) {
    const xml = await zip.file(s)!.async('string')
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeEntities(m[1]))
    out.push(`--- Slide ${i + 1} ---\n${texts.join('\n')}`)
  }
  return out.join('\n\n')
}

async function xlsxText(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const out: string[] = []
  wb.eachSheet(sheet => {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, row => {
      if (rows.length >= 5_000) return
      const values = (row.values as unknown[]).slice(1).map(v => {
        if (v == null) return ''
        if (typeof v === 'object') {
          const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> }
          if (o.richText) return o.richText.map(r => r.text).join('')
          if (o.text) return o.text
          if (o.result !== undefined) return String(o.result)
          if (v instanceof Date) return v.toISOString().slice(0, 10)
          return ''
        }
        return String(v)
      })
      rows.push(values.map(s => (/[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)).join(';'))
    })
    out.push(`--- Planilha: ${sheet.name} (${rows.length} linhas) ---\n${rows.join('\n')}`)
  })
  return out.join('\n\n')
}

// ── PDF (texto embutido) ─────────────────────────────────────────────────────

function pdfString(raw: string) {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8))
    return ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c] ?? ''
  })
}

function hexString(hex: string) {
  const h = hex.replace(/\s+/g, '')
  const bytes = Buffer.from(h.length % 2 ? `${h}0` : h, 'hex')
  // UTF-16BE com BOM, ou bytes de 2 em 2 que formam texto legível
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le')
  const latin = bytes.toString('latin1')
  return /^[\x20-\x7e -ÿ\s]*$/.test(latin) ? latin : ''
}

/** Texto dos operadores Tj / TJ / ' / " de um fluxo de conteúdo. */
function textFromContent(content: string) {
  let out = ''
  const re = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj|(T\*|Td|TD|ET|Tm)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      for (const p of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g)) {
        if (p[1] !== undefined) out += pdfString(p[1])
        else if (p[2] !== undefined) out += hexString(p[2])
        else if (p[3] !== undefined && Number(p[3]) < -180) out += ' ' // espaço largo entre palavras
      }
    } else if (m[2] !== undefined) out += pdfString(m[2])
    else if (m[3] !== undefined) out += hexString(m[3])
    else if (m[4]) out += m[4] === 'Tm' ? ' ' : '\n'
  }
  return out
}

export function pdfText(buf: Buffer) {
  const src = buf.toString('latin1')
  if (!src.startsWith('%PDF')) throw new Error('Não é um PDF válido')
  if (/\/Encrypt\b/.test(src)) throw new Error('PDF protegido por senha/criptografia — não dá para ler o texto')
  let out = ''
  const streamRe = /<<((?:(?!>>)[\s\S]){0,2000}?)>>\s*stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(src))) {
    const dict = m[1]
    const start = m.index + m[0].length
    const end = src.indexOf('endstream', start)
    if (end < 0) break
    streamRe.lastIndex = end
    // Imagens, fontes e metadados não têm texto de página
    if (/\/Subtype\s*\/(Image|XML|Type1C|CIDFontType0C|OpenType)|\/Type\s*\/(XObject|Metadata|FontFile)|\/Length1|\/Length2/.test(dict) && !/\/Subtype\s*\/Form/.test(dict)) continue
    let data = buf.subarray(start, end)
    if (/\/FlateDecode/.test(dict)) {
      try { data = zlib.inflateSync(data) } catch {
        try { data = zlib.inflateSync(data.subarray(0, data.length - 2)) } catch { continue }
      }
    } else if (/\/Filter/.test(dict)) continue // outros filtros (DCT, LZW…) não são texto
    const content = data.toString('latin1')
    if (!/\b(Tj|TJ)\b/.test(content)) continue
    out += textFromContent(content) + '\n'
  }
  const text = out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const readable = (text.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length
  if (readable < 30) throw new Error('Este PDF não tem texto embutido legível (provavelmente é escaneado ou usa fontes codificadas). Copie o texto e use "Colar texto", ou anexe as páginas como imagem.')
  return text
}

/** Ponto de entrada: nome + bytes → texto limpo. */
export async function extractText(name: string, buf: Buffer): Promise<{ text: string; kind: string }> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error(`Arquivo grande demais (máx. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`)
  const ext = extOf(name)
  let text: string
  let kind: string
  try {
    if (ext === 'docx' || ext === 'docm') { text = await docxText(buf); kind = 'Word' }
    else if (ext === 'pptx') { text = await pptxText(buf); kind = 'PowerPoint' }
    else if (ext === 'xlsx' || ext === 'xlsm') { text = await xlsxText(buf); kind = 'Excel' }
    else if (ext === 'pdf') { text = pdfText(buf); kind = 'PDF' }
    else if (ext === 'html' || ext === 'htm' || ext === 'xhtml') { text = htmlToText(decodeTextBuffer(buf)); kind = 'HTML' }
    else if (ext === 'ipynb') {
      const nb = JSON.parse(decodeTextBuffer(buf)) as { cells?: Array<{ cell_type: string; source: string[] | string }> }
      text = (nb.cells || []).map(c => `# [${c.cell_type}]\n${Array.isArray(c.source) ? c.source.join('') : c.source}`).join('\n\n')
      kind = 'Notebook'
    } else if (['doc', 'xls', 'ppt', 'odt', 'rtf', 'pages', 'key', 'numbers'].includes(ext)) {
      throw new Error(`.${ext} (formato antigo/proprietário) não é suportado — salve como .docx/.xlsx/.pptx ou .pdf`)
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
      throw new Error('Imagens vão pelo botão de imagem (o Gemini analisa); aqui entram documentos e textos')
    } else if (['zip', 'rar', '7z', 'exe', 'dll', 'mp3', 'mp4', 'wav', 'mov', 'avi', 'iso', 'bin'].includes(ext)) {
      throw new Error(`.${ext} não tem texto para a IA ler`)
    } else {
      text = decodeTextBuffer(buf)
      kind = TEXT_EXT.has(ext) ? (ext ? ext.toUpperCase() : 'Texto') : 'Texto'
    }
  } catch (e) {
    const msg = (e as Error).message
    if (/End of data|Corrupted zip|central directory|invalid signature/i.test(msg)) throw new Error(`${name}: arquivo corrompido ou não é um ${ext.toUpperCase()} de verdade`)
    throw e
  }
  text = cleanText(text)
  if (!text) throw new Error(`${name}: nenhum texto encontrado no arquivo`)
  return { text, kind }
}
