import type { Iface, NetLink, NetNode, Topology } from './types'
import { intToIp, maskText, parseCidr } from './ip'

export interface DeviceConfig { node: string; label: string; platform: string; filename: string; text: string }

const host = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'device'
const neighbourOf = (t: Topology, n: NetNode, port: string) => {
  const l = t.links.find(x => (x.a === n.id && x.aPort?.toLowerCase() === port.toLowerCase()) || (x.b === n.id && x.bPort?.toLowerCase() === port.toLowerCase()))
  if (!l) return undefined
  const otherId = l.a === n.id ? l.b : l.a
  const other = t.nodes.find(x => x.id === otherId)
  return { link: l, other, otherPort: l.a === n.id ? l.bPort : l.aPort }
}

/** Interfaces the node really has: declared ones plus ports that only appear on its cables. */
function portsOf(t: Topology, n: NetNode): Iface[] {
  const list = [...(n.ifaces || [])]
  for (const l of t.links) {
    const p = l.a === n.id ? l.aPort : l.b === n.id ? l.bPort : undefined
    if (p && !list.some(i => i.name.toLowerCase() === p.toLowerCase())) list.push({ name: p, mode: l.kind === 'trunk' ? 'trunk' : undefined })
  }
  return list
}

const isWanLink = (t: Topology, l: NetLink) => l.kind === 'wan' || [l.a, l.b].some(id => ['internet', 'cloud', 'router'].includes(t.nodes.find(n => n.id === id)?.type || '') && l.kind !== 'trunk')

function gatewayFor(t: Topology, n: NetNode): string | undefined {
  for (const i of portsOf(t, n)) {
    const nb = neighbourOf(t, n, i.name)
    if (!nb?.other || !['router', 'firewall', 'internet', 'cloud', 'l3switch'].includes(nb.other.type)) continue
    const theirs = nb.other.ifaces?.find(x => x.name.toLowerCase() === nb.otherPort?.toLowerCase())
    const mine = parseCidr(i.ip)
    const gw = parseCidr(theirs?.ip)
    if (mine && gw && mine.network === gw.network) return intToIp(gw.ip)
  }
  return undefined
}

function ciscoIos(t: Topology, n: NetNode): string {
  const lines = [`! ${n.label} — gerado pelo JARVIS (revise antes de aplicar)`, 'enable', 'configure terminal', `hostname ${host(n.label)}`, 'no ip domain-lookup', 'service password-encryption', '!']
  const l3 = n.type === 'router' || n.type === 'l3switch'
  if (n.type !== 'router' && t.vlans.length) {
    for (const v of t.vlans) lines.push(`vlan ${v.id}`, ` name ${host(v.name)}`)
    lines.push('!')
  }
  if (n.type === 'l3switch') lines.push('ip routing', '!')
  for (const i of portsOf(t, n)) {
    const nb = neighbourOf(t, n, i.name)
    lines.push(`interface ${i.name}`)
    const desc = i.description || (nb?.other ? `${nb.other.label} ${nb.otherPort || ''}`.trim() : '')
    if (desc) lines.push(` description ${desc.replace(/[\r\n]/g, ' ').slice(0, 60)}`)
    const c = parseCidr(i.ip)
    if (i.mode === 'trunk' || nb?.link.kind === 'trunk') {
      lines.push(' switchport trunk encapsulation dot1q', ' switchport mode trunk')
      const allowed = i.vlans?.length ? i.vlans : t.vlans.map(v => v.id)
      if (allowed.length) lines.push(` switchport trunk allowed vlan ${allowed.join(',')}`)
    } else if (c && l3) {
      if (n.type === 'l3switch' && /^(gi|fa|eth|e)\d/i.test(i.name)) lines.push(' no switchport')
      lines.push(` ip address ${intToIp(c.ip)} ${maskText(c.prefix)}`)
    } else if (i.vlan || i.mode === 'access') {
      lines.push(' switchport mode access', ` switchport access vlan ${i.vlan || 1}`, ' spanning-tree portfast')
    }
    lines.push(' no shutdown', '!')
  }
  if (n.type === 'l3switch' || n.type === 'switch') {
    for (const v of t.vlans) {
      const gw = parseCidr(v.gateway ? `${v.gateway.split('/')[0]}/${(v.subnet || '/24').split('/')[1] || 24}` : undefined)
      if (n.type === 'l3switch' && gw) lines.push(`interface Vlan${v.id}`, ` description ${host(v.name)}`, ` ip address ${intToIp(gw.ip)} ${maskText(gw.prefix)}`, ' no shutdown', '!')
    }
    const mgmt = parseCidr(n.mgmt)
    if (n.type === 'switch' && mgmt) {
      const mv = t.vlans.find(v => parseCidr(v.subnet)?.network === mgmt.network)?.id || 1
      lines.push(`interface Vlan${mv}`, ' description MGMT', ` ip address ${intToIp(mgmt.ip)} ${maskText(mgmt.prefix)}`, ' no shutdown', '!')
    }
  }
  const gw = gatewayFor(t, n)
  if (gw && n.type !== 'switch') lines.push(`ip route 0.0.0.0 0.0.0.0 ${gw}`)
  else if (gw) lines.push(`ip default-gateway ${gw}`)
  lines.push('line vty 0 4', ' transport input ssh', ' login local', '!', 'end', 'write memory')
  return lines.join('\n')
}

function fortigate(t: Topology, n: NetNode): string {
  const out = [`# ${n.label} — FortiOS, gerado pelo JARVIS (revise antes de aplicar)`, 'config system global', `    set hostname "${host(n.label)}"`, '    set admintimeout 15', 'end', 'config system interface']
  const wan: string[] = []
  const lan: string[] = []
  for (const i of portsOf(t, n)) {
    const nb = neighbourOf(t, n, i.name)
    const c = parseCidr(i.ip)
    const role = nb && isWanLink(t, nb.link) ? 'wan' : 'lan'
    ;(role === 'wan' ? wan : lan).push(i.name)
    out.push(`    edit "${i.name}"`, '        set mode static')
    if (c) out.push(`        set ip ${intToIp(c.ip)} ${maskText(c.prefix)}`)
    out.push(`        set allowaccess ${role === 'wan' ? 'ping' : 'ping https ssh'}`, `        set role ${role}`)
    if (nb?.other) out.push(`        set description "${nb.other.label.replace(/"/g, '')}"`)
    out.push('    next')
  }
  for (const v of t.vlans) {
    const gw = v.gateway && parseCidr(`${v.gateway.split('/')[0]}/${(v.subnet || '/24').split('/')[1] || 24}`)
    const parent = lan[0]
    if (!gw || !parent) continue
    out.push(`    edit "vlan${v.id}"`, `        set vdom "root"`, `        set interface "${parent}"`, `        set vlanid ${v.id}`, `        set ip ${intToIp(gw.ip)} ${maskText(gw.prefix)}`, '        set allowaccess ping', '        set role lan', '    next')
  }
  out.push('end')
  const ha = t.links.find(l => l.kind === 'ha' && (l.a === n.id || l.b === n.id))
  if (ha) {
    const port = ha.a === n.id ? ha.aPort : ha.bPort
    out.push('config system ha', `    set group-name "${host(t.title)}"`, '    set mode a-p', `    set hbdev "${port || 'port5'}" 50`, '    set session-pickup enable', '    set override disable', `    set priority ${t.nodes.filter(x => x.type === 'firewall').indexOf(n) === 0 ? 200 : 100}`, 'end')
  }
  const gw = gatewayFor(t, n)
  if (gw && wan[0]) out.push('config router static', '    edit 1', `        set gateway ${gw}`, `        set device "${wan[0]}"`, '    next', 'end')
  if (wan[0] && (lan[0] || t.vlans.length)) {
    const srcs = [...lan, ...t.vlans.filter(v => v.gateway).map(v => `vlan${v.id}`)]
    out.push('config firewall policy', '    edit 1', '        set name "LAN-para-Internet"', `        set srcintf ${srcs.map(s => `"${s}"`).join(' ')}`, `        set dstintf "${wan[0]}"`, '        set action accept', '        set srcaddr "all"', '        set dstaddr "all"', '        set schedule "always"', '        set service "ALL"', '        set utm-status enable', '        set ssl-ssh-profile "certificate-inspection"', '        set av-profile "default"', '        set webfilter-profile "default"', '        set ips-sensor "default"', '        set logtraffic all', '        set nat enable', '    next', 'end')
  }
  return out.join('\n')
}

function linuxNetplan(t: Topology, n: NetNode): string {
  const ifs = portsOf(t, n).filter(i => i.ip)
  if (!ifs.length) return `# ${n.label}: sem IP fixo definido — usa DHCP`
  const gw = gatewayFor(t, n)
  const y = ['# /etc/netplan/01-jarvis.yaml — aplicar com: sudo netplan apply', 'network:', '  version: 2', '  ethernets:']
  ifs.forEach((i, k) => {
    y.push(`    ${i.name.replace(/[^\w.-]/g, '') || `eth${k}`}:`, `      addresses: [${i.ip}]`)
    if (gw && k === 0) y.push('      routes:', `        - to: default`, `          via: ${gw}`, '      nameservers:', '        addresses: [1.1.1.1, 8.8.8.8]')
  })
  return y.join('\n')
}

function windowsPs(t: Topology, n: NetNode): string {
  const ifs = portsOf(t, n).filter(i => parseCidr(i.ip))
  if (!ifs.length) return `# ${n.label}: sem IP fixo definido — usa DHCP`
  const gw = gatewayFor(t, n)
  return ifs.map((i, k) => {
    const c = parseCidr(i.ip)!
    return [`# ${n.label} ${i.name} — PowerShell (como Administrador)`, `$if = (Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1).ifIndex`,
      `New-NetIPAddress -InterfaceIndex $if -IPAddress ${intToIp(c.ip)} -PrefixLength ${c.prefix}${gw && k === 0 ? ` -DefaultGateway ${gw}` : ''}`,
      `Set-DnsClientServerAddress -InterfaceIndex $if -ServerAddresses 1.1.1.1,8.8.8.8`].join('\n')
  }).join('\n\n')
}

export function deviceConfigs(t: Topology): DeviceConfig[] {
  const out: DeviceConfig[] = []
  for (const n of t.nodes) {
    let platform = ''
    let text = ''
    if (n.type === 'firewall' && (/forti/i.test(`${n.vendor} ${n.model} ${n.label}`) || !n.vendor)) { platform = 'FortiOS'; text = fortigate(t, n) }
    else if (['router', 'switch', 'l3switch', 'firewall'].includes(n.type)) { platform = 'Cisco IOS'; text = ciscoIos(t, n) }
    else if (['server', 'vm', 'nas'].includes(n.type) && !/windows|win\b|ad\b|active directory/i.test(`${n.label} ${n.vendor} ${n.notes}`)) { platform = 'Linux (netplan)'; text = linuxNetplan(t, n) }
    else if (['server', 'pc', 'laptop', 'vm'].includes(n.type)) { platform = 'Windows (PowerShell)'; text = windowsPs(t, n) }
    else continue
    out.push({ node: n.id, label: n.label, platform, filename: `${host(n.label)}.${platform.startsWith('Linux') ? 'yaml' : platform.startsWith('Windows') ? 'ps1' : 'cfg'}`, text })
  }
  return out
}

/** Addressing plan table (rows) for reports and spreadsheets. */
export function addressingPlan(t: Topology): Array<[string, string, string, string, string]> {
  const rows: Array<[string, string, string, string, string]> = []
  for (const n of t.nodes) for (const i of portsOf(t, n)) {
    const nb = neighbourOf(t, n, i.name)
    if (!i.ip && !i.vlan && !nb) continue
    rows.push([n.label, i.name, i.ip || (i.vlan ? `VLAN ${i.vlan}` : '—'), i.mode || (nb?.link.kind || ''), nb?.other ? `${nb.other.label} ${nb.otherPort || ''}`.trim() : ''])
  }
  return rows
}
