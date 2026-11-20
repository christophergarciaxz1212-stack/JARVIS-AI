'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ExtensionSetupForm from './ExtensionSetupForm'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Eye,
  FolderGit2, Globe, History, KeyRound, Lightbulb, Loader2, Package, Play, Plug,
  Plus, RefreshCw, RotateCcw, Save, Search, Settings2, Shield, Sparkles, Terminal,
  Trash2, Wrench, X, XCircle,
} from 'lucide-react'
import type {
  Approval, Candidate, EngineJob, EngineSettings, EngineStats, Extension, HistoryEntry, Opportunity, RiskLevel,
} from '@/lib/engine/types'

interface CatalogData {
  extensions: Extension[]
  settings: EngineSettings
  approvals: Approval[]
  opportunities: Opportunity[]
  conflicts: Array<{ type: string; message: string; extensions: string[] }>
  running: string[]
  jobs: EngineJob[]
  stats: EngineStats
}

interface InspectResult {
  token: string
  candidate: Candidate
  kind: string
  name: string
  version: string
  risk: Extension['risk']
  decision: { action: 'install' | 'approve' | 'block'; reason?: string }
  tools: number
  requires?: string
}

interface DiscoverResult {
  candidates: Candidate[]
  errors: string[]
}

type Tab = 'catalog' | 'discover' | 'approvals' | 'activity' | 'improve' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: 'catalog', label: 'Catálogo', icon: Package },
  { id: 'discover', label: 'Descobrir', icon: Search },
  { id: 'approvals', label: 'Aprovações', icon: Shield },
  { id: 'activity', label: 'Atividade', icon: Activity },
  { id: 'improve', label: 'Melhorias', icon: Lightbulb },
  { id: 'settings', label: 'Ajustes', icon: Settings2 },
]

const RISK_STYLE: Record<RiskLevel, string> = {
  low: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-300 border-red-500/20',
}

const RISK_LABEL: Record<RiskLevel, string> = { low: 'risco baixo', medium: 'risco médio', high: 'risco alto', critical: 'risco crítico' }

const KIND_ICON = { skill: Sparkles, mcp: Plug, tool: Wrench } as const
const KIND_LABEL = { skill: 'Skill', mcp: 'MCP', tool: 'Ferramenta' } as const

function statusLabel(e: Extension) {
  if (!e.enabled) return { text: 'desativada', cls: 'text-white/30' }
  if (e.status === 'broken') return { text: 'com problema', cls: 'text-red-300' }
  if (e.status === 'needs-setup') return { text: 'falta configurar', cls: 'text-amber-300' }
  return { text: 'ok', cls: 'text-emerald-300' }
}

function timeAgo(at?: number) {
  if (!at) return 'nunca'
  const diff = Date.now() - at
  if (diff < 60_000) return 'agora'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min atrás`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h atrás`
  return new Date(at).toLocaleDateString('pt-BR')
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/5 bg-white/[0.02] ${className}`}>{children}</div>
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${className}`}>{children}</span>
}

export default function SkillEnginePanel({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('catalog')
  const [job, setJob] = useState<EngineJob | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [busy, setBusy] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'skill' | 'mcp' | 'tool'>('all')

  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Array<'skill' | 'mcp' | 'tool'>>(['skill', 'mcp', 'tool'])
  const [results, setResults] = useState<DiscoverResult | null>(null)
  const [inspected, setInspected] = useState<InspectResult | null>(null)
  const [source, setSource] = useState('')
  const [need, setNeed] = useState('')
  const [grantDraft, setGrantDraft] = useState<Record<string, string>>({})
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({})
  const [agentsDraft, setAgentsDraft] = useState<Record<string, string>>({})
  const [toolDraft, setToolDraft] = useState<Record<string, string>>({})
  const [runTool, setRunTool] = useState<{ ext: Extension; tool: string; args: string } | null>(null)
  const [readContent, setReadContent] = useState<{ title: string; content: string } | null>(null)
  const [output, setOutput] = useState<{ title: string; content: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/engine', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao carregar o Skill Engine')
      setCatalog(data as CatalogData)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetch('/api/engine?action=history&limit=200', { cache: 'no-store' }).then(r => r.json())
      setHistory(data.history || [])
    } catch {}
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (tab === 'activity') void loadHistory() }, [tab, loadHistory])

  // Jobs run server-side; the panel polls until they finish and then refreshes the catalogue
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return
    const id = jobId
    const timer = setInterval(async () => {
      try {
        const data = await fetch(`/api/engine?action=job&id=${id}`, { cache: 'no-store' }).then(r => r.json())
        if (!data.job) return
        setJob(data.job as EngineJob)
        if (data.job.status !== 'running') {
          if (data.job.status === 'failed') toast.error(data.job.error || 'A tarefa falhou')
          else toast.success('Tarefa concluída')
          void load()
          void loadHistory()
        }
      } catch {}
    }, 1000)
    return () => clearInterval(timer)
  }, [jobId, jobStatus, load, loadHistory])

  const post = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/api/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Falha em ${action}`)
    return data
  }, [])

  const withBusy = useCallback(async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    try { await work() } catch (error) {
      toast.error((error as Error).message)
    } finally { setBusy('') }
  }, [])

  const startJob = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const data = await post(action, payload)
    const next = data.job as EngineJob | undefined
    if (!next) throw new Error('O engine não iniciou a tarefa')
    setJob(next)
    return next
  }, [post])

  const inspectCandidate = useCallback(async (candidate: Candidate) => {
    setBusy(`inspect:${candidate.id}`)
    try {
      const data = await post('inspect', { candidate })
      setInspected(data as InspectResult)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [post])

  const inspectSource = useCallback(async () => {
    const value = source.trim()
    if (!value) return
    setBusy('inspect-source')
    try {
      const data = await post('inspect', { source: value })
      setInspected(data as InspectResult)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [post, source])

  const installInspected = useCallback(async (grantEnv: string[] = []) => {
    if (!inspected) return
    setBusy('install')
    try {
      const outcome = await post('install', { token: inspected.token, grantEnv })
      if (outcome.status === 'installed') {
        toast.success(`Instalada e testada: ${outcome.extension.name}`)
        setInspected(null)
        setTab('catalog')
        await load()
      } else if (outcome.status === 'pending') {
        toast.warning(`Aguardando aprovação: ${outcome.approval.reason}`)
        setInspected(null)
        setTab('approvals')
        await load()
      } else if (outcome.status === 'blocked') {
        toast.error(`Bloqueada: ${outcome.reason}`)
      } else if (outcome.status === 'existing') {
        toast.info('Essa extensão já está instalada')
        setInspected(null)
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [inspected, post, load])

  const discover = useCallback(async () => {
    const value = query.trim()
    if (!value) return
    setBusy('discover')
    try {
      const data = await post('discover', { query: value, kinds })
      setResults(data as DiscoverResult)
      if (!(data.candidates || []).length) toast.info('Nada encontrado. Você pode criar uma Skill própria.')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [post, query, kinds])

  const decideApproval = useCallback(async (approval: Approval, approve: boolean) => {
    setBusy(`approval:${approval.id}`)
    try {
      const grantEnv = (grantDraft[approval.id] || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
      const outcome = await post(approve ? 'approve' : 'deny', { id: approval.id, grantEnv })
      if (outcome.status === 'installed') toast.success(`Instalada: ${outcome.extension.name}`)
      else if (outcome.status === 'pending') toast.warning('Ainda precisa de outro passo de aprovação')
      else if (outcome.status === 'blocked') toast.error(`Bloqueada: ${outcome.reason}`)
      else toast.success(approve ? 'Aprovada' : 'Recusada')
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [grantDraft, post, load])

  const readSkill = useCallback(async (ext: Extension, skill?: string) => {
    setBusy(`read:${ext.id}`)
    try {
      const params = new URLSearchParams({ action: 'read', id: ext.id })
      if (skill) params.set('skill', skill)
      const data = await fetch(`/api/engine?${params}`, { cache: 'no-store' }).then(r => r.json())
      if (data.error) throw new Error(data.error)
      setReadContent({ title: skill ? `${ext.name} · ${skill}` : ext.name, content: data.content })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [])

  const callTool = useCallback(async () => {
    if (!runTool) return
    let args: Record<string, unknown> = {}
    try { args = runTool.args.trim() ? JSON.parse(runTool.args) : {} } catch {
      toast.error('Os argumentos precisam ser um JSON válido')
      return
    }
    setBusy('call')
    try {
      const data = await post('call', { id: runTool.ext.id, tool: runTool.tool, args })
      setOutput({ title: `${runTool.ext.name} → ${runTool.tool}`, content: data.output || '(sem saída)' })
      setRunTool(null)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [runTool, post])

  const savePermissions = useCallback(async (ext: Extension) => {
    setBusy(`perm:${ext.id}`)
    try {
      const env = (envDraft[ext.id] ?? ext.permissions.env.join(', ')).split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      const agents = (agentsDraft[ext.id] ?? ext.permissions.agents.join(', ')).split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      await post('permissions', { id: ext.id, patch: { env, agents: agents.length ? agents : ['*'] } })
      toast.success(`Permissões de ${ext.name} atualizadas`)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }, [envDraft, agentsDraft, post, load])

  const extStats = catalog?.stats
  const pending = useMemo(() => (catalog?.approvals || []).filter(a => a.status === 'pending'), [catalog])
  const openOpportunities = useMemo(() => (catalog?.opportunities || []).filter(o => o.status === 'open'), [catalog])
  const extensions = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (catalog?.extensions || [])
      .filter(e => kindFilter === 'all' || e.kind === kindFilter)
      .filter(e => !q || `${e.name} ${e.id} ${e.description} ${e.categories.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  }, [catalog, filter, kindFilter])

  const jobPanel = job && (
    <div className="border-t border-white/10 bg-black/40 px-4 py-3 max-h-56 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          {job.status === 'running' ? <Loader2 size={13} className="animate-spin text-cyan-300" /> : job.status === 'done' ? <CheckCircle2 size={13} className="text-emerald-300" /> : <XCircle size={13} className="text-red-300" />}
          <span className="text-white/80 font-medium">{job.title}</span>
          <span className="text-white/30">{job.status === 'running' ? 'em andamento' : job.status === 'done' ? 'concluída' : 'falhou'}</span>
        </div>
        {job.status !== 'running' && (
          <button onClick={() => setJob(null)} className="text-[11px] text-white/30 hover:text-white/70">fechar</button>
        )}
      </div>
      <div className="mt-2 font-mono text-[11px] leading-relaxed text-white/45">
        {job.log.length === 0 && <div className="text-white/25">aguardando saída…</div>}
        {job.log.slice(-80).map((line, i) => <div key={i}>{line}</div>)}
        {job.error && <div className="text-red-300">{job.error}</div>}
      </div>
    </div>
  )

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0 }, pointerEvents: 'none' }}
      className="mo-backdrop fixed inset-0 bg-black/[.88] z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={false}
        animate={{ scale: 1, y: 0 }}
        className="glass modal-pop rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold jarvis-title flex items-center gap-2">
              <Sparkles size={18} className="text-cyan-300" /> Jarvis Skill Engine
            </h2>
            <p className="text-[11px] text-white/40 mt-0.5 truncate">
              Descoberta, instalação, permissões e uso de Skills, plugins e MCP por todos os agentes
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {extStats && (
              <div className="hidden md:flex items-center gap-3 text-[11px] text-white/45 mr-2">
                <span><b className="text-white/80">{extStats.enabled}</b>/{extStats.total} ativas</span>
                <span><b className={extStats.updates ? 'text-amber-300' : 'text-white/80'}>{extStats.updates}</b> atualizações</span>
                <span><b className={extStats.pendingApprovals ? 'text-orange-300' : 'text-white/80'}>{extStats.pendingApprovals}</b> aprovações</span>
                <span><b className={extStats.broken ? 'text-red-300' : 'text-white/80'}>{extStats.broken}</b> com problema</span>
              </div>
            )}
            <button onClick={() => void load()} className="p-2 rounded-lg hover:bg-white/5" title="Recarregar">
              <RefreshCw size={15} className="text-white/50" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5">
              <X size={18} className="text-white/50" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 overflow-x-auto shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap flex items-center gap-1.5 transition-all ${tab === t.id ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/40 hover:text-white/70'}`}
            >
              <t.icon size={13} />
              {t.label}
              {t.id === 'approvals' && pending.length > 0 && (
                <span className="text-[10px] px-1 rounded-full bg-orange-500/20 text-orange-300">{pending.length}</span>
              )}
              {t.id === 'improve' && openOpportunities.length > 0 && (
                <span className="text-[10px] px-1 rounded-full bg-purple-500/20 text-purple-300">{openOpportunities.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-white/30 text-sm">
              <Loader2 size={18} className="animate-spin mr-2" /> Carregando catálogo…
            </div>
          ) : tab === 'catalog' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filtrar por nome, descrição ou categoria"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/5 border border-white/5 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-500/40"
                  />
                </div>
                {(['all', 'skill', 'mcp', 'tool'] as const).map(k => (
                  <button key={k} onClick={() => setKindFilter(k)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] border transition-all ${kindFilter === k ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' : 'border-white/5 text-white/40 hover:text-white/70'}`}>
                    {k === 'all' ? 'Tudo' : KIND_LABEL[k]}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={() => setTab('discover')} className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] flex items-center gap-1">
                  <Plus size={12} /> Adicionar
                </button>
              </div>

              {!extensions.length && (
                <Card className="p-8 text-center">
                  <Package size={28} className="mx-auto text-white/15 mb-3" />
                  <div className="text-sm text-white/60">Nenhuma extensão instalada{filter ? ' com esse filtro' : ''}.</div>
                  <div className="text-xs text-white/30 mt-1">Descubra uma Skill/MCP ou peça no chat: “encontre uma skill para …”.</div>
                </Card>
              )}

              {extensions.map(ext => {
                const Icon = KIND_ICON[ext.kind]
                const status = statusLabel(ext)
                const open = expanded === ext.id
                return (
                  <Card key={ext.id} className="overflow-hidden">
                    <div className="p-3 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={15} className="text-cyan-300/80" />
                      </div>
                      <button onClick={() => setExpanded(open ? null : ext.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{ext.name}</span>
                          <Badge className="bg-white/5 text-white/40 border-white/5">{KIND_LABEL[ext.kind]}</Badge>
                          <Badge className={RISK_STYLE[ext.risk.level]}>{RISK_LABEL[ext.risk.level]}</Badge>
                          <span className={`text-[10px] ${status.cls}`}>{status.text}</span>
                          {ext.updateAvailable && <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20">v{ext.updateAvailable.version} disponível</Badge>}
                          {ext.requires && <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20">requer {ext.requires}</Badge>}
                        </div>
                        <div className="text-xs text-white/40 mt-0.5 line-clamp-2">{ext.description || 'Sem descrição'}</div>
                        {ext.status !== 'ok' && ext.statusReason && <div className="text-[11px] text-amber-200/80 mt-0.5 line-clamp-2">{ext.statusReason}</div>}
                        <div className="text-[10px] text-white/25 mt-1">
                          {ext.source.type}:{ext.source.ref}{ext.source.subPath ? `#${ext.source.subPath}` : ''} · v{ext.version} ·{' '}
                          {ext.tools.length ? `${ext.tools.length} ferramenta(s)` : ext.skills?.length ? `${ext.skills.length} skill(s)` : 'instruções'}
                          {ext.lastTest ? ` · testada ${timeAgo(ext.lastTest.at)}` : ''}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => withBusy(`toggle:${ext.id}`, async () => {
                            await post(ext.enabled ? 'disable' : 'enable', { id: ext.id })
                            await load()
                          })}
                          className={`w-9 h-5 rounded-full transition-all relative ${ext.enabled ? 'bg-cyan-500' : 'bg-white/10'}`}
                          title={ext.enabled ? 'Desativar' : 'Ativar'}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${ext.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                        <button onClick={() => setExpanded(open ? null : ext.id)} className="p-1.5 rounded-lg hover:bg-white/5">
                          {open ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="border-t border-white/5 px-3 py-3 space-y-3 bg-black/20">
                        <div className="flex flex-wrap gap-1.5">
                          {ext.kind === 'skill' && (
                            <ActionButton icon={Eye} label="Ler instruções" busy={busy === `read:${ext.id}`} onClick={() => void readSkill(ext)} />
                          )}
                          {ext.skills?.map(s => (
                            <ActionButton key={s.path} icon={Eye} label={s.name} busy={busy === `read:${ext.id}`} onClick={() => void readSkill(ext, s.name)} />
                          ))}
                          {ext.tools.length > 0 && (
                            <ActionButton icon={Play} label="Executar" onClick={() => setRunTool({
                              ext,
                              tool: ext.tools.length === 1 ? ext.tools[0].name : '',
                              args: toolDraft[ext.id] || '{}',
                            })} />
                          )}
                          <ActionButton icon={CheckCircle2} label="Testar" busy={busy === `test:${ext.id}`} onClick={() => void withBusy(`test:${ext.id}`, async () => {
                            const r = await post('test', { id: ext.id })
                            if (r.ok) toast.success(`Teste: ${r.output}`)
                            else toast.error(`Teste: ${r.output}`)
                            await load()
                          })} />
                          {ext.source.type === 'github' || ext.source.type === 'npm' ? (
                            <ActionButton icon={Download} label="Atualizar" busy={busy === `update:${ext.id}`} onClick={() => void withBusy(`update:${ext.id}`, async () => {
                              const r = await post('update', { id: ext.id })
                              if (r.updated) toast.success(r.message)
                              else toast.info(r.message)
                              await load()
                            })} />
                          ) : null}
                          <ActionButton icon={Wrench} label="Reparar" busy={busy === `repair:${ext.id}`} onClick={() => void withBusy(`repair:${ext.id}`, async () => {
                            const r = await post('repair', { id: ext.id })
                            if (r.ok) toast.success(r.output)
                            else toast.error(r.output)
                            await load()
                          })} />
                          {!ext.id.startsWith('builtin-') && (
                            <ActionButton icon={Trash2} label="Remover" danger onClick={() => {
                              if (!confirm(`Remover ${ext.name}? Os arquivos e versões guardadas serão apagados.`)) return
                              void withBusy(`remove:${ext.id}`, async () => {
                                await post('remove', { id: ext.id })
                                toast.success(`${ext.name} removida`)
                                await load()
                              })
                            }} />
                          )}
                        </div>

                        <ExtensionSetupForm ext={ext} post={post} onSaved={load} />

                        {/* Risk & permissions */}
                        <div className="grid md:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5 flex items-center gap-1">
                              <Shield size={11} /> Análise de segurança
                            </div>
                            {ext.risk.findings.length === 0 && <div className="text-[11px] text-emerald-300/80">Nenhum alerta encontrado.</div>}
                            <div className="space-y-1">
                              {ext.risk.findings.slice(0, 8).map((f, i) => (
                                <div key={i} className="text-[11px] text-white/45 flex items-start gap-1.5">
                                  <span className={
                                    f.severity === 'critical' ? 'text-red-400' : f.severity === 'high' ? 'text-orange-300' : f.severity === 'medium' ? 'text-amber-300' : 'text-white/25'
                                  }>•</span>
                                  <span>{f.message}{f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5 flex items-center gap-1">
                              <KeyRound size={11} /> Permissões
                            </div>
                            <div className="flex flex-wrap gap-2 text-[11px] text-white/50 mb-2">
                              <label className="flex items-center gap-1"><input type="checkbox" checked={ext.permissions.network}
                                onChange={e => void withBusy(`perm:${ext.id}`, async () => {
                                  await post('permissions', { id: ext.id, patch: { network: e.target.checked } })
                                  await load()
                                })} /> rede</label>
                              <label className="flex items-center gap-1"><input type="checkbox" checked={ext.permissions.shell}
                                onChange={e => void withBusy(`perm:${ext.id}`, async () => {
                                  await post('permissions', { id: ext.id, patch: { shell: e.target.checked } })
                                  await load()
                                })} /> comandos</label>
                              <label className="flex items-center gap-1"><input type="checkbox" checked={ext.permissions.fsWrite}
                                onChange={e => void withBusy(`perm:${ext.id}`, async () => {
                                  await post('permissions', { id: ext.id, patch: { fsWrite: e.target.checked } })
                                  await load()
                                })} /> gravar arquivos</label>
                            </div>
                            <div className="space-y-1.5">
                              <input
                                value={envDraft[ext.id] ?? ext.permissions.env.join(', ')}
                                onChange={e => setEnvDraft(d => ({ ...d, [ext.id]: e.target.value }))}
                                placeholder="Credenciais liberadas (ex.: NOTION_TOKEN)"
                                className="w-full px-2 py-1 rounded bg-white/5 border border-white/5 text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30"
                              />
                              <input
                                value={agentsDraft[ext.id] ?? ext.permissions.agents.join(', ')}
                                onChange={e => setAgentsDraft(d => ({ ...d, [ext.id]: e.target.value }))}
                                placeholder="Agentes autorizados (* = todos)"
                                className="w-full px-2 py-1 rounded bg-white/5 border border-white/5 text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30"
                              />
                              <button onClick={() => void savePermissions(ext)} disabled={busy === `perm:${ext.id}`}
                                className="px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] flex items-center gap-1 disabled:opacity-40">
                                {busy === `perm:${ext.id}` ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Salvar permissões
                              </button>
                            </div>
                          </div>
                        </div>

                        {ext.versions.length > 1 && (
                          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5 flex items-center gap-1">
                              <History size={11} /> Versões guardadas (rollback)
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {ext.versions.filter(v => v.dir !== ext.dir).map(v => (
                                <button key={v.dir} onClick={() => {
                                  if (!confirm(`Restaurar ${ext.name} para a versão ${v.version}?`)) return
                                  void withBusy(`restore:${ext.id}`, async () => {
                                    await post('restore', { id: ext.id, dir: v.dir })
                                    toast.success(`Versão ${v.version} restaurada`)
                                    await load()
                                  })
                                }} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-white/60 flex items-center gap-1">
                                  <RotateCcw size={11} /> {v.version}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : tab === 'discover' ? (
            <div className="space-y-4">
              <Card className="p-3">
                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void discover() }}
                      placeholder="O que você precisa? Ex.: editar vídeos, Notion, pesquisa web…"
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/5 border border-white/5 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-500/40"
                    />
                  </div>
                  <button onClick={() => void discover()} disabled={busy === 'discover'}
                    className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
                    {busy === 'discover' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Pesquisar
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-white/45">
                  {(['skill', 'mcp', 'tool'] as const).map(k => (
                    <label key={k} className="flex items-center gap-1">
                      <input type="checkbox" checked={kinds.includes(k)} onChange={e => setKinds(prev => e.target.checked ? [...new Set([...prev, k])] : prev.filter(x => x !== k))} />
                      {KIND_LABEL[k]}
                    </label>
                  ))}
                  <span className="text-white/20">·</span>
                  <span>GitHub, registro oficial MCP e npm, ao vivo</span>
                </div>
              </Card>

              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2 flex items-center gap-1.5"><FolderGit2 size={12} /> Instalar de uma origem específica</div>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void inspectSource() }}
                    placeholder="URL do GitHub, owner/repo, pacote npm, npx …, URL de MCP ou pasta local"
                    className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-500/40"
                  />
                  <button onClick={() => void inspectSource()} disabled={busy === 'inspect-source'}
                    className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs flex items-center gap-1.5 disabled:opacity-40">
                    {busy === 'inspect-source' ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Analisar antes de instalar
                  </button>
                </div>
              </Card>

              {results && (
                <div className="space-y-2">
                  <div className="text-[11px] text-white/35">
                    {results.candidates.length} resultado(s) para “{query}”.
                    {results.errors.length > 0 && <span className="text-amber-300/70"> Falhas: {results.errors.join('; ')}</span>}
                  </div>
                  {results.candidates.map(c => (
                    <CandidateRow key={c.id} candidate={c} busy={busy === `inspect:${c.id}`} onAnalyze={() => void inspectCandidate(c)} />
                  ))}
                  {!results.candidates.length && (
                    <Card className="p-6 text-center">
                      <div className="text-sm text-white/55">Nada adequado encontrado.</div>
                      <div className="text-xs text-white/30 mt-1">Crie uma Skill própria — o JARVIS escreve, testa e instala com análise de segurança.</div>
                      <button onClick={() => setTab('improve')} className="mt-3 px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-xs inline-flex items-center gap-1">
                        <Sparkles size={12} /> Criar Skill
                      </button>
                    </Card>
                  )}
                </div>
              )}

              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2 flex items-center gap-1.5"><Sparkles size={12} /> Autodesenvolvimento</div>
                <div className="flex gap-2">
                  <input
                    value={need}
                    onChange={e => setNeed(e.target.value)}
                    placeholder="Descreva a Skill que falta (ex.: organizar minhas tarefas acadêmicas no Moodle)"
                    className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-purple-500/40"
                  />
                  <button onClick={() => void withBusy('create', async () => {
                    if (!need.trim()) return
                    await startJob('create', { need: need.trim() })
                    setNeed('')
                  })} disabled={busy === 'create'}
                    className="px-3 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
                    <Sparkles size={12} /> Criar
                  </button>
                </div>
                <div className="text-[10px] text-white/25 mt-1.5">A equipe de agentes escreve, testa e instala a Skill pelo mesmo pipeline de segurança.</div>
              </Card>
            </div>
          ) : tab === 'approvals' ? (
            <div className="space-y-3">
              {!pending.length && (
                <Card className="p-8 text-center text-sm text-white/50">
                  <Shield size={26} className="mx-auto text-white/15 mb-2" /> Nenhuma aprovação pendente.
                </Card>
              )}
              {pending.map(a => (
                <Card key={a.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{a.candidate.name}</span>
                    <Badge className="bg-white/5 text-white/40 border-white/5">{a.candidate.kind}</Badge>
                    {a.risk && <Badge className={RISK_STYLE[a.risk.level]}>{RISK_LABEL[a.risk.level]}</Badge>}
                    <span className="text-[10px] text-white/25">pedido por {a.requestedBy} · {timeAgo(a.createdAt)}</span>
                  </div>
                  <div className="text-xs text-amber-300/80 mt-1">{a.reason}</div>
                  <div className="text-[10px] text-white/25 mt-1">{a.candidate.source.type}:{a.candidate.source.ref}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    <input
                      value={grantDraft[a.id] || ''}
                      onChange={e => setGrantDraft(d => ({ ...d, [a.id]: e.target.value }))}
                      placeholder="Credenciais a liberar (opcional, ex.: NOTION_TOKEN)"
                      className="flex-1 min-w-[220px] px-2 py-1.5 rounded bg-white/5 border border-white/5 text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30"
                    />
                    <button onClick={() => void decideApproval(a, true)} disabled={busy === `approval:${a.id}`}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs flex items-center gap-1 disabled:opacity-40">
                      {busy === `approval:${a.id}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Aprovar e instalar
                    </button>
                    <button onClick={() => void decideApproval(a, false)} disabled={busy === `approval:${a.id}`}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/55 text-xs flex items-center gap-1 disabled:opacity-40">
                      <XCircle size={12} /> Recusar
                    </button>
                  </div>
                </Card>
              ))}

              <div className="pt-2">
                <div className="text-[11px] text-white/35 mb-2">Decididas recentemente</div>
                <div className="space-y-1.5">
                  {(catalog?.approvals || []).filter(a => a.status !== 'pending').slice(0, 12).map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-[11px] text-white/35 px-2">
                      {a.status === 'approved' ? <CheckCircle2 size={11} className="text-emerald-300/70" /> : <XCircle size={11} className="text-red-300/70" />}
                      <span className="text-white/55">{a.candidate.name}</span>
                      <span>{a.status === 'approved' ? 'aprovada' : 'recusada'}</span>
                      <span>· {timeAgo(a.decidedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : tab === 'activity' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <ActionButton icon={RefreshCw} label="Verificar atualizações" busy={busy === 'check'} onClick={() => void withBusy('check', async () => {
                  const data = await post('check-updates')
                  toast.info(data.found ? `${data.found} atualização(ões) disponível(is)` : 'Tudo atualizado')
                  await load()
                })} />
                <ActionButton icon={Download} label="Atualizar tudo" onClick={() => void startJob('update-all')} />
                <ActionButton icon={CheckCircle2} label="Testar tudo" onClick={() => void startJob('test-all')} />
                <ActionButton icon={Activity} label="Verificação completa" onClick={() => void startJob('self-check')} />
                <ActionButton icon={Lightbulb} label="Pesquisar melhorias" onClick={() => void startJob('optimize')} />
              </div>

              {catalog?.conflicts.length ? (
                <Card className="p-3">
                  <div className="text-[11px] text-amber-300 mb-1.5 flex items-center gap-1"><AlertTriangle size={12} /> Conflitos</div>
                  {catalog.conflicts.map((c, i) => <div key={i} className="text-[11px] text-white/45">{c.message}</div>)}
                </Card>
              ) : null}

              <div>
                <div className="text-[11px] text-white/35 mb-2">Tarefas do engine</div>
                <div className="space-y-1.5">
                  {(catalog?.jobs || []).length === 0 && <div className="text-xs text-white/25 px-1">Nenhuma tarefa nesta sessão.</div>}
                  {(catalog?.jobs || []).map(j => (
                    <button key={j.id} onClick={async () => {
                      const data = await fetch(`/api/engine?action=job&id=${j.id}`, { cache: 'no-store' }).then(r => r.json())
                      if (data.job) setJob(data.job)
                    }} className="w-full flex items-center gap-2 text-[11px] text-white/45 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left">
                      {j.status === 'done' ? <CheckCircle2 size={12} className="text-emerald-300/70" /> : j.status === 'failed' ? <XCircle size={12} className="text-red-300/70" /> : <Loader2 size={12} className="animate-spin text-cyan-300/70" />}
                      <span className="text-white/65">{j.title}</span>
                      <span className="text-white/25">{timeAgo(j.startedAt)}</span>
                      <span className="ml-auto text-white/20">ver log</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-white/35 mb-2">Histórico de operações</div>
                <div className="space-y-1">
                  {history.length === 0 && <div className="text-xs text-white/25 px-1">Nada registrado ainda.</div>}
                  {history.slice(0, 120).map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] px-2 py-1 rounded hover:bg-white/[0.02]">
                      <span className={h.ok ? 'text-emerald-300/70' : 'text-red-300/70'}>{h.ok ? '✓' : '✗'}</span>
                      <span className="text-white/25 w-[110px] shrink-0">{new Date(h.at).toLocaleString('pt-BR')}</span>
                      <span className="text-cyan-300/60 w-[70px] shrink-0">{h.action}</span>
                      <span className="text-white/45 flex-1 break-words">{h.name ? <b className="text-white/60">{h.name}</b> : null} {h.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : tab === 'improve' ? (
            <div className="space-y-4">
              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2 flex items-center gap-1.5"><Lightbulb size={12} /> Oportunidades abertas</div>
                {!openOpportunities.length && <div className="text-xs text-white/30">Nenhuma necessidade registrada. Quando uma ferramenta faltar, ela aparece aqui.</div>}
                <div className="space-y-2">
                  {openOpportunities.map(o => (
                    <div key={o.id} className="rounded-lg border border-white/5 p-2.5">
                      <div className="text-xs text-white/70">{o.need}</div>
                      <div className="text-[10px] text-white/25 mt-0.5">origem: {o.source} · {timeAgo(o.at)}{o.optimizedAt ? ` · pesquisada ${timeAgo(o.optimizedAt)}` : ''}</div>
                      {o.suggestions?.length ? (
                        <div className="mt-1.5 space-y-1">
                          {o.suggestions.map(s => (
                            <button key={s.id} onClick={() => void inspectCandidate({
                              id: s.id, name: s.name, description: '', kind: s.kind, source: s.source,
                              stars: s.stars, license: s.license, installed: false, score: s.score,
                            })} className="w-full text-left text-[11px] text-cyan-300/80 hover:text-cyan-200 flex items-center gap-1.5">
                              <Download size={10} /> {s.name} <span className="text-white/25">({s.kind}{s.stars ? `, ⭐ ${s.stars}` : ''})</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-white/25 mt-1">Sem sugestões ainda — use “Pesquisar melhorias”.</div>
                      )}
                      <button onClick={() => void withBusy(`dismiss:${o.id}`, async () => {
                        await post('dismiss-opportunity', { id: o.id })
                        await load()
                      })} className="mt-1.5 text-[10px] text-white/25 hover:text-white/50">dispensar</button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2 flex items-center gap-1.5"><Sparkles size={12} /> Criar uma Skill própria</div>
                <textarea
                  value={need}
                  onChange={e => setNeed(e.target.value)}
                  rows={3}
                  placeholder="Descreva a necessidade com exemplos de entrada e saída. A Skill será criada, testada e analisada antes de entrar no catálogo."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-purple-500/40 resize-y"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => void withBusy('create', async () => {
                    if (!need.trim()) return
                    await startJob('create', { need: need.trim() })
                    setNeed('')
                    setTab('activity')
                  })} disabled={busy === 'create'}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
                    <Sparkles size={12} /> Criar com a equipe
                  </button>
                  <button onClick={() => void startJob('optimize')} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/55 text-xs flex items-center gap-1.5">
                    <Search size={12} /> Buscar alternativas nas oportunidades
                  </button>
                </div>
              </Card>
            </div>
          ) : (
            <div className="space-y-4">
              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2">Autonomia</div>
                <div className="grid md:grid-cols-3 gap-2">
                  {([
                    { id: 'manual', title: 'Manual', desc: 'Toda instalação precisa da sua aprovação.' },
                    { id: 'assisted', title: 'Assistida (recomendada)', desc: 'Instala sozinho o que é de risco baixo e não usa credenciais; o resto pede aprovação.' },
                    { id: 'autonomous', title: 'Autônoma', desc: 'Também atualiza sozinho. Risco, credenciais e MCP remoto continuam pedindo aprovação.' },
                  ] as const).map(o => (
                    <button key={o.id} onClick={() => void withBusy('settings', async () => {
                      await post('settings', { settings: { autonomy: o.id } })
                      toast.success(`Autonomia: ${o.title}`)
                      await load()
                    })} className={`text-left rounded-xl border p-3 transition-all ${catalog?.settings.autonomy === o.id ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5 hover:border-white/15'}`}>
                      <div className="text-xs font-medium text-white/80">{o.title}</div>
                      <div className="text-[10px] text-white/35 mt-1 leading-relaxed">{o.desc}</div>
                    </button>
                  ))}
                </div>
              </Card>

              <Card className="p-3 space-y-2">
                <Toggle
                  label="Criar Skills automaticamente"
                  desc="Quando nenhuma solução pública serve, a equipe de agentes escreve e testa uma Skill própria."
                  checked={!!catalog?.settings.autoCreate}
                  onChange={v => void withBusy('settings', async () => {
                    await post('settings', { settings: { autoCreate: v } })
                    await load()
                  })}
                />
                <Toggle
                  label="Atualizações automáticas"
                  desc="Aplica atualizações de baixo risco quando o verificador periódico encontra uma versão nova."
                  checked={!!catalog?.settings.autoUpdate}
                  onChange={v => void withBusy('settings', async () => {
                    await post('settings', { settings: { autoUpdate: v } })
                    await load()
                  })}
                />
                <Toggle
                  label="Otimização contínua"
                  desc="Pesquisa alternativas para necessidades em aberto e propõe. Nunca instala sozinha."
                  checked={!!catalog?.settings.autoOptimize}
                  onChange={v => void withBusy('settings', async () => {
                    await post('settings', { settings: { autoOptimize: v } })
                    await load()
                  })}
                />
              </Card>

              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2 flex items-center gap-1.5"><Shield size={12} /> Segurança</div>
                <ul className="text-[11px] text-white/40 space-y-1 list-disc pl-4">
                  <li>Todo pacote é baixado em quarentena, analisado estaticamente e testado antes de entrar no catálogo.</li>
                  <li>Risco crítico é bloqueado. Risco médio/alto, credenciais e MCP remoto pedem sua aprovação.</li>
                  <li>Credenciais nunca são copiadas: a extensão recebe só as variáveis liberadas, por nome.</li>
                  <li>Atualizações mantêm backup e voltam automaticamente se o teste da nova versão falhar.</li>
                  <li>Logs são redigidos; permissões e uso por papel de agente ficam registrados.</li>
                </ul>
                <div className="text-[10px] text-white/25 mt-2">
                  Última verificação de atualizações: {timeAgo(catalog?.settings.lastUpdateCheck)} · último autodiagnóstico: {timeAgo(catalog?.settings.lastSelfCheck)}
                </div>
              </Card>

              <Card className="p-3">
                <div className="text-[11px] text-white/45 mb-2">Servidores MCP em execução</div>
                <div className="text-xs text-white/40">
                  {catalog?.running.length ? catalog.running.map(id => catalog.extensions.find(e => e.id === id)?.name || id).join(', ') : 'Nenhum servidor ativo agora.'}
                </div>
              </Card>
            </div>
          )}
        </div>

        {jobPanel}

        {/* Inspect modal */}
        {inspected && (
          <div className="absolute inset-0 bg-black/[.78] flex items-center justify-center p-4 z-10" onClick={() => setInspected(null)}>
            <div className="glass rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{inspected.name}</div>
                  <div className="text-[11px] text-white/35 mt-0.5">
                    {inspected.kind} · v{inspected.version} · {inspected.candidate.source.type}:{inspected.candidate.source.ref}
                  </div>
                </div>
                <button onClick={() => setInspected(null)} className="p-1 rounded hover:bg-white/5"><X size={16} className="text-white/40" /></button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge className={RISK_STYLE[inspected.risk.level]}>{RISK_LABEL[inspected.risk.level]}</Badge>
                <Badge className={inspected.decision.action === 'install' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : inspected.decision.action === 'block' ? 'bg-red-500/10 text-red-300 border-red-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'}>
                  {inspected.decision.action === 'install' ? 'pode instalar direto' : inspected.decision.action === 'block' ? 'bloqueada pela política' : 'precisa de aprovação'}
                </Badge>
                <span className="text-[10px] text-white/30">{inspected.tools} ferramenta(s) · {inspected.risk.files} arquivo(s)</span>
              </div>
              {inspected.decision.reason && <div className="text-[11px] text-amber-300/80 mt-2">{inspected.decision.reason}</div>}
              {inspected.requires && <div className="text-[11px] text-amber-300/80 mt-1">Requer: {inspected.requires}</div>}

              <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">Alertas da análise</div>
                {!inspected.risk.findings.length && <div className="text-[11px] text-emerald-300/70">Nenhum alerta.</div>}
                {inspected.risk.findings.map((f, i) => (
                  <div key={i} className="text-[11px] text-white/45">
                    <span className={f.severity === 'critical' ? 'text-red-400' : f.severity === 'high' ? 'text-orange-300' : f.severity === 'medium' ? 'text-amber-300' : 'text-white/25'}>[{f.severity}]</span>{' '}
                    {f.message}{f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                <span className="flex items-center gap-1"><Globe size={11} /> rede: {inspected.risk.inferred.network ? 'sim' : 'não'}</span>
                <span className="flex items-center gap-1"><Terminal size={11} /> comandos: {inspected.risk.inferred.shell ? 'sim' : 'não'}</span>
                <span className="flex items-center gap-1"><Save size={11} /> grava arquivos: {inspected.risk.inferred.fsWrite ? 'sim' : 'não'}</span>
                {inspected.risk.inferred.envVars.length > 0 && <span className="flex items-center gap-1"><KeyRound size={11} /> credenciais: {inspected.risk.inferred.envVars.join(', ')}</span>}
              </div>

              <div className="flex items-center justify-end gap-2 mt-4">
                <button onClick={() => setInspected(null)} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/55 text-xs">Cancelar</button>
                <button onClick={() => void installInspected(inspected.risk.inferred.envVars.filter(n => /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i.test(n)))} disabled={busy === 'install' || inspected.decision.action === 'block'}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
                  {busy === 'install' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Instalar
                </button>
              </div>
              <div className="text-[10px] text-white/20 mt-1.5 text-right">
                Nada é executado durante a análise. A instalação passa por testes funcionais.
              </div>
            </div>
          </div>
        )}

        {/* Tool runner */}
        {runTool && (
          <div className="absolute inset-0 bg-black/[.78] flex items-center justify-center p-4 z-10" onClick={() => setRunTool(null)}>
            <div className="glass rounded-xl w-full max-w-lg p-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{runTool.ext.name}</div>
                <button onClick={() => setRunTool(null)} className="p-1 rounded hover:bg-white/5"><X size={15} className="text-white/40" /></button>
              </div>
              <div className="mt-2 space-y-2">
                <select
                  value={runTool.tool}
                  onChange={e => setRunTool({ ...runTool, tool: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none"
                >
                  <option value="">Escolha a ferramenta…</option>
                  {runTool.ext.tools.map(t => <option key={t.name} value={t.name} className="bg-[#0b1118]">{t.name} — {t.description}</option>)}
                </select>
                {runTool.ext.tools.find(t => t.name === runTool.tool)?.inputSchema && (
                  <div className="text-[10px] text-white/25 font-mono break-all">
                    {JSON.stringify(runTool.ext.tools.find(t => t.name === runTool.tool)?.inputSchema)}
                  </div>
                )}
                <textarea
                  value={runTool.args}
                  onChange={e => setRunTool({ ...runTool, args: e.target.value })}
                  rows={5}
                  placeholder='{"arg": "valor"}'
                  className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs font-mono text-white/80 focus:outline-none focus:border-cyan-500/40"
                />
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setRunTool(null)} className="px-3 py-1.5 rounded-lg bg-white/5 text-white/55 text-xs">Cancelar</button>
                <button onClick={() => void callTool()} disabled={!runTool.tool || busy === 'call'}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
                  {busy === 'call' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Executar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Markdown/text reader */}
        {(readContent || output) && (
          <div className="absolute inset-0 bg-black/[.78] flex items-center justify-center p-4 z-10" onClick={() => { setReadContent(null); setOutput(null) }}>
            <div className="glass rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-3 border-b border-white/5">
                <div className="text-sm font-semibold text-white truncate">{(readContent || output)!.title}</div>
                <button onClick={() => { setReadContent(null); setOutput(null) }} className="p-1 rounded hover:bg-white/5"><X size={16} className="text-white/40" /></button>
              </div>
              <pre className="p-3 overflow-auto text-[11px] text-white/60 whitespace-pre-wrap break-words flex-1">
                {(readContent || output)!.content}
              </pre>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function ActionButton({ icon: Icon, label, onClick, busy, danger }: {
  icon: typeof Package
  label: string
  onClick: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`px-2 py-1 rounded-lg text-[11px] flex items-center gap-1 transition-colors disabled:opacity-40 ${danger ? 'bg-red-500/10 hover:bg-red-500/20 text-red-300' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />} {label}
    </button>
  )
}

function CandidateRow({ candidate, busy, onAnalyze }: { candidate: Candidate; busy: boolean; onAnalyze: () => void }) {
  const meta = [candidate.stars ? `⭐ ${candidate.stars}` : '', candidate.license ? candidate.license : '', candidate.installed ? 'já instalada' : ''].filter(Boolean).join(' · ')
  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{candidate.name}</span>
            <Badge className="bg-white/5 text-white/40 border-white/5">{candidate.kind}</Badge>
            {meta && <span className="text-[10px] text-white/30">{meta}</span>}
          </div>
          <div className="text-xs text-white/40 mt-0.5 line-clamp-2">{candidate.description || candidate.source.ref}</div>
          <div className="text-[10px] text-white/20 mt-1">{candidate.source.type}:{candidate.source.ref}{candidate.source.subPath ? `#${candidate.source.subPath}` : ''}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {candidate.homepage && (
            <a href={candidate.homepage} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10" title="Abrir origem">
              <Globe size={13} className="text-white/45" />
            </a>
          )}
          <button onClick={onAnalyze} disabled={busy || candidate.installed}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] flex items-center gap-1 disabled:opacity-40">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Shield size={11} />} Analisar
          </button>
        </div>
      </div>
    </Card>
  )
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs text-white/75">{label}</div>
        <div className="text-[10px] text-white/30 mt-0.5 leading-relaxed">{desc}</div>
      </div>
      <button onClick={() => onChange(!checked)} className={`w-9 h-5 rounded-full transition-all relative shrink-0 mt-0.5 ${checked ? 'bg-cyan-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
