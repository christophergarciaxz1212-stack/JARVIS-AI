import type { DeviceType, Issue, LinkKind, NetLink, NetNode, Topology, Vlan, Zone } from './types'
import { intToIp, ipToInt, isHostAddress, overlaps, parseCidr, sameSubnet } from './ip'

const TYPE_ALIASES: Array<[RegExp, DeviceType]> = [
  [/fortigate|firewall|fw|palo|pfsense|asa|sophos|checkpoint|utm/i, 'firewall'],
  [/l3|core|multilayer|layer ?3|distribui/i, 'l3switch'],
  [/switch|sw\b/i, 'switch'],
  [/router|roteador|rtr|isp|edge router|mikrotik/i, 'router'],
  [/internet|wan|isp cloud/i, 'internet'],
  [/cloud|nuvem|aws|azure|gcp|oracle|saas/i, 'cloud'],
  [/load ?balancer|balanceador|lb|f5|haproxy/i, 'loadbalancer'],
  [/access ?point|\bap\b|wifi|wi-fi|wireless/i, 'ap'],
  [/nas|storage|san/i, 'nas'],
  [/\bvm\b|virtual/i, 'vm'],
  [/server|servidor|srv|dc\b|ad\b|dns|dhcp|web|db|banco|linux|windows server/i, 'server'],
  [/laptop|notebook/i, 'laptop'],
  [/phone|voip|telefone/i, 'phone'],
  [/printer|impressora/i, 'printer'],
  [/camera|cftv|cam\b/i, 'camera'],
  [/pc|desktop|workstation|estacao|estação|host|client|cliente|win/i, 'pc'],
]
const TYPES: DeviceType[] = ['router', 'switch', 'l3switch', 'firewall', 'server', 'pc', 'laptop', 'cloud', 'internet', 'ap', 'loadbalancer', 'nas', 'phone', 'printer', 'camera', 'vm']
const KINDS: LinkKind[] = ['ethernet', 'access', 'trunk', 'wan', 'ha', 'vpn', 'wireless', 'fiber']

export function toType(v: unknown, label = ''): DeviceType {
  const s = String(v || '').toLowerCase().trim()
  if ((TYPES as string[]).includes(s)) return s as DeviceType
  const hit = TYPE_ALIASES.find(([re]) => re.test(s) || re.test(label))
  return hit ? hit[1] : 'server'
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'n'
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '')

/** Accepts the loose JSON a model writes and returns a clean, consistent topology. */
export function normalizeTopology(raw: Record<string, unknown>, base: Partial<Topology> = {}): Topology {
  const zones: Zone[] = []
  const zoneIds = new Set<string>()
  for (const z of (Array.isArray(raw.zones) ? raw.zones : []) as Array<Record<string, unknown>>) {
    const label = str(z.label || z.name || z.id, 60)
    if (!label) continue
    let id = slug(str(z.id) || label)
    while (zoneIds.has(id)) id += '-2'
    zoneIds.add(id)
    zones.push({ id, label, color: /^#[0-9a-f]{6}$/i.test(str(z.color)) ? str(z.color) : undefined })
  }
  const zoneOf = (v: unknown) => {
    const s = str(v, 60)
    if (!s) return undefined
    const hit = zones.find(z => z.id === slug(s) || z.label.toLowerCase() === s.toLowerCase())
    if (hit) return hit.id
    const id = slug(s)
    zones.push({ id, label: s })
    zoneIds.add(id)
    return id
  }

  const nodes: NetNode[] = []
  const nodeIds = new Map<string, string>()
  for (const n of (Array.isArray(raw.nodes) ? raw.nodes : []) as Array<Record<string, unknown>>) {
    const label = str(n.label || n.name || n.hostname || n.id, 60)
    if (!label) continue
    let id = slug(str(n.id) || label)
    while ([...nodeIds.values()].includes(id)) id += '-2'
    for (const k of [str(n.id), label, str(n.name), str(n.hostname)].filter(Boolean)) nodeIds.set(k.toLowerCase(), id)
    const ifaces = (Array.isArray(n.ifaces) ? n.ifaces : Array.isArray(n.interfaces) ? n.interfaces : []) as Array<Record<string, unknown>>
    nodes.push({
      id, label,
      type: toType(n.type || n.kind || n.role, label),
      vendor: str(n.vendor, 40) || undefined,
      model: str(n.model, 60) || undefined,
      zone: zoneOf(n.zone || n.site || n.area),
      mgmt: str(n.mgmt || n.management, 40) || undefined,
      notes: str(n.notes || n.description, 300) || undefined,
      ifaces: ifaces.map(i => ({
        name: str(i.name || i.port, 30),
        ip: str(i.ip || i.address, 40) || undefined,
        vlan: Number(i.vlan) > 0 ? Number(i.vlan) : undefined,
        vlans: Array.isArray(i.vlans) ? i.vlans.map(Number).filter(v => v > 0 && v < 4095) : undefined,
        mode: (['access', 'trunk', 'routed'] as const).find(m => m === i.mode),
        description: str(i.description, 80) || undefined,
      })).filter(i => i.name).slice(0, 64),
      x: typeof n.x === 'number' ? n.x : undefined,
      y: typeof n.y === 'number' ? n.y : undefined,
    })
  }
  const nodeRef = (v: unknown) => nodeIds.get(str(v, 60).toLowerCase())

  const links: NetLink[] = []
  for (const [i, l] of ((Array.isArray(raw.links) ? raw.links : []) as Array<Record<string, unknown>>).entries()) {
    const a = nodeRef(l.a || l.from || l.source)
    const b = nodeRef(l.b || l.to || l.target)
    if (!a || !b || a === b) continue
    links.push({
      id: str(l.id) ? slug(str(l.id)) : `l${i + 1}`,
      a, b,
      aPort: str(l.aPort || l.fromPort || l.sourcePort || l.a_port, 30) || undefined,
      bPort: str(l.bPort || l.toPort || l.targetPort || l.b_port, 30) || undefined,
      kind: (KINDS as string[]).includes(str(l.kind || l.type).toLowerCase()) ? (str(l.kind || l.type).toLowerCase() as LinkKind) : undefined,
      label: str(l.label, 60) || undefined,
      subnet: str(l.subnet, 40) || undefined,
    })
  }

  const vlans: Vlan[] = ((Array.isArray(raw.vlans) ? raw.vlans : []) as Array<Record<string, unknown>>)
    .map(v => ({ id: Number(v.id ?? v.vlan), name: str(v.name, 40), subnet: str(v.subnet, 40) || undefined, gateway: str(v.gateway, 40) || undefined }))
    .filter(v => Number.isInteger(v.id) && v.id > 0 && v.id < 4095)

  // Zones nobody uses are dropped
  const used = new Set(nodes.map(n => n.zone).filter(Boolean))
  return {
    id: base.id || '',
    title: str(raw.title, 120) || base.title || 'Topologia de rede',
    description: str(raw.description, 600) || base.description,
    zones: zones.filter(z => used.has(z.id)),
    nodes, links, vlans,
    notes: (Array.isArray(raw.notes) ? raw.notes.map(n => str(n, 300)).filter(Boolean) : []).slice(0, 20),
    createdAt: base.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
}

/** Addressing and wiring checks an engineer would do before deploying the design. */
export function validateTopology(t: Topology): Issue[] {
  const issues: Issue[] = []
  const byId = new Map(t.nodes.map(n => [n.id, n]))
  const seenIp = new Map<string, string>()
  for (const n of t.nodes) {
    const ports = new Set<string>()
    for (const i of n.ifaces || []) {
      if (ports.has(i.name.toLowerCase())) issues.push({ level: 'error', node: n.id, message: `${n.label}: interface ${i.name} declarada duas vezes` })
      ports.add(i.name.toLowerCase())
      if (!i.ip || /dhcp/i.test(i.ip)) continue
      const c = parseCidr(i.ip)
      if (!c) { issues.push({ level: 'error', node: n.id, message: `${n.label} ${i.name}: IP inválido "${i.ip}" (use formato 10.0.0.1/24)` }); continue }
      if (!isHostAddress(c)) issues.push({ level: 'error', node: n.id, message: `${n.label} ${i.name}: ${i.ip} é endereço de rede/broadcast, não de host` })
      const ip = i.ip.split('/')[0]
      const owner = seenIp.get(ip)
      if (owner) issues.push({ level: 'error', node: n.id, message: `IP duplicado ${ip}: ${owner} e ${n.label} ${i.name}` })
      else seenIp.set(ip, `${n.label} ${i.name}`)
      if (i.vlan && !t.vlans.some(v => v.id === i.vlan) && t.vlans.length) issues.push({ level: 'warn', node: n.id, message: `${n.label} ${i.name}: VLAN ${i.vlan} não está na tabela de VLANs` })
    }
  }
  const portUse = new Map<string, string>()
  for (const l of t.links) {
    const a = byId.get(l.a), b = byId.get(l.b)
    if (!a || !b) { issues.push({ level: 'error', link: l.id, message: `Link ${l.id} aponta para equipamento inexistente` }); continue }
    for (const [n, p] of [[a, l.aPort], [b, l.bPort]] as const) {
      if (!p) continue
      const key = `${n.id}:${p.toLowerCase()}`
      if (portUse.has(key) && !['cloud', 'internet'].includes(n.type)) issues.push({ level: 'error', link: l.id, message: `${n.label} ${p} está ligada em dois cabos (${portUse.get(key)} e ${l.id})` })
      portUse.set(key, l.id)
    }
    const ia = a.ifaces?.find(i => i.name.toLowerCase() === l.aPort?.toLowerCase())
    const ib = b.ifaces?.find(i => i.name.toLowerCase() === l.bPort?.toLowerCase())
    const ca = parseCidr(ia?.ip), cb = parseCidr(ib?.ip)
    if (ca && cb && !sameSubnet(ca, cb)) issues.push({ level: 'error', link: l.id, message: `${a.label} ${l.aPort} (${ia!.ip}) e ${b.label} ${l.bPort} (${ib!.ip}) estão em sub-redes diferentes no mesmo cabo` })
    if (ia?.mode === 'trunk' && ib?.mode === 'access') issues.push({ level: 'warn', link: l.id, message: `${a.label} ${l.aPort} é trunk mas ${b.label} ${l.bPort} é access` })
  }
  // Two different subnets that overlap make routing ambiguous — VLANs, cable subnets and every interface network
  issues.push(...overlapIssues(t))
  const linked = new Set(t.links.flatMap(l => [l.a, l.b]))
  for (const n of t.nodes) if (!linked.has(n.id) && t.nodes.length > 1) issues.push({ level: 'warn', node: n.id, message: `${n.label} não tem nenhum cabo` })
  const ids = new Set<number>()
  for (const v of t.vlans) { if (ids.has(v.id)) issues.push({ level: 'error', message: `VLAN ${v.id} repetida` }); ids.add(v.id) }
  issues.push(...vlanIssues(t), ...gatewayIssues(t), ...edgeIssues(t), ...loopIssues(t), ...spofIssues(t))
  return issues
}

const L3: DeviceType[] = ['router', 'l3switch', 'firewall', 'loadbalancer']
const ENDPOINTS: DeviceType[] = ['server', 'pc', 'laptop', 'vm', 'nas', 'printer', 'phone', 'camera']
const net = (c: NonNullable<ReturnType<typeof parseCidr>>) => `${intToIp(c.network)}/${c.prefix}`
const nodeNetText = (t: Topology) => `${t.description || ''} ${t.notes.join(' ')} ${t.nodes.map(n => n.notes || '').join(' ')}`.toLowerCase()

function overlapIssues(t: Topology): Issue[] {
  const issues: Issue[] = []
  // Uma entrada por rede distinta, com quem a usa
  const nets = new Map<string, { c: NonNullable<ReturnType<typeof parseCidr>>; who: string }>()
  const add = (c: ReturnType<typeof parseCidr>, who: string) => {
    if (!c) return
    const key = net(c)
    if (!nets.has(key)) nets.set(key, { c, who })
  }
  for (const v of t.vlans) add(parseCidr(v.subnet), `VLAN ${v.id}`)
  for (const l of t.links) add(parseCidr(l.subnet), `cabo ${l.id}`)
  for (const n of t.nodes) for (const i of n.ifaces || []) add(parseCidr(i.ip), `${n.label} ${i.name}`)
  const entries = [...nets.values()]
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i], b = entries[j]
    if (!overlaps(a.c, b.c) || sameSubnet(a.c, b.c)) continue
    // Loopback /32 dentro de uma rede é aviso; duas LANs que se cruzam é erro
    const host = a.c.prefix === 32 || b.c.prefix === 32
    issues.push({ level: host ? 'warn' : 'error', message: `Sub-redes sobrepostas: ${a.who} (${net(a.c)}) e ${b.who} (${net(b.c)}) — o roteamento fica ambíguo` })
    if (issues.length >= 8) return issues
  }
  return issues
}

/** Interfaces numa VLAN precisam de IP dentro da sub-rede dela; o gateway precisa existir e estar na faixa. */
function vlanIssues(t: Topology): Issue[] {
  const issues: Issue[] = []
  const byVlan = new Map(t.vlans.map(v => [v.id, v]))
  for (const n of t.nodes) for (const i of n.ifaces || []) {
    if (!i.vlan || !i.ip || /dhcp/i.test(i.ip)) continue
    const v = byVlan.get(i.vlan)
    const vs = parseCidr(v?.subnet), ic = parseCidr(i.ip)
    if (vs && ic && (ic.ip < vs.network || ic.ip > vs.broadcast)) issues.push({ level: 'error', node: n.id, message: `${n.label} ${i.name}: ${i.ip} está fora da sub-rede da VLAN ${i.vlan} (${v!.subnet})` })
  }
  const allIps = new Set(t.nodes.flatMap(n => (n.ifaces || []).map(i => i.ip?.split('/')[0]).filter(Boolean)))
  // O gerador de configurações (configs.ts) cria a SVI (switch L3) ou a subinterface (FortiGate) de cada
  // VLAN com gateway sozinho — só falta gateway quando não há nenhum desses equipamentos (ex.: só roteadores)
  const gatewayAutoCreated = t.nodes.some(n => n.type === 'l3switch' || n.type === 'firewall')
  for (const v of t.vlans) {
    if (!v.gateway) continue
    const s = parseCidr(v.subnet)
    const g = ipToInt(v.gateway.split('/')[0])
    if (g === null) { issues.push({ level: 'error', message: `VLAN ${v.id}: gateway "${v.gateway}" não é um IP válido` }); continue }
    if (s && (g < s.network || g > s.broadcast)) issues.push({ level: 'error', message: `VLAN ${v.id}: gateway ${v.gateway} fora da sub-rede ${v.subnet}` })
    else if (s && s.prefix < 31 && (g === s.network || g === s.broadcast)) issues.push({ level: 'error', message: `VLAN ${v.id}: gateway ${v.gateway} é o endereço de rede/broadcast` })
    else if (!gatewayAutoCreated && allIps.size && !allIps.has(v.gateway.split('/')[0])) issues.push({ level: 'warn', message: `VLAN ${v.id}: o gateway ${v.gateway} não está configurado em nenhum equipamento (falta a subinterface no roteador — router-on-a-stick)` })
  }
  // Trunk com VLANs diferentes nas duas pontas: o tráfego dessas VLANs morre no cabo
  for (const l of t.links) {
    const a = t.nodes.find(n => n.id === l.a), b = t.nodes.find(n => n.id === l.b)
    const ia = a?.ifaces?.find(i => i.name.toLowerCase() === l.aPort?.toLowerCase())
    const ib = b?.ifaces?.find(i => i.name.toLowerCase() === l.bPort?.toLowerCase())
    if (ia?.mode !== 'trunk' || ib?.mode !== 'trunk' || !ia.vlans?.length || !ib.vlans?.length) continue
    const onlyA = ia.vlans.filter(v => !ib.vlans!.includes(v)), onlyB = ib.vlans.filter(v => !ia.vlans!.includes(v))
    if (onlyA.length || onlyB.length) issues.push({ level: 'warn', link: l.id, message: `Trunk ${a!.label} ${l.aPort} ↔ ${b!.label} ${l.bPort} com VLANs diferentes${onlyA.length ? ` (só em ${a!.label}: ${onlyA.join(', ')})` : ''}${onlyB.length ? ` (só em ${b!.label}: ${onlyB.join(', ')})` : ''}` })
  }
  return issues
}

/** Estação com IP numa sub-rede onde nenhum roteador/firewall/L3 tem endereço = sem gateway. */
function gatewayIssues(t: Topology): Issue[] {
  if (!t.nodes.some(n => L3.includes(n.type))) return []
  const routed = new Set<string>()
  for (const n of t.nodes) if (L3.includes(n.type)) for (const i of n.ifaces || []) { const c = parseCidr(i.ip); if (c) routed.add(net(c)) }
  for (const v of t.vlans) { const s = parseCidr(v.subnet); if (s && v.gateway) routed.add(net(s)) }
  const issues: Issue[] = []
  for (const n of t.nodes) {
    if (!ENDPOINTS.includes(n.type)) continue
    const ips = (n.ifaces || []).map(i => parseCidr(i.ip)).filter((c): c is NonNullable<typeof c> => !!c)
    if (ips.length && !ips.some(c => routed.has(net(c)))) issues.push({ level: 'warn', node: n.id, message: `${n.label} (${net(ips[0])}) não tem gateway na sua sub-rede — só fala com quem está na mesma rede` })
    if (issues.length >= 6) break
  }
  return issues
}

/** Internet/nuvem ligada direto num equipamento interno, sem roteador/firewall no meio. */
function edgeIssues(t: Topology): Issue[] {
  const issues: Issue[] = []
  const byId = new Map(t.nodes.map(n => [n.id, n]))
  for (const l of t.links) {
    const a = byId.get(l.a), b = byId.get(l.b)
    if (!a || !b) continue
    for (const [outside, inside] of [[a, b], [b, a]] as const) {
      if (outside.type !== 'internet') continue
      if (!['router', 'firewall', 'loadbalancer', 'cloud', 'internet'].includes(inside.type) && l.kind !== 'vpn') {
        issues.push({ level: 'warn', link: l.id, message: `${inside.label} está ligado direto à internet, sem roteador/firewall na borda` })
      }
    }
  }
  if (t.nodes.some(n => n.type === 'internet') && !t.nodes.some(n => n.type === 'firewall') && t.nodes.some(n => ENDPOINTS.includes(n.type))) {
    issues.push({ level: 'info', message: 'A rede sai para a internet sem nenhum firewall: considere um firewall de borda (ou ao menos regras no roteador) e uma DMZ para os servidores expostos.' })
  }
  return issues
}

/** Laço de camada 2 entre switches: sem STP/RSTP (ou LACP), um broadcast circula para sempre. */
function loopIssues(t: Topology): Issue[] {
  const l2 = new Set(t.nodes.filter(n => n.type === 'switch' || n.type === 'l3switch' || n.type === 'ap').map(n => n.id))
  const byId = new Map(t.nodes.map(n => [n.id, n]))
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  const seenPair = new Set<string>()
  const loops: string[] = []
  for (const l of t.links) {
    if (!l2.has(l.a) || !l2.has(l.b)) continue
    if (l.kind === 'wan' || l.kind === 'vpn') continue
    const a = byId.get(l.a)!, b = byId.get(l.b)!
    const ia = a.ifaces?.find(i => i.name.toLowerCase() === l.aPort?.toLowerCase())
    const ib = b.ifaces?.find(i => i.name.toLowerCase() === l.bPort?.toLowerCase())
    // Ligação roteada (IP nas duas pontas) não é camada 2
    if (ia?.ip && ib?.ip && ia.mode !== 'trunk' && ib.mode !== 'trunk') continue
    // Cabos paralelos marcados como agregação (LACP/port-channel) contam como um só
    const pair = [l.a, l.b].sort().join('|')
    if (seenPair.has(pair) && /lacp|port-?channel|etherchannel|lag|bond|agrega/i.test(`${l.label || ''} ${l.kind || ''}`)) continue
    seenPair.add(pair)
    const ra = find(l.a), rb = find(l.b)
    if (ra === rb) loops.push(`${a.label} ↔ ${b.label}`)
    else parent.set(ra, rb)
  }
  if (!loops.length) return []
  const stp = /\b(stp|rstp|mstp|spanning|lacp|port-?channel|etherchannel|mlag|vpc|stack)\b/.test(nodeNetText(t))
  return [{
    level: stp ? 'info' : 'warn',
    message: stp
      ? `Caminhos redundantes de camada 2 (${loops.slice(0, 3).join('; ')}) — protegidos pelo STP/LACP citado no projeto.`
      : `Laço de camada 2 (${loops.slice(0, 3).join('; ')}): ative STP/RSTP ou agregue os cabos com LACP, senão um broadcast circula para sempre e derruba a rede.`,
  }]
}

/** Equipamento de infraestrutura cuja queda separa a rede em pedaços (ponto único de falha). */
function spofIssues(t: Topology): Issue[] {
  if (t.nodes.length < 6) return []
  const adj = new Map<string, Set<string>>(t.nodes.map(n => [n.id, new Set()]))
  for (const l of t.links) { adj.get(l.a)?.add(l.b); adj.get(l.b)?.add(l.a) }
  // Tarjan: pontos de articulação
  const disc = new Map<string, number>(), low = new Map<string, number>(), cut = new Set<string>()
  let time = 0
  const dfs = (u: string, parentId: string | null) => {
    disc.set(u, ++time); low.set(u, time)
    let children = 0
    for (const v of adj.get(u) || []) {
      if (!disc.has(v)) {
        children++
        dfs(v, u)
        low.set(u, Math.min(low.get(u)!, low.get(v)!))
        if (parentId !== null && low.get(v)! >= disc.get(u)!) cut.add(u)
      } else if (v !== parentId) low.set(u, Math.min(low.get(u)!, disc.get(v)!))
    }
    if (parentId === null && children > 1) cut.add(u)
  }
  for (const n of t.nodes) if (!disc.has(n.id)) dfs(n.id, null)
  const infra = t.nodes.filter(n => cut.has(n.id) && ['router', 'firewall', 'l3switch', 'switch', 'loadbalancer'].includes(n.type))
  if (!infra.length) return []
  // Só vale apontar quando a queda isola estações (não só uma folha qualquer)
  const hosts = new Set(t.nodes.filter(n => ENDPOINTS.includes(n.type)).map(n => n.id))
  const relevant = infra.filter(c => {
    const seen = new Set<string>([c.id])
    const start = [...(adj.get(c.id) || [])][0]
    if (!start) return false
    const stack = [start]
    while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); for (const y of adj.get(x) || []) if (!seen.has(y)) stack.push(y) }
    const cutOff = [...hosts].filter(h => !seen.has(h)).length
    const reached = [...hosts].filter(h => seen.has(h)).length
    return cutOff > 0 && (reached > 0 || t.nodes.some(n => !seen.has(n.id) && n.type === 'internet') || [...adj.get(c.id)!].length > 1)
  })
  if (!relevant.length) return []
  return [{ level: 'info', message: `Ponto(s) único(s) de falha: ${relevant.slice(0, 4).map(n => n.label).join(', ')} — se ${relevant.length === 1 ? 'cair' : 'um deles cair'}, parte da rede fica isolada. Para alta disponibilidade, duplique o equipamento ou adicione um caminho redundante.` }]
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const TIER: Record<DeviceType, number> = {
  internet: 0, cloud: 0, router: 1, firewall: 2, loadbalancer: 2, l3switch: 3, switch: 4, ap: 4,
  server: 5, nas: 5, vm: 5, pc: 6, laptop: 6, phone: 6, printer: 6, camera: 6,
}
export const NODE_W = 120
export const NODE_H = 96
const GAP_X = 40
const GAP_Y = 46
const ZONE_PAD = 46

export interface ZoneBox { id: string; label: string; color?: string; x: number; y: number; w: number; h: number }

/**
 * Places nodes that have no position: each zone is a box laid out on a grid, devices inside
 * go top-down by role (internet → routers → firewalls → core → access → servers → endpoints).
 */
export function layoutTopology(t: Topology): Topology {
  const groups = new Map<string, NetNode[]>()
  for (const n of t.nodes) {
    const key = n.zone || '__none'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n)
  }
  const order = [...groups.keys()].sort((a, b) => {
    const ta = Math.min(...groups.get(a)!.map(n => TIER[n.type]))
    const tb = Math.min(...groups.get(b)!.map(n => TIER[n.type]))
    return ta - tb
  })
  const cols = order.length <= 2 ? order.length : order.length <= 4 ? 2 : 3
  const top = 40
  const rowH: number[] = []
  const boxes: Array<{ key: string; w: number; h: number; rows: NetNode[][] }> = []
  for (const key of order) {
    const list = groups.get(key)!
    const tiers = new Map<number, NetNode[]>()
    for (const n of list) { const k = TIER[n.type]; if (!tiers.has(k)) tiers.set(k, []); tiers.get(k)!.push(n) }
    const rows: NetNode[][] = []
    for (const k of [...tiers.keys()].sort((a, b) => a - b)) {
      const tier = tiers.get(k)!
      for (let i = 0; i < tier.length; i += 6) rows.push(tier.slice(i, i + 6))
    }
    const widest = Math.max(...rows.map(r => r.length))
    boxes.push({ key, rows, w: widest * NODE_W + (widest - 1) * GAP_X + ZONE_PAD * 2, h: rows.length * NODE_H + (rows.length - 1) * GAP_Y + ZONE_PAD * 2 + 10 })
  }
  const colW: number[] = []
  boxes.forEach((b, i) => { const c = i % cols; colW[c] = Math.max(colW[c] || 0, b.w) })
  boxes.forEach((b, i) => { const r = Math.floor(i / cols); rowH[r] = Math.max(rowH[r] || 0, b.h) })
  boxes.forEach((b, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    const x0 = 40 + colW.slice(0, c).reduce((s, w) => s + w + 70, 0) + (colW[c] - b.w) / 2
    const y0 = top + rowH.slice(0, r).reduce((s, h) => s + h + 70, 0)
    b.rows.forEach((row, ri) => {
      const rowWidth = row.length * NODE_W + (row.length - 1) * GAP_X
      const startX = x0 + (b.w - rowWidth) / 2
      row.forEach((n, ni) => {
        if (n.x === undefined || n.y === undefined) {
          n.x = Math.round(startX + ni * (NODE_W + GAP_X))
          n.y = Math.round(y0 + ZONE_PAD + 10 + ri * (NODE_H + GAP_Y))
        }
      })
    })
  })
  return t
}

/** Zone rectangles computed from where their devices are (follows manual dragging). */
export function zoneBoxes(t: Topology): ZoneBox[] {
  return t.zones.map((z): ZoneBox | null => {
    const ns = t.nodes.filter(n => n.zone === z.id && n.x !== undefined && n.y !== undefined)
    if (!ns.length) return null
    const minX = Math.min(...ns.map(n => n.x!)) - ZONE_PAD
    const minY = Math.min(...ns.map(n => n.y!)) - ZONE_PAD - 10
    const maxX = Math.max(...ns.map(n => n.x! + NODE_W)) + ZONE_PAD
    const maxY = Math.max(...ns.map(n => n.y! + NODE_H)) + ZONE_PAD
    return { id: z.id, label: z.label, color: z.color, x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }).filter((b): b is ZoneBox => !!b)
}
