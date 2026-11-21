'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BadgeCheck, CheckCircle2, CircleDashed, Database, Download, Link2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Terminal, Users, Wand2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { DiagnosticsPayload } from '@/app/api/diagnostics/route'
import type { Diagnostics } from '@/lib/infra/diagnostics'
import type { LogEntry } from '@/lib/infra/log'
import type { ModuleCategory, ModuleDiagnostic, ModuleStatus } from '@/lib/diagnostics/modules'

type Level = 'ok' | 'warn' | 'fail'
const LEVEL_META: Record<Level, { label: string; color: string; bg: string }> = {
  ok: { label: 'Saudável', color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  warn: { label: 'Atenção', color: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/20' },
  fail: { label: 'Alerta', color: 'text-red-300', bg: 'bg-red-500/10 border-red-500/20' },
}

const MODULE_META: Record<ModuleStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'ok', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/10' },
  error: { label: 'erro', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/10' },
  attention: { label: 'atenção', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/10' },
  unknown: { label: 'n/a', color: 'text-white/35', bg: 'bg-white/5 border-white/10' },
}

const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  nucleo: 'Núcleo', ia: 'IA', agentes: 'Agentes', integracoes: 'Integrações', dados: 'Dados', build: 'Build',
}

function StatusBadge({ level, label, dot }: { level: Level; label?: string; dot?: boolean }) {
  const m = LEVEL_META[level]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold ${m.color} ${m.bg}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${level === 'ok' ? 'bg-emerald-400' : level === 'warn' ? 'bg-amber-400' : level === 'fail' ? 'bg-red-400' : 'bg-white/40'}`} aria-hidden />}
      {label ?? m.label}
    </span>
  )
}

function Line({ icon: Icon, title, subtitle, status, action }: { icon?: React.ReactNode; title: string; subtitle?: string; status: Level; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04] hover:border-white/8 transition-colors">
      <span className="text-white/45 flex-shrink-0">{Icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-white/85">{title}</div>
        {subtitle && <div className="text-[10.5px] text-white/35 truncate mt-0.5">{subtitle}</div>}
      </div>
      <StatusBadge level={status} />
      {action}
    </div>
  )
}

function moduleLine(m: ModuleDiagnostic, status: Level) {
  const meta = MODULE_META[m.status]
  return (
    <div key={m.id} className="flex items-center gap-2.5 py-1.5 border-b border-white/5 last:border-0">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-semibold ${meta.color} ${meta.bg} flex-shrink-0`}>{CATEGORY_LABELS[m.category] || m.category}</span>
      <span className="text-xs font-medium text-white/85 truncate flex-1">{m.name}</span>
      <span className={`inline-flex items-center gap-1.5 text-[10px] ${meta.color}`}><span className={`w-1.5 h-1.5 rounded-full bg-current`} />{meta.label}</span>
      {m.action && <span className="text-[10px] text-amber-400/80">{m.action}</span>}
      {m.evidence && <span className="text-[10px] text-white/30 truncate max-w-[180px]" title={m.evidence}>{m.evidence}</span>}
    </div>
  )
}

export default function DiagnosticsPanel({ onClose, onOpenAgents }: { onClose?: () => void; onOpenAgents?: () => void }) {
  const [d, setD] = useState<DiagnosticsPayload | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  const [autoOn, setAutoOn] = useState(true)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logSince, setLogSince] = useState(0)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/diagnostics', { cache: 'no-store' })
      setD(await r.json())
    } catch { /* ficará no retry */ }
  }, [])

  const refresh = useCallback(async () => {
    if (runBusy) return
    setRunBusy(true)
    try {
      const res = await fetch('/api/diagnostics', { method: 'POST' })
      const data = await res.json()
      setD(data)
      toast.success('Verificação N1–N5 executada')
    } catch (e) { toast.error('Falha na verificação: ' + (e as Error).message) }
    setRunBusy(false)
  }, [runBusy])

  // Stream: snapshot + log tail automático (sozinho: todos os 5s quando ativo)
  useEffect(() => {
    if (!autoOn) return
    let es: EventSource | null = null
    const timer = setTimeout(() => {
      es = new EventSource('/api/diagnostics?sse=1')
      let lastAt = 0
      es.addEventListener('snapshot', (ev) => { try { setD(JSON.parse(ev.data)) } catch {} })
      es.addEventListener('logs', (ev) => {
        try {
          const rows: LogEntry[] = JSON.parse(ev.data)
          const fresh = rows.filter(l => l.ts > lastAt).sort((a, b) => b.ts - a.ts)
          if (!fresh.length) return
          lastAt = Math.max(...fresh.map(l => l.ts))
          setLogs(prev => [...fresh.slice(0, 60), ...prev].slice(0, 200))
          setLogSince(lastAt)
        } catch {}
      })
      es.onerror = () => es?.close()
    }, 100)
    return () => { if (es) es.close() }
  }, [autoOn, version])

  // Fallback em caso de stream não conectar: carga periódica
  useEffect(() => {
    const t = setInterval(() => { if (autoOn) load() }, 5_000)
    return () => clearInterval(t)
  }, [autoOn, load])

  useEffect(() => { load() }, [load])

  if (!d) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-white/40"><Loader2 size={14} className="animate-spin" /> carregando diagnóstico…</div>
      </div>
    )
  }

  const diag: Diagnostics = d.diagnostics
  const overall: Level = d.modules.some(m => m.status === 'error') ? 'fail'
    : d.modules.some(m => m.status === 'attention') ? 'warn'
    : diag.levels && Object.values(diag.levels).some(v => v === 'fail') ? 'fail'
    : diag.levels && Object.values(diag.levels).some(v => v === 'warn') ? 'warn'
    : 'ok'

  const modError = d.modules.filter(m => m.status === 'error').length
  const modAttention = d.modules.filter(m => m.status === 'attention').length
  const modOk = d.modules.filter(m => m.status === 'ok').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-white/5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Wand2 size={18} className="text-cyan-300 flex-shrink-0" />
            <h1 className="text-sm font-semibold text-white">Diagnóstico do JARVIS</h1>
            <StatusBadge level={overall} dot />
            <span className="text-[10px] text-white/30">· {modOk} ok · {modError} erro · {modAttention} atenção</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={refresh} title="Rode verificação N1–N5 em todos os modelos" disabled={runBusy} className="p-1.5 rounded-lg text-white/35 hover:text-amber-300 hover:bg-white/5 disabled:opacity-40"><ShieldAlert size={13} /></button>
            <button onClick={() => (navigator as { clipboard?: { writeText(t: string): Promise<void> } }).clipboard?.writeText(JSON.stringify(d, null, 2))} title="Copiar resposta (JSON)" className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5"><Download size={13} /></button>
            <button onClick={() => setAutoOn(v => !v)} title={autoOn ? 'Desligar atualização automática' : 'Ligar atualização automática'} className={`p-1.5 rounded-lg ${autoOn ? 'text-cyan-400' : 'text-white/30'} hover:bg-white/5`}><RefreshCw size={13} /></button>
            {onClose && <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5"><XCircle size={13} /></button>}
          </div>
        </div>
        <p className="text-[10px] text-white/35">O que está funcionando, o que apresenta erro e onde precisa de atenção. Verificado em tempo real.</p>
        <p className="text-[10px] text-white/25">{d.checkedAt ? new Date(d.checkedAt).toLocaleTimeString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''} · {runBusy ? 'verificando modelos…' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* 1. Módulos do JARVIS — a resposta direta: funcionando, com erro ou em atenção */}
        <section className="rounded-xl glass-panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <Link2 size={12} className="text-white/45" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Módulos do JARVIS</span>
          </div>
          {d.modules.length === 0 && <div className="text-[10.5px] text-white/30 py-3 text-center">nenhum módulo reportou (fonte inacessível?)</div>}
          {d.modules.map(m => moduleLine(m, m.status === 'ok' ? 'ok' : m.status === 'error' ? 'fail' : 'warn'))}
          <div className="text-[10px] text-amber-400/70 mt-1.5">Verificação real por probe; as ações acima são efetivas (ex.: verificar na tela de diagnóstico).</div>
        </section>

        {/* 2. IAs conectadas */}
        <section className="rounded-xl glass-panel p-3 space-y-1">
          <div className="flex items-center gap-2 mb-1.5"><Users size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">IAs conectadas</span><StatusBadge level={diag.providers.length ? (diag.providers.some(p => p.status === 'fail') ? 'fail' : diag.providers.some(p => p.status === 'warn') ? 'warn' : 'ok') : 'ok'} /></div>
          {diag.providers.length === 0 && <div className="text-[10.5px] text-white/30">nenhuma conectada</div>}
          {diag.providers.map(p => (
            <Line key={p.provider} status={p.status} title={p.provider} subtitle={p.error || `${p.models} modelo(s) · ${p.freeCount} grátis`} />
          ))}
        </section>

        {/* 3. Modelos registrados */}
        <section className="rounded-xl glass-panel p-3 space-y-1">
          <div className="flex items-center gap-2 mb-1.5"><Database size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Modelos ({diag.models.length})</span><StatusBadge level={diag.models.some(m => m.state === 'unavailable') ? 'fail' : diag.models.some(m => m.state === 'cooling') ? 'warn' : 'ok'} /></div>
          {diag.models.length === 0 && <div className="text-[10.5px] text-white/30">nenhum modelo registrado nesta execução</div>}
          {diag.models.map(m => (
            <Line key={m.model}
              status={m.state === 'unavailable' ? 'fail' : m.state === 'cooling' ? 'warn' : 'ok'}
              icon={m.state === 'unavailable' ? <XCircle size={12} /> : m.state === 'cooling' ? <CircleDashed size={12} /> : <CheckCircle2 size={12} />}
              title={m.model.split('|').pop() || m.model}
              subtitle={[m.lastError ? `falhou: ${m.lastError}` : '', m.latencyMs ? `latência ${m.latencyMs} ms` : ''].filter(Boolean).join(' · ') || (m.state === 'ok' ? 'operando' : 'aguardando liberação')}
              action={m.state === 'cooling' && m.cooldownMs > 0 ? <span className="text-[10px] text-white/30">espera ~{Math.max(0, Math.round(m.cooldownMs / 1000))}s</span> : undefined}
            />
          ))}
        </section>

        {/* 4. Equipes */}
        <section className="rounded-xl glass-panel p-3 space-y-1">
          <div className="flex items-center gap-2 mb-1.5"><Users size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Equipes de agentes</span><StatusBadge level={diag.teams.activeRuns || diag.teams.runningTasks ? 'warn' : 'ok'} /></div>
          <Line status="ok" icon={<Users size={12} />} title={`${diag.teams.teams} equipes · ${diag.teams.agentsTotal} agentes`} subtitle={`${diag.teams.activeRuns} execução(ões) ativa(s) · ${diag.teams.runningTasks} tarefa(s) rodando · ${diag.teams.failedTasks} falhadas`} />
          {onOpenAgents && (
            <button onClick={onOpenAgents} className="w-full mt-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10.5px] text-white/45 hover:text-cyan-200 hover:bg-white/5 border border-white/5">
              <Users size={11} /> abrir o painel de equipes
            </button>
          )}
        </section>

        {/* 5. Terminal */}
        <section className="rounded-xl glass-panel p-3">
          <div className="flex items-center gap-2 mb-1.5"><Terminal size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Terminal ao vivo</span><StatusBadge level="ok" /></div>
          <Line status="ok" icon={<Terminal size={12} />} title="Sessões de terminal" subtitle={diag.terminal.sessions ? `${diag.terminal.sessions} aberta(s)` : 'nenhuma aberta'} />
        </section>

        {/* 6. Persistência */}
        <section className="rounded-xl glass-panel p-3 space-y-1">
          <div className="flex items-center gap-2 mb-1.5"><Database size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Dados e arquivos</span><StatusBadge level={diag.persistence.corrupt.length ? 'fail' : diag.persistence.quarantined.length || diag.persistence.staleTmp.length ? 'warn' : 'ok'} /></div>
          <Line status="ok" icon={<Database size={12} />} title={`${diag.persistence.files.toLocaleString()} arquivo(s) JSON verificados`} />
          {diag.persistence.corrupt.length > 0 && <Line status="fail" icon={<XCircle size={12} />} title="Corrompidos" subtitle={diag.persistence.corrupt.join(', ')} />}
          {diag.persistence.quarantined.length > 0 && <Line status="warn" icon={<XCircle size={12} />} title="Em quarentena" subtitle={`${diag.persistence.quarantined.slice(0, 8).join(', ')}${diag.persistence.quarantined.length > 8 ? ', …' : ''}`} />}
          {diag.persistence.staleTmp.length > 0 && <Line status="warn" icon={<AlertTriangle size={12} />} title="Temporários órfãos" subtitle={`${diag.persistence.staleTmp.length} arquivo(s) de gravações interrompidas`} />}
        </section>

        {/* 7. Backups */}
        <section className="rounded-xl glass-panel p-3">
          <div className="flex items-center gap-2 mb-1.5"><Download size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Backups</span><StatusBadge level={diag.backups.latestAt ? 'ok' : 'warn'} /></div>
          <Line status={diag.backups.latestAt ? 'ok' : 'warn'} icon={<Download size={12} />} title={`${diag.backups.count} backup(s)`} subtitle={diag.backups.latestAt ? `último em ${new Date(diag.backups.latestAt).toLocaleString('pt-BR')}${diag.backups.lastSizeMb ? ` · ${diag.backups.lastSizeMb.toFixed(1)} MB` : ''}` : 'nenhum ainda'} />
        </section>

        {/* 8. Autodiagnóstico próprio */}
        <section className="rounded-xl glass-panel p-3 space-y-1">
          <div className="flex items-center gap-2 mb-1.5"><ShieldCheck size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Autodiagnóstico do JARVIS</span><StatusBadge level={diag.selfcheck.status} /></div>
          {diag.selfcheck.checks.map(c => (
            <Line key={c.id} status={c.status === 'ok' ? 'ok' : c.status === 'fail' ? 'fail' : 'warn'}
              icon={c.status === 'ok' ? <CheckCircle2 size={12} /> : c.status === 'fail' ? <XCircle size={12} /> : <AlertTriangle size={12} />}
              title={c.label} subtitle={c.detail}
            />
          ))}
        </section>

        {/* 9. Infraestrutura */}
        <section className="rounded-xl glass-panel p-3">
          <div className="flex items-center gap-2 mb-1.5"><BadgeCheck size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Sistema / Máquina</span><StatusBadge level={diag.infra.status === 'critical' ? 'fail' : diag.infra.status === 'warning' ? 'warn' : 'ok'} /></div>
          <Line status={diag.infra.status === 'critical' ? 'fail' : diag.infra.status === 'warning' ? 'warn' : 'ok'} icon={<BadgeCheck size={12} />} title="Ressurso da máquina" subtitle={diag.infra.issues.length ? diag.infra.issues.join(' · ') : 'sem ressonâncias acima de 85% ou disco cheio'} />
        </section>

        {/* 10. Erros recentes */}
        <section className="rounded-xl glass-panel p-3">
          <div className="flex items-center gap-2 mb-1.5"><AlertTriangle size={12} className="text-white/45" /><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Erros e atividade recente</span><StatusBadge level={logs.some(l => l.level === 'error') ? 'warn' : 'ok'} /></div>
          {logs.length === 0 && <div className="text-[10.5px] text-white/30 py-3 text-center">sem registros a recentes no filtro ativo</div>}
          {logs.slice(0, 100).map((l, i) => (
            <div key={`${l.ts}-${i}`} className="flex gap-2 py-1 border-b border-white/5 last:border-0">
              <span className="text-[10px] font-mono text-white/40 flex-shrink-0">{new Date(l.ts).toLocaleTimeString('pt-BR', { hour12: false })}</span>
              <span className={`text-[10px] font-semibold flex-shrink-0 ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-white/40'}`}>{l.level === 'error' ? 'ERRO' : l.level === 'warn' ? 'AVISO' : 'INFO'}</span>
              <span className="text-[10px] text-cyan-300/70 font-mono flex-shrink-0">{l.area}</span>
              <span className="text-[10px] text-white/55 flex-1 min-w-0 break-words">{l.message}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
