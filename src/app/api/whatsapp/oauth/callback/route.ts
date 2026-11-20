import { NextRequest } from 'next/server'
import { oauthCallback } from '@/lib/whatsapp/meta/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Tudo que vem da URL ou do provedor é texto: nunca vira HTML ou código na página de retorno
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => (c === '\u2028' ? '\\u2028' : '\\u2029'))

function page(title: string, payload: { type: 'wa-oauth'; ok: boolean; error?: string }, closeAfterMs?: number) {
  // Só ok/erro vão para a janela que abriu o popup: nada de token ou segredo na mensagem
  const script = `if(window.opener){try{window.opener.postMessage(${scriptJson(payload)},'*')}catch(e){}}${closeAfterMs ? `setTimeout(function(){window.close()},${closeAfterMs})` : ''}`
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>JARVIS · WhatsApp</title></head><body style="font-family:system-ui;background:#0b0b0c;color:#e5e5e5;padding:24px"><h3>${escapeHtml(title)}</h3><script>${script}</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' } },
  )
}

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams
  const code = q.get('code')
  const state = q.get('state') || ''
  const error = q.get('error_description') || q.get('error')
  if (error) return page(`Erro OAuth: ${error.slice(0, 300)}`, { type: 'wa-oauth', ok: false, error: error.slice(0, 300) }, 2500)
  if (!code) return new Response('code ausente', { status: 400 })
  const r = await oauthCallback(code, state)
  return r.ok
    ? page('WhatsApp conectado com sucesso! Você pode fechar esta janela.', { type: 'wa-oauth', ok: true }, 1500)
    : page(`Falha: ${r.error || 'erro desconhecido'}`, { type: 'wa-oauth', ok: false, error: r.error })
}
