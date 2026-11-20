import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { consumeOauthState, oauthStartUrl } from '@/lib/whatsapp/meta/service'
import { writeConfig } from '@/lib/whatsapp/meta/store'
import { GET as callback } from '@/app/api/whatsapp/oauth/callback/route'
import { middleware } from '@/middleware'

const stateOf = (url: string) => new URL(url).searchParams.get('state')!

describe('OAuth do WhatsApp (Meta)', () => {
  it('o state é de uso único e precisa ser exatamente o emitido', () => {
    writeConfig({ appId: '123', redirectUri: 'http://localhost:3001/api/whatsapp/oauth/callback' })
    // Sem start, nenhum callback passa (antes, a falta do arquivo aceitava qualquer state)
    expect(consumeOauthState('qualquer')).toBe(false)
    const state = stateOf(oauthStartUrl())
    expect(consumeOauthState(`${state}x`)).toBe(false)
    // A tentativa errada já consumiu o state: nem o certo passa depois
    expect(consumeOauthState(state)).toBe(false)
    const fresh = stateOf(oauthStartUrl())
    expect(consumeOauthState(fresh)).toBe(true)
    expect(consumeOauthState(fresh)).toBe(false)
  })

  it('a página de retorno nunca executa o que vem na URL', async () => {
    const res = await callback(new NextRequest('http://localhost:3001/api/whatsapp/oauth/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E'))
    const html = await res.text()
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;alert(1)')
    // Dentro do script, o texto vai como JSON sem "</script>" literal
    expect(html).toContain('\\u003cscript>alert(1)\\u003c/script>')
    expect(html).toMatch(/postMessage\(.*,'\*'\)/)
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
  })
})

describe('middleware', () => {
  const req = (path: string, headers: Record<string, string>) => new NextRequest(`http://localhost:3001${path}`, { headers })

  it('bloqueia a API vinda de outro host ou de outro site', () => {
    expect(middleware(req('/api/keys', { host: 'abc.trycloudflare.com' })).status).toBe(403)
    expect(middleware(req('/api/keys', { host: 'localhost:3001', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(middleware(req('/api/keys', { host: 'localhost:3001', origin: 'https://evil.example' })).status).toBe(403)
    expect(middleware(req('/api/keys', { host: 'localhost:3001' })).headers.get('x-middleware-next')).toBe('1')
  })

  it('deixa só o webhook da Meta passar pelo túnel (ele se autentica por HMAC)', () => {
    expect(middleware(req('/api/whatsapp/webhook', { host: 'abc.trycloudflare.com' })).headers.get('x-middleware-next')).toBe('1')
    expect(middleware(req('/api/whatsapp/webhook-x', { host: 'abc.trycloudflare.com' })).status).toBe(403)
    expect(middleware(req('/api/whatsapp/send', { host: 'abc.trycloudflare.com' })).status).toBe(403)
  })
})
