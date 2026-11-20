import fs from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { layoutTopology, normalizeTopology, validateTopology } from '@/lib/netlab/model'
import { topologySvg } from '@/lib/netlab/svg'
import { deviceConfigs, addressingPlan } from '@/lib/netlab/configs'
import { netIntent, lastTopologyIn } from '@/lib/netlab/intent'
import { designTopology, setNetlabLlm } from '@/lib/netlab/generate'
import { getTopology, savePositions } from '@/lib/netlab/store'
import { netlabCommandRunner } from '@/lib/netlab/commands'
import { topologyPng } from '@/lib/netlab/png'
import { topologyReport } from '@/lib/netlab/report'
import { findBrowser } from '@/lib/motion/chrome'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'
import { extractAll } from '@/lib/motion/inline'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { analyzeReachability, reachText } from '@/lib/netlab/reach'
import { containerlabYaml, eveNgUnl } from '@/lib/netlab/export'
import { buildReportDocx, buildReportMarkdown } from '@/lib/docs/office'
import { documentsDir } from '@/lib/docs/generate'

afterEach(() => setNetlabLlm(null))

/** The Fortinet lab from the user's screenshot (Hackone FCP: ISP + Datacenter-PR + Unidade-SP). */
const HACKONE = {
  title: 'Formação Fortinet FCP — FortiGate AD',
  description: 'Laboratório com ISP simulado, datacenter com cluster FortiGate em HA e filial em SP.',
  zones: [{ id: 'isp', label: 'ISP - INTERNET' }, { id: 'dc', label: 'DATACENTER-PR' }, { id: 'sp', label: 'UNIDADE-SP' }],
  nodes: [
    { id: 'copel', label: 'COPEL', type: 'router', zone: 'isp', ifaces: [{ name: 'fa1/0', ip: '203.0.113.1/30' }, { name: 'fa3/0', ip: '150.150.150.1/29' }, { name: 'fa0/0', ip: '10.255.0.1/30' }] },
    { id: 'tim', label: 'TIM', type: 'router', zone: 'isp', ifaces: [{ name: 'fa0/0', ip: '203.0.113.2/30' }, { name: 'fa1/0', ip: '200.200.200.1/29' }] },
    { id: 'claro', label: 'CLARO', type: 'router', zone: 'isp', ifaces: [{ name: 'fa3/0', ip: '209.165.200.225/29' }, { name: 'fa0/0', ip: '10.255.0.2/30' }, { name: 'fa1/0', ip: '10.255.1.1/30' }] },
    { id: 'vivo', label: 'VIVO', type: 'router', zone: 'isp', ifaces: [{ name: 'fa1/0', ip: '209.165.200.233/29' }, { name: 'fa0/0', ip: '10.255.1.2/30' }] },
    { id: 'aws', label: 'AWS', type: 'cloud', zone: 'isp' },
    { id: 'azure', label: 'Azure', type: 'cloud', zone: 'isp' },
    { id: 'edge', label: 'Edge-Switch', type: 'switch', zone: 'dc', mgmt: '192.168.99.250/24', ifaces: [{ name: 'e1/0', mode: 'access', vlan: 20 }, { name: 'e1/1', mode: 'access', vlan: 10 }, { name: 'e1/2', mode: 'access', vlan: 30 }, { name: 'e1/3', mode: 'trunk', vlans: [10, 20, 30] }, { name: 'e2/0', mode: 'trunk', vlans: [10, 20, 30] }] },
    { id: 'fw1', label: 'Cluster_FW_01', type: 'firewall', vendor: 'Fortinet', model: 'FortiGate VM', zone: 'dc', ifaces: [{ name: 'port1', ip: '150.150.150.2/29' }, { name: 'port4', ip: '10.10.10.1/24' }, { name: 'port5', ip: '169.254.0.1/30' }] },
    { id: 'fw2', label: 'Cluster_FW_02', type: 'firewall', vendor: 'Fortinet', model: 'FortiGate VM', zone: 'dc', ifaces: [{ name: 'port1', ip: '150.150.150.3/29' }, { name: 'port4', ip: '10.10.10.2/24' }, { name: 'port5', ip: '169.254.0.2/30' }] },
    { id: 'core', label: 'Core', type: 'l3switch', zone: 'dc', mgmt: '192.168.99.253/24', ifaces: [{ name: 'e0/0', mode: 'trunk' }, { name: 'e0/1', mode: 'trunk' }, { name: 'e0/2', mode: 'trunk' }, { name: 'e0/3', mode: 'trunk' }] },
    { id: 'acc1', label: 'Access-Switches_1', type: 'switch', zone: 'dc', mgmt: '192.168.99.252/24', ifaces: [{ name: 'e0/0', mode: 'trunk' }, { name: 'e0/1', mode: 'access', vlan: 200 }] },
    { id: 'acc2', label: 'Access-Switches_2', type: 'switch', zone: 'dc', mgmt: '192.168.99.251/24', ifaces: [{ name: 'e0/0', mode: 'trunk' }, { name: 'e0/1', mode: 'access', vlan: 100 }] },
    { id: 'ad', label: 'MS_AD', type: 'server', vendor: 'Windows Server', zone: 'dc', ifaces: [{ name: 'Ethernet0', ip: '10.10.10.10/24' }] },
    { id: 'win200', label: 'Win_VLAN200', type: 'pc', zone: 'dc', ifaces: [{ name: 'e0', ip: '192.168.200.10/24' }] },
    { id: 'win100', label: 'Win_VLAN100', type: 'pc', zone: 'dc', ifaces: [{ name: 'e0', ip: '192.168.100.10/24' }] },
    { id: 'fgsp', label: 'Fortinet-SP', type: 'firewall', vendor: 'Fortinet', zone: 'sp', ifaces: [{ name: 'port2', ip: '209.165.200.234/29' }, { name: 'port3', ip: '10.20.0.1/24' }] },
    { id: 'swadm', label: 'Switch_Adm', type: 'l3switch', zone: 'sp', ifaces: [{ name: 'e0/0', ip: '10.20.0.2/24' }, { name: 'e0/3', mode: 'access', vlan: 300 }, { name: 'e0/1', mode: 'access', vlan: 300 }] },
    { id: 'adm', label: 'Adm_01', type: 'pc', zone: 'sp' },
    { id: 'winsp', label: 'Win', type: 'pc', zone: 'sp' },
  ],
  links: [
    { a: 'copel', aPort: 'fa1/0', b: 'tim', bPort: 'fa0/0', kind: 'wan', subnet: '203.0.113.0/30' },
    { a: 'copel', aPort: 'fa0/0', b: 'claro', bPort: 'fa0/0', kind: 'wan' },
    { a: 'claro', aPort: 'fa1/0', b: 'vivo', bPort: 'fa0/0', kind: 'wan' },
    { a: 'copel', aPort: 'fa3/0', b: 'fw1', bPort: 'port1', kind: 'wan', subnet: '150.150.150.0/29' },
    { a: 'tim', aPort: 'fa1/0', b: 'aws' }, { a: 'claro', b: 'azure' },
    { a: 'fw1', aPort: 'port5', b: 'fw2', bPort: 'port5', kind: 'ha', label: 'HA' },
    { a: 'fw1', aPort: 'port4', b: 'core', bPort: 'e0/0', kind: 'trunk' },
    { a: 'fw2', aPort: 'port4', b: 'core', bPort: 'e0/1', kind: 'trunk' },
    { a: 'core', aPort: 'e0/2', b: 'acc1', bPort: 'e0/0', kind: 'trunk' },
    { a: 'core', aPort: 'e0/3', b: 'acc2', bPort: 'e0/0', kind: 'trunk' },
    { a: 'acc1', aPort: 'e0/1', b: 'win200', bPort: 'e0', kind: 'access' },
    { a: 'acc2', aPort: 'e0/1', b: 'win100', bPort: 'e0', kind: 'access' },
    { a: 'edge', aPort: 'e1/3', b: 'ad', bPort: 'Ethernet0' },
    { a: 'vivo', aPort: 'fa1/0', b: 'fgsp', bPort: 'port2', kind: 'wan' },
    { a: 'fgsp', aPort: 'port3', b: 'swadm', bPort: 'e0/0' },
    { a: 'swadm', aPort: 'e0/3', b: 'adm', kind: 'access' },
    { a: 'swadm', aPort: 'e0/1', b: 'winsp', kind: 'access' },
  ],
  vlans: [
    { id: 10, name: 'CLARO' }, { id: 20, name: 'COPEL' }, { id: 30, name: 'VIVO' },
    { id: 99, name: 'MGMT', subnet: '192.168.99.0/24' }, { id: 100, name: 'USUARIOS', subnet: '192.168.100.0/24', gateway: '192.168.100.1' },
    { id: 110, name: 'SERVIDORES', subnet: '10.10.10.0/24', gateway: '10.10.10.1' }, { id: 200, name: 'WIFI', subnet: '192.168.200.0/24', gateway: '192.168.200.1' },
    { id: 300, name: 'ADM-SP', subnet: '10.20.0.0/24' },
  ],
  notes: ['Cluster FortiGate em HA ativo-passivo (heartbeat na port5).'],
}

describe('modelo e validação', () => {
  it('aceita o JSON solto de um modelo: tipos por nome, refs por rótulo, zonas criadas', () => {
    const t = normalizeTopology({ nodes: [{ name: 'FortiGate-01', zone: 'Matriz' }, { name: 'SW Core', type: 'core switch', zone: 'Matriz' }, { name: 'Internet' }], links: [{ from: 'FortiGate-01', to: 'SW Core', type: 'trunk' }, { from: 'Internet', to: 'FortiGate-01' }] })
    expect(t.nodes.map(n => n.type)).toEqual(['firewall', 'l3switch', 'internet'])
    expect(t.zones.map(z => z.label)).toEqual(['Matriz'])
    expect(t.links).toHaveLength(2)
    expect(t.links[0].kind).toBe('trunk')
  })

  it('pega os erros que um engenheiro pegaria', () => {
    const t = normalizeTopology({
      nodes: [
        { id: 'r1', label: 'R1', type: 'router', ifaces: [{ name: 'g0/0', ip: '10.0.0.1/30' }, { name: 'g0/1', ip: '192.168.1.0/24' }] },
        { id: 'r2', label: 'R2', type: 'router', ifaces: [{ name: 'g0/0', ip: '10.0.1.2/30' }] },
        { id: 'pc', label: 'PC', type: 'pc', ifaces: [{ name: 'eth0', ip: '10.0.0.1/30' }] },
        { id: 'solto', label: 'Solto', type: 'server' },
      ],
      links: [{ a: 'r1', aPort: 'g0/0', b: 'r2', bPort: 'g0/0' }, { a: 'r1', aPort: 'g0/0', b: 'pc', bPort: 'eth0' }],
      vlans: [{ id: 10, name: 'A', subnet: '10.10.0.0/16' }, { id: 20, name: 'B', subnet: '10.10.5.0/24' }],
    })
    const msgs = validateTopology(t).map(i => i.message).join('\n')
    expect(msgs).toMatch(/sub-redes diferentes no mesmo cabo/)
    expect(msgs).toMatch(/IP duplicado 10\.0\.0\.1/)
    expect(msgs).toMatch(/endereço de rede/)
    expect(msgs).toMatch(/R1 g0\/0 está ligada em dois cabos/)
    expect(msgs).toMatch(/Sub-redes sobrepostas/)
    expect(msgs).toMatch(/Solto não tem nenhum cabo/)
  })

  it('o laboratório da imagem (Hackone FCP) fica válido, posicionado e com zonas', () => {
    const t = layoutTopology(normalizeTopology(HACKONE, { id: '00000000-0000-4000-8000-000000000001' }))
    expect(t.nodes).toHaveLength(19)
    expect(t.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
    expect(validateTopology(t).filter(i => i.level === 'error')).toEqual([])
    const svg = topologySvg(t)
    expect(svg).toContain('DATACENTER-PR')
    expect(svg).toContain('data-node="fw1"')
    expect(svg).toContain('VLAN_100 - USUARIOS')
    expect(svg).toContain('port5') // HA heartbeat port label
  })
})

describe('desenho e configurações', () => {
  it('escapa tudo que veio da IA (sem script no SVG)', () => {
    const t = layoutTopology(normalizeTopology({ title: '<script>alert(1)</script>', nodes: [{ label: '<img src=x onerror=alert(1)>', type: 'server' }] }))
    const svg = topologySvg(t)
    expect(svg).not.toMatch(/<script|<img/i)
    expect(svg).toContain('&lt;script&gt;')
  })

  it('gera configs de Cisco, FortiGate (com HA e política com NAT), Linux e Windows', () => {
    const t = layoutTopology(normalizeTopology(HACKONE))
    const cfg = Object.fromEntries(deviceConfigs(t).map(c => [c.label, c]))
    expect(cfg.COPEL.platform).toBe('Cisco IOS')
    expect(cfg.COPEL.text).toContain('interface fa1/0\n description TIM fa0/0\n ip address 203.0.113.1 255.255.255.252')
    expect(cfg['Edge-Switch'].text).toMatch(/interface e1\/3[\s\S]*switchport mode trunk\n switchport trunk allowed vlan 10,20,30/)
    expect(cfg['Edge-Switch'].text).toMatch(/interface e1\/1[\s\S]*switchport access vlan 10/)
    expect(cfg.Cluster_FW_01.platform).toBe('FortiOS')
    expect(cfg.Cluster_FW_01.text).toContain('set ip 150.150.150.2 255.255.255.248')
    expect(cfg.Cluster_FW_01.text).toContain('set hbdev "port5" 50')
    expect(cfg.Cluster_FW_01.text).toContain('set nat enable')
    expect(cfg.Cluster_FW_01.text).toContain('set gateway 150.150.150.1')
    expect(cfg.MS_AD.platform).toBe('Windows (PowerShell)')
    expect(cfg.MS_AD.text).toContain('New-NetIPAddress -InterfaceIndex $if -IPAddress 10.10.10.10 -PrefixLength 24')
    expect(addressingPlan(t).some(r => r[0] === 'TIM' && r[2] === '200.200.200.1/29')).toBe(true)
  })
})

describe('chat', () => {
  it('entende pedidos de rede em português e manda para o laboratório (não para o modo agente)', () => {
    expect(netIntent('crie uma topologia de rede com 2 filiais e VPN')).toBe('design')
    expect(netIntent('quero um projeto de rede igual ao eve-ng para um datacenter')).toBe('design')
    expect(netIntent('monte uma rede para um escritório com 30 pessoas')).toBe('design')
    expect(netIntent('gere um relatório de rede e servidores')).toBe('infra-report')
    expect(netIntent('faça um diagrama da minha rede')).toBe('env-diagram')
    expect(netIntent('adicione um servidor web na DMZ', true)).toBe('edit')
    expect(netIntent('gere o relatório desse projeto', true)).toBe('topology-report')
    expect(netIntent('crie um post para minhas redes sociais')).toBeNull()
    expect(netIntent('qual a capital da França?')).toBeNull()
    expect(shouldRunAgent('monte uma rede para uma filial com firewall')).toBe(false)
    expect(lastTopologyIn(['oi', 'veja [[topology:11111111-1111-4111-8111-111111111111]]', 'ok'])).toBe('11111111-1111-4111-8111-111111111111')
    const e = extractAll('Pronto\n[[topology:11111111-1111-4111-8111-111111111111]]')
    expect(e.topologies).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(e.clean).toBe('Pronto')
  })

  it('projeta pela IA, corrige o endereçamento e depois edita mantendo as posições', async () => {
    const calls: string[] = []
    setNetlabLlm(async messages => {
      const last = messages[messages.length - 1].content
      calls.push(last.slice(0, 40))
      if (/Corrija estes problemas/.test(last)) return JSON.stringify({ ...HACKONE, nodes: HACKONE.nodes })
      if (/Topologia atual/.test(last)) return JSON.stringify({ ...HACKONE, nodes: [...HACKONE.nodes, { id: 'web', label: 'WEB-DMZ', type: 'server', zone: 'dc', ifaces: [{ name: 'eth0', ip: '10.10.10.50/24' }] }], links: [...HACKONE.links, { a: 'edge', aPort: 'e2/0', b: 'web', bPort: 'eth0' }] })
      // First answer with a duplicated IP: the designer must ask for a fix
      return JSON.stringify({ ...HACKONE, nodes: HACKONE.nodes.map(n => (n.id === 'win100' ? { ...n, ifaces: [{ name: 'e0', ip: '192.168.200.10/24' }] } : n)) })
    })
    const runner = netlabCommandRunner('crie um laboratório EVE-NG igual ao Hackone FCP com FortiGate em HA')
    expect(runner).toBeTypeOf('function')
    const reply = await runner!()
    const id = reply.match(/\[\[topology:([0-9a-f-]{36})\]\]/)![1]
    expect(calls).toHaveLength(2)
    expect(reply).toMatch(/19 equipamentos/)
    const t = getTopology(id)!
    savePositions(id, { fw1: { x: 777, y: 333 } })

    const edit = await netlabCommandRunner('adicione um servidor web na DMZ do datacenter', id)!()
    expect(edit).toMatch(/20 equipamentos/)
    const after = getTopology(id)!
    expect(after.nodes.find(n => n.id === 'fw1')).toMatchObject({ x: 777, y: 333 })
    expect(after.nodes.some(n => n.label === 'WEB-DMZ')).toBe(true)
    expect(after.createdAt).toBe(t.createdAt)
  })
})

/** Two LANs joined by two routers: PC1 ↔ PC2 must route; PC3 sits in the wrong subnet. */
const SMALL = normalizeTopology({
  title: 'Duas LANs',
  nodes: [
    { id: 'pc1', label: 'PC1', type: 'pc', ifaces: [{ name: 'e0', ip: '10.1.0.10/24' }] },
    { id: 'pc3', label: 'PC3', type: 'pc', ifaces: [{ name: 'e0', ip: '10.9.0.10/24' }] },
    { id: 'sw1', label: 'SW1', type: 'switch' },
    { id: 'r1', label: 'R1', type: 'router', ifaces: [{ name: 'g0/0', ip: '10.1.0.1/24' }, { name: 'g0/1', ip: '172.16.0.1/30' }] },
    { id: 'r2', label: 'R2', type: 'router', ifaces: [{ name: 'g0/1', ip: '172.16.0.2/30' }, { name: 'g0/0', ip: '10.2.0.1/24' }] },
    { id: 'pc2', label: 'PC2', type: 'pc', ifaces: [{ name: 'e0', ip: '10.2.0.10/24' }] },
    { id: 'fw', label: 'FortiGate', type: 'firewall', vendor: 'Fortinet', ifaces: [{ name: 'port1', ip: '10.2.0.254/24' }] },
  ],
  links: [
    { a: 'pc1', aPort: 'e0', b: 'sw1', bPort: 'f0/1' }, { a: 'pc3', aPort: 'e0', b: 'sw1', bPort: 'f0/2' },
    { a: 'sw1', aPort: 'f0/24', b: 'r1', bPort: 'g0/0' }, { a: 'r1', aPort: 'g0/1', b: 'r2', bPort: 'g0/1' },
    { a: 'r2', aPort: 'g0/0', b: 'pc2', bPort: 'e0' }, { a: 'r2', aPort: 'g0/2', b: 'fw', bPort: 'port1' },
  ],
}, { id: '22222222-2222-4222-8222-222222222222' })

describe('laboratório real e exportação', () => {
  it('analisa o alcance: roteia entre LANs e explica quem não se comunica', () => {
    const r = analyzeReachability(SMALL)
    const ok = r.pairs.find(p => p.from === 'PC1' && p.to === 'PC2')!
    expect(ok.ok).toBe(true)
    expect(ok.path).toEqual(['PC1', 'R1', 'R2', 'PC2'])
    const bad = r.pairs.find(p => (p.from === 'PC3' || p.to === 'PC3') && (p.from === 'PC1' || p.to === 'PC1'))!
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/PC3/)
    expect(reachText(r)).toMatch(/1\/3/)
  })

  it('gera um lab Containerlab executável com IPs, rotas e bridges', () => {
    const { yaml, notes } = containerlabYaml(SMALL)
    expect(yaml).toMatch(/^name: duas-lans$/m)
    expect(yaml).toMatch(/r1:\n\s+kind: linux\n\s+image: quay\.io\/frrouting\/frr/)
    expect(yaml).toContain('"ip addr add 10.1.0.1/24 dev eth1"')
    expect(yaml).toContain('"ip route replace default via 10.1.0.1"')
    expect(yaml).toContain('"ip link set eth1 master br0"')
    expect(yaml).toMatch(/fortigate:\n\s+kind: fortinet_fortigate/)
    expect(yaml.match(/- endpoints:/g)).toHaveLength(6)
    expect(yaml).toContain('["r1:eth2", "r2:eth1"]')
    expect(notes.join(' ')).toMatch(/FortiGate/)
    const yamlLib = require('js-yaml') as { load: (s: string) => { topology: { nodes: Record<string, unknown>; links: unknown[] } } }
    const parsed = yamlLib.load(yaml)
    expect(Object.keys(parsed.topology.nodes)).toHaveLength(7)
  })

  it('gera o arquivo de laboratório do EVE-NG (.unl) com nós, interfaces e redes', () => {
    const { unl, notes } = eveNgUnl(SMALL)
    expect(unl.match(/<node /g)).toHaveLength(7)
    expect(unl.match(/<network /g)).toHaveLength(6)
    expect(unl).toContain('template="fortinet"')
    expect(unl).toContain('template="vios"')
    expect(unl).toMatch(/<interface id="0" name="g0\/0" type="ethernet" network_id="3"\/>/)
    expect(notes[0]).toMatch(/fortinet/)
  })

  it('reconhece no chat: testar, exportar, subir e derrubar o lab — sem roubar pedidos de software', () => {
    expect(netIntent('teste a comunicação entre as estações', true)).toBe('validate')
    expect(netIntent('valide a rede', true)).toBe('validate')
    expect(netIntent('exporte para o containerlab', true)).toBe('export')
    expect(netIntent('gere o arquivo do EVE-NG', true)).toBe('export')
    expect(netIntent('suba o laboratório', true)).toBe('deploy')
    expect(netIntent('derrube o laboratório', true)).toBe('destroy')
    expect(netIntent('teste o projeto', true)).toBeNull()
    expect(netIntent('exporte o projeto como zip', true)).toBeNull()
    expect(shouldRunAgent('teste o projeto e corrija os erros', true)).toBe(true)
    expect(shouldRunAgent('suba o laboratório', true)).toBe(false)
    // Without a topology in the conversation, an edit-like order is real work for the agent
    expect(shouldRunAgent('adicione um switch no projeto', false)).toBe(true)
  })

  it('exporta pelo chat e entrega os arquivos na conversa', async () => {
    setNetlabLlm(async () => JSON.stringify({ ...SMALL, nodes: SMALL.nodes.map(({ x: _x, y: _y, ...n }) => n) }))
    const { topology } = await designTopology('duas lans')
    const reply = await netlabCommandRunner('exporte para containerlab e eve-ng', topology.id)!()
    const files = [...reply.matchAll(/\[\[document:([^\]]+)\]\]/g)].map(m => m[1])
    expect(files.some(f => f.endsWith('.yml'))).toBe(true)
    expect(files.some(f => f.endsWith('.unl'))).toBe(true)
    const validate = await netlabCommandRunner('teste a comunicação da rede', topology.id)!()
    expect(validate).toMatch(/Alcance: \*\*1\/3\*\*/)
  }, 60_000)

  it('gera relatório em Word (DOCX válido com imagem) e Markdown', async () => {
    const png = path.join(os.tmpdir(), `jv-${Date.now()}.png`)
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    const sections = [{ heading: 'Diagrama', body: 'Visão geral\n- item um\n- item dois', image: png }, { heading: 'Config', body: 'config system interface\n edit port1\n set ip 1.1.1.1\n next\nend\n!\n' }]
    const docx = await buildReportDocx({ title: 'Projeto Ação & Teste', sections })
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(documentsDir(), docx.file)))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Projeto Ação &amp; Teste')
    expect(xml).toContain('•  item um')
    expect(xml).toContain('w:pStyle w:val="Code"')
    expect(zip.file('word/media/img1.png')).toBeTruthy()
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('media/img1.png')
    const md = buildReportMarkdown({ title: 'Projeto', sections })
    const text = fs.readFileSync(path.join(documentsDir(), md.file), 'utf8')
    expect(text).toMatch(/^# Projeto/)
    expect(text).toContain('data:image/png;base64,')
    expect(text).toContain('```\nconfig system interface')
  })
})

describe.runIf(!!findBrowser())('imagem e relatório (Chrome real)', () => {
  it('exporta PNG e gera o PDF + planilha do projeto', async () => {
    setNetlabLlm(async () => JSON.stringify(HACKONE))
    const { topology } = await designTopology('laboratório FCP')
    const png = await topologyPng(topology)
    const buf = fs.readFileSync(png)
    expect(buf.subarray(1, 4).toString()).toBe('PNG')
    expect(buf.readUInt32BE(16)).toBeGreaterThan(1000)
    const r = await topologyReport(topology)
    expect(r.pdf.file).toMatch(/\.pdf$/)
    expect(r.sheet.file).toMatch(/\.xlsx$/)
    expect(r.pdf.size).toBeGreaterThan(50_000)
    expect(r.docx.file).toMatch(/\.docx$/)
    expect(r.docx.size).toBeGreaterThan(20_000) // carries the diagram
    expect(r.md.file).toMatch(/\.md$/)
  }, 120_000)
})
