'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Cpu, Download, HardDrive, KeyRound, RefreshCw, Search, X, Zap } from 'lucide-react'
import type { Provider } from '@/types'

interface LocalModel {
  id: string
  name: string
  params: string
  sizeGB: number
  category: string
  description: string
  useFor: string
  contextWindow: number
  toolSupport: boolean
  minRamGB: number
  recommendedVramGB: number
  installed: boolean
  fitsGpu: boolean
  pulling?: { percent: number; detail: string }
  lastPull?: { status: 'running' | 'done' | 'error'; percent: number; detail: string; error?: string }
}

interface LocalData {
  ollama: boolean
  hardware: { ramGB: number; cpu: string; cores: number; gpu: string | null; vramGB: number | null }
  installed: Array<{ id: string; sizeGB: number; params: string }>
  models: LocalModel[]
}

export default function ModelManagerModal({
  onClose,
  onSelect,
  onOpenKeys,
  currentModel,
}: {
  onClose: () => void
  onSelect: (id: string) => void
  onOpenKeys: () => void
  currentModel: string
}) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'free' | 'connected'>('free')
  const [tab, setTab] = useState<'cloud' | 'local'>('cloud')
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [testing, setTesting] = useState('')
  const [local, setLocal] = useState<LocalData | null>(null)
  const [localLoading, setLocalLoading] = useState(true)
  // Latência medida nesta máquina (teste de modelo), por id de modelo
  const [tested, setTested] = useState<Record<string, { ok: boolean; ms?: number; at: number }>>({})

  const loadCloud = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      const d = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`).then(r => r.json())
      setProviders(d.providers || [])
      setTested(d.tests || {})
    } catch {
      setProviders([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadLocal = useCallback(async () => {
    try {
      const d = await fetch('/api/models/local').then(r => r.json())
      setLocal(d)
    } catch {
      setLocal(null)
    } finally {
      setLocalLoading(false)
    }
  }, [])

  useEffect(() => { loadCloud() }, [loadCloud])

  // Enquanto a aba local está aberta, acompanha o progresso do download
  useEffect(() => {
    if (tab !== 'local') return
    loadLocal()
    const timer = setInterval(loadLocal, 2500)
    return () => clearInterval(timer)
  }, [tab, loadLocal])

  const allModels = providers.flatMap(p =>
    p.models.map(m => ({ ...m, providerStatus: p.status }))
  )

  const filtered = allModels.filter(m => {
    const matchSearch = search === '' ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.providerName.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ||
      (filter === 'free' && m.free) ||
      (filter === 'connected' && m.providerStatus === 'connected')
    return matchSearch && matchFilter
  })

  const categoryIcons: Record<string, string> = {
    fast: '⚡', chat: '💬', code: '💻', reasoning: '🧠',
    vision: '👁️', local: '🦙', search: '🔍',
  }

  const testModel = async (id: string) => {
    setTesting(id)
    try {
      const d = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: id, provider: id.split('|')[0] }),
      }).then(r => r.json())
      setTests(prev => ({
        ...prev,
        [id]: d.success
          ? { ok: true, message: `${(d.latencyMs / 1000).toFixed(1)}s · ${String(d.reply || '').trim().slice(0, 80)}` }
          : { ok: false, message: String(d.error || 'Falhou').slice(0, 180) },
      }))
    } catch {
      setTests(prev => ({ ...prev, [id]: { ok: false, message: 'Falha de conexão com o JARVIS' } }))
    } finally {
      setTesting('')
    }
  }

  const installLocal = async (id: string) => {
    try {
      await fetch('/api/models/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id }),
      })
      await loadLocal()
    } catch {}
  }

  const hw = local?.hardware

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
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0, transition: { duration: 0 } }}
        className="glass modal-pop rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold jarvis-title">MODELOS DISPONÍVEIS</h2>
              <p className="text-xs text-white/40 mt-0.5">
                {allModels.filter(m => m.free).length} modelos gratuitos · {local?.installed.length || 0} locais instalados
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadCloud(true)}
                disabled={refreshing}
                title="Atualizar catálogo"
                className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-40 transition-colors"
              >
                <RefreshCw size={16} className={`text-white/50 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => { onClose(); onOpenKeys() }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
              >
                <KeyRound size={12} /> Chaves de API
              </button>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                <X size={18} className="text-white/50" />
              </button>
            </div>
          </div>

          <div className="flex gap-1 p-1 bg-white/5 rounded-xl w-fit mb-4">
            {(['cloud', 'local'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-xs transition-all ${tab === t ? 'bg-cyan-500/20 text-cyan-300' : 'text-white/40 hover:text-white/70'}`}
              >
                {t === 'cloud' ? 'Nuvem grátis' : 'Locais (Ollama)'}
              </button>
            ))}
          </div>

          {tab === 'cloud' && (
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  className="input-jarvis w-full pl-9 pr-4 py-2 rounded-xl text-sm"
                  placeholder="Buscar modelo..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
                {(['free', 'connected', 'all'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs transition-all ${filter === f ? 'bg-cyan-500/20 text-cyan-300' : 'text-white/40 hover:text-white/70'}`}
                  >
                    {f === 'free' ? 'Gratuitos' : f === 'connected' ? 'Conectados' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Models list */}
        <div className="overflow-y-auto flex-1 p-4">
          {tab === 'cloud' ? (
            loading ? (
              <div className="space-y-2 p-1" aria-label="Carregando catálogo de modelos">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-white/5">
                    <div className="skeleton-line w-9 h-9 !rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton-line h-3" style={{ width: `${62 - i * 6}%` }} />
                      <div className="skeleton-line h-2.5" style={{ width: `${38 - i * 4}%` }} />
                    </div>
                    <div className="skeleton-line w-16 h-6 !rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 mo-stagger">
                {filtered.map(m => {
                  const result = tests[m.id]
                  return (
                    <div
                      key={m.id}
                      className={`mo-spot w-full p-4 rounded-xl border transition-all ${
                        currentModel === m.id
                          ? 'border-cyan-500/40 bg-cyan-500/[.08]'
                          : 'border-white/5 bg-white/[.02] hover:border-white/10 hover:bg-white/[.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <button
                          onClick={() => { onSelect(m.id); onClose() }}
                          className="flex items-center gap-3 text-left flex-1 min-w-0"
                        >
                          <span className="text-xl">{categoryIcons[m.category] || '🤖'}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white truncate">{m.name}</span>
                              {currentModel === m.id && <Check size={12} className="text-cyan-400 flex-shrink-0" />}
                              {m.free && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300">FREE</span>}
                              {tested[m.id]?.ms != null && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300/80 font-mono border border-emerald-500/20" title="Latência medida no teste desta máquina">
                                  ⚡{tested[m.id].ms}ms
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-white/40 mt-0.5 truncate">{m.providerName} · {m.id.slice(m.id.indexOf('|') + 1)}</div>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => testModel(m.id)}
                            disabled={!!testing}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-40 transition-colors"
                          >
                            {testing === m.id ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />} Testar
                          </button>
                          <div className="text-xs text-white/30 text-right hidden sm:block">
                            <div>{m.contextWindow >= 1_000_000 ? `${(m.contextWindow / 1_000_000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}k`} ctx</div>
                            <div className={`${m.speed === 'fast' ? 'text-green-400' : m.speed === 'slow' ? 'text-yellow-400' : 'text-white/40'}`}>
                              {m.speed === 'fast' ? '⚡ rápido' : m.speed === 'slow' ? '🐢 lento' : '🔄 médio'}
                            </div>
                          </div>
                          <div className={`w-2 h-2 rounded-full ${m.providerStatus === 'connected' ? 'bg-green-400' : 'bg-gray-500'}`} />
                        </div>
                      </div>
                      {result && (
                        <p className={`text-xs mt-2 ml-9 break-words ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                          {result.ok ? '✓' : '✗'} {result.message}
                        </p>
                      )}
                      {m.description && (
                        <p className="text-xs text-white/30 mt-1.5 ml-9">{m.description}</p>
                      )}
                      {m.note && (
                        <p className="text-xs text-yellow-500/50 mt-1 ml-9">⚠️ {m.note}</p>
                      )}
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div className="text-center py-16 text-white/30 text-sm">
                    {allModels.length === 0 ? 'Nenhuma IA gratuita conectada ainda' : 'Nenhum modelo encontrado'}
                    {allModels.length === 0 && (
                      <button
                        onClick={() => { onClose(); onOpenKeys() }}
                        className="mt-4 mx-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 border border-cyan-500/30 transition-colors"
                      >
                        <KeyRound size={14} /> Configurar chaves de API
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-3">
              {hw && (
                <div className="p-4 rounded-xl border border-cyan-500/15 bg-cyan-500/[.04] flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/50">
                  <span className="flex items-center gap-1.5"><Cpu size={13} className="text-cyan-300" /> {hw.cpu} · {hw.cores} threads</span>
                  <span className="flex items-center gap-1.5"><HardDrive size={13} className="text-cyan-300" /> {hw.ramGB} GB RAM</span>
                  <span className="flex items-center gap-1.5">🎮 {hw.gpu || 'GPU não detectada'}{hw.vramGB ? ` · ${hw.vramGB} GB VRAM` : ''}</span>
                </div>
              )}
              {!local?.ollama && !localLoading && (
                <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/[.05] text-xs text-yellow-200/80">
                  Ollama não respondeu em localhost:11434. Abra o Ollama e volte para esta aba para instalar ou usar modelos locais.
                </div>
              )}
              {localLoading && (
                <div className="flex items-center justify-center py-10 text-white/30 text-sm">
                  <RefreshCw size={16} className="animate-spin mr-2" /> Lendo modelos locais...
                </div>
              )}
              {(local?.models || []).map(m => {
                const pulling = m.pulling
                const failed = m.lastPull?.status === 'error'
                return (
                  <div key={m.id} className="mo-spot p-4 rounded-xl border border-white/5 bg-white/[.02] hover:border-white/10 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white">{m.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">{m.params}</span>
                          <span className="text-[10px] text-white/30">~{m.sizeGB} GB</span>
                          {m.installed && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300">INSTALADO</span>}
                          {!m.fitsGpu && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-300/70">divide GPU/CPU</span>}
                          {currentModel === `ollama|${m.id}` && <Check size={12} className="text-cyan-400" />}
                        </div>
                        <p className="text-xs text-white/40 mt-1">{m.description}</p>
                        <p className="text-[11px] text-white/25 mt-1">Ideal para: {m.useFor}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {m.installed ? (
                          <>
                            <button
                              onClick={() => { onSelect(`ollama|${m.id}`); onClose() }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 border border-cyan-500/25 transition-colors"
                            >
                              <Check size={12} /> Usar
                            </button>
                            <button
                              onClick={() => testModel(`ollama|${m.id}`)}
                              disabled={!!testing}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-40 transition-colors"
                            >
                              {testing === `ollama|${m.id}` ? <RefreshCw size={10} className="animate-spin" /> : <Zap size={10} />} Testar
                            </button>
                          </>
                        ) : pulling ? (
                          <span className="text-xs text-cyan-300">{pulling.percent}%</span>
                        ) : (
                          <button
                            onClick={() => installLocal(m.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 transition-colors"
                          >
                            <Download size={12} /> Baixar
                          </button>
                        )}
                      </div>
                    </div>
                    {pulling && (
                      <div className="mt-3">
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full bg-cyan-400/70 transition-all" style={{ width: `${pulling.percent}%` }} />
                        </div>
                        <p className="text-[11px] text-white/30 mt-1">{pulling.detail} · {pulling.percent}%</p>
                      </div>
                    )}
                    {failed && (
                      <p className="text-[11px] text-red-400 mt-2">✗ {m.lastPull?.error || 'Falha no download'}</p>
                    )}
                    {tests[`ollama|${m.id}`] && (
                      <p className={`text-[11px] mt-2 ${tests[`ollama|${m.id}`].ok ? 'text-green-400' : 'text-red-400'}`}>
                        {tests[`ollama|${m.id}`].ok ? '✓' : '✗'} {tests[`ollama|${m.id}`].message}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
