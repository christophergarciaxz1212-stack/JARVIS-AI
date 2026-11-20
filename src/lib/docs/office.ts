import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { v4 as uuidv4 } from 'uuid'
import { documentsDir, registerDocument, type DocumentMeta, type ReportSection } from './generate'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'documento'

/** Saves any generated file (lab exports, configs…) as a downloadable document shown inline in the chat. */
export function saveDocumentFile(title: string, ext: DocumentMeta['kind'], content: string | Buffer): DocumentMeta {
  const file = `${slug(title)}-${uuidv4().slice(0, 8)}.${ext}`
  fs.mkdirSync(documentsDir(), { recursive: true })
  const dest = path.join(documentsDir(), file)
  fs.writeFileSync(dest, content)
  return registerDocument(file, title, ext, fs.statSync(dest).size)
}

// ─── Markdown ────────────────────────────────────────────────────────────────

export function buildReportMarkdown(opts: { title: string; subtitle?: string; sections: ReportSection[] }): DocumentMeta {
  const out = [`# ${opts.title}`, '', opts.subtitle ? `_${opts.subtitle}_` : `_${new Date().toLocaleDateString('pt-BR')} · gerado pelo JARVIS AI_`, '']
  for (const s of opts.sections) {
    out.push(`## ${s.heading}`, '')
    if (s.image && fs.existsSync(s.image)) out.push(`![${s.heading}](data:image/png;base64,${fs.readFileSync(s.image).toString('base64')})`, '')
    // Config dumps read better as code blocks
    out.push(/^(config |interface |hostname |!|#|network:)/m.test(s.body) && s.body.split('\n').length > 6 ? `\`\`\`\n${s.body}\n\`\`\`` : s.body, '')
  }
  return saveDocumentFile(opts.title, 'md', out.join('\n'))
}

// ─── DOCX (Office Open XML) ──────────────────────────────────────────────────

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="2400" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="475569"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0E7490"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="17"/></w:rPr></w:style>
</w:styles>`

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`

function picture(rid: string, n: number, w: number, h: number) {
  // Fit to the 16 cm text width (EMU: 1 cm = 360000)
  const maxW = 16 * 360000
  const cx = maxW, cy = Math.round((h / w) * maxW)
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Imagem ${n}"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="${n}" name="img${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

/** Word document with cover, headings, bullets, code blocks and diagrams — opens in Word, LibreOffice and Google Docs. */
export async function buildReportDocx(opts: { title: string; subtitle?: string; sections: ReportSection[] }): Promise<DocumentMeta> {
  const zip = new JSZip()
  const rels: string[] = []
  const body: string[] = [
    para(opts.title, 'Title'),
    para(opts.subtitle || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }), 'Subtitle'),
    para('gerado pelo JARVIS AI', 'Subtitle'),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  ]
  let img = 0
  for (const s of opts.sections) {
    body.push(para(s.heading, 'Heading1'))
    if (s.image && fs.existsSync(s.image)) {
      const buf = fs.readFileSync(s.image)
      const size = pngSize(buf)
      if (size) {
        img++
        zip.file(`word/media/img${img}.png`, buf)
        rels.push(`<Relationship Id="rImg${img}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${img}.png"/>`)
        body.push(picture(`rImg${img}`, img, size.w, size.h))
      }
    }
    const code = /^(config |interface |hostname |!|#|network:)/m.test(s.body) && s.body.split('\n').length > 6
    for (const raw of (s.body || '').split('\n')) {
      const line = raw.trimEnd()
      if (code) { body.push(para(line || ' ', 'Code')); continue }
      if (!line.trim()) continue
      if (/^#{1,3}\s/.test(line.trim())) body.push(para(line.trim().replace(/^#{1,3}\s*/, ''), 'Heading2'))
      else if (/^[-*•]\s+/.test(line.trim())) body.push(`<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr><w:r><w:t xml:space="preserve">${xml(`•  ${line.trim().replace(/^[-*•]\s+/, '')}`)}</w:t></w:r></w:p>`)
      else body.push(para(line.trim()))
    }
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(opts.title)}</dc:title><dc:creator>JARVIS AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`)
  zip.file('word/styles.xml', STYLES)
  zip.file('word/document.xml', doc)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return saveDocumentFile(opts.title, 'docx', buf)
}
