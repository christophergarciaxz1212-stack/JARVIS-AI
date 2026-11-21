import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SR, Track } from '@/lib/motion/audio'
import { decideEngine } from '@/lib/studio/chat'
import { guessKitStyle, syntaxExcerpt } from '@/lib/motion/compose'
import { localIntent } from '@/lib/local/commands'
import { leadScore, overpassQuery, waNumber, categoriesFrom } from '@/lib/local/places'
import { outputBudget, streamAI, type StreamChunk } from '@/lib/ai/client'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'
import { hubCommandRunner } from '@/lib/hub/hub'
import { dataDir } from '@/lib/agents/fsutil'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** Maior salto entre amostras vizinhas: ruído branco salta muito; um tom suave, pouco. */
const maxJump = (pcm: Float32Array) => { let m = 0; for (let i = 1; i < pcm.length; i++) m = Math.max(m, Math.abs(pcm[i] - pcm[i - 1])); return m }

describe('áudio sem chiado: só voz e efeitos', () => {
  it('whoosh, rise e impact não usam ruído branco', () => {
    for (const kind of ['whoosh', 'rise', 'impact'] as const) {
      const t = new Track(2, 30)
      t.add({ frame: 30, type: kind, vol: 0.3 })
      // Um ruído branco de volume 0.3 salta ~0.3–0.6 entre amostras; um tom de até ~1 kHz salta < 0.05
      expect(maxJump(t.buf), kind).toBeLessThan(0.06)
    }
  })
})

describe('os 3 modelos de vídeo', () => {
  it('chat escolhe o motor pelo pedido', () => {
    expect(decideEngine('5 ferramentas de IA para programadores')).toMatchObject({ engine: 'studio' })
    expect(decideEngine('vídeo animado: 5 ferramentas de IA')).toMatchObject({ engine: 'motion', style: 'auto' })
    expect(decideEngine('comercial do meu app de finanças, baixe grátis')).toMatchObject({ engine: 'motion', style: 'app-promo' })
    expect(decideEngine('anúncio do fone Pulse X com desconto')).toMatchObject({ engine: 'studio' })
    expect(decideEngine('filme publicitário da minha cafeteria')).toMatchObject({ engine: 'studio' })
  })
  it('erro de sintaxe vira o trecho exato do código para a correção', () => {
    const js = ['function renderFrame(n) {', '  const a = 1', '  stage.innerHTML = K.bg(n) + (', '  K.caption(n)', '}'].join('\n')
    const ex = syntaxExcerpt(js, ["O script não executou: Uncaught SyntaxError: Unexpected token '}' (linha 5 do js)"])
    expect(ex).toContain('   5 >> }')
    expect(ex).toMatch(/ {3}3 {4}\s*stage\.innerHTML/)
    expect(syntaxExcerpt(js, ['outro problema'])).toBe('')
  })
  it('a variação visual acompanha o tema', () => {
    expect(guessKitStyle('5 projetos do GitHub para o Claude')).toBe('tech-passos')
    expect(guessKitStyle('o Claude acabou de lançar um novo modelo')).toBe('tech-news')
    expect(guessKitStyle('os primeiros 100 mil reais e os juros compostos')).toBe('minimal-dados')
    expect(guessKitStyle('Supabase explicado como se fosse um prédio')).toBe('tech-analogia')
  })
})

describe('prospecção local (empresas e comércios próximos)', () => {
  it('entende onde, raio, categoria e "sem site"', () => {
    expect(localIntent('quais padarias tem perto da Savassi, Belo Horizonte num raio de 1 km')).toMatchObject({ where: 'Savassi, Belo Horizonte', radiusM: 1000 })
    expect(localIntent('empresas sem site no centro de Campinas')).toMatchObject({ where: 'Centro, Campinas', onlyNoSite: true })
    expect(localIntent('quero leads de academias em Moema, São Paulo')).toMatchObject({ where: 'Moema, São Paulo' })
    expect(localIntent('liste os dentistas perto de mim')?.where).toBe('')
    expect(localIntent('quais empresas usam IA?')).toBeNull()
  })
  it('não confunde com outros pedidos', () => {
    expect(localIntent('crie uma topologia de rede para a empresa em São Paulo')).toBeNull()
    expect(localIntent('o que é uma empresa?')).toBeNull()
    expect(localIntent('crie um vídeo sobre padarias em BH')).toBeNull()
  })
  it('categorias viram filtros do OpenStreetMap; sem categoria busca todas as empresas', () => {
    expect(categoriesFrom('padarias e academias').map(c => c.label)).toEqual(['Padaria', 'Academia'])
    const q = overpassQuery({ lat: -19.93, lon: -43.93, label: 'x' }, 1000, categoriesFrom('padarias'))
    expect(q).toContain('nwr[shop=bakery][name](around:1000,-19.930000,-43.930000);')
    expect(overpassQuery({ lat: 0, lon: 0, label: 'x' }, 500, [])).toContain('nwr[shop][name]')
  })
  it('pontuação de lead: sem site com telefone é o melhor; site próprio com https é o pior', () => {
    expect(leadScore({ phone: '31 3333-4444' }).score).toBe(95)
    expect(leadScore({ phone: '1', website: 'https://instagram.com/padaria' }).score).toBe(80)
    expect(leadScore({ phone: '1', website: 'http://padaria.com.br' }).score).toBe(55)
    expect(leadScore({ phone: '1', website: 'https://padaria.com.br', hours: 'Mo-Fr 07:00-19:00' }).score).toBe(15)
  })
  it('número para WhatsApp com DDI do Brasil', () => {
    expect(waNumber('(31) 3296-8750')).toBe('553132968750')
    expect(waNumber('+55 31 99999-0000')).toBe('5531999990000')
    expect(waNumber('123')).toBeUndefined()
  })
  it('pedido de vídeo com "estudar" não vira plano de estudos do Hub', () => {
    expect(hubCommandRunner('crie um vídeo de 15 segundos: 3 ferramentas de IA grátis para estudar')).toBeNull()
    expect(hubCommandRunner('o que eu preciso estudar essa semana?')).not.toBeNull()
  })
  it('pasta de dados por junção: usa o caminho real (mkdir recursivo falha em junção no Windows)', () => {
    const OLD = process.env.JARVIS_DATA_DIR
    const OLDCWD = process.cwd()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-junc-'))
    try {
      fs.mkdirSync(path.join(tmp, 'real'))
      fs.mkdirSync(path.join(tmp, 'app'))
      fs.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'app', 'data'), 'junction')
      delete process.env.JARVIS_DATA_DIR
      process.chdir(path.join(tmp, 'app'))
      const d = dataDir()
      expect(fs.realpathSync.native(d)).toBe(d)
      fs.mkdirSync(path.join(d, 'local', 'x'), { recursive: true })
      expect(fs.existsSync(path.join(tmp, 'real', 'local', 'x'))).toBe(true)
    } finally {
      process.chdir(OLDCWD)
      if (OLD !== undefined) process.env.JARVIS_DATA_DIR = OLD
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
  it('o modo Agente manda esses pedidos para o chat', () => {
    expect(shouldRunAgent('quais padarias tem perto da Savassi, Belo Horizonte')).toBe(false)
  })
})

describe('extrair o máximo dos modelos', () => {
  let server: http.Server
  const seen: Array<Record<string, unknown>> = []
  const OLD = process.env.LMSTUDIO_BASE_URL
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        seen.push(body)
        const part = seen.length
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        // 1ª parte é cortada pelo limite; a 2ª termina
        res.write(chunk({ content: part === 1 ? 'Primeira metade, ' : 'segunda metade.' }, null))
        res.write(chunk({}, part === 1 ? 'length' : 'stop'))
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    process.env.LMSTUDIO_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(() => { server.close(); if (OLD === undefined) delete process.env.LMSTUDIO_BASE_URL; else process.env.LMSTUDIO_BASE_URL = OLD })

  it('resposta cortada pelo limite continua sozinha e chega inteira, com um único "done"', async () => {
    const chunks: StreamChunk[] = []
    await streamAI('lmstudio|modelo', [{ role: 'user', content: 'escreva bastante' }], c => chunks.push(c))
    expect(chunks.map(c => c.content).join('')).toBe('Primeira metade, segunda metade.')
    expect(chunks.filter(c => c.done)).toHaveLength(1)
    expect(seen).toHaveLength(2)
    // A continuação manda o que já veio e pede para seguir sem repetir
    const msgs = seen[1].messages as Array<{ role: string; content: string }>
    expect(msgs[msgs.length - 2]).toEqual({ role: 'assistant', content: 'Primeira metade, ' })
    expect(msgs[msgs.length - 1].content).toMatch(/Continue exatamente de onde parou/)
    // E pede a saída máxima ao provedor
    expect(Number(seen[0].max_tokens)).toBeGreaterThanOrEqual(4096)
  })
  it('saída máxima respeita a cota grátis do provedor', () => {
    expect(outputBudget('groq', 'openai/gpt-oss-120b')).toBeLessThanOrEqual(4096)
    expect(outputBudget('gemini', 'gemini-2.5-flash')).toBeGreaterThanOrEqual(8192)
  })
})
