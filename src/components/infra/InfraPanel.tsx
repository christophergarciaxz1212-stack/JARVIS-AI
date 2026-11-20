'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, ArchiveRestore, BrainCircuit, Calculator, Globe, Plug, Radio, Route, Check, CircleAlert, CircleCheck, Container, Cpu, Gauge, HardDrive, HeartPulse, KeyRound,
  Loader2, Lock, Network, Play, Plus, RefreshCw, RotateCcw, ScrollText, ServerCog, ShieldCheck, Siren, Square, SquareTerminal, Trash2, Wrench, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '@/components/agents/api'
import { ConfirmDialog, Modal } from '@/components/agents/shared'
import type { Inventory } from '@/lib/infra/inventory'
import type { Incident, MonitorDef, MonitorState, InfraSettings } from '@/lib/infra/monitor'
import type { InfraApproval } from '@/lib/infra/approvals'
import type { BackupEntry } from '@/lib/infra/backup'
import type { ServerEntry, RemoteResult } from '@/lib/infra/ssh'
import type { Diagnosis, DnsResult, ListeningPort, PingResult, TcpResult } from '@/lib/infra/netdiag'
import { parseCidr } from '@/lib/netlab/ip'
import { parseNetInput, splitEqual, subnetInfo, summarize, vlsm } from '@/lib/netlab/subnet'
import type { DockerOverview } from '@/lib/infra/docker'
import type { ModelAdvice, OllamaStatus } from '@/lib/infra/ai'
import type { SelfReport } from '@/lib/infra/selfcheck'
import type { AuditEntry, LogEntry } from '@/lib/infra/log'
import type { RiskAssessment } from '@/lib/infra/risk'

type Tab = 'overview' | 'monitors' | 'incidents' | 'servers' | 'network' | 'docker' | 'backups' | 'ai' | 'health' | 'approvals' | 'audit'
type MonitorRow = MonitorDef & { state: MonitorState }

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Visão geral', icon: Gauge },
  { id: 'monitors', label: 'Monitores', icon: Activity },
  { id: 'incidents', label: 'Incidentes', icon: Siren },
  { id: 'servers', label: 'Servidores', icon: ServerCog },
  { id: 'network', label: 'Rede', icon: Network },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'backups', label: 'Backups', icon: ArchiveRestore },
  { id: 'ai', label: 'IA local', icon: BrainCircuit },
  { id: 'health', label: 'Saúde do JARVIS', icon: HeartPulse },
  { id: 'approvals', label: 'Aprovações', icon: ShieldCheck },
  { id: 'audit', label: 'Auditoria', icon: ScrollText },
]

const API = '/api/infra'
const fmtMb = (n?: number) => (n === undefined ? '—' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`)
const when = (t?: number) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const input = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-40'
const btnCyan = `${btn} bg-cyan-500/15 text-cyan-100 border-cyan-400/30 hover:bg-cyan-500/25`
const btnGhost = `${btn} text-white/60 border-white/10 hover:bg-white/5 hover:text-white`
const btnRed = `${btn} text-red-200 border-red-400/30 hover:bg-red-500/15`
const card = 'rounded-xl border border-white/[0.07] bg-white/[0.02] p-4'

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast.success(ok)
      return r
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, run }
}

function Bar({ pct, warn = 80, crit = 92 }: { pct: number; warn?: number; crit?: number }) {
  const color = pct >= crit ? 'from-red-500 to-red-400' : pct >= warn ? 'from-amber-500 to-amber-300' : 'from-cyan-500 to-emerald-400'
  return (
    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
      <motion.div className={`h-full bg-gradient-to-r ${color}`} initial={false} animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function Dot({ status }: { status: string }) {
  const c = status === 'up' || status === 'ok' ? 'bg-emerald-400' : status === 'down' || status === 'fail' ? 'bg-red-400 animate-pulse' : status === 'warn' ? 'bg-amber-400' : 'bg-white/25'
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-white/40 py-10 text-center">{children}</div>
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({ inv, onRefresh, refreshing }: { inv?: Inventory; onRefresh: () => void; refreshing: boolean }) {
  const { busy, run } = useBusy()
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  if (!inv) return <Empty><Loader2 className="inline animate-spin mr-2" size={14} />Coletando dados reais da máquina…</Empty>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/50">{inv.host} · {inv.os.caption || `${inv.os.platform} ${inv.os.release}`} · {inv.os.arch} · ligado há {(inv.os.uptimeSec / 3600).toFixed(1)} h · coletado {when(inv.collectedAt)}</div>
        <button className={btnGhost} onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Atualizar</button>
      </div>
      {inv.issues.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100 space-y-1">
          {inv.issues.map(i => <div key={i} className="flex gap-2"><CircleAlert size={14} className="mt-0.5 shrink-0" />{i}</div>)}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-white/80 mb-2"><Cpu size={14} className="text-cyan-300" /> CPU <span className="ml-auto text-white">{inv.cpu.usagePct}%</span></div>
          <Bar pct={inv.cpu.usagePct} warn={85} crit={95} />
          <div className="text-[11px] text-white/40 mt-2 truncate">{inv.cpu.model} · {inv.cpu.cores} threads</div>
        </div>
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-white/80 mb-2"><Gauge size={14} className="text-cyan-300" /> Memória RAM <span className="ml-auto text-white">{inv.memory.usedPct}%</span></div>
          <Bar pct={inv.memory.usedPct} />
          <div className="text-[11px] text-white/40 mt-2">{fmtMb(inv.memory.totalMb - inv.memory.freeMb)} de {fmtMb(inv.memory.totalMb)}</div>
        </div>
        {inv.disks.map(d => (
          <div key={d.mount} className={card}>
            <div className="flex items-center gap-2 text-sm text-white/80 mb-2"><HardDrive size={14} className="text-cyan-300" /> Disco {d.mount} {d.label && <span className="text-white/40 text-xs">{d.label}</span>}<span className="ml-auto text-white">{d.usedPct}%</span></div>
            <Bar pct={d.usedPct} warn={85} crit={95} />
            <div className="text-[11px] text-white/40 mt-2">{fmtMb(d.freeMb)} livres de {fmtMb(d.totalMb)} {d.fs && `· ${d.fs}`}</div>
          </div>
        ))}
        {inv.gpus.map(g => (
          <div key={g.index} className={card}>
            <div className="flex items-center gap-2 text-sm text-white/80 mb-2"><BrainCircuit size={14} className="text-fuchsia-300" /> <span className="truncate">{g.name}</span>{g.temperatureC !== undefined && <span className={`ml-auto ${g.temperatureC >= 85 ? 'text-red-300' : 'text-white'}`}>{g.temperatureC} °C</span>}</div>
            {g.memoryTotalMb ? <Bar pct={Math.round(((g.memoryUsedMb || 0) / g.memoryTotalMb) * 100)} warn={85} crit={95} /> : null}
            <div className="text-[11px] text-white/40 mt-2">VRAM {fmtMb(g.memoryUsedMb)} / {fmtMb(g.memoryTotalMb)}{g.utilizationPct !== undefined && ` · uso ${g.utilizationPct}%`}{g.powerW !== undefined && ` · ${g.powerW} W`}{g.driver && ` · driver ${g.driver}`}</div>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="text-sm text-white/80 mb-3 flex items-center gap-2"><Wrench size={14} className="text-cyan-300" /> Ferramentas de infraestrutura</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {inv.tools.map(t => {
            const ok = !!t.path || installed[t.id]
            return (
              <div key={t.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2">
                {ok ? <CircleCheck size={14} className="text-emerald-400 shrink-0" /> : <CircleAlert size={14} className="text-white/30 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className={`text-xs truncate ${ok ? 'text-white/85' : 'text-white/45'}`}>{t.label}</div>
                  <div className="text-[10px] text-white/30 truncate" title={t.path || t.note}>{t.path || t.note || t.category}</div>
                </div>
                {!ok && t.installId && (
                  <button className={btnCyan} disabled={!!busy} title={`winget install -e --id ${t.installId}`}
                    onClick={() => run(t.id, async () => { const r = await post<{ approval: InfraApproval }>(API, { action: 'install', tool: t.id }); if (r.approval.status !== 'executed') throw new Error(r.approval.result || 'Instalação falhou'); setInstalled(x => ({ ...x, [t.id]: true })) }, `${t.label} instalado`)}>
                    {busy === t.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Instalar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="text-sm text-white/80 mb-2">Rede</div>
          {inv.network.filter(n => n.family === 'IPv4').map(n => <div key={n.name + n.address} className="text-xs text-white/60 font-mono">{n.name}: {n.address}{n.cidr ? ` (${n.cidr.split('/')[1] ? '/' + n.cidr.split('/')[1] : ''})` : ''}</div>)}
        </div>
        <div className={card}>
          <div className="text-sm text-white/80 mb-2">Processos que mais usam RAM</div>
          {inv.topProcesses.slice(0, 6).map(p => <div key={p.pid} className="text-xs text-white/60 flex"><span className="truncate">{p.name}</span><span className="ml-auto font-mono">{fmtMb(p.memMb)}</span></div>)}
        </div>
      </div>
      {inv.stoppedAutoServices.length > 0 && (
        <div className={card}>
          <div className="text-sm text-white/80 mb-1">Serviços automáticos que não estão rodando</div>
          <div className="text-[11px] text-white/40 mb-2">Alguns param sozinhos por design; verifique só os que você usa.</div>
          <div className="flex flex-wrap gap-1.5">{inv.stoppedAutoServices.map(s => <span key={s.name} title={s.displayName} className="text-[11px] px-2 py-0.5 rounded bg-white/5 text-white/60">{s.name}</span>)}</div>
        </div>
      )}
    </div>
  )
}

// ─── Monitors ────────────────────────────────────────────────────────────────

const KIND_HINT: Record<string, string> = {
  http: 'https://meusite.com/health', tcp: '192.168.0.10:5432', dns: 'meusite.com', process: 'nginx (nome do processo)', docker: 'nome-do-container', ssh: 'nome do servidor cadastrado', resource: '',
}

function Monitors({ monitors, reload, watchdog, leader }: { monitors: MonitorRow[]; reload: () => void; watchdog: boolean; leader: boolean }) {
  const { busy, run } = useBusy()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', kind: 'http', target: '', intervalSec: 60, failThreshold: 2, metric: 'memory', max: 90, recovery: '', maxAttempts: 3, cooldownSec: 30 })
  const [del, setDel] = useState<MonitorRow | null>(null)
  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))
  const submit = () => run('add', async () => {
    await post(API, {
      action: 'monitor-add',
      monitor: {
        name: form.name || undefined, kind: form.kind, target: form.target, intervalSec: form.intervalSec, failThreshold: form.failThreshold,
        resource: form.kind === 'resource' ? { metric: form.metric, max: form.max } : undefined,
        recovery: form.recovery.trim() ? { command: form.recovery.trim(), maxAttempts: form.maxAttempts, cooldownSec: form.cooldownSec, windowMin: 60, verifyAfterSec: 10 } : undefined,
      },
    })
    setAdding(false)
    setForm(f => ({ ...f, name: '', target: '', recovery: '' }))
    reload()
  }, 'Monitor criado e verificado')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs text-white/50 flex items-center gap-2"><Dot status={watchdog ? 'up' : 'down'} /> Watchdog {!watchdog ? 'parado' : leader ? 'ativo — verifica e tenta recuperar sozinho, com limite de tentativas' : 'ativo em outra janela/processo do JARVIS (este painel mostra os dados dele)'}</div>
        <button className={`${btnCyan} ml-auto`} onClick={() => setAdding(a => !a)}><Plus size={12} /> Novo monitor</button>
      </div>
      {adding && (
        <div className={`${card} grid grid-cols-1 md:grid-cols-2 gap-3`}>
          <input className={input} placeholder="Nome (ex.: API de produção)" value={form.name} onChange={e => set('name', e.target.value)} />
          <select className={input} value={form.kind} onChange={e => set('kind', e.target.value)}>
            <option value="http">HTTP(S) — site/API</option><option value="tcp">Porta TCP</option><option value="dns">DNS</option>
            <option value="process">Processo local</option><option value="docker">Container Docker</option><option value="ssh">Servidor SSH</option><option value="resource">Recurso da máquina</option>
          </select>
          {form.kind === 'resource' ? (
            <div className="flex gap-2 md:col-span-2">
              <select className={input} value={form.metric} onChange={e => set('metric', e.target.value)}>
                <option value="memory">RAM (%)</option><option value="disk">Disco C: (%)</option><option value="cpu">CPU (%)</option><option value="gpu-temp">Temperatura GPU (°C)</option><option value="gpu-mem">VRAM (%)</option>
              </select>
              <input className={input} type="number" value={form.max} onChange={e => set('max', Number(e.target.value))} placeholder="Limite" />
            </div>
          ) : (
            <input className={`${input} md:col-span-2 font-mono`} placeholder={KIND_HINT[form.kind]} value={form.target} onChange={e => set('target', e.target.value)} />
          )}
          <label className="text-[11px] text-white/50">Intervalo (s)<input className={input} type="number" min={10} value={form.intervalSec} onChange={e => set('intervalSec', Number(e.target.value))} /></label>
          <label className="text-[11px] text-white/50">Falhas seguidas para abrir incidente<input className={input} type="number" min={1} max={10} value={form.failThreshold} onChange={e => set('failThreshold', Number(e.target.value))} /></label>
          <div className="md:col-span-2 space-y-2">
            <div className="text-[11px] text-white/50">Autorrecuperação (opcional) — comando PowerShell executado quando o serviço cair. Comandos destrutivos são recusados.</div>
            <input className={`${input} font-mono`} placeholder={form.kind === 'docker' ? `docker restart ${form.target || 'meu-container'}` : 'Restart-Service MeuServico   |   Start-Process "C:\\app\\server.exe"'} value={form.recovery} onChange={e => set('recovery', e.target.value)} />
            {form.recovery && (
              <div className="flex gap-2">
                <label className="text-[11px] text-white/50 flex-1">Máx. tentativas por hora<input className={input} type="number" min={1} max={10} value={form.maxAttempts} onChange={e => set('maxAttempts', Number(e.target.value))} /></label>
                <label className="text-[11px] text-white/50 flex-1">Espera entre tentativas (s, dobra a cada vez)<input className={input} type="number" min={5} value={form.cooldownSec} onChange={e => set('cooldownSec', Number(e.target.value))} /></label>
              </div>
            )}
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setAdding(false)}>Cancelar</button>
            <button className={btnCyan} disabled={busy === 'add'} onClick={submit}>{busy === 'add' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Criar e verificar</button>
          </div>
        </div>
      )}
      {!monitors.length ? <Empty>Nenhum monitor.</Empty> : monitors.map(m => (
        <div key={m.id} className={`${card} ${m.enabled ? '' : 'opacity-50'}`}>
          <div className="flex items-center gap-3">
            <Dot status={m.enabled ? m.state.status : 'unknown'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{m.name} <span className="text-[10px] text-white/35 uppercase ml-1">{m.kind}</span></div>
              <div className="text-[11px] text-white/45 truncate font-mono">{m.kind === 'resource' ? `${m.resource?.metric} < ${m.resource?.max}` : m.target} · a cada {m.intervalSec}s{m.state.lastCheckAt ? ` · ${when(m.state.lastCheckAt)}` : ''}{m.state.lastLatencyMs !== undefined ? ` · ${m.state.lastLatencyMs} ms` : ''}{m.state.lastValue !== undefined && m.kind === 'resource' ? ` · agora ${m.state.lastValue}` : ''}</div>
              {m.state.lastError && <div className="text-[11px] text-red-300/90 mt-0.5">{m.state.lastError}</div>}
              {m.recovery && <div className="text-[11px] text-cyan-200/70 mt-0.5 font-mono truncate">↻ {m.recovery.command} {m.state.breakerOpen && <span className="text-amber-300 font-sans">· suspensa após {m.recovery.maxAttempts} tentativas</span>}</div>}
            </div>
            <div className="hidden md:flex items-end gap-px h-6">
              {m.state.history.slice(-30).map((h, i) => <div key={i} title={`${when(h.t)} ${h.ok ? 'ok' : 'falha'} ${h.ms} ms`} className={`w-1 rounded-sm ${h.ok ? 'bg-emerald-400/70' : 'bg-red-400/80'}`} style={{ height: `${h.ok ? 40 + Math.min(60, h.ms / 20) : 100}%` }} />)}
            </div>
            <div className="flex gap-1">
              <button className={btnGhost} title="Verificar agora" disabled={!!busy} onClick={() => run(m.id, async () => { await post(API, { action: 'monitor-check', id: m.id }); reload() })}>{busy === m.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
              {m.state.breakerOpen && <button className={btnCyan} title="Permitir novas tentativas de recuperação" onClick={() => run('r' + m.id, async () => { await post(API, { action: 'monitor-reset', id: m.id }); reload() }, 'Recuperação automática reativada')}><RotateCcw size={12} /></button>}
              <button className={btnGhost} title={m.enabled ? 'Pausar' : 'Ativar'} onClick={() => run('t' + m.id, async () => { await post(API, { action: 'monitor-update', id: m.id, monitor: { enabled: !m.enabled } }); reload() })}>{m.enabled ? <Square size={12} /> : <Play size={12} />}</button>
              <button className={btnRed} title="Excluir" onClick={() => setDel(m)}><Trash2 size={12} /></button>
            </div>
          </div>
        </div>
      ))}
      {del && <ConfirmDialog title={`Excluir o monitor "${del.name}"?`} confirmLabel="Excluir" onClose={() => setDel(null)} onConfirm={async () => { await post(API, { action: 'monitor-remove', id: del.id }); reload() }}>O histórico de incidentes é mantido.</ConfirmDialog>}
    </div>
  )
}

// ─── Incidents ───────────────────────────────────────────────────────────────

function Incidents({ incidents, reload }: { incidents: Incident[]; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!incidents.length) return <Empty>Nenhum incidente registrado. 🎉</Empty>
  return (
    <div className="space-y-2">
      {incidents.map(i => (
        <div key={i.id} className={`${card} ${i.status === 'open' ? 'border-red-400/30' : ''}`}>
          <button className="w-full text-left flex items-start gap-3" onClick={() => setOpen(open === i.id ? null : i.id)}>
            <Dot status={i.status === 'open' ? 'down' : 'up'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{i.monitorName} <span className="text-[11px] text-white/40 ml-2">{when(i.openedAt)}{i.resolvedAt ? ` → ${when(i.resolvedAt)}` : ''}</span></div>
              <div className="text-xs text-white/60 mt-0.5">{i.cause}</div>
              <div className="text-[11px] mt-1">{i.status === 'open' ? <span className="text-red-300">Aberto · {i.impact}</span> : <span className="text-emerald-300/80">Resolvido{i.autoRecovered ? ' automaticamente' : ''}</span>}</div>
            </div>
            {i.status === 'open' && !i.acknowledged && <span onClick={e => { e.stopPropagation(); post(API, { action: 'incident-ack', id: i.id }).then(reload) }} className={btnGhost}>Ciente</span>}
          </button>
          {open === i.id && (
            <div className="mt-3 border-l border-white/10 pl-4 space-y-2">
              {i.actions.map((a, k) => (
                <div key={k} className="text-xs">
                  <span className="text-white/35 mr-2">{when(a.t)}</span>
                  <span className={`uppercase text-[10px] mr-2 ${a.ok === false ? 'text-red-300' : a.ok ? 'text-emerald-300' : 'text-cyan-300/80'}`}>{a.kind}</span>
                  <pre className="whitespace-pre-wrap font-mono text-white/70 mt-1">{a.message}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Servers (SSH) ───────────────────────────────────────────────────────────

function Servers() {
  const { busy, run } = useBusy()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [form, setForm] = useState({ name: '', host: '', port: 22, user: 'root', identityFile: '', os: 'linux' })
  const [adding, setAdding] = useState(false)
  const [sel, setSel] = useState<string>('')
  const [cmd, setCmd] = useState('')
  const [out, setOut] = useState<string>('')
  const [confirm, setConfirm] = useState<RiskAssessment | null>(null)
  const [key, setKey] = useState<{ publicKey: string; privateKeyPath: string; howTo: string } | null>(null)
  const load = useCallback(() => get<{ servers: ServerEntry[] }>(`${API}?action=servers`).then(d => { setServers(d.servers); setSel(s => s || d.servers[0]?.id || '') }).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const exec = async (confirmed: boolean) => {
    const r = await post<{ result: RemoteResult }>(API, { action: 'server-exec', id: sel, command: cmd, confirmed })
    setOut(`$ ${cmd}\n[exit ${r.result.exitCode} · ${r.result.durationMs} ms · risco: ${r.result.risk.level}]\n${r.result.stdout}${r.result.stderr ? `\n[stderr]\n${r.result.stderr}` : ''}`)
  }
  const send = () => run('exec', async () => {
    const { risk } = await post<{ risk: RiskAssessment }>(API, { action: 'server-risk', command: cmd })
    if (risk.level === 'critical') { setConfirm(risk); return }
    await exec(false)
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className={btnCyan} onClick={() => setAdding(a => !a)}><Plus size={12} /> Cadastrar servidor</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => run('key', async () => setKey((await post<{ key: typeof key }>(API, { action: 'ssh-key' })).key))}>{busy === 'key' ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Chave SSH do JARVIS</button>
      </div>
      {key && (
        <div className={`${card} space-y-2`}>
          <div className="text-xs text-white/60">Chave privada: <span className="font-mono">{key.privateKeyPath}</span> (fica só neste PC). Coloque a pública no servidor:</div>
          <pre className="text-[11px] font-mono bg-black/40 rounded-lg p-3 whitespace-pre-wrap break-all text-cyan-100/90 select-all">{key.howTo}</pre>
        </div>
      )}
      {adding && (
        <div className={`${card} grid grid-cols-1 md:grid-cols-3 gap-2`}>
          <input className={input} placeholder="Nome (ex.: vps-producao)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={input} placeholder="Host ou IP" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
          <input className={input} type="number" placeholder="Porta" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} />
          <input className={input} placeholder="Usuário" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} />
          <input className={`${input} md:col-span-2 font-mono`} placeholder="Chave privada (ex.: C:\Users\voce\.ssh\jarvis_ed25519) — senhas não são guardadas" value={form.identityFile} onChange={e => setForm({ ...form, identityFile: e.target.value })} />
          <select className={input} value={form.os} onChange={e => setForm({ ...form, os: e.target.value })}><option value="linux">Linux</option><option value="windows">Windows Server</option></select>
          <div className="md:col-span-2 flex justify-end gap-2 items-center">
            <button className={btnGhost} onClick={() => setAdding(false)}>Cancelar</button>
            <button className={btnCyan} disabled={!!busy} onClick={() => run('save', async () => { await post(API, { action: 'server-save', server: { ...form, identityFile: form.identityFile || key?.privateKeyPath || undefined } }); setAdding(false); load() }, 'Servidor cadastrado')}><Check size={12} /> Salvar</button>
          </div>
        </div>
      )}
      {!servers.length && !adding ? <Empty>Nenhum servidor. Cadastre um VPS, Raspberry, Proxmox ou servidor da empresa para o JARVIS administrar via SSH.</Empty> : (
        <div className="space-y-2">
          {servers.map(s => (
            <div key={s.id} className={`${card} flex items-center gap-3 ${sel === s.id ? 'border-cyan-400/40' : ''}`} onClick={() => setSel(s.id)}>
              <Dot status={s.lastCheck ? (s.lastCheck.ok ? 'up' : 'down') : 'unknown'} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{s.name} <span className="text-[10px] text-white/35 uppercase">{s.os}</span></div>
                <div className="text-[11px] text-white/45 font-mono">{s.user}@{s.host}:{s.port}{s.identityFile ? ' · 🔑' : ' · chave padrão do ssh'}{s.lastCheck ? ` · ${when(s.lastCheck.at)} ${s.lastCheck.ok ? `${s.lastCheck.latencyMs} ms` : 'falhou'}` : ''}</div>
                {s.lastCheck?.error && <div className="text-[11px] text-red-300/90 whitespace-pre-wrap">{s.lastCheck.error}</div>}
              </div>
              <button className={btnGhost} disabled={!!busy} onClick={e => { e.stopPropagation(); run('t' + s.id, async () => { const r = await post<{ result: { ok: boolean; error?: string } }>(API, { action: 'server-test', id: s.id }); load(); if (!r.result.ok) throw new Error(r.result.error || 'Falhou') }, 'Conexão ok') }}>{busy === 't' + s.id ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />} Testar</button>
              <button className={btnGhost} disabled={!!busy} onClick={e => { e.stopPropagation(); run('i' + s.id, async () => { const r = await post<{ result: { sections: Array<{ title: string; body: string }>; stderr: string } }>(API, { action: 'server-inventory', id: s.id }); setSel(s.id); setOut(r.result.sections.length ? r.result.sections.map(x => `### ${x.title}\n${x.body}`).join('\n\n') : r.result.stderr) }) }}>{busy === 'i' + s.id ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />} Inventário</button>
              <button className={btnRed} onClick={e => { e.stopPropagation(); run('d' + s.id, async () => { await post(API, { action: 'server-remove', id: s.id }); load() }) }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {servers.length > 0 && (
        <div className={card}>
          <div className="flex items-center gap-2 mb-2 text-sm text-white/80"><SquareTerminal size={14} className="text-cyan-300" /> Terminal remoto — {servers.find(s => s.id === sel)?.name || 'selecione um servidor'}</div>
          <div className="flex gap-2">
            <input className={`${input} font-mono`} placeholder="systemctl status nginx --no-pager" value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && cmd.trim() && sel) send() }} />
            <button className={btnCyan} disabled={!cmd.trim() || !sel || busy === 'exec'} onClick={send}>{busy === 'exec' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Executar</button>
          </div>
          {out && <pre className="mt-3 max-h-80 overflow-auto text-[11px] font-mono bg-black/40 rounded-lg p-3 whitespace-pre-wrap text-white/80">{out}</pre>}
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Comando crítico" confirmLabel="Executar mesmo assim" onClose={() => setConfirm(null)} onConfirm={() => exec(true)}>
          <p className="font-mono text-xs bg-black/40 rounded p-2 break-all">{cmd}</p>
          <p>Motivo do alerta: <b className="text-red-200">{confirm.reasons.join(', ')}</b>.</p>
          <p>Isso pode apagar dados, cortar o acesso ou expor serviços. Tenha um backup antes.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

// ─── Network ─────────────────────────────────────────────────────────────────

type NetResult =
  | { kind: 'diag'; at: number; diag: Diagnosis }
  | { kind: 'ping'; at: number; host: string; ping: PingResult }
  | { kind: 'dns'; at: number; dns: DnsResult & { host: string } }
  | { kind: 'port'; at: number; tcp: TcpResult }
  | { kind: 'trace'; at: number; host: string; hops: string[] }

function NetworkTab() {
  const { busy, run } = useBusy()
  const [target, setTarget] = useState('')
  const [port, setPort] = useState('')
  const [results, setResults] = useState<NetResult[]>([])
  const [ports, setPorts] = useState<ListeningPort[] | null>(null)
  const [onlyExposed, setOnlyExposed] = useState(false)
  const push = (r: NetResult) => setResults(prev => [r, ...prev].slice(0, 8))
  const hostOnly = () => target.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '')
  const go = (kind: NetResult['kind']) => {
    if (!target.trim() || busy) return
    if (kind === 'diag') run('diag', async () => push({ kind, at: Date.now(), diag: (await post<{ diagnosis: Diagnosis }>(API, { action: 'diagnose', target })).diagnosis }))
    if (kind === 'ping') run('ping', async () => push({ kind, at: Date.now(), host: hostOnly(), ping: (await post<{ ping: PingResult }>(API, { action: 'ping', target: hostOnly() })).ping }))
    if (kind === 'dns') run('dns', async () => push({ kind, at: Date.now(), dns: (await post<{ dns: DnsResult & { host: string } }>(API, { action: 'dns', target: hostOnly() })).dns }))
    if (kind === 'port') run('port', async () => push({ kind, at: Date.now(), tcp: (await post<{ tcp: TcpResult }>(API, { action: 'port', target: target.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0], port: Number(port) || undefined })).tcp }))
    if (kind === 'trace') run('trace', async () => push({ kind, at: Date.now(), host: hostOnly(), hops: (await post<{ trace: { hops: string[] } }>(API, { action: 'traceroute', host: hostOnly() })).trace.hops }))
  }
  const tools: Array<{ kind: NetResult['kind']; label: string; icon: React.ReactNode; main?: boolean; title: string }> = [
    { kind: 'diag', label: 'Diagnosticar', icon: <Activity size={12} />, main: true, title: 'DNS → ping → porta → HTTP/TLS, com a causa provável' },
    { kind: 'ping', label: 'Ping', icon: <Radio size={12} />, title: '4 pacotes ICMP: latência e perda' },
    { kind: 'dns', label: 'DNS', icon: <Globe size={12} />, title: 'Para quais IPs o nome resolve' },
    { kind: 'port', label: 'Porta', icon: <Plug size={12} />, title: 'Testa se a porta TCP aceita conexão' },
    { kind: 'trace', label: 'Rota', icon: <Route size={12} />, title: 'Traceroute: os roteadores até o destino' },
  ]
  const shownPorts = (ports || []).filter(p => !onlyExposed || p.exposed)
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <Network size={14} className="text-cyan-300" />
          <span className="text-sm text-white/85 font-medium">Diagnóstico de conectividade</span>
          <span className="text-[10.5px] text-white/35 ml-auto hidden sm:inline">testes reais a partir deste PC</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input className={`${input} font-mono flex-1 min-w-[220px]`} placeholder="google.com · 192.168.0.1:22 · https://meusite.com" value={target} onChange={e => setTarget(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go('diag') }} aria-label="Alvo do diagnóstico" />
          <input className={`${input} font-mono w-24`} placeholder="porta" inputMode="numeric" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} onKeyDown={e => { if (e.key === 'Enter') go('port') }} aria-label="Porta TCP" />
        </div>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {tools.map(tl => (
            <button key={tl.kind} title={tl.title} className={tl.main ? btnCyan : btnGhost} disabled={!target.trim() || !!busy} onClick={() => go(tl.kind)}>
              {busy === tl.kind ? <Loader2 size={12} className="animate-spin" /> : tl.icon} {tl.label}
            </button>
          ))}
          {results.length > 0 && <button className={`${btnGhost} ml-auto`} onClick={() => setResults([])} title="Limpar resultados"><Trash2 size={12} /></button>}
        </div>
        <div className="mt-3 space-y-2">
          {results.map(r => <NetResultCard key={`${r.kind}-${r.at}`} r={r} />)}
        </div>
      </div>

      <SubnetCalculator />

      <div className={card}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-white/80">Portas em escuta neste PC</span>
          {ports && <label className="flex items-center gap-1.5 text-[11px] text-white/50 ml-3 cursor-pointer select-none"><input type="checkbox" className="accent-cyan-400" checked={onlyExposed} onChange={e => setOnlyExposed(e.target.checked)} /> só expostas na rede</label>}
          <button className={`${btnGhost} ml-auto`} disabled={!!busy} onClick={() => run('ports', async () => setPorts((await get<{ ports: ListeningPort[] }>(`${API}?action=ports`)).ports))}>{busy === 'ports' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Listar</button>
        </div>
        {ports && (
          <div className="max-h-72 overflow-auto">
            <div className="text-[11px] text-white/45 mb-1">{ports.length} porta(s) · {ports.filter(p => p.exposed).length} exposta(s) na rede</div>
            {shownPorts.map(p => (
              <div key={`${p.address}:${p.port}`} className="flex items-center text-xs font-mono py-0.5 gap-3">
                <span className={`w-16 ${p.exposed ? 'text-amber-300' : 'text-emerald-300/80'}`}>{p.exposed ? 'exposta' : 'local'}</span>
                <span className="text-white/80 w-48 truncate">{p.address}:{p.port}</span>
                <span className="text-white/50 truncate">{p.process} ({p.pid})</span>
              </div>
            ))}
            <div className="text-[11px] text-white/35 mt-2">“exposta” = escuta em todas as interfaces; o firewall do Windows ainda pode bloquear o acesso externo.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function NetResultCard({ r }: { r: NetResult }) {
  const time = new Date(r.at).toLocaleTimeString('pt-BR')
  const shell = (tone: 'ok' | 'warn' | 'bad', title: React.ReactNode, body?: React.ReactNode) => (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border px-3 py-2 ${tone === 'ok' ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : tone === 'warn' ? 'border-amber-500/25 bg-amber-500/[0.05]' : 'border-red-500/25 bg-red-500/[0.05]'}`}>
      <div className="flex items-center gap-2 text-sm">
        {tone === 'ok' ? <CircleCheck size={14} className="text-emerald-300" /> : <CircleAlert size={14} className={tone === 'warn' ? 'text-amber-300' : 'text-red-300'} />}
        <span className="text-white/85 flex-1 min-w-0">{title}</span>
        <span className="text-[10px] text-white/30">{time}</span>
      </div>
      {body && <div className="mt-1.5 text-xs text-white/60 space-y-0.5">{body}</div>}
    </motion.div>
  )
  if (r.kind === 'diag') {
    const d = r.diag
    return shell(d.verdict === 'ok' ? 'ok' : d.verdict === 'degradado' ? 'warn' : 'bad', <><b>{d.target.input}</b> — {d.verdict === 'ok' ? 'tudo funcionando' : d.verdict === 'degradado' ? 'funciona com problemas' : 'falhou'}</>,
      <>{d.probableCause && <div className="text-white/80">Causa provável: {d.probableCause}</div>}{d.findings.map(f => <div key={f}>• {f}</div>)}</>)
  }
  if (r.kind === 'ping') {
    const p = r.ping
    if (!p.ok) return shell('bad', <>Ping <b>{r.host}</b>: sem resposta</>, <div>{p.error} — muitos servidores bloqueiam ICMP; teste a porta do serviço.</div>)
    return shell(p.lossPct ? 'warn' : 'ok', <>Ping <b>{r.host}</b>: média <b>{p.avgMs} ms</b> · perda {p.lossPct}%</>, <div className="font-mono">{p.received}/{p.sent} respostas · mín {p.minMs} · máx {p.maxMs} ms</div>)
  }
  if (r.kind === 'dns') {
    const d = r.dns
    return d.ok
      ? shell(d.durationMs > 1500 ? 'warn' : 'ok', <>DNS <b>{d.host}</b> em {d.durationMs} ms</>, <div className="font-mono">{d.addresses.join(' · ')}</div>)
      : shell('bad', <>DNS <b>{d.host}</b>: {d.error}</>)
  }
  if (r.kind === 'port') {
    const t = r.tcp
    return t.ok ? shell('ok', <>Porta <b>{t.host}:{t.port}</b> aberta ({t.latencyMs} ms)</>) : shell('bad', <>Porta <b>{t.host}:{t.port}</b> {t.code ? <code className="text-[10px]">{t.code}</code> : null}</>, <div>{t.error}</div>)
  }
  return shell(r.hops.length ? 'ok' : 'warn', <>Rota até <b>{r.host}</b>: {r.hops.length} salto(s)</>, <pre className="font-mono text-[11px] whitespace-pre-wrap text-white/65">{r.hops.join('\n') || 'Sem saltos (host local ou ICMP bloqueado)'}</pre>)
}

/** Calculadora IP local (sem rede, sem IA): sub-rede, divisão, VLSM e sumarização. */
function SubnetCalculator() {
  const [mode, setMode] = useState<'calc' | 'split' | 'vlsm' | 'sum'>('calc')
  const [netText, setNetText] = useState('192.168.10.0/24')
  const [parts, setParts] = useState('4')
  const [reqs, setReqs] = useState('Vendas 60\nRH 25\nTI 12\nLink WAN 2')
  const [sumText, setSumText] = useState('192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24')
  let out: React.ReactNode = null
  let error = ''
  try {
    if (mode === 'sum') {
      const nets = sumText.split(/[\s,;]+/).map(s => parseCidr(s)).filter((c): c is NonNullable<typeof c> => !!c)
      if (nets.length >= 2) {
        const s = summarize(nets)
        out = <div className="text-sm text-white/85">Rota sumarizada: <code className="text-cyan-200">{s.network}/{s.prefix}</code> {s.exact ? <span className="text-emerald-300 text-xs">· exata</span> : <span className="text-amber-300 text-xs">· cobre {s.extra.toLocaleString('pt-BR')} endereços a mais</span>}</div>
      } else error = 'Informe pelo menos duas redes em CIDR'
    } else {
      const base = parseNetInput(netText)
      if (!base) error = 'Use 192.168.10.0/24 ou 192.168.10.0 255.255.255.0'
      else if (mode === 'calc') {
        const i = subnetInfo(base.ip, base.prefix, base.input)
        const rows: Array<[string, string]> = [['Rede', `${i.network}/${i.prefix}`], ['Máscara', i.mask], ['Wildcard', i.wildcard], ['Broadcast', i.broadcast], ['Hosts', i.prefix >= 31 ? `${i.firstHost} – ${i.lastHost}` : `${i.firstHost} – ${i.lastHost}`], ['Utilizáveis', `${i.usable.toLocaleString('pt-BR')} de ${i.total.toLocaleString('pt-BR')}`], ['Tipo', `${i.kind} · classe ${i.klass}`]]
        out = <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">{rows.map(([k, v]) => <div key={k} className="flex text-xs"><span className="w-24 text-white/40">{k}</span><span className="font-mono text-white/85">{v}</span></div>)}</div>
      } else {
        const b = { network: base.ip, prefix: base.prefix }
        const blocks = mode === 'split'
          ? splitEqual(b, /^\/?\d{1,2}$/.test(parts.trim()) && parts.trim().startsWith('/') ? { newPrefix: Number(parts.trim().slice(1)) } : { parts: Number(parts) || 2 }).blocks
          : vlsm(b, reqs.split('\n').map(l => { const m = l.match(/(\d+)\s*$/); return m ? { name: l.replace(m[1], '').trim() || undefined, hosts: Number(m[1]) } : null }).filter((x): x is { name: string | undefined; hosts: number } => !!x)).blocks
        out = (
          <div className="max-h-64 overflow-auto rounded-lg border border-white/5">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-white/40 bg-white/[0.03] sticky top-0"><tr>{mode === 'vlsm' && <th className="text-left px-2 py-1">Nome</th>}<th className="text-left px-2 py-1">Rede</th><th className="text-left px-2 py-1">Máscara</th><th className="text-right px-2 py-1">Hosts</th><th className="text-left px-2 py-1">Faixa</th><th className="text-left px-2 py-1">Broadcast</th></tr></thead>
              <tbody>{blocks.slice(0, 256).map(x => (
                <tr key={`${x.network}/${x.prefix}`} className="border-t border-white/5 text-white/75 hover:bg-white/[0.03]">
                  {mode === 'vlsm' && <td className="px-2 py-1 font-sans">{x.name || '—'}{x.wantHosts !== undefined && <span className="text-white/35"> ({x.wantHosts})</span>}</td>}
                  <td className="px-2 py-1 text-cyan-200">{x.network}/{x.prefix}</td><td className="px-2 py-1">{x.mask}</td><td className="px-2 py-1 text-right">{x.usable.toLocaleString('pt-BR')}</td><td className="px-2 py-1">{x.firstHost} – {x.lastHost}</td><td className="px-2 py-1">{x.broadcast}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      }
    }
  } catch (e) { error = (e as Error).message }
  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Calculator size={14} className="text-cyan-300" />
        <span className="text-sm text-white/85 font-medium">Calculadora IP / VLSM</span>
        <div role="tablist" className="ml-auto flex gap-1 p-0.5 rounded-lg bg-black/30 border border-white/5">
          {([['calc', 'Sub-rede'], ['split', 'Dividir'], ['vlsm', 'VLSM'], ['sum', 'Sumarizar']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${mode === id ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/50 hover:text-white/80'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap mb-3">
        {mode !== 'sum' && <input className={`${input} font-mono flex-1 min-w-[200px]`} value={netText} onChange={e => setNetText(e.target.value)} placeholder="192.168.10.0/24" aria-label="Rede" />}
        {mode === 'split' && <input className={`${input} font-mono w-32`} value={parts} onChange={e => setParts(e.target.value)} placeholder="4 ou /27" aria-label="Partes ou novo prefixo" title="Número de sub-redes (ex.: 4) ou o novo prefixo (ex.: /27)" />}
        {mode === 'vlsm' && <textarea className={`${input} font-mono w-full`} rows={4} value={reqs} onChange={e => setReqs(e.target.value)} placeholder={'Vendas 60\nRH 25'} aria-label="Pedidos VLSM: nome e hosts por linha" />}
        {mode === 'sum' && <textarea className={`${input} font-mono w-full`} rows={4} value={sumText} onChange={e => setSumText(e.target.value)} placeholder={'10.0.0.0/24\n10.0.1.0/24'} aria-label="Redes para sumarizar" />}
      </div>
      {error ? <div className="text-xs text-amber-300">{error}</div> : out}
    </div>
  )
}

// ─── Docker ──────────────────────────────────────────────────────────────────

function DockerTab() {
  const { busy, run } = useBusy()
  const [d, setD] = useState<DockerOverview | null>(null)
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null)
  const load = useCallback(() => get<{ docker: DockerOverview }>(`${API}?action=docker`).then(r => setD(r.docker)).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!d) return <Empty><Loader2 className="inline animate-spin mr-2" size={14} />Consultando Docker…</Empty>
  if (!d.available || !d.daemon) return <Empty>{d.installHint || d.error}</Empty>
  const act = (name: string, op: string) => run(op + name, async () => { await post(API, { action: 'docker-action', container: name, op }); load() }, `docker ${op} ${name}`)
  return (
    <div className="space-y-2">
      <div className="text-xs text-white/50">Docker {d.version} · {d.containers.length} container(s) · {d.images} imagem(ns)</div>
      {d.containers.map(c => (
        <div key={c.id} className={`${card} flex items-center gap-3`}>
          <Dot status={c.state === 'running' ? 'up' : c.state === 'exited' ? 'down' : 'unknown'} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white">{c.name} <span className="text-[11px] text-white/40">{c.image}</span></div>
            <div className="text-[11px] text-white/45">{c.status}{c.cpu ? ` · CPU ${c.cpu} · RAM ${c.mem}` : ''}{c.ports ? ` · ${c.ports}` : ''}</div>
          </div>
          <button className={btnGhost} onClick={() => run('l' + c.id, async () => setLogs({ name: c.name, text: (await post<{ logs: string }>(API, { action: 'docker-logs', container: c.name })).logs }))}><ScrollText size={12} /> Logs</button>
          {c.state !== 'running' ? <button className={btnCyan} disabled={!!busy} onClick={() => act(c.name, 'start')}><Play size={12} /></button> : <>
            <button className={btnGhost} disabled={!!busy} onClick={() => act(c.name, 'restart')}><RotateCcw size={12} /></button>
            <button className={btnRed} disabled={!!busy} onClick={() => act(c.name, 'stop')}><Square size={12} /></button>
          </>}
        </div>
      ))}
      {logs && <div className={card}><div className="flex mb-2 text-sm text-white/80">Logs — {logs.name}<button className="ml-auto text-white/40" onClick={() => setLogs(null)}><X size={14} /></button></div><pre className="max-h-96 overflow-auto text-[11px] font-mono whitespace-pre-wrap text-white/70">{logs.text}</pre></div>}
    </div>
  )
}

// ─── Backups ─────────────────────────────────────────────────────────────────

function Backups() {
  const { busy, run } = useBusy()
  const [list, setList] = useState<BackupEntry[]>([])
  const [settings, setSettings] = useState<InfraSettings | null>(null)
  const [label, setLabel] = useState('')
  const [pass, setPass] = useState('')
  const [profile, setProfile] = useState<'essencial' | 'completo'>('essencial')
  const [restorePass, setRestorePass] = useState<Record<string, string>>({})
  const [del, setDel] = useState<BackupEntry | null>(null)
  const load = useCallback(() => get<{ backups: BackupEntry[]; settings: InfraSettings }>(`${API}?action=backups`).then(d => { setList(d.backups); setSettings(d.settings) }).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const saveSettings = (patch: Partial<InfraSettings>) => run('settings', async () => { setSettings((await post<{ settings: InfraSettings }>(API, { action: 'settings-save', settings: { ...settings, ...patch } })).settings) }, 'Agendamento salvo')
  return (
    <div className="space-y-3">
      <div className={`${card} grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end`}>
        <label className="text-[11px] text-white/50">Rótulo<input className={input} placeholder="ex.: antes de atualizar" value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label className="text-[11px] text-white/50 flex flex-col">Senha (opcional — criptografa com AES-256 e inclui as chaves de API)<input className={input} type="password" autoComplete="new-password" placeholder="mín. 8 caracteres; não é guardada" value={pass} onChange={e => setPass(e.target.value)} /></label>
        <div className="flex gap-2">
          <select className={input} value={profile} onChange={e => setProfile(e.target.value as 'essencial' | 'completo')}><option value="essencial">Essencial</option><option value="completo">Completo (+ extensões)</option></select>
          <button className={btnCyan} disabled={!!busy} onClick={() => run('create', async () => { await post(API, { action: 'backup-create', label, passphrase: pass, profile }); setPass(''); setLabel(''); load() }, 'Backup criado e verificado')}>{busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Fazer backup</button>
        </div>
      </div>
      {settings && (
        <div className={`${card} flex flex-wrap items-center gap-3 text-xs text-white/60`}>
          Backup automático a cada
          <select className={`${input} w-auto`} value={settings.backupEveryHours} onChange={e => saveSettings({ backupEveryHours: Number(e.target.value) })}>
            {[0, 6, 12, 24, 48, 168].map(h => <option key={h} value={h}>{h === 0 ? 'desativado' : h === 168 ? '7 dias' : `${h} h`}</option>)}
          </select>
          mantendo os últimos
          <select className={`${input} w-auto`} value={settings.backupKeep} onChange={e => saveSettings({ backupKeep: Number(e.target.value) })}>{[3, 5, 7, 14, 30].map(n => <option key={n} value={n}>{n}</option>)}</select>
          <span className="text-white/35">· último automático: {when(settings.lastBackupAt)}{settings.lastBackupError ? ` · erro: ${settings.lastBackupError}` : ''}</span>
        </div>
      )}
      {!list.length ? <Empty>Nenhum backup ainda.</Empty> : list.map(b => (
        <div key={b.id} className={card}>
          <div className="flex items-center gap-3">
            <Dot status={b.verifyOk === false ? 'fail' : 'ok'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{b.label} {b.encrypted && <Lock size={11} className="inline text-cyan-300" />} <span className="text-[10px] text-white/35 uppercase ml-1">{b.trigger} · {b.profile}</span></div>
              <div className="text-[11px] text-white/45 font-mono truncate">{when(b.createdAt)} · {(b.size / 1048576).toFixed(1)} MB · {b.entries} itens · sha256 {b.sha256.slice(0, 12)}… · verificado {when(b.verifiedAt)}</div>
              {b.verifyError && <div className="text-[11px] text-red-300">{b.verifyError}</div>}
            </div>
            {b.encrypted && <input className={`${input} w-36`} type="password" placeholder="senha" value={restorePass[b.id] || ''} onChange={e => setRestorePass(p => ({ ...p, [b.id]: e.target.value }))} />}
            <button className={btnGhost} disabled={!!busy} onClick={() => run('v' + b.id, async () => { const r = await post<{ result: { ok: boolean; error?: string; entries?: number } }>(API, { action: 'backup-verify', id: b.id, passphrase: restorePass[b.id] }); load(); if (!r.result.ok) throw new Error(r.result.error) }, 'Íntegro')}>{busy === 'v' + b.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Verificar</button>
            <button className={btnGhost} disabled={!!busy} title="Extrai em data/restores (não sobrescreve nada)" onClick={() => run('r' + b.id, async () => { const r = await post<{ result: { path: string } }>(API, { action: 'backup-restore', id: b.id, passphrase: restorePass[b.id] }); toast.success(`Extraído em ${r.result.path}`, { duration: 12_000 }) })}>{busy === 'r' + b.id ? <Loader2 size={12} className="animate-spin" /> : <ArchiveRestore size={12} />} Restaurar</button>
            <button className={btnRed} onClick={() => setDel(b)}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      {del && <ConfirmDialog title="Apagar este backup?" confirmLabel="Apagar" onClose={() => setDel(null)} onConfirm={async () => { await post(API, { action: 'backup-delete', id: del.id }); load() }}>O arquivo {del.label} ({when(del.createdAt)}) será removido do disco e não poderá ser recuperado.</ConfirmDialog>}
    </div>
  )
}

// ─── Local AI ────────────────────────────────────────────────────────────────

function AiTab() {
  const [d, setD] = useState<{ gpus: Inventory['gpus']; ramMb: number; ollama: OllamaStatus; advice: ModelAdvice } | null>(null)
  useEffect(() => { get<typeof d>(`${API}?action=ai`).then(setD).catch(e => toast.error(e.message)) }, [])
  if (!d) return <Empty><Loader2 className="inline animate-spin mr-2" size={14} />Lendo GPU e Ollama…</Empty>
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="text-sm text-white/80 mb-2">Capacidade para IA local</div>
        <div className="text-lg text-white">{d.advice.tier}</div>
        <div className="text-xs text-white/60">até ~{d.advice.maxParamsB}B parâmetros (quantização Q4) rodando em {d.advice.where} · RAM {fmtMb(d.ramMb)}{d.gpus[0] ? ` · ${d.gpus[0].name} ${fmtMb(d.gpus[0].memoryTotalMb)} VRAM` : ''}</div>
        <div className="mt-3 space-y-1">{d.advice.examples.map(e => <div key={e} className="text-xs text-cyan-100/90 font-mono">• {e}</div>)}</div>
        <div className="mt-3 space-y-1">{d.advice.notes.map(n => <div key={n} className="text-[11px] text-white/45">{n}</div>)}</div>
      </div>
      <div className={card}>
        <div className="text-sm text-white/80 mb-2 flex items-center gap-2"><Dot status={d.ollama.running ? 'up' : 'down'} /> Ollama {d.ollama.version}</div>
        {!d.ollama.running ? <div className="text-xs text-white/60">{d.ollama.error}</div> : (
          <>
            {d.ollama.models.map(m => {
              const loaded = d.ollama.loaded.find(l => l.name === m.name)
              return <div key={m.name} className="text-xs flex gap-3 py-0.5"><span className="text-white/85 font-mono">{m.name}</span><span className="text-white/40">{m.params} {m.quant}</span><span className="ml-auto text-white/50">{fmtMb(m.sizeMb)}{loaded ? ` · carregado (${fmtMb(loaded.vramMb)} VRAM)` : ''}</span></div>
            })}
            {!d.ollama.models.length && <div className="text-xs text-white/50">Nenhum modelo baixado. Ex.: <span className="font-mono">ollama pull {d.advice.examples[0]?.split(' ')[0]}</span></div>}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Self health ─────────────────────────────────────────────────────────────

function Health() {
  const { busy, run } = useBusy()
  const [r, setR] = useState<SelfReport | null>(null)
  const load = useCallback(() => get<{ report: SelfReport }>(`${API}?action=selfcheck`).then(d => setR(d.report)).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!r) return <Empty><Loader2 className="inline animate-spin mr-2" size={14} />Diagnosticando o JARVIS…</Empty>
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-white/50"><Dot status={r.status} /> {r.status === 'ok' ? 'Tudo certo' : r.status === 'warn' ? 'Atenção em alguns pontos' : 'Há problemas para corrigir'} · {r.durationMs} ms<button className={`${btnGhost} ml-auto`} onClick={load}><RefreshCw size={12} /> Rodar de novo</button></div>
      {r.checks.map(c => (
        <div key={c.id} className={`${card} flex items-start gap-3`}>
          <span className="mt-1.5"><Dot status={c.status} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white">{c.label}</div>
            <div className="text-xs text-white/55 break-words">{c.detail}</div>
          </div>
          <div className="flex flex-col gap-1">
            {c.fixes?.map(f => <button key={f.action + (f.arg || '')} className={btnCyan} disabled={!!busy} onClick={() => run(f.action + (f.arg || ''), async () => { const res = await post<{ message: string }>(API, { action: 'fix', fix: f.action, arg: f.arg }); toast.success(res.message); load() })}>{busy === f.action + (f.arg || '') ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} {f.label}</button>)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Approvals & audit ───────────────────────────────────────────────────────

function Approvals({ reloadAll }: { reloadAll: () => void }) {
  const { busy, run } = useBusy()
  const [list, setList] = useState<InfraApproval[]>([])
  const load = useCallback(() => get<{ approvals: InfraApproval[] }>(`${API}?action=approvals`).then(d => setList(d.approvals)).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const risk = (r: string) => (r === 'critical' ? 'text-red-300 border-red-400/30' : r === 'change' ? 'text-amber-200 border-amber-400/30' : 'text-white/60 border-white/10')
  if (!list.length) return <Empty>Nenhum pedido. Quando um agente precisar de algo destrutivo ou instalar software, o pedido aparece aqui.</Empty>
  return (
    <div className="space-y-2">
      {list.map(a => (
        <div key={a.id} className={card}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{a.title} <span className={`text-[10px] uppercase border rounded px-1.5 py-0.5 ml-2 ${risk(a.risk)}`}>{a.risk}</span></div>
              <div className="text-[11px] text-white/45">{when(a.createdAt)} · pedido por {a.actor}{a.reasons.length ? ` · ${a.reasons.join(', ')}` : ''}</div>
              <pre className="mt-2 text-[11px] font-mono bg-black/40 rounded p-2 whitespace-pre-wrap break-all text-white/80">{a.command}</pre>
              {a.result && <pre className={`mt-2 max-h-48 overflow-auto text-[11px] font-mono rounded p-2 whitespace-pre-wrap ${a.status === 'failed' ? 'bg-red-500/10 text-red-200' : 'bg-black/30 text-white/60'}`}>{a.result}</pre>}
            </div>
            {a.status === 'pending' ? (
              <div className="flex flex-col gap-1">
                <button className={a.risk === 'critical' ? btnRed : btnCyan} disabled={!!busy} onClick={() => run(a.id, async () => { const r = await post<{ approval: InfraApproval }>(API, { action: 'approve', id: a.id }); load(); reloadAll(); if (r.approval.status === 'failed') throw new Error('Executou, mas falhou — veja a saída') }, 'Executado')}>{busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Aprovar e executar</button>
                <button className={btnGhost} disabled={!!busy} onClick={() => run('x' + a.id, async () => { await post(API, { action: 'reject', id: a.id }); load() })}><X size={12} /> Recusar</button>
              </div>
            ) : <span className={`text-[11px] ${a.status === 'executed' ? 'text-emerald-300' : a.status === 'failed' ? 'text-red-300' : 'text-white/40'}`}>{a.status === 'executed' ? 'executado' : a.status === 'failed' ? 'falhou' : 'recusado'} {when(a.decidedAt)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Audit() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [errors, setErrors] = useState<LogEntry[]>([])
  useEffect(() => {
    get<{ audit: AuditEntry[] }>(`${API}?action=audit`).then(d => setRows(d.audit)).catch(e => toast.error(e.message))
    get<{ logs: LogEntry[] }>(`${API}?action=logs&level=error&limit=50`).then(d => setErrors(d.logs)).catch(() => {})
  }, [])
  if (!rows) return <Empty><Loader2 className="inline animate-spin mr-2" size={14} />Carregando…</Empty>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className={card}>
        <div className="text-sm text-white/80 mb-2">Trilha de auditoria (segredos mascarados)</div>
        <div className="max-h-[55vh] overflow-auto space-y-1">
          {rows.length ? rows.map((r, i) => (
            <div key={i} className="text-[11px] font-mono flex gap-2">
              <span className="text-white/30 shrink-0">{when(r.ts)}</span>
              <span className={r.ok ? 'text-emerald-300/80' : 'text-red-300'}>{r.ok ? '✔' : '✖'}</span>
              <span className="text-white/70 break-all">{r.actor} · {r.action}{r.target ? ` · ${r.target}` : ''}{r.risk ? ` [${r.risk}]` : ''}{r.detail ? ` — ${r.detail}` : ''}</span>
            </div>
          )) : <div className="text-xs text-white/40">Nada registrado ainda.</div>}
        </div>
      </div>
      <div className={card}>
        <div className="text-sm text-white/80 mb-2">Erros recentes do JARVIS</div>
        <div className="max-h-[55vh] overflow-auto space-y-1">
          {errors.length ? errors.map((e, i) => <div key={i} className="text-[11px] font-mono"><span className="text-white/30">{when(e.ts)} [{e.area}] </span><span className="text-red-200/90 break-all">{e.message}</span></div>) : <div className="text-xs text-white/40">Nenhum erro registrado.</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Panel ───────────────────────────────────────────────────────────────────

interface OverviewData { monitors: MonitorRow[]; incidents: Incident[]; approvals: InfraApproval[]; watchdog: boolean; leader: boolean }

export default function InfraPanel({ onClose, initialTab = 'overview' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [data, setData] = useState<OverviewData | null>(null)
  const [inventory, setInventory] = useState<Inventory>()
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async () => {
    try { setData(await get<OverviewData>(`${API}?action=overview`)) } catch (e) { toast.error((e as Error).message) }
  }, [])
  const loadInventory = useCallback(async (fresh = false) => {
    setRefreshing(true)
    try { setInventory((await get<{ inventory: Inventory }>(`${API}?action=inventory${fresh ? '&fresh=1' : ''}`)).inventory) } catch (e) { toast.error((e as Error).message) } finally { setRefreshing(false) }
  }, [])
  useEffect(() => {
    load()
    loadInventory()
    const t = setInterval(() => { load(); loadInventory() }, 15_000)
    return () => clearInterval(t)
  }, [load, loadInventory])
  const openInc = data?.incidents.filter(i => i.status === 'open').length || 0
  const pending = data?.approvals.length || 0
  const badge = (id: Tab) => (id === 'incidents' && openInc ? openInc : id === 'approvals' && pending ? pending : 0)

  return (
    <Modal onClose={onClose} width="max-w-6xl">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/15 flex items-center justify-center"><ServerCog size={18} className="text-cyan-300" /></div>
        <div>
          <div className="text-base font-semibold text-white">Infrastructure Core</div>
          <div className="text-[11px] text-white/45">Monitoramento, autorrecuperação, servidores, rede, backups e saúde do JARVIS — dados reais</div>
        </div>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/5 text-white/40"><X size={16} /></button>
      </div>
      <div className="flex flex-1 min-h-0">
        <nav className="w-48 shrink-0 border-r border-white/5 p-2 space-y-0.5 overflow-y-auto hidden md:block">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${tab === t.id ? 'bg-cyan-500/15 text-cyan-100' : 'text-white/55 hover:bg-white/5 hover:text-white'}`}>
              <t.icon size={14} /> {t.label}
              {badge(t.id) > 0 && <span className={`ml-auto text-[10px] px-1.5 rounded-full ${t.id === 'incidents' ? 'bg-red-500/80 text-white' : 'bg-amber-400/80 text-black'}`}>{badge(t.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 overflow-y-auto p-4" style={{ maxHeight: 'calc(88vh - 70px)' }}>
          <select className={`${input} md:hidden mb-3`} value={tab} onChange={e => setTab(e.target.value as Tab)}>{TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          {tab === 'overview' && <Overview inv={inventory} refreshing={refreshing} onRefresh={() => loadInventory(true)} />}
          {tab === 'monitors' && <Monitors monitors={data?.monitors || []} watchdog={!!data?.watchdog} leader={data?.leader !== false} reload={() => load()} />}
          {tab === 'incidents' && <Incidents incidents={data?.incidents || []} reload={() => load()} />}
          {tab === 'servers' && <Servers />}
          {tab === 'network' && <NetworkTab />}
          {tab === 'docker' && <DockerTab />}
          {tab === 'backups' && <Backups />}
          {tab === 'ai' && <AiTab />}
          {tab === 'health' && <Health />}
          {tab === 'approvals' && <Approvals reloadAll={() => load()} />}
          {tab === 'audit' && <Audit />}
        </div>
      </div>
    </Modal>
  )
}
