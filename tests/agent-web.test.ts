import { describe, expect, it } from 'vitest'
import { formatSearch, htmlToText, webFetch, webSearch } from '@/lib/agents/web'

describe('HTML para texto legível', () => {
  it('remove script, estilo e marcação, mantendo o conteúdo', () => {
    const html = `
      <html><head><title>Página</title><style>.a{color:red}</style></head>
      <body><script>var x = 1 < 2;</script>
      <h1>Título</h1><p>Primeiro parágrafo.</p><p>Segundo parágrafo.</p>
      </body></html>`
    const text = htmlToText(html)
    expect(text).toContain('Título')
    expect(text).toContain('Primeiro parágrafo.')
    expect(text).toContain('Segundo parágrafo.')
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('var x')
  })

  it('decodifica entidades e não deixa espaço duplicado', () => {
    const text = htmlToText('<p>caf&eacute; &amp; p&atilde;o&nbsp;&nbsp;quente &lt;ok&gt;</p>')
    expect(text).toContain('&')
    expect(text).toContain('<ok>')
    expect(text).not.toMatch(/ {2}/)
  })

  it('separa blocos em linhas em vez de grudar o texto', () => {
    const text = htmlToText('<li>um</li><li>dois</li>')
    expect(text.split('\n')).toEqual(['um', 'dois'])
  })
})

describe('formatação para o agente', () => {
  it('numera os resultados com link e resumo', () => {
    const out = formatSearch({
      source: 'brave',
      results: [{ title: 'T', url: 'https://x.dev', snippet: 'resumo' }],
    })
    expect(out).toContain('1. T')
    expect(out).toContain('https://x.dev')
    expect(out).toContain('resumo')
  })

  it('sem resultados, avisa e repassa a observação da rota', () => {
    const out = formatSearch({ source: 'aberta', results: [], note: 'rota limitada' })
    expect(out).toContain('Nenhum resultado')
    expect(out).toContain('rota limitada')
  })
})

describe('validação de endereço', () => {
  it('recusa endereço inválido e protocolo fora de http/https', async () => {
    await expect(webFetch('não é url')).rejects.toThrow('Endereço inválido')
    await expect(webFetch('file:///C:/Windows/System32/drivers/etc/hosts')).rejects.toThrow('http e https')
    await expect(webFetch('ftp://exemplo.com/a')).rejects.toThrow('http e https')
  })

  it('exige o que procurar', async () => {
    await expect(webSearch('   ')).rejects.toThrow('Informe o que procurar')
  })
})

// Rede de verdade: pulam sozinhos quando a máquina está sem internet.
describe('busca e leitura reais', () => {
  const online = async () => {
    try {
      await fetch('https://pt.wikipedia.org/w/api.php?action=query&format=json', { signal: AbortSignal.timeout(8000) })
      return true
    } catch { return false }
  }

  it('encontra resultados pela rota aberta, sem chave nenhuma', async () => {
    if (!await online()) return
    const out = await webSearch('Next.js framework', { limit: 4 })
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.results[0].url).toMatch(/^https?:\/\//)
    // Sem BRAVE_SEARCH_API_KEY a rota é a aberta, e ela avisa a limitação
    if (out.source === 'aberta') expect(out.note).toContain('brave.com/search/api')
  }, 60_000)

  it('lê uma página e devolve o texto, não o HTML', async () => {
    if (!await online()) return
    const page = await webFetch('https://pt.wikipedia.org/wiki/Next.js')
    expect(page.title.length).toBeGreaterThan(0)
    expect(page.text).not.toContain('<div')
    expect(page.text.toLowerCase()).toContain('next.js')
    expect(page.url).toMatch(/^https:/)
  }, 60_000)
})

describe('web_fetch não alcança a própria máquina nem a rede local', () => {
  it('reconhece endereços internos', async () => {
    const { isInternalHost } = await import('@/lib/agents/web')
    for (const h of [
      'localhost', 'app.localhost', 'impressora.local', '127.0.0.1', '127.1.2.3',
      '0.0.0.0', '10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254',
      '169.254.169.254', '::1', 'fe80::1', 'fd00::1',
    ]) expect(isInternalHost(h), h).toBe(true)
  })

  it('não confunde endereços públicos com internos', async () => {
    const { isInternalHost } = await import('@/lib/agents/web')
    for (const h of [
      'exemplo.com', 'pt.wikipedia.org', '8.8.8.8', '1.1.1.1',
      '172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1',
    ]) expect(isInternalHost(h), h).toBe(false)
  })

  it('recusa a busca e explica o que usar no lugar', async () => {
    await expect(webFetch('http://127.0.0.1:3001/api/chat')).rejects.toThrow('read_file')
    await expect(webFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('rede local')
    await expect(webFetch('http://localhost:3001/api/providers')).rejects.toThrow('própria máquina')
  })
})
