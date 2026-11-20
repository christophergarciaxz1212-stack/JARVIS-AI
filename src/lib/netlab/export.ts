import { parseCidr, intToIp } from './ip'
import type { NetNode, Topology } from './types'

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lab'
const q = (s: string) => JSON.stringify(s) // YAML accepts JSON strings
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Images used for each role. FRR = real routing daemons; Alpine = tiny Linux host/switch. */
export const CLAB_IMAGES = {
  router: 'quay.io/frrouting/frr:10.2.1',
  host: 'alpine:3.20',
  fortigate: 'vrnetlab/fortinet_fortigate:7.0.14',
}

/** Interface names per node in cable order (Containerlab uses eth1, eth2…; eth0 is management). */
function portMap(t: Topology) {
  const map = new Map<string, string>() // "<linkId>:a|b" -> ethN on that end's node
  const next = new Map<string, number>()
  for (const l of t.links) {
    for (const [side, node] of [['a', l.a], ['b', l.b]] as const) {
      const n = (next.get(node) || 0) + 1
      next.set(node, n)
      map.set(`${l.id}:${side}`, `eth${n}`)
    }
  }
  return map
}

const isFortinet = (n: NetNode) => n.type === 'firewall' && /forti/i.test(`${n.vendor || ''} ${n.model || ''} ${n.label}`)
const skipNode = (n: NetNode) => n.type === 'internet' || n.type === 'cloud'

/**
 * Containerlab topology (https://containerlab.dev): a lab you can actually run with Docker (Linux or Windows+WSL2).
 * Routers/firewalls/L3 switches become FRR containers, switches become Linux bridges, hosts become Alpine,
 * and every IP / default gateway from the design is applied at boot. FortiGates use the vrnetlab image,
 * which the user builds from their own licensed FortiGate VM image.
 */
export function containerlabYaml(t: Topology): { yaml: string; notes: string[] } {
  const notes: string[] = []
  const ports = portMap(t)
  const byId = new Map(t.nodes.map(n => [n.id, n]))
  const ifaceOf = (_node: string, linkId: string, side: 'a' | 'b') => ports.get(`${linkId}:${side}`)
  const nodes: string[] = []
  const kept = t.nodes.filter(n => !skipNode(n))
  const skipped = t.nodes.filter(skipNode)
  if (skipped.length) notes.push(`${skipped.map(n => n.label).join(', ')}: Internet/nuvem não viram contêineres; os links até eles ficam de fora (o lab sai para a internet pela rede de gerência do Docker).`)
  const routerIps = kept.filter(n => ['router', 'l3switch', 'firewall', 'loadbalancer'].includes(n.type)).flatMap(n => (n.ifaces || []).map(i => parseCidr(i.ip)).filter(Boolean))
  // Container names must be unique even when two devices share a label
  const names = new Map<string, string>()
  const used = new Set<string>()
  for (const n of kept) { const base = slug(n.label); let k = base; for (let i = 2; used.has(k); i++) k = `${base}-${i}`; used.add(k); names.set(n.id, k) }
  for (const n of kept) {
    const name = names.get(n.id)!
    const mine = t.links.filter(l => (l.a === n.id || l.b === n.id) && !skipNode(byId.get(l.a === n.id ? l.b : l.a)!))
    const execs: string[] = []
    const ethFor = (portName?: string) => {
      const l = mine.find(x => (x.a === n.id && x.aPort === portName) || (x.b === n.id && x.bPort === portName))
      return l ? ifaceOf(n.id, l.id, l.a === n.id ? 'a' : 'b') : undefined
    }
    let kind = 'linux', image = CLAB_IMAGES.host
    if (isFortinet(n)) {
      kind = 'fortinet_fortigate'; image = CLAB_IMAGES.fortigate
      notes.push(`${n.label}: FortiGate precisa da imagem vrnetlab construída a partir do seu arquivo de VM FortiGate (licença Fortinet). Aplique a configuração gerada pelo JARVIS no console.`)
    } else if (['router', 'l3switch', 'firewall', 'loadbalancer'].includes(n.type)) {
      image = CLAB_IMAGES.router
      execs.push('sysctl -w net.ipv4.ip_forward=1')
      for (const i of n.ifaces || []) {
        const eth = ethFor(i.name); const c = parseCidr(i.ip)
        if (eth && c) execs.push(`ip addr add ${c.text} dev ${eth}`)
      }
      if (n.type === 'l3switch') notes.push(`${n.label}: VLANs/trunks não são reproduzidos no contêiner FRR; as interfaces roteadas e IPs sim.`)
    } else if (n.type === 'switch' || n.type === 'ap') {
      execs.push('ip link add br0 type bridge', 'ip link set br0 up')
      for (const l of mine) { const eth = ifaceOf(n.id, l.id, l.a === n.id ? 'a' : 'b'); if (eth) execs.push(`ip link set ${eth} master br0`, `ip link set ${eth} up`) }
    } else {
      // Host: address on its cable, default route via the first router in the same subnet
      for (const i of n.ifaces || []) {
        const eth = ethFor(i.name) || (mine[0] ? ifaceOf(n.id, mine[0].id, mine[0].a === n.id ? 'a' : 'b') : undefined)
        const c = parseCidr(i.ip)
        if (!eth || !c) continue
        execs.push(`ip addr add ${c.text} dev ${eth}`)
        const gw = routerIps.find(r => r && r.network === c.network && r.prefix === c.prefix && r.ip !== c.ip)
        if (gw && !execs.some(e => e.includes('default'))) execs.push(`ip route replace default via ${intToIp(gw.ip)}`)
      }
      if (/windows/i.test(`${n.vendor} ${n.model}`)) notes.push(`${n.label}: Windows é representado por um contêiner Linux leve com o mesmo IP (Windows não roda em contêiner Linux).`)
    }
    nodes.push([
      `    ${name}:`,
      `      kind: ${kind}`,
      `      image: ${image}`,
      `      labels: { jarvis-label: ${q(n.label)}, jarvis-type: ${n.type} }`,
      ...(execs.length ? ['      exec:', ...execs.map(e => `        - ${q(e)}`)] : []),
    ].join('\n'))
  }
  const links = t.links
    .filter(l => !skipNode(byId.get(l.a)!) && !skipNode(byId.get(l.b)!))
    .map(l => `    - endpoints: [${q(`${names.get(l.a)}:${ifaceOf(l.a, l.id, 'a')}`)}, ${q(`${names.get(l.b)}:${ifaceOf(l.b, l.id, 'b')}`)}]  # ${l.aPort || '?'} ↔ ${l.bPort || '?'}`)
  const yaml = [
    `# ${t.title} — gerado pelo JARVIS AI`,
    '# Subir:   sudo containerlab deploy -t <este arquivo>',
    '# Console: docker exec -it clab-<lab>-<equipamento> sh   (FRR: vtysh)',
    '# Derrubar: sudo containerlab destroy -t <este arquivo>',
    `name: ${slug(t.title)}`,
    'topology:',
    '  nodes:',
    ...nodes,
    '  links:',
    ...links,
    '',
  ].join('\n')
  return { yaml, notes }
}

/** EVE-NG template + icon per device (images are the user's own: EVE-NG doesn't ship vendor images). */
function eveTemplate(n: NetNode): { template: string; type: string; icon: string; ram: number; eth: number } {
  if (isFortinet(n)) return { template: 'fortinet', type: 'qemu', icon: 'Firewall.png', ram: 2048, eth: 10 }
  switch (n.type) {
    case 'router': return { template: 'vios', type: 'qemu', icon: 'Router.png', ram: 1024, eth: 8 }
    case 'l3switch': return { template: 'viosl2', type: 'qemu', icon: 'Switch L3.png', ram: 1024, eth: 16 }
    case 'switch': return { template: 'viosl2', type: 'qemu', icon: 'Switch.png', ram: 1024, eth: 16 }
    case 'firewall': return { template: 'pfsense', type: 'qemu', icon: 'Firewall.png', ram: 2048, eth: 8 }
    case 'server': case 'nas': case 'vm': return /windows/i.test(`${n.vendor} ${n.model}`) ? { template: 'winserver', type: 'qemu', icon: 'Server.png', ram: 4096, eth: 2 } : { template: 'linux', type: 'qemu', icon: 'Server.png', ram: 2048, eth: 2 }
    case 'pc': case 'laptop': return /windows/i.test(`${n.vendor} ${n.model}`) ? { template: 'win', type: 'qemu', icon: 'Desktop.png', ram: 4096, eth: 1 } : { template: 'vpcs', type: 'vpcs', icon: 'Desktop.png', ram: 0, eth: 1 }
    default: return { template: 'vpcs', type: 'vpcs', icon: 'Desktop.png', ram: 0, eth: 1 }
  }
}

/** EVE-NG lab file (.unl): import it in EVE-NG (Import lab, or copy to /opt/unetlab/labs and fix permissions). */
export function eveNgUnl(t: Topology): { unl: string; notes: string[] } {
  const ids = new Map(t.nodes.map((n, i) => [n.id, i + 1]))
  const ifCount = new Map<string, number>()
  const nodeIfaces = new Map<string, string[]>()
  const networks: string[] = []
  t.links.forEach((l, i) => {
    const net = i + 1
    const a = t.nodes.find(n => n.id === l.a), b = t.nodes.find(n => n.id === l.b)
    const x = Math.round((((a?.x ?? 0) + (b?.x ?? 0)) / 2) + 60), y = Math.round((((a?.y ?? 0) + (b?.y ?? 0)) / 2) + 30)
    networks.push(`      <network id="${net}" type="bridge" name="${xml(l.label || l.subnet || `Net${net}`)}" left="${x}" top="${y}" visibility="0"/>`)
    for (const [node, port] of [[l.a, l.aPort], [l.b, l.bPort]] as const) {
      const k = ifCount.get(node) || 0
      ifCount.set(node, k + 1)
      if (!nodeIfaces.has(node)) nodeIfaces.set(node, [])
      nodeIfaces.get(node)!.push(`        <interface id="${k}" name="${xml(port || `e${k}`)}" type="ethernet" network_id="${net}"/>`)
    }
  })
  const needs = new Set<string>()
  const nodes = t.nodes.map(n => {
    const tpl = eveTemplate(n)
    if (tpl.type === 'qemu') needs.add(tpl.template)
    const eth = Math.max(tpl.eth, ifCount.get(n.id) || 0)
    return [
      `      <node id="${ids.get(n.id)}" name="${xml(n.label.replace(/\s+/g, '_').slice(0, 30))}" type="${tpl.type}" template="${tpl.template}" image="" console="telnet" cpu="1" cpulimit="0" ram="${tpl.ram}" ethernet="${eth}" delay="0" icon="${tpl.icon}" left="${Math.round(n.x ?? 0) + 60}" top="${Math.round(n.y ?? 0) + 30}">`,
      ...(nodeIfaces.get(n.id) || []),
      '      </node>',
    ].join('\n')
  })
  const unl = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<lab name="${xml(t.title)}" id="${t.id}" version="1" scripttimeout="300" lock="0" author="JARVIS AI">`,
    `  <description>${xml(t.description || 'Gerado pelo JARVIS AI')}</description>`,
    '  <topology>',
    '    <nodes>', ...nodes, '    </nodes>',
    '    <networks>', ...networks, '    </networks>',
    '  </topology>',
    '</lab>',
    '',
  ].join('\n')
  return { unl, notes: [`Imagens necessárias no EVE-NG (suas, licenciadas): ${[...needs].join(', ') || 'nenhuma — só VPCS'}. Depois de importar, escolha a imagem de cada nó e cole a configuração gerada pelo JARVIS.`] }
}
