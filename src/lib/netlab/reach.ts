import { parseCidr, sameSubnet, type Cidr } from './ip'
import type { DeviceType, NetNode, Topology } from './types'

/** Devices that bridge frames between their ports (layer 2). */
const BRIDGES: DeviceType[] = ['switch', 'ap']
/** Devices that route between subnets (layer 3). */
const ROUTERS: DeviceType[] = ['router', 'l3switch', 'firewall', 'loadbalancer']
/** End systems whose reachability matters to the user. */
const HOSTS: DeviceType[] = ['server', 'pc', 'laptop', 'vm', 'nas', 'printer', 'phone', 'camera']

export interface ReachPair { from: string; to: string; ok: boolean; path?: string[]; reason?: string }
export interface ReachResult { pairs: ReachPair[]; reachable: number; total: number; notes: string[] }

/**
 * Static reachability analysis of a designed topology (no packets are sent): follows cables through switches,
 * matches IP subnets on each shared segment and routes through routers/firewalls/L3 switches.
 * VLAN tagging and firewall policies are not modelled, so a "reachable" result means "addressing and cabling allow it".
 */
export function analyzeReachability(t: Topology, maxHosts = 24): ReachResult {
  const byId = new Map(t.nodes.map(n => [n.id, n]))
  // Segment = set of link ids joined through bridging devices
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const l of t.links) parent.set(l.id, l.id)
  for (const n of t.nodes) {
    if (!BRIDGES.includes(n.type)) continue
    const mine = t.links.filter(l => l.a === n.id || l.b === n.id)
    for (let i = 1; i < mine.length; i++) union(mine[0].id, mine[i].id)
  }
  // Addresses per device, tied to the segment of the cable on that port (or every segment of the device for SVIs/unmatched ports)
  type Addr = { node: string; cidr: Cidr; segs: Set<string> }
  const addrs: Addr[] = []
  for (const n of t.nodes) {
    const mine = t.links.filter(l => l.a === n.id || l.b === n.id)
    for (const i of n.ifaces || []) {
      const c = parseCidr(i.ip)
      if (!c) continue
      const onPort = mine.filter(l => (l.a === n.id && l.aPort === i.name) || (l.b === n.id && l.bPort === i.name))
      addrs.push({ node: n.id, cidr: c, segs: new Set((onPort.length ? onPort : mine).map(l => find(l.id))) })
    }
  }
  // L3 adjacency: same segment + same subnet
  const adj = new Map<string, Set<string>>()
  for (let i = 0; i < addrs.length; i++) for (let j = i + 1; j < addrs.length; j++) {
    const a = addrs[i], b = addrs[j]
    if (a.node === b.node || !sameSubnet(a.cidr, b.cidr) || ![...a.segs].some(s => b.segs.has(s))) continue
    if (!adj.has(a.node)) adj.set(a.node, new Set())
    if (!adj.has(b.node)) adj.set(b.node, new Set())
    adj.get(a.node)!.add(b.node)
    adj.get(b.node)!.add(a.node)
  }
  const isRouter = (id: string) => ROUTERS.includes(byId.get(id)?.type as DeviceType)
  const route = (from: string, to: string): string[] | null => {
    const prev = new Map<string, string>([[from, '']])
    const queue = [from]
    while (queue.length) {
      const cur = queue.shift()!
      if (cur === to) break
      // Only routers forward; hosts are endpoints
      if (cur !== from && !isRouter(cur)) continue
      for (const nx of adj.get(cur) || []) if (!prev.has(nx)) { prev.set(nx, cur); queue.push(nx) }
    }
    if (!prev.has(to)) return null
    const path: string[] = []
    for (let c = to; c; c = prev.get(c) || '') path.unshift(c)
    return path
  }
  const hosts = t.nodes.filter(n => HOSTS.includes(n.type)).slice(0, maxHosts)
  const label = (id: string) => byId.get(id)?.label || id
  const pairs: ReachPair[] = []
  for (let i = 0; i < hosts.length; i++) for (let j = i + 1; j < hosts.length; j++) {
    const a = hosts[i], b = hosts[j]
    const reason = !addrs.some(x => x.node === a.id) ? `${a.label} não tem endereço IP` : !addrs.some(x => x.node === b.id) ? `${b.label} não tem endereço IP` : undefined
    if (reason) { pairs.push({ from: a.label, to: b.label, ok: false, reason }); continue }
    const p = route(a.id, b.id)
    pairs.push(p ? { from: a.label, to: b.label, ok: true, path: p.map(label) } : { from: a.label, to: b.label, ok: false, reason: whyNot(a, adj, isRouter) || whyNot(b, adj, isRouter) || 'não há rota entre as sub-redes (falta ligação ou endereçamento entre os roteadores)' })
  }
  const notes = ['Análise estática do projeto: segue cabos, switches, sub-redes e roteadores. VLANs e regras de firewall não são simuladas; para tráfego real, suba o laboratório no Containerlab.']
  return { pairs, reachable: pairs.filter(p => p.ok).length, total: pairs.length, notes }
}

/** What is wrong on one end (null when that end is fine and the problem is in between). */
function whyNot(a: NetNode, adj: Map<string, Set<string>>, isRouter: (id: string) => boolean): string | null {
  const neighbours = [...(adj.get(a.id) || [])]
  if (!neighbours.length) return `${a.label} não alcança nenhum equipamento na própria sub-rede (cabo ou IP fora da faixa)`
  if (!neighbours.some(isRouter)) return `${a.label} não tem um roteador/gateway na sua sub-rede`
  return null
}

export function reachText(r: ReachResult) {
  if (!r.total) return 'Sem pares de estações com IP para testar.'
  const bad = r.pairs.filter(p => !p.ok)
  return [
    `🔌 Alcance: **${r.reachable}/${r.total}** pares de estações se comunicam pelo projeto.`,
    ...r.pairs.filter(p => p.ok).slice(0, 4).map(p => `- ✅ ${p.from} → ${p.to}: ${p.path!.join(' → ')}`),
    ...bad.slice(0, 6).map(p => `- ❌ ${p.from} → ${p.to}: ${p.reason}`),
    bad.length > 6 ? `- … e mais ${bad.length - 6} par(es) sem comunicação` : '',
    `_${r.notes[0]}_`,
  ].filter(Boolean).join('\n')
}

