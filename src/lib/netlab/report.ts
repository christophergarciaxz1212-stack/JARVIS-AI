import os from 'os'
import { buildReportPdf, buildSpreadsheet, type DocumentMeta, type ReportSection } from '../docs/generate'
import { addressingPlan, deviceConfigs } from './configs'
import { layoutTopology, validateTopology } from './model'
import { topologyPng } from './png'
import { analyzeReachability } from './reach'
import { buildReportDocx, buildReportMarkdown } from '../docs/office'
import { newTopologyId, saveTopology } from './store'
import type { NetNode, Topology } from './types'
import { getInventory } from '../infra/inventory'
import { diagnose, listeningPorts } from '../infra/netdiag'
import { runPowerShell } from '../infra/exec'
import { listServers } from '../infra/ssh'
import { dockerOverview } from '../infra/docker'
import { getInfraCore, selfReport, backupStatus } from '../infra/core'

const TYPE_PT: Record<string, string> = { router: 'Roteador', switch: 'Switch', l3switch: 'Switch L3', firewall: 'Firewall', server: 'Servidor', pc: 'Estação', laptop: 'Notebook', cloud: 'Nuvem', internet: 'Internet', ap: 'Access point', loadbalancer: 'Balanceador', nas: 'Storage', phone: 'Telefone IP', printer: 'Impressora', camera: 'Câmera', vm: 'VM' }

async function diagramOrNote(t: Topology): Promise<{ image?: string; note?: string }> {
  try { return { image: await topologyPng(t) } } catch (e) { return { note: `(diagrama não gerado: ${(e as Error).message})` } }
}

/** Full design document of a topology: diagram, inventory, addressing, VLANs, validation and configs. */
export async function topologyReport(t: Topology): Promise<{ pdf: DocumentMeta; docx: DocumentMeta; md: DocumentMeta; sheet: DocumentMeta; png?: string }> {
  const issues = validateTopology(t)
  const d = await diagramOrNote(t)
  const plan = addressingPlan(t)
  const configs = deviceConfigs(t)
  const count = new Map<string, number>()
  for (const n of t.nodes) count.set(TYPE_PT[n.type] || n.type, (count.get(TYPE_PT[n.type] || n.type) || 0) + 1)
  const sections: ReportSection[] = [
    { heading: 'Visão geral', body: [t.description || 'Projeto de rede gerado pelo JARVIS.', '', `${t.nodes.length} equipamentos · ${t.links.length} conexões · ${t.zones.length} áreas · ${t.vlans.length} VLANs`, ...[...count].map(([k, v]) => `- ${k}: ${v}`)].join('\n') },
    { heading: 'Diagrama da topologia', body: d.note || 'Diagrama lógico com áreas, equipamentos, portas e sub-redes.', image: d.image },
    { heading: 'Áreas e equipamentos', body: t.zones.map(z => `# ${z.label}\n${t.nodes.filter(n => n.zone === z.id).map(n => `- ${n.label} (${TYPE_PT[n.type] || n.type}${n.vendor ? `, ${n.vendor}` : ''}${n.model ? ` ${n.model}` : ''})${n.mgmt ? ` · gerência ${n.mgmt}` : ''}`).join('\n')}`).join('\n\n') || t.nodes.map(n => `- ${n.label} (${TYPE_PT[n.type]})`).join('\n') },
    ...(t.vlans.length ? [{ heading: 'VLANs', body: t.vlans.map(v => `- VLAN ${v.id} · ${v.name}${v.subnet ? ` · ${v.subnet}` : ''}${v.gateway ? ` · gateway ${v.gateway}` : ''}`).join('\n') }] : []),
    { heading: 'Plano de endereçamento', body: plan.map(r => `- ${r[0]} ${r[1]}: ${r[2]}${r[3] ? ` (${r[3]})` : ''}${r[4] ? ` → ${r[4]}` : ''}`).join('\n') || 'Sem endereçamento definido.' },
    { heading: 'Validação do projeto', body: issues.length ? issues.map(i => `- [${i.level === 'error' ? 'ERRO' : i.level === 'warn' ? 'atenção' : 'info'}] ${i.message}`).join('\n') : 'Nenhum problema encontrado: endereçamento, cabos, portas e VLANs consistentes.' },
    { heading: 'Alcance entre estações', body: reachBody(analyzeReachability(t)) },
    ...(t.notes.length ? [{ heading: 'Decisões de projeto', body: t.notes.map(n => `- ${n}`).join('\n') }] : []),
    ...configs.map(c => ({ heading: `Configuração — ${c.label} (${c.platform})`, body: c.text.split('\n').slice(0, 120).map(l => (l.trim() ? `  ${l}` : '')).join('\n') })),
  ]
  const subtitle = `Projeto de rede · ${new Date().toLocaleDateString('pt-BR')}`
  const pdf = await buildReportPdf({ title: t.title, subtitle, coverImagePath: d.image, sections })
  const docx = await buildReportDocx({ title: t.title, subtitle, sections })
  const md = buildReportMarkdown({ title: t.title, subtitle, sections })
  const sheet = await buildSpreadsheet({
    name: `${t.title} - endereçamento`,
    sheets: [
      { name: 'Endereçamento', headers: ['Equipamento', 'Interface', 'IP / VLAN', 'Modo', 'Conectado a'], rows: plan },
      { name: 'VLANs', headers: ['VLAN', 'Nome', 'Sub-rede', 'Gateway'], rows: t.vlans.map(v => [v.id, v.name, v.subnet || '', v.gateway || '']) },
      { name: 'Equipamentos', headers: ['Equipamento', 'Tipo', 'Fabricante', 'Modelo', 'Área', 'Gerência'], rows: t.nodes.map(n => [n.label, TYPE_PT[n.type] || n.type, n.vendor || '', n.model || '', t.zones.find(z => z.id === n.zone)?.label || '', n.mgmt || '']) },
    ],
  })
  return { pdf, docx, md, sheet, png: d.image }
}

function reachBody(r: ReturnType<typeof analyzeReachability>) {
  if (!r.total) return 'Sem pares de estações com IP para avaliar.'
  return [`${r.reachable} de ${r.total} pares de estações se comunicam pelo projeto.`, '', ...r.pairs.slice(0, 40).map(p => `- ${p.ok ? 'OK' : 'SEM COMUNICAÇÃO'}: ${p.from} → ${p.to}${p.ok ? ` (${p.path!.join(' → ')})` : ` — ${p.reason}`}`), '', r.notes[0]].join('\n')
}

async function defaultGateway(): Promise<{ ip?: string; alias?: string }> {
  if (process.platform !== 'win32') return {}
  const r = await runPowerShell("Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 NextHop,InterfaceAlias | ConvertTo-Json -Compress", 15_000)
  try { const j = JSON.parse(r.stdout.trim()) as { NextHop?: string; InterfaceAlias?: string }; return { ip: j.NextHop, alias: j.InterfaceAlias } } catch { return {} }
}

/** Real diagram of this environment: this PC, its gateway, the Internet, registered servers and containers. */
export async function environmentTopology(): Promise<Topology> {
  const [inv, gw, docker] = await Promise.all([getInventory(), defaultGateway(), dockerOverview().catch(() => null)])
  const ipv4 = inv.network.filter(n => n.family === 'IPv4')
  const main = ipv4.find(n => n.name === gw.alias) || ipv4[0]
  const pc: NetNode = {
    id: 'este-pc', label: inv.host, type: 'pc', zone: 'local', vendor: inv.os.caption?.replace('Microsoft ', ''),
    ifaces: ipv4.slice(0, 4).map(n => ({ name: n.name.slice(0, 24), ip: n.cidr || n.address })),
    notes: `${inv.cpu.model} · ${Math.round(inv.memory.totalMb / 1024)} GB RAM${inv.gpus[0] ? ` · ${inv.gpus[0].name}` : ''}`,
  }
  const nodes: NetNode[] = [pc]
  const links: Topology['links'] = []
  const prefix = main?.cidr?.split('/')[1] || '24'
  if (gw.ip) {
    nodes.push({ id: 'gateway', label: 'Roteador / gateway', type: 'router', zone: 'local', ifaces: [{ name: 'LAN', ip: `${gw.ip}/${prefix}` }] })
    links.push({ id: 'l-pc-gw', a: 'este-pc', aPort: main?.name.slice(0, 24), b: 'gateway', bPort: 'LAN', subnet: main?.cidr ? `${main.cidr.split('/')[0].split('.').slice(0, 3).join('.')}.0/${prefix}` : undefined })
  }
  nodes.push({ id: 'internet', label: 'Internet', type: 'internet', zone: 'internet' })
  links.push({ id: 'l-wan', a: gw.ip ? 'gateway' : 'este-pc', aPort: 'WAN', b: 'internet', kind: 'wan' })
  for (const s of listServers().slice(0, 12)) {
    const id = `srv-${s.id.slice(-6)}`
    nodes.push({ id, label: s.name, type: 'server', zone: 'servidores', vendor: s.os === 'windows' ? 'Windows Server' : 'Linux', mgmt: s.host, notes: s.lastCheck ? `último teste ${s.lastCheck.ok ? 'ok' : 'falhou'}` : undefined })
    links.push({ id: `l-${id}`, a: 'internet', b: id, kind: 'vpn', label: `SSH :${s.port}` })
  }
  for (const c of (docker?.containers || []).slice(0, 10)) {
    const id = `ct-${c.id.slice(0, 8)}`
    nodes.push({ id, label: c.name, type: 'vm', zone: 'docker', vendor: c.image.slice(0, 24) })
    links.push({ id: `l-${id}`, a: 'este-pc', b: id, label: c.state })
  }
  const zones = [{ id: 'internet', label: 'INTERNET' }, { id: 'local', label: `REDE LOCAL${main?.cidr ? ` · ${main.cidr}` : ''}` }, { id: 'servidores', label: 'SERVIDORES (SSH)' }, { id: 'docker', label: 'CONTAINERS (Docker)' }]
    .filter(z => nodes.some(n => n.zone === z.id))
  const t: Topology = { id: newTopologyId(), title: `Infraestrutura de ${inv.host}`, description: 'Diagrama real do ambiente, gerado a partir do inventário do JARVIS.', zones, nodes, links, vlans: [], notes: [], createdAt: Date.now(), updatedAt: Date.now() }
  layoutTopology(t)
  return saveTopology(t)
}

const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`)
const RISKY_PORTS: Record<number, string> = { 21: 'FTP', 23: 'Telnet', 135: 'RPC', 139: 'NetBIOS', 445: 'SMB', 1433: 'SQL Server', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 27017: 'MongoDB', 11434: 'Ollama' }

/** Network & servers report of the REAL environment (PDF + diagram), with recommendations. */
export async function infraReport(): Promise<{ pdf: DocumentMeta; topology: Topology; summary: string }> {
  const [inv, ports, net] = await Promise.all([
    getInventory(0),
    listeningPorts().catch(() => []),
    diagnose('https://www.google.com').catch(e => ({ verdict: 'falha' as const, findings: [(e as Error).message], probableCause: undefined })),
  ])
  const topo = await environmentTopology()
  const d = await diagramOrNote(topo)
  const health = selfReport()
  const w = getInfraCore().watchdog
  const monitors = w.list()
  const incidents = w.listIncidents(20)
  const bk = backupStatus()
  const servers = listServers()
  const exposed = ports.filter(p => p.exposed)
  const risky = exposed.filter(p => RISKY_PORTS[p.port])

  const recs: string[] = []
  for (const p of risky) recs.push(`Porta ${p.port} (${RISKY_PORTS[p.port]}, processo ${p.process}) aceita conexões de toda a rede: restrinja no firewall do Windows ou ligue o serviço só em 127.0.0.1.`)
  for (const i of inv.issues) recs.push(i)
  if (!bk.last) recs.push('Nenhum backup dos dados do JARVIS ainda: ative o backup agendado.')
  if (net.verdict !== 'ok') recs.push(`Conectividade com a Internet: ${net.probableCause || net.verdict}.`)
  for (const c of health.checks.filter(c => c.status !== 'ok')) recs.push(`${c.label}: ${c.detail}`)
  if (!servers.length) recs.push('Cadastre seus servidores (peça "cadastre o servidor …" ou digite /infra) para o JARVIS monitorá-los e incluí-los nos relatórios.')
  const missing = inv.tools.filter(t => !t.path && t.installId && ['docker', 'git', 'tailscale'].includes(t.id))
  if (missing.length) recs.push(`Ferramentas úteis ausentes: ${missing.map(t => t.label).join(', ')} (o JARVIS instala com sua aprovação).`)

  const sections: ReportSection[] = [
    { heading: 'Resumo executivo', body: [`Ambiente: ${inv.host} · ${inv.os.caption || inv.os.platform} · ligado há ${(inv.os.uptimeSec / 3600).toFixed(1)} h`, `Saúde geral: ${health.status === 'ok' ? 'boa' : health.status === 'warn' ? 'com pontos de atenção' : 'com problemas'} · Internet: ${net.verdict} · ${exposed.length} porta(s) expostas na rede (${risky.length} sensíveis)`, `Monitores ativos: ${monitors.filter(m => m.enabled).length} · incidentes abertos: ${incidents.filter(i => i.status === 'open').length} · servidores cadastrados: ${servers.length}`].join('\n') },
    { heading: 'Diagrama do ambiente', body: d.note || 'Este PC, gateway, Internet, servidores cadastrados e containers.', image: d.image },
    { heading: 'Equipamento', body: [`- CPU: ${inv.cpu.model} · ${inv.cpu.cores} threads · uso ${inv.cpu.usagePct}%`, `- Memória: ${mb(inv.memory.totalMb - inv.memory.freeMb)} de ${mb(inv.memory.totalMb)} (${inv.memory.usedPct}%)`, ...inv.disks.map(x => `- Disco ${x.mount}: ${x.usedPct}% usado · ${mb(x.freeMb)} livres de ${mb(x.totalMb)}`), ...inv.gpus.map(g => `- GPU: ${g.name}${g.memoryTotalMb ? ` · VRAM ${mb(g.memoryUsedMb || 0)}/${mb(g.memoryTotalMb)}` : ''}${g.temperatureC !== undefined ? ` · ${g.temperatureC} °C` : ''}`)].join('\n') },
    { heading: 'Rede', body: [...inv.network.filter(n => n.family === 'IPv4').map(n => `- ${n.name}: ${n.cidr || n.address}`), '', `Teste de Internet (google.com): ${net.verdict.toUpperCase()}`, ...net.findings.map(f => `- ${f}`)].join('\n') },
    { heading: 'Portas em escuta', body: exposed.length ? exposed.slice(0, 40).map(p => `- ${p.address}:${p.port} · ${p.process}${RISKY_PORTS[p.port] ? ` · ${RISKY_PORTS[p.port]} (sensível)` : ''}`).join('\n') : 'Nenhuma porta exposta para a rede.' },
    { heading: 'Servidores', body: servers.length ? servers.map(s => `- ${s.name} · ${s.user}@${s.host}:${s.port} (${s.os})${s.lastCheck ? ` · último teste ${s.lastCheck.ok ? `ok (${s.lastCheck.latencyMs} ms)` : 'FALHOU'}` : ''}`).join('\n') : 'Nenhum servidor cadastrado.' },
    { heading: 'Monitoramento e incidentes', body: [...monitors.map(m => `- ${m.name} [${m.kind}] → ${m.state.status}${m.state.lastError ? ` (${m.state.lastError})` : ''}`), '', ...(incidents.length ? incidents.slice(0, 10).map(i => `- ${new Date(i.openedAt).toLocaleString('pt-BR')} ${i.monitorName}: ${i.cause} (${i.status === 'open' ? 'aberto' : i.autoRecovered ? 'recuperado automaticamente' : 'resolvido'})`) : ['Nenhum incidente registrado.'])].join('\n') },
    { heading: 'Backups e saúde do JARVIS', body: [bk.last ? `Último backup: ${new Date(bk.last.createdAt).toLocaleString('pt-BR')} (${(bk.last.size / 1048576).toFixed(1)} MB${bk.last.verifyOk === false ? ', FALHOU na verificação' : ''})` : 'Nenhum backup ainda.', '', ...health.checks.map(c => `- ${c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Atenção' : 'Problema'} · ${c.label}: ${c.detail}`)].join('\n') },
    { heading: 'Recomendações', body: recs.length ? recs.map(r => `- ${r}`).join('\n') : 'Nenhuma ação necessária no momento.' },
  ]
  const pdf = await buildReportPdf({ title: `Relatório de rede e servidores — ${inv.host}`, subtitle: `${new Date().toLocaleString('pt-BR')} · ${os.platform()}`, coverImagePath: d.image, sections })
  const summary = [
    `**Relatório de rede e servidores — ${inv.host}**`,
    `- Saúde: ${health.status === 'ok' ? '✅ boa' : health.status === 'warn' ? '⚠️ atenção' : '❌ problemas'} · Internet: ${net.verdict} · CPU ${inv.cpu.usagePct}% · RAM ${inv.memory.usedPct}%`,
    `- ${exposed.length} porta(s) expostas na rede${risky.length ? ` — sensíveis: ${risky.map(p => `${p.port}/${RISKY_PORTS[p.port]}`).join(', ')}` : ''}`,
    `- ${servers.length} servidor(es) cadastrados · ${monitors.filter(m => m.enabled).length} monitores · ${incidents.filter(i => i.status === 'open').length} incidente(s) aberto(s)`,
    recs.length ? `\n**Recomendações principais**\n${recs.slice(0, 5).map(r => `- ${r}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
  return { pdf, topology: topo, summary }
}
