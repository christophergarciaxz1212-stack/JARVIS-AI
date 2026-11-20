import dns from 'dns/promises'
import net from 'net'

/**
 * SSRF guard for user-configured URLs (calendars, brand sites, imports).
 * - HTTPS only (or http for non-https-only callers by opt-in)
 * - hostname must not be a literal private/reserved IP
 * - DNS resolution must not return private/reserved addresses
 * - redirects are followed manually (max 5 hops) and every hop is re-checked
 */

const IPV4_BLOCKS: Array<[number, number]> = [
  [0x00000000, 0xff000000],      // 0.0.0.0/8 "this network"
  [0x0a000000, 0xff000000],      // 10.0.0.0/8
  [0x7f000000, 0xff000000],      // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xffff0000],      // 169.254.0.0/16 link-local (incl. cloud metadata)
  [0xac100000, 0xfff00000],      // 172.16.0.0/12
  [0xc0a80000, 0xffff0000],      // 192.168.0.0/16
  [0x64400000, 0xffc00000],      // 100.64.0.0/10 CGNAT
  [0xc0000000, 0xffffff00],      // 192.0.0.0/24
  [0xc0000200, 0xffffff00],      // 192.0.2.0/24 TEST-NET-1
  [0xc6120000, 0xfffe0000],      // 198.18.0.0/15 benchmarking
  [0xc6336400, 0xffffff00],      // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xffffff00],      // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 0xf0000000],      // 224.0.0.0/4 multicast + reserved
]

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function isBlockedIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) ip = mapped[1]

  const v4 = ipv4ToLong(ip)
  if (v4 !== null) return IPV4_BLOCKS.some(([base, mask]) => (v4 & mask) >>> 0 === (base & mask) >>> 0)

  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true   // unique local
  if (/^fe[89ab]/.test(lower)) return true                             // link-local
  if (lower.startsWith('ff')) return true                              // multicast
  return false
}

export function isPrivateHostLiteral(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  if (net.isIP(h)) return isBlockedIp(h)
  return false
}

export async function assertPublicHttpsUrl(raw: string, { allowHttp = false }: { allowHttp?: boolean } = {}): Promise<URL> {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('URL inválida') }
  if (u.protocol === 'http:' && !allowHttp) throw new Error('Use https://')
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Apenas URLs http(s)')
  if (u.username || u.password) throw new Error('URLs com credenciais não são aceitas')

  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isPrivateHostLiteral(host)) throw new Error('Endereço privado ou local — recusado')

  if (!net.isIP(host)) {
    let addrs: Array<{ address: string }>
    try {
      addrs = await dns.lookup(host, { all: true, verbatim: true })
    } catch {
      throw new Error(`Não foi possível resolver o endereço: ${host}`)
    }
    if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) {
      throw new Error('O endereço aponta para uma rede privada — recusado')
    }
  }
  return u
}

export async function fetchPublicText(raw: string, { maxBytes = 4 * 1024 * 1024, timeoutMs = 20_000, maxRedirects = 5, headers = {} }: {
  maxBytes?: number; timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string>
} = {}): Promise<string> {
  let url = raw
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicHttpsUrl(url)
    const res = await fetch(u, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`Redirecionamento sem destino (${res.status})`)
      url = new URL(loc, u).toString()
      continue
    }
    if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`)
    if (!res.body) return ''

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`Resposta maior que ${Math.round(maxBytes / 1024 / 1024)} MB — recusada`)
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))))
  }
  throw new Error('Redirecionamentos demais')
}
