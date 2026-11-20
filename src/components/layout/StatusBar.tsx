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
    <footer className="statusbar" role="status" aria-label="Status do JARVIS">
      <span className="statusbar-item" title={streaming ? 'O JARVIS está trabalhando' : 'Aguardando a próxima ordem'}>
        <span className={`statusbar-dot ${streaming ? 'busy' : 'on'}`} aria-hidden />
        <strong>{streaming ? 'TRABALHANDO' : 'PRONTO'}</strong>
      </span>

      <span className="statusbar-sep" aria-hidden />

      <span className="statusbar-item" title={agentMode ? 'Modo agente: executa arquivos e comandos' : 'Modo chat: apenas responde'}>
        <Zap size={10} className={agentMode ? 'text-emerald-400' : 'text-white/25'} />
        {agentMode ? 'AGENTE' : 'CHAT'}
      </span>

      <span className="statusbar-sep" aria-hidden />

      <span className="statusbar-item min-w-0" title="Modelo ativo">
        <Circle size={6} className="text-cyan-400 fill-cyan-400" aria-hidden />
        <span className="truncate">{model ? shortModelName(model) : 'nenhum modelo'}</span>
      </span>

      <span className="statusbar-right">
        <span className="statusbar-item" title="Projeto atual">
          <ChevronRight size={10} className="text-white/20" aria-hidden />
          <span className="truncate max-w-[140px]">{projectId}</span>
        </span>
        <span className="statusbar-sep" aria-hidden />
        <span className="statusbar-item" title="Provedores conectados com chave válida">
          {connected === null ? '… provedores' : connected === 0 ? 'sem IA conectada' : `${connected} provedor${connected > 1 ? 'es' : ''}`}
        </span>
        <span className="statusbar-sep" aria-hidden />
        <span className="statusbar-item" title="Versão do JARVIS">v{pkg.version}</span>
      </span>
    </footer>
  )
}
