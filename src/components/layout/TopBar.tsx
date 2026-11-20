'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Command, Loader2, PanelLeft, PanelRight, Sparkles, Zap } from 'lucide-react'
import { shortModelName, type StreamStatus } from '@/lib/ai/status'

const PROVIDER_ICONS: Record<string, string> = {
  gemini: '◆', groq: '⚡', openrouter: '⇄', cerebras: '◇',
  ollama: '▣', sambanova: '▲', nvidia: '▰', mistral: '◈',
  huggingface: '◉', lmstudio: '▤', custom: '⧉', anthropic: '◐',
}

function providerIcon(modelId: string) {
  if (!modelId) return '·'
  const provider = modelId.includes('|') ? modelId.split('|')[0] : modelId.startsWith('gemini') ? 'gemini' : 'ollama'
  return PROVIDER_ICONS[provider] || '·'
}

/** Barra de operações: contexto, modo, modelo ativo e estado real da geração. */
export default function TopBar({
  title,
  sidebarOpen,
  onToggleSidebar,
  agentMode,
  onToggleAgentMode,
  currentModel,
  autoModel,
  onOpenModels,
  onToggleAuto,
  connected,
  onOpenPalette,
  rightPanelOpen,
  onToggleRightPanel,
  streaming,
  status,
  clock,
}: {
  title: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  agentMode: boolean
  onToggleAgentMode: () => void
  currentModel: string
  autoModel: boolean
  onOpenModels: () => void
  onToggleAuto: () => void
  connected: number | null
  onOpenPalette: () => void
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  streaming: boolean
  status?: StreamStatus | null
  clock?: string
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!streaming) { setElapsed(0); return }
    const started = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [streaming])

  const phase = status?.phase === 'retry'
    ? `tentando de novo (${status.attempt ?? 1})`
    : status?.phase === 'fallback'
      ? 'trocando de modelo'
      : status?.phase === 'connecting'
        ? 'conectando'
        : 'gerando'

  return (
    <div className="topbar">
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Esconder conversas' : 'Mostrar conversas'}
        aria-label="Alternar barra de conversas"
        className="icon-btn"
      >
        <PanelLeft size={15} className={sidebarOpen ? 'text-white/60' : 'text-white/30'} />
      </motion.button>

      <div className="min-w-0 flex-1">
        <div className="micro-label">Operações</div>
        <div className="truncate text-[12.5px] font-medium text-white/80 leading-tight" title={title}>{title}</div>
      </div>

      <button onClick={onOpenPalette} className="palette-trigger" title="Central de comandos (Ctrl+K)">
        <Command size={12} className="text-white/35" />
        <span className="hidden md:inline">Comandos</span>
        <kbd className="kbd hidden md:inline-flex">Ctrl K</kbd>
      </button>

      <div className="topbar-sep" />

      <div className="segmented" role="group" aria-label="Modo de operação">
        <button
          onClick={() => !agentMode && onToggleAgentMode()}
          title="O JARVIS executa: arquivos, comandos, infraestrutura"
          className={`segmented-item ${agentMode ? 'is-on' : ''}`}
        >
          <Zap size={10} /> Agente
        </button>
        <button
          onClick={() => agentMode && onToggleAgentMode()}
          title="Só conversa, sem executar nada"
          className={`segmented-item ${!agentMode ? 'is-neutral' : ''}`}
        >
          Chat
        </button>
      </div>

      <div className="model-pill">
        <button onClick={onOpenModels} title="Escolher modelo" className="model-pill-main">
          <span className="model-glyph">{autoModel ? <Sparkles size={11} /> : providerIcon(currentModel)}</span>
          <span className="max-w-[170px] truncate font-mono text-[11px]">{autoModel ? 'Automático' : shortModelName(currentModel)}</span>
          <ChevronDown size={10} className="text-white/30" />
        </button>
        <button
          onClick={onToggleAuto}
          title={autoModel ? 'Melhor IA automática por tarefa: ligada' : 'Melhor IA automática por tarefa: desligada'}
          aria-pressed={autoModel}
          className={`model-pill-auto ${autoModel ? 'is-on' : ''}`}
        >
          <Sparkles size={11} />
        </button>
      </div>

      {streaming ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 440, damping: 28 }}
          className="live-badge"
          title={status?.message || phase}
        >
          <span className="live-dot" />
          <span className="hidden sm:inline">{phase}</span>
          <span className="font-mono tabular-nums">{elapsed}s</span>
          {elapsed > 6 && !status && <Loader2 size={10} className="animate-spin opacity-60" />}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 440, damping: 28 }}
          className={`conn-badge ${connected === null ? 'is-wait' : connected === 0 ? 'is-off' : 'is-on'}`}
          title={connected === null ? 'Verificando provedores' : `${connected} provedor(es) conectado(s)`}
        >
          <span className={`status-dot ${connected === null ? 'loading' : connected === 0 ? 'offline' : 'online'}`} />
          <span className="hidden sm:inline">{connected === null ? 'verificando' : connected === 0 ? 'sem conexão' : `${connected} conectado${connected > 1 ? 's' : ''}`}</span>
        </motion.div>
      )}

      {clock && <span className="nav-clock hidden xl:inline" aria-hidden>{clock}</span>}

      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onToggleRightPanel}
        title={rightPanelOpen ? 'Esconder terminal e arquivos' : 'Mostrar terminal e arquivos'}
        aria-label="Alternar painel de terminal e arquivos"
        className="icon-btn"
      >
        <PanelRight size={15} className={rightPanelOpen ? 'text-white/60' : 'text-white/30'} />
      </motion.button>
    </div>
  )
}
