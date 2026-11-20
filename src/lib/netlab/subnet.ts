/**
 * Calculadora IPv4 de engenheiro de redes: sub-rede, divisão em partes iguais, VLSM e sumarização.
 * Tudo determinístico e local (nenhum modelo de IA envolvido) — a resposta é sempre exata.
 */
import { intToIp, ipToInt, maskOf, type Cidr } from './ip'

export interface SubnetInfo {
  input: string
  address: string
  prefix: number
  mask: string
  wildcard: string
  network: string
  broadcast: string
  firstHost: string
  lastHost: string
  /** Endereços utilizáveis por hosts (/31 e /32 seguem a RFC 3021 / rota de host). */
  usable: number
  total: number
  kind: string
  klass: string
  binaryMask: string
}

const MAX = 0xffffffff

/** Converte "255.255.255.192" no prefixo (26); recusa máscaras não contíguas. */
export function maskToPrefix(mask: string): number | null {
  const n = ipToInt(mask)
  if (n === null) return null
  const inv = (~n) >>> 0
  // contígua: o complemento + 1 é potência de 2
  if (((inv + 1) & inv) !== 0) return null
  let p = 0
  for (let b = 31; b >= 0 && (n >>> b) & 1; b--) p++
  return p
}

/**
 * Lê "192.168.1.10/26", "192.168.1.10 255.255.255.192", "192.168.1.10 máscara 255.255.255.192"
 * ou "192.168.1.10 /26". Sem prefixo, usa o padrão da classe (A=/8, B=/16, C=/24).
 */
export function parseNetInput(text: string): { ip: number; prefix: number; input: string } | null {
  // O espaço fica dentro de cada alternativa: um \s* fora do grupo "comia" o espaço e a máscara decimal nunca casava
  const m = text.match(/(\d{1,3}(?:\.\d{1,3}){3})(?:\s*\/\s*(\d{1,2})|\s+(?:(?:m[aá]scara|mask|netmask)\s*:?\s*)?(\d{1,3}(?:\.\d{1,3}){3}))?/i)
  if (!m) return null
  const ip = ipToInt(m[1])
  if (ip === null) return null
  let prefix: number | null = null
  if (m[2] !== undefined) prefix = Number(m[2])
  else if (m[3]) prefix = maskToPrefix(m[3])
  else {
    const first = ip >>> 24
    prefix = first < 128 ? 8 : first < 192 ? 16 : 24
  }
  if (prefix === null || prefix < 0 || prefix > 32) return null
  return { ip, prefix, input: `${m[1]}/${prefix}` }
}

export function addressKind(ip: number): string {
  const a = ip >>> 24, b = (ip >>> 16) & 255
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'privado (RFC 1918)'
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT (RFC 6598) — compartilhado pela operadora'
  if (a === 127) return 'loopback'
  if (a === 169 && b === 254) return 'link-local (APIPA) — o DHCP não respondeu'
  if (a >= 224 && a <= 239) return 'multicast'
  if (a >= 240) return 'reservado'
  if (a === 0) return '"esta rede" (0.0.0.0/8)'
  if ((a === 192 && b === 0 && ((ip >>> 8) & 255) === 2) || (a === 198 && (b === 51 && ((ip >>> 8) & 255) === 100)) || (a === 203 && b === 0 && ((ip >>> 8) & 255) === 113)) return 'documentação (TEST-NET)'
  return 'público'
}

function klassOf(ip: number) {
  const a = ip >>> 24
  return a < 128 ? 'A' : a < 192 ? 'B' : a < 224 ? 'C' : a < 240 ? 'D (multicast)' : 'E (reservada)'
}

export function subnetInfo(ip: number, prefix: number, input?: string): SubnetInfo {
  const mask = maskOf(prefix)
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const total = 2 ** (32 - prefix)
  const usable = prefix === 32 ? 1 : prefix === 31 ? 2 : total - 2
  const first = prefix >= 31 ? network : network + 1
  const last = prefix >= 31 ? broadcast : broadcast - 1
  const bin = mask.toString(2).padStart(32, '0')
  return {
    input: input || `${intToIp(ip)}/${prefix}`,
    address: intToIp(ip),
    prefix,
    mask: intToIp(mask),
    wildcard: intToIp((~mask) >>> 0),
    network: intToIp(network),
    broadcast: intToIp(broadcast),
    firstHost: intToIp(first),
    lastHost: intToIp(last),
    usable,
    total,
    kind: addressKind(ip),
    klass: klassOf(ip),
    binaryMask: bin.match(/.{8}/g)!.join('.'),
  }
}

/** Menor prefixo cujo bloco comporta `hosts` máquinas (mais rede e broadcast). */
export function prefixForHosts(hosts: number): number {
  // 1–2 hosts: /30, o clássico ponto a ponto entre roteadores
  if (hosts <= 2) return 30
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts) return p
  return 0
}

export interface Block { name?: string; wantHosts?: number; network: string; prefix: number; mask: string; firstHost: string; lastHost: string; broadcast: string; usable: number }

function block(network: number, prefix: number, name?: string, wantHosts?: number): Block {
  const i = subnetInfo(network, prefix)
  return { name, wantHosts, network: i.network, prefix, mask: i.mask, firstHost: i.firstHost, lastHost: i.lastHost, broadcast: i.broadcast, usable: i.usable }
}

/** Divide uma rede em N partes iguais (arredonda N para a próxima potência de 2) ou no prefixo pedido. */
export function splitEqual(base: Cidr | { network: number; prefix: number }, opts: { parts?: number; newPrefix?: number }): { blocks: Block[]; note?: string } {
  let newPrefix = opts.newPrefix
  let note: string | undefined
  if (newPrefix === undefined) {
    const parts = Math.max(1, Math.floor(opts.parts || 1))
    const bits = Math.ceil(Math.log2(parts))
    newPrefix = base.prefix + bits
    if (2 ** bits !== parts) note = `${parts} não é potência de 2: a rede foi dividida em ${2 ** bits} blocos iguais (/${newPrefix}); use os ${parts} primeiros e guarde o resto para crescer.`
  }
  if (newPrefix < base.prefix) throw new Error(`/${newPrefix} é maior que a rede original /${base.prefix}`)
  if (newPrefix > 32) throw new Error('Não cabe: a divisão passaria de /32')
  const count = 2 ** (newPrefix - base.prefix)
  if (count > 1024) throw new Error(`Seriam ${count} sub-redes — peça no máximo 1024`)
  const size = 2 ** (32 - newPrefix)
  const net = (base.network & maskOf(base.prefix)) >>> 0
  return { blocks: Array.from({ length: count }, (_, i) => block(net + i * size, newPrefix!)), note }
}

export interface VlsmResult { blocks: Block[]; free: Block[]; usedPct: number }

/**
 * VLSM: cada pedido recebe o menor bloco que comporta seus hosts, alocando do maior para o menor
 * (o que evita desalinhamento). Lança erro claro quando a soma não cabe na rede.
 */
export function vlsm(base: { network: number; prefix: number }, requests: Array<{ name?: string; hosts: number }>): VlsmResult {
  if (!requests.length) throw new Error('Informe quantos hosts cada sub-rede precisa')
  const net = (base.network & maskOf(base.prefix)) >>> 0
  const end = net + 2 ** (32 - base.prefix)
  const sorted = requests.map((r, i) => ({ ...r, i, prefix: prefixForHosts(r.hosts) })).sort((a, b) => a.prefix - b.prefix || a.i - b.i)
  let cursor = net
  const blocks: Block[] = []
  for (const r of sorted) {
    if (r.prefix < base.prefix) throw new Error(`${r.name || `A sub-rede de ${r.hosts} hosts`} precisa de um /${r.prefix}, maior que a rede inteira /${base.prefix}`)
    const size = 2 ** (32 - r.prefix)
    cursor = Math.ceil((cursor - net) / size) * size + net
    if (cursor + size > end) {
      const need = sorted.reduce((s, x) => s + 2 ** (32 - x.prefix), 0)
      throw new Error(`Não cabe em ${intToIp(net)}/${base.prefix}: os pedidos somam ${need} endereços e a rede tem ${end - net}. Use uma rede maior (ex.: /${Math.max(0, 32 - Math.ceil(Math.log2(need)))}) ou reduza os hosts.`)
    }
    blocks.push(block(cursor, r.prefix, r.name, r.hosts))
    cursor += size
  }
  // Espaço livre ao fim, em blocos alinhados (para crescer depois)
  const free: Block[] = []
  let c = cursor
  while (c < end && free.length < 16) {
    let p = 32
    while (p > base.prefix && c % 2 ** (33 - p) === 0 && c + 2 ** (33 - p) <= end) p--
    free.push(block(c, p))
    c += 2 ** (32 - p)
  }
  const used = blocks.reduce((s, b) => s + 2 ** (32 - b.prefix), 0)
  return { blocks, free, usedPct: Math.round((used / (end - net)) * 100) }
}

/** Menor rede que engloba todas as dadas (sumarização de rotas / supernet). */
export function summarize(nets: Array<{ network: number; prefix: number }>): { network: string; prefix: number; exact: boolean; extra: number } {
  if (!nets.length) throw new Error('Informe as redes para sumarizar')
  const ranges = nets.map(n => { const s = (n.network & maskOf(n.prefix)) >>> 0; return [s, s + 2 ** (32 - n.prefix) - 1] as const })
  const lo = Math.min(...ranges.map(r => r[0]))
  const hi = Math.max(...ranges.map(r => r[1]))
  let p = 32
  while (p > 0 && ((lo & maskOf(p)) >>> 0) + 2 ** (32 - p) - 1 < hi) p--
  while (p > 0 && ((lo & maskOf(p)) >>> 0) !== ((hi & maskOf(p)) >>> 0)) p--
  const network = (lo & maskOf(p)) >>> 0
  const covered = 2 ** (32 - p)
  // Endereços somados das redes (sem contar sobreposição)
  const merged = [...ranges].sort((a, b) => a[0] - b[0]).reduce<Array<[number, number]>>((acc, [s, e]) => {
    const last = acc[acc.length - 1]
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else acc.push([s, e])
    return acc
  }, [])
  const real = merged.reduce((s, [a, b]) => s + (b - a + 1), 0)
  return { network: intToIp(network), prefix: p, exact: real === covered, extra: Math.min(MAX, covered - real) }
}

// ── Texto para o chat ────────────────────────────────────────────────────────

const n = (v: number) => v.toLocaleString('pt-BR')

export function infoText(i: SubnetInfo) {
  const hostLine = i.prefix === 32 ? 'rota de host (/32): um único endereço' : i.prefix === 31 ? 'ponto a ponto (/31, RFC 3021): os 2 endereços são usáveis' : `${i.firstHost} – ${i.lastHost}`
  return [
    `🧮 **${i.input}**`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| Rede | \`${i.network}/${i.prefix}\` |`,
    `| Máscara | \`${i.mask}\` (/${i.prefix}) |`,
    `| Wildcard (ACL/OSPF) | \`${i.wildcard}\` |`,
    `| Broadcast | \`${i.broadcast}\` |`,
    `| Hosts utilizáveis | ${hostLine} |`,
    `| Quantidade | **${n(i.usable)}** hosts (${n(i.total)} endereços no bloco) |`,
    `| Tipo | ${i.kind} · classe ${i.klass} |`,
    `| Máscara em binário | \`${i.binaryMask}\` |`,
    i.address !== i.network && i.address !== i.broadcast ? '' : i.prefix < 31 ? `\n⚠️ ${i.address} é o endereço de ${i.address === i.network ? 'rede' : 'broadcast'} — não pode ser usado num host.` : '',
  ].filter(l => l !== '').join('\n')
}

export function blocksTable(blocks: Block[], withNames = false) {
  const head = withNames ? '| Sub-rede | Pedido | Rede | Máscara | Hosts úteis | Faixa de hosts | Broadcast |\n|---|---|---|---|---|---|---|' : '| # | Rede | Máscara | Hosts úteis | Faixa de hosts | Broadcast |\n|---|---|---|---|---|---|'
  const rows = blocks.map((b, i) => withNames
    ? `| ${b.name || `Sub-rede ${i + 1}`} | ${b.wantHosts !== undefined ? n(b.wantHosts) : '—'} | \`${b.network}/${b.prefix}\` | ${b.mask} | ${n(b.usable)} | ${b.firstHost} – ${b.lastHost} | ${b.broadcast} |`
    : `| ${i + 1} | \`${b.network}/${b.prefix}\` | ${b.mask} | ${n(b.usable)} | ${b.firstHost} – ${b.lastHost} | ${b.broadcast} |`)
  return `${head}\n${rows.join('\n')}`
}
