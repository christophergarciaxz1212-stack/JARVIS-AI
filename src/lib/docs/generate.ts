import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { dataDir } from '../agents/fsutil'

export const documentsDir = () => path.join(dataDir(), 'documents')
const indexFile = () => path.join(documentsDir(), 'index.json')

export interface DocumentMeta {
  file: string
  title: string
  kind: 'xlsx' | 'pdf' | 'md' | 'csv' | 'docx' | 'yml' | 'unl' | 'gns3' | 'zip'
  size: number
  at: number
}

const readIndex = (): DocumentMeta[] => {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf-8')) as DocumentMeta[]
  } catch {
    return []
  }
}
export function listDocuments(): DocumentMeta[] {
  return readIndex()
}
export function getDocument(file: string): DocumentMeta | null {
  return readIndex().find(d => d.file === file) || null
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'documento'
}

export function registerDocument(file: string, title: string, kind: DocumentMeta['kind'], size: number) {
  return registerMeta(file, title, kind, size)
}

function registerMeta(file: string, title: string, kind: DocumentMeta['kind'], size: number) {
  const meta: DocumentMeta = { file, title, kind, size, at: Date.now() }
  const rest = readIndex().filter(d => d.file !== file)
  fs.mkdirSync(documentsDir(), { recursive: true })
  fs.writeFileSync(indexFile(), JSON.stringify([meta, ...rest].slice(0, 300), null, 0), 'utf-8')
  return meta
}

// ─── Spreadsheets ─────────────────────────────────────────────────────────────

export interface SheetInput {
  name: string
  headers: string[]
  rows: Array<Array<string | number | null>>
  /** Append a totals row (numeric columns get =SUM(...)) */
  totals?: boolean
}

function colLetter(idx: number) {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export async function buildSpreadsheet(opts: { name?: string; sheets: SheetInput[] }): Promise<DocumentMeta> {
  const sheets = (opts.sheets || []).slice(0, 20)
  if (!sheets.length) throw new Error('Informe pelo menos uma aba (sheets)')
  for (const [i, s] of sheets.entries()) {
    if (!Array.isArray(s.headers) || !s.headers.length) throw new Error(`Aba ${i + 1}: informe os cabeçalhos (headers)`)
    if (!Array.isArray(s.rows)) throw new Error(`Aba ${i + 1}: informe as linhas (rows)`)
    if (s.rows.length > 2000) throw new Error(`Aba ${i + 1}: máximo de 2000 linhas`)
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'JARVIS AI'
  wb.created = new Date()
  wb.modified = new Date()

  const title = (opts.name || sheets[0].headers[0] || 'Planilha').slice(0, 60)
  for (const [i, s] of sheets.entries()) {
    let name = (s.name || `Aba ${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Aba ${i + 1}`
    if (sheets.slice(0, i).some(prev => prev.name === name)) name = `${name.slice(0, 28)} ${i + 1}`
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FF00D4FF' } } })

    ws.columns = s.headers.map((h, j) => {
      const maxContent = Math.max(s.headers[j]?.length || 8, ...s.rows.slice(0, 200).map(r => String(r[j] ?? '').length), 8)
      return { header: h, key: `c${j}`, width: Math.min(60, Math.max(10, maxContent + 2)) }
    })
    s.rows.forEach(r => ws.addRow(r.map(v => (v === null || v === undefined ? '' : v))))

    const header = ws.getRow(1)
    header.font = { bold: true, color: { argb: 'FFE8F6FF' }, size: 10 }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }
    header.alignment = { vertical: 'middle' }
    header.height = 22

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } }
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      row.alignment = { vertical: 'middle', wrapText: true }
      row.height = Math.max(18, row.height || 18)
      if (rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      }
      row.eachCell((cell, colNumber) => {
        const v = s.rows[rowNumber - 2]?.[colNumber - 1]
        if (typeof v === 'number') cell.numFmt = '#,##0.00'
      })
    })

    if (s.totals && s.rows.length) {
      const totalsRow = ws.addRow(s.headers.map((_, j) => {
        const numeric = s.rows.some(r => typeof r[j] === 'number')
        if (j === 0) return 'TOTAL'
        return numeric ? { formula: `SUM(${colLetter(j)}2:${colLetter(j)}${s.rows.length + 1})` } : ''
      }))
      totalsRow.font = { bold: true, color: { argb: 'FF0F172A' } }
      totalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F2FF' } }
      totalsRow.eachCell((cell, colNumber) => {
        if (s.rows.some(r => typeof r[colNumber - 1] === 'number')) cell.numFmt = '#,##0.00'
      })
    }
  }

  const file = `${slugify(title)}-${uuidv4().slice(0, 8)}.xlsx`
  const dest = path.join(documentsDir(), file)
  fs.mkdirSync(documentsDir(), { recursive: true })
  await wb.xlsx.writeFile(dest)
  const size = fs.statSync(dest).size
  return registerMeta(file, title.slice(0, 60), 'xlsx', size)
}

// ─── PDF reports ──────────────────────────────────────────────────────────────

export interface ReportSection {
  heading: string
  body: string
  /** Optional picture (PNG/JPEG path) shown full width under the heading, e.g. a network diagram. */
  image?: string
}

const FONT_CANDIDATES: Array<[string, string]> = [
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
  ['C:\\Windows\\Fonts\\calibri.ttf', 'C:\\Windows\\Fonts\\calibrib.ttf'],
  ['C:\\Windows\\Fonts\\segoeui.ttf', 'C:\\Windows\\Fonts\\segoeuib.ttf'],
]

function tryRegisterFonts(doc: PDFKit.PDFDocument): { regular?: string; bold?: string } {
  for (const [regular, bold] of FONT_CANDIDATES) {
    try {
      if (!fs.existsSync(regular)) continue
      doc.registerFont('Jarvis', regular)
      if (fs.existsSync(bold)) doc.registerFont('Jarvis-Bold', bold)
      else doc.registerFont('Jarvis-Bold', regular)
      return { regular: 'Jarvis', bold: 'Jarvis-Bold' }
    } catch {
      // fall through to Helvetica
    }
  }
  return {}
}

export async function buildReportPdf(opts: {
  title: string
  subtitle?: string
  coverImagePath?: string
  sections: ReportSection[]
}): Promise<DocumentMeta> {
  const title = (opts.title || 'Relatório').slice(0, 90)
  const subtitle = opts.subtitle?.slice(0, 160)
  const sections = (opts.sections || []).filter(s => s && (s.heading || s.body)).slice(0, 60)
  if (!sections.length) throw new Error('Informe pelo menos uma seção (heading/body)')

  const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, info: { Title: title, Author: 'JARVIS AI' } })
  const file = `${slugify(title)}-${uuidv4().slice(0, 8)}.pdf`
  const dest = path.join(documentsDir(), file)
  fs.mkdirSync(documentsDir(), { recursive: true })

  const done = new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(dest)
    stream.on('finish', resolve)
    stream.on('error', reject)
    doc.pipe(stream)
  })

  const fonts = tryRegisterFonts(doc)
  const regular = fonts.regular || 'Helvetica'
  const bold = fonts.bold || 'Helvetica-Bold'
  const pageW = doc.page.width
  const pageH = doc.page.height

  // ── Cover
  if (opts.coverImagePath && fs.existsSync(opts.coverImagePath)) {
    try { doc.image(opts.coverImagePath, 0, 0, { cover: [pageW, pageH], align: 'center', valign: 'center' }) } catch {}
    doc.rect(0, 0, pageW, pageH).fillOpacity(0.55).fill('#020617').fillOpacity(1)
  } else {
    doc.rect(0, 0, pageW, pageH).fill('#050b18')
    doc.circle(pageW / 2, pageH * 0.32, 84).lineWidth(1).strokeColor('#00d4ff').strokeOpacity(0.9).stroke()
  }

  const coverTitleY = opts.coverImagePath ? pageH * 0.52 : pageH * 0.31
  doc.fillColor('#7dd3fc').font(bold).fontSize(15).text('R E L A T Ó R I O', 0, pageH * 0.16, { align: 'center', characterSpacing: 4 })
  doc.fillColor('#ffffff').font(bold).fontSize(30).text(title, 56, coverTitleY, { align: 'center', lineGap: 6 })
  const afterTitle = doc.y + 6
  if (subtitle) {
    doc.fillColor('#cbd5e1').font(regular).fontSize(11).text(subtitle, 72, afterTitle, { align: 'center', lineGap: 3 })
  } else {
    doc.fillColor('#cbd5e1').font(regular).fontSize(10).text(new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }), 0, afterTitle, { align: 'center' })
  }
  doc.fillColor('#475569').font(regular).fontSize(8).text('gerado pelo JARVIS AI', 0, pageH - 80, { align: 'center' })

  // ── Sections
  doc.addPage()
  for (const [i, s] of sections.entries()) {
    const isShort = s.body.length < 400
    if (!isShort || i === 0) {
      // keep heading near its body: avoid orphan headings at page bottom
      if (doc.y > pageH - 160) doc.addPage()
    }
    doc.fillColor('#0f172a').font(bold).fontSize(15)
    doc.text(s.heading || `Seção ${i + 1}`, 56, doc.y, { lineGap: 2 })
    doc.moveDown(0.35)

    if (s.image && fs.existsSync(s.image)) {
      try {
        const img = (doc as unknown as { openImage(src: string): { width: number; height: number } }).openImage(s.image)
        const w = pageW - 112
        const h = Math.min(pageH - 160, (img.height / img.width) * w)
        if (doc.y + h > pageH - 70) doc.addPage()
        doc.image(s.image, 56, doc.y, { fit: [w, h], align: 'center' })
        doc.y += h + 10
      } catch {}
    }

    const lines = (s.body || '').split('\n')
    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!line.trim()) { doc.moveDown(0.4); continue }
      if (/^#{1,3}\s/.test(line.trim())) {
        doc.moveDown(0.3).fillColor('#0f172a').font(bold).fontSize(12).text(line.trim().replace(/^#{1,3}\s*/, ''), 56, doc.y)
        doc.moveDown(0.25)
        continue
      }
      if (/^[-*•]\s+/.test(line.trim())) {
        doc.fillColor('#1f2937').font(regular).fontSize(10.5)
        doc.text(`•  ${line.trim().replace(/^[-*•]\s+/, '')}`, 76, doc.y, { lineGap: 2.2, width: pageW - 132 })
        continue
      }
      doc.fillColor('#1f2937').font(regular).fontSize(10.5).text(line.trim(), 56, doc.y, { lineGap: 2.6, width: pageW - 112, align: 'justify' })
    }
    doc.moveDown(0.7)
    if (i < sections.length - 1) doc.moveTo(56, doc.y).lineTo(pageW - 56, doc.y).lineWidth(0.4).strokeColor('#e2e8f0').stroke().moveDown(0.4)
  }

  // ── Footer page numbers
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i)
    doc.fillColor('#94a3b8').font(regular).fontSize(8).text(`JARVIS AI  ·  página ${i + 1} de ${range.count}`, 0, pageH - 40, { align: 'center' })
  }

  doc.end()
  await done
  const size = fs.statSync(dest).size
  return registerMeta(file, title, 'pdf', size)
}
