import type { DeviceType, LinkKind, NetNode, Topology } from './types'
import { NODE_H, NODE_W, zoneBoxes } from './model'

// Every string that reaches the SVG comes from the user or a model: always escaped.
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const ZONE_COLORS = ['#7dd3c0', '#8ec5f0', '#f7e59a', '#f5b7b1', '#c7b8f5', '#b8e0a6', '#f9c98c']
const zoneFill = (c: string) => `${c}55`

/** Device icons drawn in a 64x48 box (EVE-NG style, flat colours). */
function icon(type: DeviceType): string {
  switch (type) {
    case 'router':
      return `<ellipse cx="32" cy="30" rx="26" ry="11" fill="#1d5f9e"/><rect x="6" y="18" width="52" height="12" fill="#2f7dc4"/><ellipse cx="32" cy="18" rx="26" ry="11" fill="#4a9be0"/>
<path d="M20 18h8m-3-3 3 3-3 3M44 18h-8m3-3-3 3 3 3M32 12v-4m-3 3 3-3 3 3M32 24v4m-3-3 3 3 3-3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'switch':
      return `<path d="M6 22 16 12h42l-10 10z" fill="#5aa6e8"/><rect x="6" y="22" width="42" height="16" fill="#2f7dc4"/><path d="M48 22l10-10v16l-10 10z" fill="#1d5f9e"/>
<path d="M14 27h14m-3-3 3 3-3 3M40 33H26m3-3-3 3 3 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>`
    case 'l3switch':
      return `<rect x="10" y="8" width="44" height="34" rx="4" fill="#1b7fa0"/><g transform="translate(32 25)" stroke="#fff" stroke-width="2.4" stroke-linecap="round">${[0, 45, 90, 135].map(a => `<line x1="-13" y1="0" x2="13" y2="0" transform="rotate(${a})"/>`).join('')}</g><circle cx="32" cy="25" r="5" fill="#fff"/>`
    case 'firewall':
      return `<rect x="10" y="8" width="44" height="34" rx="3" fill="#d7322a"/><g stroke="#fff" stroke-width="1.6" opacity=".85"><line x1="10" y1="19" x2="54" y2="19"/><line x1="10" y1="30" x2="54" y2="30"/><line x1="24" y1="8" x2="24" y2="19"/><line x1="40" y1="8" x2="40" y2="19"/><line x1="17" y1="19" x2="17" y2="30"/><line x1="32" y1="19" x2="32" y2="30"/><line x1="47" y1="19" x2="47" y2="30"/><line x1="24" y1="30" x2="24" y2="42"/><line x1="40" y1="30" x2="40" y2="42"/></g>`
    case 'server':
    case 'nas':
      return `<rect x="18" y="4" width="28" height="42" rx="3" fill="#4b5563"/><rect x="18" y="4" width="28" height="42" rx="3" fill="none" stroke="#1f2937"/>${[10, 17, 24].map(y => `<rect x="22" y="${y}" width="20" height="4" rx="1" fill="#9ca3af"/>`).join('')}<circle cx="38" cy="38" r="2.2" fill="#34d399"/>${type === 'nas' ? '<text x="32" y="44" font-size="6" text-anchor="middle" fill="#fff">NAS</text>' : ''}`
    case 'vm':
      return `<rect x="12" y="8" width="40" height="34" rx="5" fill="#6b7280"/><text x="32" y="30" font-size="13" font-weight="700" text-anchor="middle" fill="#fff">VM</text>`
    case 'pc':
      return `<rect x="10" y="6" width="44" height="28" rx="2" fill="#1f2937"/><rect x="13" y="9" width="38" height="22" fill="#38bdf8"/><path d="M28 34h8l2 7H26z" fill="#4b5563"/><rect x="20" y="41" width="24" height="3" rx="1" fill="#4b5563"/>`
    case 'laptop':
      return `<rect x="14" y="8" width="36" height="24" rx="2" fill="#1f2937"/><rect x="17" y="11" width="30" height="18" fill="#38bdf8"/><path d="M8 34h48l-4 6H12z" fill="#6b7280"/>`
    case 'internet':
    case 'cloud':
      return `<path d="M18 40h30a10 10 0 0 0 1-20 14 14 0 0 0-27-3 9 9 0 0 0-4 23z" fill="#ffffff" stroke="#9ca3af" stroke-width="2"/>${type === 'internet' ? '<circle cx="34" cy="28" r="7" fill="none" stroke="#3b82f6" stroke-width="1.6"/><path d="M27 28h14M34 21c-3 4-3 10 0 14M34 21c3 4 3 10 0 14" stroke="#3b82f6" stroke-width="1.3" fill="none"/>' : ''}`
    case 'ap':
      return `<path d="M14 38a18 8 0 0 1 36 0z" fill="#e5e7eb" stroke="#6b7280"/><circle cx="32" cy="34" r="2.5" fill="#22c55e"/>${[8, 14, 20].map(r => `<path d="M${32 - r} ${26 - r / 3}a${r} ${r} 0 0 1 ${r * 2} 0" stroke="#3b82f6" stroke-width="2" fill="none"/>`).join('')}`
    case 'loadbalancer':
      return `<path d="M32 4l22 12v20L32 48 10 36V16z" fill="#7c3aed"/><path d="M22 26h20m-6-5 6 5-6 5M22 18l8 0M22 34h8" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    case 'phone':
      return `<rect x="22" y="6" width="20" height="38" rx="4" fill="#374151"/><rect x="25" y="10" width="14" height="22" fill="#38bdf8"/>`
    case 'printer':
      return `<rect x="20" y="6" width="24" height="12" fill="#e5e7eb" stroke="#6b7280"/><rect x="12" y="18" width="40" height="18" rx="3" fill="#4b5563"/><rect x="20" y="30" width="24" height="12" fill="#fff" stroke="#6b7280"/>`
    case 'camera':
      return `<rect x="10" y="16" width="34" height="18" rx="4" fill="#4b5563"/><path d="M44 21l10-6v20l-10-6z" fill="#4b5563"/><circle cx="22" cy="25" r="5" fill="#38bdf8"/>`
  }
}

function linkStyle(kind?: LinkKind) {
  switch (kind) {
    case 'trunk': return 'stroke="#1e6fb8" stroke-width="3"'
    case 'wan': return 'stroke="#0e7490" stroke-width="2.4"'
    case 'ha': return 'stroke="#ea580c" stroke-width="3" stroke-dasharray="10 4"'
    case 'vpn': return 'stroke="#16a34a" stroke-width="2.2" stroke-dasharray="7 5"'
    case 'wireless': return 'stroke="#6366f1" stroke-width="2" stroke-dasharray="2 5"'
    case 'fiber': return 'stroke="#d97706" stroke-width="2.6"'
    default: return 'stroke="#2b7bbd" stroke-width="2"'
  }
}

const center = (n: NetNode) => ({ x: n.x! + NODE_W / 2, y: n.y! + 30 })
type Pt = { x: number; y: number }

/** Distance from the icon centre to where a ray in direction (dx,dy) leaves the device box (icon + labels). */
function exitDistance(n: NetNode, dx: number, dy: number) {
  const c = center(n)
  const box = { x0: n.x! - 4, y0: n.y! - 4, x1: n.x! + NODE_W + 4, y1: n.y! + 86 }
  let t = Infinity
  if (dx > 1e-6) t = Math.min(t, (box.x1 - c.x) / dx)
  if (dx < -1e-6) t = Math.min(t, (box.x0 - c.x) / dx)
  if (dy > 1e-6) t = Math.min(t, (box.y1 - c.y) / dy)
  if (dy < -1e-6) t = Math.min(t, (box.y0 - c.y) / dy)
  return Number.isFinite(t) ? t : 40
}

const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y })

/** Point on a quadratic curve at a given straight-line distance from its start (small search, plenty for labels). */
function alongCurve(a: Pt, c: Pt, b: Pt, dist: number): Pt {
  let best = a
  for (let i = 1; i <= 40; i++) {
    const p = quad(a, c, b, i / 80)
    best = p
    if (Math.hypot(p.x - a.x, p.y - a.y) >= dist) break
  }
  return best
}

function portTag(x: number, y: number, text: string) {
  const w = Math.max(26, text.length * 6.2 + 10)
  return `<g class="nl-port"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="8" fill="#e8f3fb" stroke="#2b7bbd" stroke-width="1"/><text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-size="10" text-anchor="middle" fill="#0f3d63">${esc(text)}</text></g>`
}

export interface SvgOptions {
  title?: boolean
  vlanTable?: boolean
  /** Highlights this device and its cables; the other cables are faded */
  selected?: string
  /** false = transparent, for an interactive canvas that draws its own endless grid */
  background?: boolean
}

/** Topology → standalone SVG (light canvas with grid, like EVE-NG). */
export function topologySvg(t: Topology, opts: SvgOptions = {}): string {
  const showTitle = opts.title !== false
  const nodes = t.nodes.filter(n => n.x !== undefined && n.y !== undefined)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const zones = zoneBoxes(t)
  const vlanW = t.vlans.length && opts.vlanTable !== false ? 300 : 0
  const minX = Math.min(0, ...nodes.map(n => n.x! - 60), ...zones.map(z => z.x - 20))
  const minY = Math.min(0, ...nodes.map(n => n.y! - 60), ...zones.map(z => z.y - 20)) - (showTitle ? 60 : 0)
  const maxX = Math.max(400, ...nodes.map(n => n.x! + NODE_W + 60), ...zones.map(z => z.x + z.w + 20)) + (vlanW ? vlanW + 40 : 0)
  const maxY = Math.max(300, ...nodes.map(n => n.y! + NODE_H + 60), ...zones.map(z => z.y + z.h + 20), vlanW ? minY + 120 + t.vlans.length * 22 : 0)
  const W = maxX - minX, H = maxY - minY

  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif">`)
  if (opts.background !== false) {
    out.push(`<defs><pattern id="nlgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e6ebf1" stroke-width="1"/></pattern></defs>`)
    out.push(`<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#fbfcfe"/><rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="url(#nlgrid)"/>`)
  }
  if (showTitle) out.push(`<text x="${minX + 30}" y="${minY + 42}" font-size="26" font-weight="700" fill="#c81e1e">${esc(t.title)}</text>`)

  zones.forEach((z, i) => {
    const c = z.color || ZONE_COLORS[i % ZONE_COLORS.length]
    out.push(`<g class="nl-zone"><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="6" fill="${zoneFill(c)}" stroke="#334155" stroke-width="1.4" stroke-dasharray="6 4"/>`)
    const tw = z.label.length * 8.4 + 22
    out.push(`<rect x="${z.x + 12}" y="${z.y + 8}" width="${tw}" height="24" rx="3" fill="#ffffff" stroke="#334155" stroke-width="1"/><text x="${z.x + 23}" y="${z.y + 25}" font-size="14" font-weight="600" fill="#0f172a">${esc(z.label)}</text></g>`)
  })

  // Labels are collected and drawn after every cable, so no cable ever crosses over a label
  const labels: string[] = []
  for (const l of t.links) {
    const a = byId.get(l.a), b = byId.get(l.b)
    if (!a || !b) continue
    const pa = center(a), pb = center(b)
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1
    // Same row and not neighbours: a straight cable would run behind the devices in between, so it bends
    const between = Math.abs(pa.y - pb.y) < 12 && t.nodes.some(n => n.id !== a.id && n.id !== b.id && n.x !== undefined && Math.abs(center(n).y - pa.y) < 12 && center(n).x > Math.min(pa.x, pb.x) && center(n).x < Math.max(pa.x, pb.x))
    const mid = [l.label, l.subnet].filter(Boolean).join(' · ') || (l.kind && l.kind !== 'ethernet' ? l.kind.toUpperCase() : '')
    const touches = !!opts.selected && (l.a === opts.selected || l.b === opts.selected)
    const fade = opts.selected && !touches ? ' opacity="0.25"' : ''
    const glow = 'fill="none" stroke="#60a5fa" stroke-width="8" stroke-opacity="0.45" stroke-linecap="round"'
    let m: Pt, tagA: Pt, tagB: Pt
    if (between) {
      const bow = Math.min(110, 40 + len * 0.18)
      const ctrl = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 - bow * 2 }
      const d = `M${pa.x} ${pa.y} Q${ctrl.x} ${ctrl.y} ${pb.x} ${pb.y}`
      if (touches) out.push(`<path d="${d}" ${glow}/>`)
      out.push(`<path class="nl-link" data-link="${esc(l.id)}" d="${d}" fill="none" ${linkStyle(l.kind)} stroke-linecap="round"${fade}/>`)
      m = quad(pa, ctrl, pb, 0.5)
      tagA = alongCurve(pa, ctrl, pb, 58)
      tagB = alongCurve(pb, ctrl, pa, 58)
    } else {
      if (touches) out.push(`<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" ${glow}/>`)
      out.push(`<line class="nl-link" data-link="${esc(l.id)}" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" ${linkStyle(l.kind)} stroke-linecap="round"${fade}/>`)
      const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len
      m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
      const da = Math.min(len * 0.42, exitDistance(a, ux, uy) + 14)
      const db = Math.min(len * 0.42, exitDistance(b, -ux, -uy) + 14)
      tagA = { x: pa.x + ux * da, y: pa.y + uy * da }
      tagB = { x: pb.x - ux * db, y: pb.y - uy * db }
    }
    // Too short for two separate port tags: one combined tag in the middle, link label lifted above it
    const portsW = ((l.aPort?.length || 0) + (l.bPort?.length || 0)) * 6.2 + 60
    const cramped = !between && l.aPort && l.bPort && Math.hypot(tagB.x - tagA.x, tagB.y - tagA.y) < portsW / 2 + 10
    if (cramped) {
      labels.push(portTag(m.x, m.y, `${l.aPort} ⇄ ${l.bPort}`))
      // Mostly vertical cable: the label goes beside the tag (above it would cover the device's IP)
      const vertical = Math.abs(pb.y - pa.y) > Math.abs(pb.x - pa.x)
      const lw = mid ? mid.length * 6.4 + 14 : 0
      m = vertical ? { x: m.x + portsW / 2 + lw / 2 - 18, y: m.y } : { x: m.x, y: m.y - 20 }
    }
    if (mid) {
      const w = mid.length * 6.4 + 14
      labels.push(`<rect x="${(m.x - w / 2).toFixed(1)}" y="${(m.y - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="3" fill="#ffffff" stroke="#94a3b8"/><text x="${m.x.toFixed(1)}" y="${(m.y + 4).toFixed(1)}" font-size="10.5" font-weight="600" text-anchor="middle" fill="#0f172a">${esc(mid)}</text>`)
    }
    if (!cramped && l.aPort) labels.push(portTag(tagA.x, tagA.y, l.aPort))
    if (!cramped && l.bPort) labels.push(portTag(tagB.x, tagB.y, l.bPort))
  }

  for (const n of nodes) {
    const firstIp = n.mgmt || n.ifaces?.find(i => i.ip && !/dhcp/i.test(i.ip))?.ip
    const sel = opts.selected === n.id
    out.push(`<g class="nl-node" data-node="${esc(n.id)}" transform="translate(${n.x} ${n.y})" style="cursor:grab">`)
    out.push(`<rect x="-4" y="-6" width="${NODE_W + 8}" height="${NODE_H + 10}" rx="10" fill="${sel ? '#dbeafe' : 'transparent'}" stroke="${sel ? '#2563eb' : 'transparent'}" stroke-width="1.5"/>`)
    out.push(`<g transform="translate(${(NODE_W - 64) / 2} 2)">${icon(n.type)}</g>`)
    // Background-coloured outline keeps names readable where a cable passes behind them
    const halo = 'stroke="#fbfcfe" stroke-width="4" stroke-linejoin="round" paint-order="stroke"'
    out.push(`<text x="${NODE_W / 2}" y="64" font-size="12.5" font-weight="700" text-anchor="middle" fill="#0f172a" ${halo}>${esc(n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label)}</text>`)
    const sub = [n.vendor, firstIp].filter(Boolean).join(' · ')
    if (sub) out.push(`<text x="${NODE_W / 2}" y="79" font-size="10" text-anchor="middle" fill="#475569" ${halo}>${esc(sub.length > 30 ? sub.slice(0, 29) + '…' : sub)}</text>`)
    out.push(`</g>`)
  }
  out.push(...labels)

  if (vlanW) {
    const x = maxX - vlanW - 20, y = minY + (showTitle ? 70 : 20)
    out.push(`<g class="nl-vlans"><rect x="${x}" y="${y}" width="${vlanW}" height="${36 + t.vlans.length * 22}" rx="4" fill="#ffffff" stroke="#334155"/>`)
    out.push(`<text x="${x + 14}" y="${y + 23}" font-size="13" font-weight="700" fill="#0f172a">VLANs</text>`)
    t.vlans.forEach((v, i) => {
      out.push(`<text x="${x + 14}" y="${y + 46 + i * 22}" font-size="11.5" fill="#1e293b">${esc(`VLAN_${v.id} - ${v.name}${v.subnet ? ` · ${v.subnet}` : ''}`)}</text>`)
    })
    out.push(`</g>`)
  }
  out.push('</svg>')
  return out.join('\n')
}
