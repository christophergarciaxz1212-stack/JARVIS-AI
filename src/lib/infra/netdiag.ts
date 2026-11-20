import dns from 'dns'
import net from 'net'
import http from 'http'
import https from 'https'
import type { TLSSocket } from 'tls'
import { parseJsonList, runPowerShell, runProgram } from './exec'

export interface Target { input: string; host: string; port?: number; url?: string }

export function isValidHost(host: string) {
  return !!host && host.length <= 253 && !host.startsWith('-') && /^[a-z0-9.\-:[\]_]+$/i.test(host)
}

/** Accepts "site.com", "1.2.3.4:5432", "https://site.com/path", "[::1]:8080". */
export function parseTarget(input: string): Target {
  const raw = input.trim()
  if (!raw) throw new Error('Informe um host, IP, host:porta ou URL')
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw)
    const host = u.hostname.replace(/^\[|\]$/g, '')
    return { input: raw, host, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), url: u.toString() }
  }
  const v6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/)
  const hp = v6 ? [v6[1], v6[2]] : raw.split(':').length === 2 ? raw.split(':') : [raw, undefined]
  const host = String(hp[0])
  const port = hp[1] ? Number(hp[1]) : undefined
  if (!isValidHost(host)) throw new Error(`Host inválido: ${host}`)
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error(`Porta inválida: ${hp[1]}`)
  return { input: raw, host, port }
}

export interface DnsResult { ok: boolean; addresses: string[]; durationMs: number; error?: string }

export async function dnsCheck(host: string, timeoutMs = 5000): Promise<DnsResult> {
  const started = Date.now()
  if (net.isIP(host)) return { ok: true, addresses: [host], durationMs: 0 }
  try {
    const res = await Promise.race([
      dns.promises.lookup(host, { all: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('Tempo esgotado na resolução DNS'), { code: 'ETIMEOUT' })), timeoutMs)),
    ])
    return { ok: true, addresses: res.map(r => r.address), durationMs: Date.now() - started }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code || ''
    return { ok: false, addresses: [], durationMs: Date.now() - started, error: code === 'ENOTFOUND' ? 'Nome não encontrado (NXDOMAIN)' : `${code} ${(e as Error).message}`.trim() }
  }
}

export interface TcpResult { ok: boolean; host: string; port: number; latencyMs: number; error?: string; code?: string }

export function tcpCheck(host: string, port: number, timeoutMs = 4000): Promise<TcpResult> {
  return new Promise(resolve => {
    const started = Date.now()
    const sock = net.connect({ host, port })
    let settled = false
    const done = (r: Omit<TcpResult, 'host' | 'port' | 'latencyMs'>) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve({ host, port, latencyMs: Date.now() - started, ...r })
    }
    sock.setTimeout(timeoutMs, () => done({ ok: false, code: 'ETIMEDOUT', error: 'Sem resposta (timeout) — host desligado ou firewall descartando pacotes' }))
    sock.once('connect', () => done({ ok: true }))
    sock.once('error', (e: NodeJS.ErrnoException) => {
      const code = e.code || 'ERR'
      const msg = code === 'ECONNREFUSED' ? 'Conexão recusada — nada escutando nessa porta (serviço parado?)'
        : code === 'EHOSTUNREACH' || code === 'ENETUNREACH' ? 'Rede/host inalcançável — rota ou VPN ausente'
        : code === 'ENOTFOUND' ? 'Nome não resolve no DNS'
        : e.message
      done({ ok: false, code, error: msg })
    })
  })
}

export interface TlsInfo { authorized: boolean; error?: string; subject?: string; issuer?: string; validTo?: string; daysLeft?: number; protocol?: string | null }
export interface HttpResult { ok: boolean; url: string; status?: number; latencyMs: number; server?: string; location?: string; tls?: TlsInfo; error?: string }

export function httpCheck(url: string, timeoutMs = 8000): Promise<HttpResult> {
  return new Promise(resolve => {
    const started = Date.now()
    let u: URL
    try { u = new URL(url) } catch { resolve({ ok: false, url, latencyMs: 0, error: 'URL inválida' }); return }
    const lib = u.protocol === 'https:' ? https : http
    let settled = false
    const done = (r: Omit<HttpResult, 'url' | 'latencyMs'>) => {
      if (settled) return
      settled = true
      resolve({ url, latencyMs: Date.now() - started, ...r })
    }
    // Certificate problems are reported, not hidden: we connect anyway to read the cert, then flag it
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false, headers: { 'user-agent': 'JARVIS-InfraCore/1.0', accept: '*/*' } }, res => {
      let tls: TlsInfo | undefined
      const sock = res.socket as TLSSocket
      if (u.protocol === 'https:' && typeof sock.getPeerCertificate === 'function') {
        const cert = sock.getPeerCertificate()
        const validTo = cert?.valid_to
        const daysLeft = validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / 86_400_000) : undefined
        tls = {
          authorized: sock.authorized,
          error: sock.authorized ? undefined : String(sock.authorizationError || 'certificado não confiável'),
          subject: typeof cert?.subject?.CN === 'string' ? cert.subject.CN : undefined,
          issuer: typeof cert?.issuer?.O === 'string' ? cert.issuer.O : typeof cert?.issuer?.CN === 'string' ? cert.issuer.CN : undefined,
          validTo,
          daysLeft,
          protocol: sock.getProtocol?.() ?? null,
        }
      }
      const status = res.statusCode || 0
      res.destroy()
      const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
      done({ ok: status > 0 && status < 400, status, server: header(res.headers.server), location: header(res.headers.location), tls })
    })
    req.on('timeout', () => { req.destroy(); done({ ok: false, error: `Sem resposta em ${Math.round(timeoutMs / 1000)}s` }) })
    req.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code === 'ECONNREFUSED' ? 'Conexão recusada' : e.code === 'ENOTFOUND' ? 'Nome não resolve' : e.message }))
    req.end()
  })
}

export interface PingResult { ok: boolean; sent: number; received: number; lossPct: number; minMs?: number; avgMs?: number; maxMs?: number; raw: string; error?: string }

export function parsePing(output: string, sent: number): Omit<PingResult, 'raw'> {
  const times = [...output.matchAll(/(?:time|tempo|Zeit|temps|tiempo)\s*[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/gi)].map(m => Number(m[1].replace(',', '.')))
  const received = times.length
  const lossPct = sent ? Math.round(((sent - received) / sent) * 100) : 100
  if (!received) return { ok: false, sent, received: 0, lossPct: 100, error: 'Sem resposta ao ping (host offline ou ICMP bloqueado)' }
  const avg = times.reduce((a, b) => a + b, 0) / received
  return { ok: true, sent, received, lossPct, minMs: Math.min(...times), avgMs: Math.round(avg * 10) / 10, maxMs: Math.max(...times) }
}

export async function ping(host: string, count = 4): Promise<PingResult> {
  if (!isValidHost(host)) throw new Error(`Host inválido: ${host}`)
  const n = Math.max(1, Math.min(10, count))
  const args = process.platform === 'win32' ? ['-n', String(n), '-w', '1500', host] : ['-c', String(n), '-W', '2', host]
  const r = await runProgram('ping', args, { timeoutMs: n * 2500 + 4000 })
  return { ...parsePing(r.stdout, n), raw: r.stdout.trim().slice(-1500) }
}

export async function traceroute(host: string): Promise<{ hops: string[]; raw: string }> {
  if (!isValidHost(host)) throw new Error(`Host inválido: ${host}`)
  const r = process.platform === 'win32'
    ? await runProgram('tracert', ['-d', '-h', '20', '-w', '800', host], { timeoutMs: 70_000 })
    : await runProgram('traceroute', ['-n', '-m', '20', '-w', '1', host], { timeoutMs: 70_000 })
  const hops = r.stdout.split(/\r?\n/).filter(l => /^\s*\d+\s/.test(l)).map(l => l.trim().replace(/\s+/g, ' '))
  return { hops, raw: r.stdout.trim().slice(-4000) }
}

export interface ListeningPort { address: string; port: number; pid: number; process: string; exposed: boolean }

export async function listeningPorts(): Promise<ListeningPort[]> {
  if (process.platform === 'win32') {
    const r = await runPowerShell(
      "$p=@{}; Get-Process | ForEach-Object { $p[$_.Id]=$_.ProcessName }; Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess,@{n='Proc';e={$p[[int]$_.OwningProcess]}} | Sort-Object LocalPort -Unique | ConvertTo-Json -Compress",
      20_000,
    )
    return parseJsonList<{ LocalAddress: string; LocalPort: number; OwningProcess: number; Proc?: string }>(r.stdout).map(x => ({
      address: x.LocalAddress, port: x.LocalPort, pid: x.OwningProcess, process: x.Proc || '?', exposed: !/^(127\.|::1$)/.test(x.LocalAddress),
    }))
  }
  const r = await runProgram('ss', ['-tlnpH'], { timeoutMs: 10_000 })
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const cols = line.trim().split(/\s+/)
    const local = cols[3] || ''
    const idx = local.lastIndexOf(':')
    const address = local.slice(0, idx).replace(/^\[|\]$/g, '')
    const proc = line.match(/users:\(\("([^"]+)",pid=(\d+)/)
    return { address, port: Number(local.slice(idx + 1)), pid: Number(proc?.[2] || 0), process: proc?.[1] || '?', exposed: !/^(127\.|::1$|localhost)/.test(address) }
  })
}

export interface Diagnosis {
  target: Target
  dns?: DnsResult
  ping?: PingResult
  tcp?: TcpResult
  http?: HttpResult
  findings: string[]
  verdict: 'ok' | 'degradado' | 'falha'
  probableCause?: string
}

/** End-to-end connectivity diagnosis with a probable cause, layer by layer. */
export async function diagnose(input: string): Promise<Diagnosis> {
  const target = parseTarget(input)
  const d: Diagnosis = { target, findings: [], verdict: 'ok' }
  d.dns = await dnsCheck(target.host)
  if (!d.dns.ok) {
    d.verdict = 'falha'
    d.probableCause = `DNS: ${d.dns.error}. Verifique o nome, o registro no provedor de DNS (A/AAAA/CNAME) ou o servidor DNS configurado.`
    d.findings.push(`DNS falhou em ${d.dns.durationMs} ms`)
    return d
  }
  d.findings.push(`DNS ok (${d.dns.durationMs} ms): ${d.dns.addresses.slice(0, 4).join(', ')}`)
  if (d.dns.durationMs > 1500) d.findings.push('Resolução DNS lenta (> 1,5 s) — considere outro resolvedor (1.1.1.1 / 8.8.8.8)')

  const [pingRes, tcpRes] = await Promise.all([
    ping(target.host, 3).catch(e => ({ ok: false, sent: 3, received: 0, lossPct: 100, raw: '', error: (e as Error).message }) as PingResult),
    target.port ? tcpCheck(target.host, target.port) : Promise.resolve(undefined),
  ])
  d.ping = pingRes
  d.tcp = tcpRes
  if (pingRes.ok) {
    d.findings.push(`Ping ok: média ${pingRes.avgMs} ms, perda ${pingRes.lossPct}%`)
    if ((pingRes.avgMs ?? 0) > 150) d.findings.push('Latência alta (> 150 ms)')
    if (pingRes.lossPct > 0) d.findings.push(`Perda de pacotes de ${pingRes.lossPct}% — rede instável`)
  } else d.findings.push('Ping sem resposta (muitos servidores bloqueiam ICMP; não é conclusivo sozinho)')

  if (tcpRes) {
    if (tcpRes.ok) d.findings.push(`Porta ${tcpRes.port} aberta (${tcpRes.latencyMs} ms)`)
    else {
      d.findings.push(`Porta ${tcpRes.port}: ${tcpRes.error}`)
      d.verdict = 'falha'
      d.probableCause = tcpRes.code === 'ECONNREFUSED'
        ? `O host responde, mas nada escuta na porta ${tcpRes.port}: o serviço está parado ou ligado em outra porta/interface (ex.: só 127.0.0.1).`
        : tcpRes.code === 'ETIMEDOUT'
          ? (pingRes.ok ? `O host está online, mas a porta ${tcpRes.port} não responde: firewall/security group/NAT bloqueando.` : 'Host offline, sem rota, ou firewall bloqueando tudo.')
          : tcpRes.error
      return d
    }
  }

  if (target.url) {
    d.http = await httpCheck(target.url)
    const h = d.http
    if (h.error) {
      d.verdict = 'falha'
      d.probableCause = `HTTP: ${h.error}`
    } else {
      d.findings.push(`HTTP ${h.status} em ${h.latencyMs} ms${h.server ? ` (${h.server})` : ''}${h.location ? ` → ${h.location}` : ''}`)
      if ((h.status ?? 0) >= 500) { d.verdict = 'falha'; d.probableCause = `A aplicação respondeu ${h.status}: erro no servidor/upstream (veja os logs da aplicação e do proxy reverso).` }
      else if ((h.status ?? 0) >= 400) { d.verdict = 'degradado'; d.probableCause = `Resposta ${h.status}: rota, autenticação ou permissão.` }
      if (h.latencyMs > 2000) { d.findings.push('Tempo de resposta acima de 2 s'); if (d.verdict === 'ok') d.verdict = 'degradado' }
    }
    if (h.tls) {
      if (!h.tls.authorized) { d.findings.push(`Certificado TLS inválido: ${h.tls.error}`); if (d.verdict === 'ok') d.verdict = 'degradado' }
      if (h.tls.daysLeft !== undefined) {
        d.findings.push(`Certificado de ${h.tls.issuer || '?'} vence em ${h.tls.daysLeft} dia(s)${h.tls.protocol ? ` · ${h.tls.protocol}` : ''}`)
        if (h.tls.daysLeft < 14) { d.findings.push('Renove o certificado (certbot renew / Caddy renova sozinho)'); if (d.verdict === 'ok') d.verdict = 'degradado' }
      }
    }
  }
  return d
}
