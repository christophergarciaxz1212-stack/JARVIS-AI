'use client'

import { Zap, Circle, ChevronRight } from 'lucide-react'
import { shortModelName } from '@/lib/ai/status'
import pkg from '../../../package.json'

/**
 * Barra de status inferior: o que está acontecendo AINDA importa quando o chat está vazio.
 * Dados reais (não decorativos): estado do agente, modelo ativo, provedores conectados, projeto.
 */
export default function StatusBar({
  streaming,
  agentMode,
  model,
  projectId,
  connected,
}: {
  streaming: boolean
  agentMode: boolean
  model?: string
  projectId: string
  connected: number | null
}) {
  return (
    <footer
      className="jv-row h-[22px] px-3 text-[8.5px] text-[var(--jv-muted)] bg-[var(--jv-bg-deep)]"
      style={{ fontFamily: 'var(--jv-font-mono)' }}
      role="status"
      aria-label="Status do JARVIS"
    >
      <span className="jv-status">
        <span className={`jv-status-dot ${streaming ? 'jv-status-dot-ok jv-status-dot-pulse-ok' : 'jv-status-dot-ok'}`} aria-hidden />
        <span>{streaming ? 'TRABALHANDO' : 'Início'}</span>
      </span>

      <span className="h-[8px] w-px bg-[var(--jv-border-subtle)] flex-shrink-0" aria-hidden />

      <span className="jv-status">
        <Zap size={10} className={agentMode ? 'text-emerald-400' : 'text-white/25'} aria-hidden />
        <span>{agentMode ? 'AI agente' : 'CHAT'}</span>
      </span>

      <span className="h-[8px] w-px bg-[var(--jv-border-subtle)] flex-shrink-0" aria-hidden />

      <span className="jv-status min-w-0">
        <Circle size={6} className="text-cyan-400 fill-cyan-400" aria-hidden />
        <span className="truncate">{model ? shortModelName(model) : 'nenhum modelo'}</span>
      </span>

      <span className="h-[8px] w-px bg-[var(--jv-border-subtle)] flex-shrink-0" aria-hidden />

      <span className="jv-status min-w-0">
        <ChevronRight size={10} className="text-white/20" aria-hidden />
        <span className="truncate max-w-[140px]">{projectId}</span>
      </span>

      <span className="h-[8px] w-px bg-[var(--jv-border-subtle)] flex-shrink-0" aria-hidden />

      <span className="jv-status">
        <span className={`jv-status-dot ${connected === null ? 'jv-status-dot-idle' : connected === 0 ? 'jv-status-dot-fail' : 'jv-status-dot-ok jv-status-dot-pulse-ok'}`} aria-hidden />
        <span>{connected === null ? 'Total…' : `Total: ${connected}`}</span>
      </span>

      <span className="h-[8px] w-px bg-[var(--jv-border-subtle)] flex-shrink-0" aria-hidden />

      <span className="jv-status" title="Versão do JARVIS">v{pkg.version}</span>
    </footer>
  )
}
