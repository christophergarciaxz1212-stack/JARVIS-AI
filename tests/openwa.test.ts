import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'
import { verifyOpenwaSignature } from '@/lib/openwa/signature'
import { sanitizeBaseUrl, sanitizeSessionName, getOpenwaConfig, saveOpenwaConfig } from '@/lib/openwa/config'
import { normalizeChatId } from '@/lib/openwa/chatid'
import { recordOpenwaEvent, listOpenwaEvents, openwaEventStats } from '@/lib/openwa/events'

describe('openwa: assinatura do webhook (HMAC-SHA256)', () => {
  const secret = 'segredo-de-teste-com-mais-de-16-bytes'
  const body = JSON.stringify({ event: 'message.received', data: { id: '3EB0', body: 'oi' } })
  const sig = (s: string, b: string) => 'sha256=' + crypto.createHmac('sha256', s).update(b, 'utf8').digest('hex')

  it('aceita assinatura válida', () => {
    expect(verifyOpenwaSignature(body, sig(secret, body), secret)).toBe(true)
  })
  it('rejeita assinatura com outro segredo', () => {
    expect(verifyOpenwaSignature(body, sig('outro-segredo', body), secret)).toBe(false)
  })
  it('rejeita corpo adulterado', () => {
    expect(verifyOpenwaSignature(body + ' ', sig(secret, body), secret)).toBe(false)
  })
  it('rejeita header malformado', () => {
    expect(verifyOpenwaSignature(body, 'md5=abc', secret)).toBe(false)
    expect(verifyOpenwaSignature(body, null, secret)).toBe(false)
    expect(verifyOpenwaSignature(body, '', secret)).toBe(false)
  })
  it('sem segredo configurado, nada verifica', () => {
    expect(verifyOpenwaSignature(body, sig(secret, body), '')).toBe(false)
  })
})

describe('openwa: sanitização de configuração', () => {
  it('sessionName: só letras/números/hífen, 3-50', () => {
    expect(sanitizeSessionName('jarvis')).toBe('jarvis')
    expect(sanitizeSessionName('minha-sessao-2')).toBe('minha-sessao-2')
    expect(sanitizeSessionName('ab')).toBeNull()
    expect(sanitizeSessionName('com espaço')).toBeNull()
    expect(sanitizeSessionName('com_underscore')).toBeNull()
    expect(sanitizeSessionName('')).toBeNull()
    expect(sanitizeSessionName(null)).toBeNull()
  })
  it('baseUrl: http(s) apenas, sem barra final', () => {
    expect(sanitizeBaseUrl('http://127.0.0.1:2785')).toBe('http://127.0.0.1:2785')
    expect(sanitizeBaseUrl('http://127.0.0.1:2785/')).toBe('http://127.0.0.1:2785')
    expect(sanitizeBaseUrl('https://owa.exemplo.com')).toBe('https://owa.exemplo.com')
    expect(sanitizeBaseUrl('ftp://127.0.0.1')).toBeNull()
    expect(sanitizeBaseUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeBaseUrl('nao-e-url')).toBeNull()
    expect(sanitizeBaseUrl('')).toBeNull()
  })
})

describe('openwa: config persistida', () => {
  it('tem defaults e gera webhookSecret na primeira leitura', () => {
    const cfg = getOpenwaConfig()
    expect(cfg.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:2785$/)
    expect(cfg.sessionName).toBe('jarvis')
    expect(cfg.port).toBe(2785)
    expect(cfg.webhookSecret.length).toBeGreaterThanOrEqual(32)
  })
  it('salva patch e preserva o webhookSecret (nunca sobrescrevível via save)', () => {
    const before = getOpenwaConfig()
    const after = saveOpenwaConfig({ sessionName: 'minha-sessao', port: 2786 })
    expect(after.sessionName).toBe('minha-sessao')
    expect(after.port).toBe(2786)
    expect(after.webhookSecret).toBe(before.webhookSecret)
    // ignora valores inválidos em vez de quebrar
    const kept = saveOpenwaConfig({ sessionName: 'inválido!', baseUrl: 'sem-protocolo' })
    expect(kept.sessionName).toBe('minha-sessao')
    expect(kept.baseUrl).toBe(after.baseUrl)
  })
})

describe('openwa: normalizeChatId', () => {
  it('converte telefone livre em chatId @c.us', () => {
    expect(normalizeChatId('5511998877665')).toBe('5511998877665@c.us')
    expect(normalizeChatId('+55 (11) 99887-7665')).toBe('5511998877665@c.us')
  })
  it('mantém chatIds prontos (contato e grupo)', () => {
    expect(normalizeChatId('5511998877665@c.us')).toBe('5511998877665@c.us')
    expect(normalizeChatId('120363000000000000@g.us')).toBe('120363000000000000@g.us')
  })
  it('rejeita entradas inválidas', () => {
    expect(normalizeChatId('')).toBeNull()
    expect(normalizeChatId('123')).toBeNull()
    expect(normalizeChatId('@@@')).toBeNull()
  })
})

describe('openwa: log de eventos (ndjson)', () => {
  it('registra e lista do mais recente para o mais antigo', () => {
    recordOpenwaEvent({ at: Date.now() - 1000, event: 'session.status', body: 'ready' })
    recordOpenwaEvent({ at: Date.now(), event: 'message.received', from: '5511998877665@c.us', chatId: '5511998877665@c.us', body: 'olá JARVIS', messageId: '3EB0ABC' })
    const evts = listOpenwaEvents(10)
    expect(evts.length).toBeGreaterThanOrEqual(2)
    expect(evts[0].event).toBe('message.received')
    expect(evts[0].body).toBe('olá JARVIS')
    expect(openwaEventStats().received).toBeGreaterThanOrEqual(1)
  })
})

describe('openwa: client REST (fetch mockado)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('listSessions repassa o array da API', async () => {
    process.env.OPENWA_API_KEY = 'test-key'
    const sessions = [{ id: 'id1', name: 'jarvis', status: 'ready', phone: '5511998877665', pushName: 'Me', engineLoaded: true }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sessions), { status: 200 })))
    const { listSessions } = await import('@/lib/openwa/client')
    const out = await listSessions('jarvis')
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('ready')
    delete process.env.OPENWA_API_KEY
  })

  it('erros 401 viram mensagem acionável em português', async () => {
    process.env.OPENWA_API_KEY = 'key-errada'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'invalid key' }), { status: 401 })))
    const { listSessions, OpenwaError } = await import('@/lib/openwa/client')
    await expect(listSessions()).rejects.toThrowError(OpenwaError)
    await expect(listSessions()).rejects.toThrow(/API key do OpenWA/)
    delete process.env.OPENWA_API_KEY
  })

  it('sem API key configurada falha antes de chamar a rede', async () => {
    delete process.env.OPENWA_API_KEY
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const { listSessions } = await import('@/lib/openwa/client')
    await expect(listSessions()).rejects.toThrow(/API key do OpenWA não configurada/)
    expect(spy).not.toHaveBeenCalled()
  })
})
