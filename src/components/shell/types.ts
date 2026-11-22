import type { ReactNode } from 'react'
import type { Prefs } from '@/components/settings/usePrefs'
import type { RailItem } from '@/components/layout/NavRail'
import type { SessionMeta } from '@/lib/agents/types'
import type { StreamStatus } from '@/lib/ai/status'

export type ShellOverlayName = 'keys' | 'models' | 'skills' | 'motion' | 'infra' | 'social' | 'settings'

/**
 * Entradas do AppShell: tudo o que ele precisa que vem de fora (a página).
 * Os overlays (modais: chaves, modelos, skills, motion, infra, social,
 * settings) viram estado da página para o shell controlar visíveis/escondidos;
 * as funções de `on*` entregam as ações reais das telas para o shell executar.
 */
export interface ShellProps {
  /** Escala global da interface — o valor do `--ui-scale` da raiz. */
  uiScale: number
  prefs: Prefs | null

  // ── Zonas (os nós vêm do chamador; o shell escolhe qual renderizar) ──
  chatZone: ReactNode
  teamsZone: ReactNode
  hubZone: ReactNode
  whatsappZone: ReactNode

  // ── Seleção de zona ──
  showDiagnostics: boolean
  setShowDiagnostics: (v: boolean) => void
  showWhatsApp: boolean
  hubOpen: boolean
  teamMode: boolean
  activeSession: SessionMeta | null

  // ── Modais — estado compartilhado; o shell abre/fecha pelo onSetOverlay ──
  overlay: ShellOverlayName | null
  onSetOverlay: (next: ShellOverlayName | null) => void

  // ── NavRail ──
  onSelect: (item: RailItem) => void
  keysMissing: boolean

  // ── Sidebar ──
  sidebarTab: 'chat' | 'memory'
  onSidebarTab: (tab: 'chat' | 'memory') => void
  projectId: string
  sessionsPanel: ReactNode
  memoryEntries: unknown[]

  // ── TopBar ──
  title: string
  agentMode: boolean
  onToggleAgentMode: () => void
  currentModel: string
  autoModel: boolean
  onToggleAuto: () => void
  connected: number | null
  clock: string
  streaming: boolean
  status: StreamStatus | null

  // ── Painel direito (com conteúdo real) ──
  activeRunId: string
  runPanel: ReactNode
  terminalPanel: ReactNode
  filesPanel: ReactNode

  // ── Arquivos arrastados para o chat ──
  onDropFiles: (files: File[]) => void

  // ── Ações reais da tela (painéis e modais) ──
  refreshModels: () => void
  onModelSelect: (id: string) => void
  onOpenCouncil: () => void
  onOpenHub: () => void
  onShowWhatsApp: () => void
  onOpenAgents: () => void
  showFirstRun: boolean
  onFirstRunDone: () => void
  onFirstRunSkip: () => void
  onNewChat: () => void
  onNewTeam: () => void
  onExample: (text: string) => void
}
