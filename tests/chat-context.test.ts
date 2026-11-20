import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import { addContext, buildContextBlock, clearContext, contextBudgetChars, listContext, removeContext, summarize } from '@/lib/chat/context'
import { decodeTextBuffer, extractText, htmlToText } from '@/lib/chat/extract'

describe('contexto da conversa', () => {
  it('guarda por conversa, remove e limpa', () => {
    const items = addContext('conv-1', [{ name: 'a.md', text: '# Título\r\nconteúdo' }, { name: '', text: 'colado', kind: 'text' }, { text: '   ' }])
    expect(items).toHaveLength(2)
    expect(items[0].text).toBe('# Título\nconteúdo')
    expect(items[1]).toMatchObject({ name: 'Texto colado', kind: 'text' })
    expect(listContext('conv-1')).toHaveLength(2)
    expect(listContext('outra')).toEqual([])
    expect(summarize(items)[0]).not.toHaveProperty('text')
    removeContext('conv-1', items[0].id)
    expect(listContext('conv-1').map(i => i.name)).toEqual(['Texto colado'])
    clearContext('conv-1')
    expect(listContext('conv-1')).toEqual([])
  })
  it('recusa ids de conversa perigosos', () => {
    expect(() => addContext('../x', [{ text: 'a' }])).toThrow(/inválido/)
  })
  it('cabe tudo quando há espaço; corta proporcionalmente e avisa quando não há', () => {
    const items = addContext('conv-2', [{ name: 'pequeno.txt', text: 'p'.repeat(500) }, { name: 'grande.txt', text: 'INICIO' + 'g'.repeat(50_000) + 'FIM' }])
    const all = buildContextBlock(items, 200_000)
    expect(all.clipped).toBe(false)
    expect(all.block).toContain('<<< arquivo: grande.txt >>>')
    expect(all.block).toContain('FIM')
    const cut = buildContextBlock(items, 10_000)
    expect(cut.clipped).toBe(true)
    // o item pequeno entra inteiro; o grande guarda começo e fim
    expect(cut.block).toContain('p'.repeat(500))
    expect(cut.block).toContain('INICIO')
    expect(cut.block).toContain('FIM')
    expect(cut.block).toMatch(/caracteres omitidos/)
    expect(cut.block).toMatch(/chegaram cortados/)
    expect(cut.usedChars).toBeLessThan(cut.totalChars)
  })
  it('o orçamento respeita a cota gratuita do provedor e a janela do modelo', () => {
    const groq = contextBudgetChars('groq|openai/gpt-oss-120b', 131_000, 4_000)
    const gemini = contextBudgetChars('gemini|gemini-2.5-flash', 1_000_000, 4_000)
    const local = contextBudgetChars('ollama|llama3.2:3b', 8_192, 4_000)
    expect(groq).toBeLessThan(20_000)
    expect(gemini).toBeGreaterThan(200_000)
    expect(local).toBeLessThan(20_000)
    expect(local).toBeGreaterThanOrEqual(2_000)
  })
})

describe('extração de texto dos arquivos', () => {
  it('texto UTF-8, UTF-16 e Windows-1252', () => {
    expect(decodeTextBuffer(Buffer.from('﻿ação', 'utf8'))).toBe('ação')
    expect(decodeTextBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('olá', 'utf16le')]))).toBe('olá')
    expect(decodeTextBuffer(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
    expect(() => decodeTextBuffer(Buffer.from(Array.from({ length: 400 }, (_, i) => i % 7)))).toThrow(/binário/)
  })
  it('HTML sem scripts e com quebras', () => {
    expect(htmlToText('<html><head><title>x</title></head><body><script>alert(1)</script><p>Olá &amp; tchau</p><ul><li>um</li></ul></body></html>').trim()).toBe('Olá & tchau\n• um')
  })
  it('Word (.docx)', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Relatório</w:t></w:r></w:p><w:p><w:r><w:t>Linha &amp; dois</w:t></w:r></w:p></w:body></w:document>')
    const r = await extractText('doc.docx', await zip.generateAsync({ type: 'nodebuffer' }))
    expect(r.kind).toBe('Word')
    expect(r.text).toBe('Relatório\nLinha & dois')
  })
  it('PowerPoint (.pptx) em ordem de slide', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide10.xml', '<p:sld><a:t>Dez</a:t></p:sld>')
    zip.file('ppt/slides/slide2.xml', '<p:sld><a:t>Dois</a:t></p:sld>')
    const r = await extractText('a.pptx', await zip.generateAsync({ type: 'nodebuffer' }))
    expect(r.text.indexOf('Dois')).toBeLessThan(r.text.indexOf('Dez'))
  })
  it('PDF com texto embutido (gerado pelo pdfkit)', async () => {
    const doc = new PDFDocument()
    const parts: Buffer[] = []
    doc.on('data', (c: Buffer) => parts.push(c))
    const done = new Promise<void>(r => doc.on('end', () => r()))
    doc.fontSize(14).text('Contrato de prestação de serviços')
    doc.text('Valor total: 1500 reais por mes')
    doc.end()
    await done
    const r = await extractText('contrato.pdf', Buffer.concat(parts))
    expect(r.kind).toBe('PDF')
    expect(r.text).toMatch(/Contrato de presta/)
    expect(r.text).toMatch(/Valor total: 1500 reais/)
  })
  it('recusa com explicação o que não é texto', async () => {
    await expect(extractText('foto.png', Buffer.from('x'))).rejects.toThrow(/botão de imagem/)
    await expect(extractText('velho.doc', Buffer.from('x'))).rejects.toThrow(/não é suportado/)
    await expect(extractText('quebrado.docx', Buffer.from('não é zip'))).rejects.toThrow()
    await expect(extractText('vazio.pdf', Buffer.from('%PDF-1.4\n%%EOF'))).rejects.toThrow(/não tem texto/)
  })
})
