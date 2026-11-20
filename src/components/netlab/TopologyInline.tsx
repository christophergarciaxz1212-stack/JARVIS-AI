'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Cable, Copy, Download, FileCode2, Layers, Lightbulb, Loader2, Maximize2, Minimize2, Minus, Plus, ScanSearch, X } from 'lucide-react'
import { toast } from 'sonner'
import { topologySvg } from '@/lib/netlab/svg'
import type { Issue, Topology } from '@/lib/netlab/types'
import type { DeviceConfig } from '@/lib/netlab/configs'
import { usePortalTarget } from '@/components/usePortalTarget'

interface Data { topology: Topology; issues: Issue[]; configs: DeviceConfig[] }
type Drag = { kind: 'node' | 'pan'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }

const TYPE_PT: Record<string, string> = { router: 'Roteador', switch: 'Switch', l3switch: 'Switch L3', firewall: 'Firewall', server: 'Servidor', pc: 'Estação', laptop: 'Notebook', cloud: 'Nuvem', internet: 'Internet', ap: 'Access point', loadbalancer: 'Balanceador', nas: 'Storage', phone: 'Telefone IP', printer: 'Impressora', camera: 'Câmera', vm: 'VM / container' }
const GRID = 20
const snap = (v: number) => Math.round(v / 10) * 10

/** EVE-NG–style topology canvas inside the chat: drag devices, pan/zoom, inspect configs, export. */
export default function TopologyInline({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState({ x: 0, y: 0, s: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  const [overlay, setOverlay] = useState<'issues' | 'vlans' | null>(null)
  const [panning, setPanning] = useState(false)
  // The usage hint only stays until the first interaction
  const [touched, setTouched] = useState(false)
  const portalTarget = usePortalTarget()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf = useRef(0)

  useEffect(() => {
    fetch(`/api/netlab?id=${id}`, { cache: 'no-store' }).then(r => r.json()).then(d => { if (d.error) setError(d.error); else setData(d) }).catch(e => setError(e.message))
  }, [id])

  // On the canvas the title lives in the header, the VLANs in an overlay and the grid is the canvas's own
  const svg = useMemo(() => (data ? topologySvg(data.topology, { selected: selected || undefined, title: false, vlanTable: false, background: false }) : ''), [data, selected])
  const size = useMemo(() => {
    const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/)
    return vb ? { x: Number(vb[1]), y: Number(vb[2]), w: Number(vb[3]), h: Number(vb[4]) } : { x: 0, y: 0, w: 1000, h: 600 }
  }, [svg])

  const fit = useCallback(() => {
    const el = box.current
    if (!el || !data) return
    const s = Math.min(el.clientWidth / size.w, el.clientHeight / size.h, 1.4) * 0.92
    setView({ s, x: (el.clientWidth - size.w * s) / 2, y: (el.clientHeight - size.h * s) / 2 })
  }, [data, size.w, size.h])
  // Fit once when loaded and whenever the canvas changes size
  const fitted = useRef(false)
  useEffect(() => { if (data && !fitted.current) { fitted.current = true; requestAnimationFrame(fit) } }, [data, fit])
  useEffect(() => { requestAnimationFrame(fit) }, [big]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => setView(v => {
    const s = Math.max(0.15, Math.min(4, v.s * factor))
    return { s, x: cx - ((cx - v.x) * s) / v.s, y: cy - ((cy - v.y) * s) / v.s }
  }), [])
  const zoomCenter = (factor: number) => zoomAt(factor, (box.current?.clientWidth || 0) / 2, (box.current?.clientHeight || 0) / 2)

  // Attached once the canvas exists (not on every drag frame) and again when full screen moves it to the app root
  const loaded = !!data
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loaded, zoomAt, big, portalTarget])

  const savePositions = (t: Topology) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const positions = Object.fromEntries(t.nodes.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
      fetch('/api/netlab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'positions', id, positions }) }).catch(() => {})
    }, 400)
  }

  const placed = (t: Topology, d: Drag, dx: number, dy: number): Topology =>
    ({ ...t, nodes: t.nodes.map(n => (n.id === d.id ? { ...n, x: snap(d.ox + dx / view.s), y: snap(d.oy + dy / view.s) } : n)) })

  const onDown = (e: React.PointerEvent) => {
    // Buttons and overlays keep their own clicks; capturing the pointer here would swallow them
    if (!data || e.button !== 0 || (e.target as Element).closest('button, a, [data-overlay]')) return
    setTouched(true)
    const nodeId = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') || undefined
    const n = nodeId ? data.topology.nodes.find(x => x.id === nodeId) : undefined
    drag.current = n
      ? { kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x ?? 0, oy: n.y ?? 0, moved: false }
      : { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !data) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; if (d.kind === 'pan') setPanning(true) }
    if (!d.moved) return
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      if (d.kind === 'pan') setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
      else setData(cur => cur && ({ ...cur, topology: placed(cur.topology, d, dx, dy) }))
    })
  }
  // The final spot comes from the release point itself: the last animation frame may not have run yet
  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d || !data) return
    if (d.moved) cancelAnimationFrame(raf.current)
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (d.kind === 'node' && d.moved) {
      const topology = cancelled ? data.topology : placed(data.topology, d, dx, dy)
      setData({ ...data, topology })
      savePositions(topology)
    } else if (d.kind === 'pan' && d.moved) {
      if (!cancelled) setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    } else if (d.kind === 'node') setSelected(s => (s === d.id ? null : d.id!))
    else { setSelected(null); setOverlay(null) }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.2) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(1 / 1.2) }
    else if (e.key === '0') { e.preventDefault(); fit() }
    else if (e.key === 'Escape' && !big) { setSelected(null); setOverlay(null) }
  }

  if (error) return <div className="mt-3 text-xs text-red-300">Topologia: {error}</div>
  if (!data) return <div className="mt-3 flex items-center gap-2 text-xs text-white/50"><Loader2 size={13} className="animate-spin" /> Carregando topologia…</div>

  const t = data.topology
  const node = selected ? t.nodes.find(n => n.id === selected) : undefined
  const cfg = node ? data.configs.find(c => c.node === node.id) : undefined
  const errors = data.issues.filter(i => i.level === 'error').length
  // Sugestões de projeto (ponto único de falha, firewall de borda) não são problemas
  const problems = data.issues.filter(i => i.level !== 'info').length
  const neighbours = node
    ? t.links.filter(l => l.a === node.id || l.b === node.id).map(l => {
        const mine = l.a === node.id
        return { id: l.id, port: mine ? l.aPort : l.bPort, other: t.nodes.find(n => n.id === (mine ? l.b : l.a)), otherPort: mine ? l.bPort : l.aPort }
      })
    : []
  // Zoomed far out, a 20px grid turns into noise: switch to a coarser one
  const step = view.s < 0.5 ? GRID * 5 : GRID
  const btn = 'p-1.5 rounded-md bg-white/95 hover:bg-white text-slate-700 shadow-sm border border-slate-200 transition-colors'
  const chip = 'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border transition-colors'
  const plain = `${chip} bg-white border-slate-200 hover:bg-slate-100`

  const designer = (
      <div className={`keep-colors rounded-xl overflow-hidden border border-cyan-500/25 bg-white ${big ? 'fixed inset-4 z-[70] shadow-2xl' : 'relative mt-3'}`}>
        <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-200 text-slate-700">
          <div className="text-xs font-semibold truncate flex-1 min-w-0" title={t.title}>{t.title} <span className="font-normal text-slate-400">· {t.nodes.length} equipamentos · {t.links.length} conexões</span></div>
          {data.issues.length > 0 && (
            <button onClick={() => setOverlay(o => (o === 'issues' ? null : 'issues'))} className={`${chip} ${errors ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : problems ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'}`} title={problems ? 'Problemas encontrados na topologia' : 'Sugestões de projeto'}>{problems ? <><AlertTriangle size={11} /> {problems}</> : <><Lightbulb size={11} /> {data.issues.length}</>}</button>
          )}
          {t.vlans.length > 0 && (
            <button onClick={() => setOverlay(o => (o === 'vlans' ? null : 'vlans'))} className={overlay === 'vlans' ? `${chip} bg-blue-50 border-blue-200 text-blue-700` : plain} title="VLANs da topologia"><Layers size={11} /> VLANs</button>
          )}
          <a href={`/api/netlab?action=png&id=${id}&download=1`} download className={plain} title="Baixar imagem PNG"><Download size={11} /> PNG</a>
          <a href={`/api/netlab?action=svg&id=${id}&download=1`} download className={plain} title="Baixar SVG (vetor)">SVG</a>
          <a href={`/api/netlab?action=configs&id=${id}`} download className={plain} title="Baixar configurações de todos os equipamentos"><FileCode2 size={11} /> Configs</a>
          <button onClick={() => setBig(b => !b)} className="p-1 rounded-md hover:bg-slate-200" title={big ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        </div>
        <div className="relative flex" style={{ height: big ? 'calc(100% - 41px)' : 540 }}>
          <div
            ref={box}
            tabIndex={0}
            className="relative flex-1 overflow-hidden touch-none select-none outline-none"
            style={{
              cursor: panning ? 'grabbing' : 'grab',
              backgroundColor: '#fbfcfe',
              backgroundImage: 'linear-gradient(#e6ebf1 1px, transparent 1px), linear-gradient(90deg, #e6ebf1 1px, transparent 1px)',
              backgroundSize: `${step * view.s}px ${step * view.s}px`,
              // Grid lines sit on the same coordinates devices snap to
              backgroundPosition: `${view.x - size.x * view.s}px ${view.y - size.y * view.s}px`,
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={e => endDrag(e)}
            onPointerCancel={e => endDrag(e, true)}
            onDoubleClick={e => { if (!(e.target as Element).closest('[data-node], button, a, [data-overlay]')) fit() }}
            onKeyDown={onKey}
          >
            <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0', width: size.w, height: size.h, willChange: 'transform' }}
              dangerouslySetInnerHTML={{ __html: svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${size.w}" height="${size.h}"`) }} />
            <div className="absolute right-2 bottom-2 flex flex-col items-center gap-1">
              <button className={btn} onClick={() => zoomCenter(1.2)} title="Aproximar (+)"><Plus size={13} /></button>
              <button onClick={fit} className="min-w-[40px] py-0.5 rounded-md bg-white/95 border border-slate-200 text-[10px] font-medium text-slate-600 tabular-nums shadow-sm hover:bg-white" title="Ajustar à tela (0)">{Math.round(view.s * 100)}%</button>
              <button className={btn} onClick={() => zoomCenter(1 / 1.2)} title="Afastar (−)"><Minus size={13} /></button>
              <button className={btn} onClick={fit} title="Ajustar à tela (0)"><ScanSearch size={13} /></button>
            </div>
            {!touched && !node && !overlay && (
              <div className="pointer-events-none absolute left-2 bottom-2 rounded-md bg-white/85 border border-slate-200 px-2 py-1 text-[10px] text-slate-500 shadow-sm">
                Arraste os equipamentos · roda do mouse: zoom · duplo clique: ajustar · clique num equipamento para ver detalhes
              </div>
            )}
            {overlay && (
              <div data-overlay className="absolute left-2 top-2 max-w-[60%] max-h-[70%] overflow-auto rounded-lg bg-white/95 border border-slate-200 shadow p-2.5 text-[11px] text-slate-700 space-y-1 cursor-auto">
                <div className="flex items-center mb-1">
                  <span className="font-semibold text-slate-800 flex-1">{overlay === 'issues' ? (problems ? 'Problemas encontrados' : 'Sugestões de projeto') : 'VLANs'}</span>
                  <button onClick={() => setOverlay(null)} className="text-slate-400 hover:text-slate-700" title="Fechar"><X size={12} /></button>
                </div>
                {overlay === 'issues'
                  ? data.issues.map((i, k) => (
                      <div key={k} onClick={() => i.node && setSelected(i.node)} className={`${i.level === 'error' ? 'text-red-700' : i.level === 'warn' ? 'text-amber-700' : 'text-sky-700'} ${i.node ? 'cursor-pointer hover:underline' : ''}`}>{i.level === 'info' ? '💡' : '•'} {i.message}</div>
                    ))
                  : t.vlans.map(v => (
                      <div key={v.id} className="font-mono"><span className="text-blue-700 font-semibold">{v.id}</span> {v.name}{v.subnet ? <span className="text-slate-500"> · {v.subnet}</span> : null}</div>
                    ))}
              </div>
            )}
          </div>
          {node && (
            <div className="w-[300px] flex-shrink-0 border-l border-slate-200 bg-white text-slate-800 overflow-y-auto">
              <div className="flex items-start gap-2 p-3 border-b border-slate-100">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{node.label}</div>
                  <div className="text-[11px] text-slate-500">{TYPE_PT[node.type] || node.type}{node.vendor ? ` · ${node.vendor}` : ''}{node.model ? ` ${node.model}` : ''}</div>
                  {node.zone && <div className="text-[11px] text-slate-500">Área: {t.zones.find(z => z.id === node.zone)?.label}</div>}
                  {node.mgmt && <div className="text-[11px] text-slate-500 font-mono">Gerência: {node.mgmt}</div>}
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700" title="Fechar"><X size={14} /></button>
              </div>
              {neighbours.length > 0 && (
                <div className="p-3 border-b border-slate-100">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Conexões</div>
                  {neighbours.map(nb => (
                    <button key={nb.id} onClick={() => nb.other && setSelected(nb.other.id)} className="w-full flex items-center gap-1.5 py-0.5 px-1 -mx-1 rounded text-[11px] text-left hover:bg-slate-50" title={nb.other ? `Ir para ${nb.other.label}` : undefined}>
                      <span className="font-mono text-slate-500 w-16 truncate flex-shrink-0">{nb.port || '—'}</span>
                      <Cable size={10} className="text-slate-400 flex-shrink-0" />
                      <span className="truncate text-slate-700">{nb.other?.label || '?'}</span>
                      {nb.otherPort && <span className="font-mono text-slate-400 ml-auto flex-shrink-0">{nb.otherPort}</span>}
                    </button>
                  ))}
                </div>
              )}
              {!!node.ifaces?.length && (
                <div className="p-3 border-b border-slate-100">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Interfaces</div>
                  {node.ifaces.map(i => <div key={i.name} className="text-[11px] font-mono flex gap-2"><span className="w-16 truncate">{i.name}</span><span className="text-slate-600">{i.ip || (i.vlan ? `VLAN ${i.vlan}` : i.mode || '')}{i.mode === 'trunk' && i.vlans?.length ? ` (${i.vlans.join(',')})` : ''}</span></div>)}
                </div>
              )}
              {node.notes && <div className="p-3 text-[11px] text-slate-600 border-b border-slate-100">{node.notes}</div>}
              {cfg ? (
                <div className="p-3">
                  <div className="flex items-center mb-1"><span className="text-[10px] uppercase tracking-wider text-slate-400 flex-1">Configuração · {cfg.platform}</span>
                    <button onClick={() => { navigator.clipboard.writeText(cfg.text).then(() => toast.success('Configuração copiada')).catch(() => {}) }} className="text-slate-400 hover:text-slate-700" title="Copiar"><Copy size={12} /></button></div>
                  <pre className="text-[10.5px] leading-snug font-mono bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto max-h-[300px]">{cfg.text}</pre>
                </div>
              ) : <div className="p-3 text-[11px] text-slate-400">Sem configuração gerada para este tipo de equipamento.</div>}
            </div>
          )}
        </div>
      </div>
  )

  // Full screen renders at the app root: inside the chat's layer the side panels would paint over it
  if (big && portalTarget) {
    return (
      <>
        <div className="mt-3 h-[581px] rounded-xl border border-dashed border-cyan-500/25 flex items-center justify-center text-xs text-white/40">
          Designer aberto em tela cheia · Esc para voltar
        </div>
        {createPortal(<><div className="mo-backdrop fixed inset-0 z-[69] bg-black/70" onClick={() => setBig(false)} />{designer}</>, portalTarget)}
      </>
    )
  }
  return designer
}
