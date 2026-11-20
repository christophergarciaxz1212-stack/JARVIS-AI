import { NextRequest, NextResponse } from 'next/server'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const PUBLIC_WEBHOOK = '/api/whatsapp/webhook'

function hostname(hostHeader: string) {
  return hostHeader.replace(/:\d+$/, '')
}

// The API can run PowerShell, write files and read saved keys, so only JARVIS's own
// pages on this machine may call it: blocks other devices, other websites (CSRF)
// and DNS-rebinding tricks.
export function middleware(req: NextRequest) {
  // Única rota pública: o webhook da Meta chega por túnel HTTPS (Host público, sem navegador).
  // Ela se autentica sozinha (verify token no GET, HMAC do App Secret no POST, fail closed).
  if (req.nextUrl.pathname === PUBLIC_WEBHOOK) return NextResponse.next()

  const host = req.headers.get('host') || ''
  if (!LOCAL_HOSTS.has(hostname(host))) {
    return NextResponse.json({ error: 'Acesso permitido só neste computador' }, { status: 403 })
  }

  // <img>/<script> tags from other sites send no Origin, but browsers still label them
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site' || site === 'same-site') {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403 })
  }

  const origin = req.headers.get('origin')
  if (origin) {
    let originHost = ''
    try { originHost = new URL(origin).host } catch {}
    if (originHost !== host) {
      return NextResponse.json({ error: 'Origem não permitida' }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
