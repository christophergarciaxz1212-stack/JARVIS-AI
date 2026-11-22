'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { toast } from 'sonner'
import {
  Brain, Database, FolderOpen, GraduationCap, KeyRound, Layers, MessageCircle, MessageSquarePlus,
  Package, PanelLeft, Server, Settings, Sparkles, Stethoscope, Terminal, TrendingUp, Users, Video, Zap,
} from 'lucide-react'
import NeuralBackground from '@/components/NeuralBackground'
import BootSequence from '@/components/BootSequence'
import InfraAlerts from '@/components/infra/InfraButton'
import NavRail, { type RailItem } from '@/components/layout/NavRail'
import TopBar from '@/components/layout/TopBar'
import StatusBar from '@/components/layout/StatusBar'
import CommandPalette, { type PaletteCommand } from '@/components/layout/CommandPalette'
import DiagnosticsPanel from '@/components/DiagnosticsPanel'
import ApiKeysModal from '@/components/chat/ApiKeysModal'
import ModelManagerModal from '@/components/chat/ModelManagerModal'
import SkillEnginePanel from '@/components/engine/SkillEnginePanel'
import StudioPanel from '@/components/studio/StudioPanel'
import InfraPanel from '@/components/infra/InfraPanel'
import SocialPanel from '@/components/social/SocialPanel'
import SettingsPanel from '@/components/settings/SettingsPanel'
import WhatsAppCenter from '@/components/WhatsAppCenter'
import FirstRunSetup from '@/components/firstRun/FirstRunSetup'
import { shortModelName } from '@/lib/ai/status'
import type { ShellProps, ShellOverlayName } from './types'

/**
 * AppShell — o shell de layout do JARVIS: NavRail, sidebar, TopBar, StatusBar,
 * zonas, painéis direitos, overlays modais e Central de Comandos.
 * Zonas de chat (mensagens + composer), Equipes e Hub vêm do chamador.
 */
export default function AppShell({
  uiScale, prefs,
  chatZone, teamsZone, hubZone, whatsappZone,
  showDiagnostics, setShowDiagnostics, showWhatsApp, hubOpen, teamMode, activeSession,
  overlay, onSetOverlay, onSelect, keysMissing,
  sidebarTab, onSidebarTab, projectId, sessionsPanel, memoryEntries,
  title, agentMode, onToggleAgentMode, currentModel, autoModel, onToggleAuto,
  connected, clock, streaming, status,
  activeRunId, runPanel, terminalPanel, filesPanel,
  onDropFiles,
  refreshModels, onModelSelect, onOpenCouncil, onOpenHub, onShowWhatsApp,
  onOpenAgents,
  showFirstRun, onFirstRunDone, onFirstRunSkip, onNewChat, onNewTeam, onExample,
}: ShellProps) {
  const [showPalette, setShowPalette] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'run' | 'terminal' | 'memory' | 'files'>('terminal')
  const dragDepth = useRef(0)

  const savePanels = useCallback((left: boolean, right: boolean) => {
    try { localStorage.setItem('jarvis.panels', JSON.stringify({ left, right })) } catch {}
  }, [])
  const toggleSidebar = () => { setSidebarOpen(!sidebarOpen); savePanels(!sidebarOpen, rightPanelOpen) }
  const toggleRightPanel = () => { setRightPanelOpen(!rightPanelOpen); savePanels(sidebarOpen, !rightPanelOpen) }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('jarvis.panels') || 'null') as { left?: boolean; right?: boolean } | null
      if (saved) { setSidebarOpen(saved.left !== false); setRightPanelOpen(saved.right === true) }
    } catch {}
  }, [])

  const openOverlay = useCallback((name: ShellOverlayName, toggle = false) => {
    setShowDiagnostics(false)
    onSetOverlay(toggle ? (overlay === name ? null : name) : name)
  }, [overlay, onSetOverlay, setShowDiagnostics])
  const closeOverlays = useCallback(() => { onSetOverlay(null) }, [onSetOverlay])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === ',' || e.code === 'Comma') { e.preventDefault(); openOverlay('settings') }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setShowPalette(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openOverlay])

  const railActive: RailItem = showWhatsApp ? 'whatsapp' : showDiagnostics ? 'diagnostics' : hubOpen ? 'hub' : teamMode && activeSession ? 'team' : 'chat'
  const onRailSelect = (item: RailItem) => {
    if (item === 'social' || item === 'motion' || item === 'skills') { openOverlay(item, true); return }
    onSelect(item)
  }

  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth.current++; setDragOver(true) },
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false) },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault(); dragDepth.current = 0; setDragOver(false)
      onDropFiles(Array.from(e.dataTransfer.files))
    },
  }

  const onPaletteSelectModel = (id: string) => {
    onModelSelect(id)
    if (autoModel) onToggleAuto()
    toast.success(`Modelo ativo: ${shortModelName(id)}`)
  }

  const paletteCommands: PaletteCommand[] = [
    { id: 'new-chat', label: 'Nova conversa', hint: 'Começar do zero', group: 'Ações', icon: MessageSquarePlus, shortcut: 'Ctrl N', keywords: 'chat limpar', run: onNewChat },
    { id: 'new-team', label: 'Nova sessão de equipe', hint: 'Abrir o workspace multiagente', group: 'Ações', icon: Users, keywords: 'agentes time', run: onNewTeam },
    { id: 'agent-mode', label: agentMode ? 'Desligar modo agente' : 'Ligar modo agente', hint: agentMode ? 'Voltar a só conversar' : 'Permitir execução de arquivos e comandos', group: 'Ações', icon: Zap, keywords: 'executar ferramenta', run: onToggleAgentMode },
    { id: 'auto-model', label: autoModel ? 'Desligar IA automática' : 'Ligar IA automática', hint: 'Escolher o melhor modelo por tarefa', group: 'Ações', icon: Sparkles, keywords: 'roteamento modelo', run: onToggleAuto },
    { id: 'council', label: 'Conselho de IA', hint: 'Vários modelos respondem a mesma pergunta; o árbitro consolida', group: 'Ações', icon: Sparkles, keywords: 'council conselho consultar modelos especialistas', run: () => { closeOverlays(); onOpenCouncil() } },
    { id: 'models', label: 'Gerenciar modelos', hint: 'Nuvem, locais, testes e downloads', group: 'Ações', icon: Server, keywords: 'catálogo ollama', run: () => openOverlay('models') },
    { id: 'keys', label: 'Chaves de API', hint: 'Conectar provedores gratuitos', group: 'Ações', icon: KeyRound, keywords: 'credencial provedor', run: () => openOverlay('keys') },
    { id: 'settings', label: 'Configurações', hint: 'Aparência, agente e preferências', group: 'Ações', icon: Settings, shortcut: 'Ctrl ,', keywords: 'preferências tema', run: () => openOverlay('settings') },
    { id: 'hub', label: 'Hub Escolar', hint: 'Disciplinas, provas e trabalhos', group: 'Navegação', icon: GraduationCap, keywords: 'faculdade estudo', run: () => { closeOverlays(); onOpenHub() } },
    { id: 'whatsapp', label: 'WhatsApp Center', hint: 'Integração oficial Meta', group: 'Navegação', icon: MessageCircle, keywords: 'whatsapp meta mensagens', run: () => { closeOverlays(); onShowWhatsApp() } },
    { id: 'skills', label: 'Skills e MCP', hint: 'Extensões, plugins e servidores', group: 'Navegação', icon: Package, keywords: 'plugin ferramenta', run: () => openOverlay('skills', true) },
    { id: 'motion', label: 'Estúdio de Vídeo', hint: 'Vídeos profissionais com IA', group: 'Navegação', icon: Video, keywords: 'vídeo clipe render documentário anúncio shorts reels', run: () => openOverlay('motion', true) },
    { id: 'social', label: 'Social', hint: 'Instagram e TikTok via Metricool', group: 'Navegação', icon: TrendingUp, keywords: 'post conteúdo', run: () => openOverlay('social', true) },
    { id: 'infra', label: 'Infraestrutura', hint: 'Monitores, servidores e backups', group: 'Navegação', icon: Database, keywords: 'servidor rede', run: () => openOverlay('infra', true) },
    { id: 'diagnostics', label: 'Diagnóstico do JARVIS', hint: 'Status de módulos, falhas e atenções', group: 'Navegação', icon: Stethoscope, keywords: 'erro alerta falha diagnóstico selfcheck', run: () => setShowDiagnostics(true) },
    { id: 'sidebar', label: sidebarOpen ? 'Esconder conversas' : 'Mostrar conversas', hint: 'Barra lateral de sessões', group: 'Painéis', icon: PanelLeft, keywords: 'histórico', run: toggleSidebar },
    { id: 'panel-toggle', label: rightPanelOpen ? 'Esconder terminal e arquivos' : 'Mostrar terminal e arquivos', hint: 'Painel direito', group: 'Painéis', icon: Terminal, keywords: 'shell', run: toggleRightPanel },
    { id: 'panel-terminal', label: 'Abrir terminal', hint: 'PowerShell integrado', group: 'Painéis', icon: Terminal, keywords: 'comando shell', run: () => { setRightPanelOpen(true); setRightTab('terminal'); savePanels(sidebarOpen, true) } },
    { id: 'panel-memory', label: 'Abrir memória', hint: 'Memórias persistentes', group: 'Painéis', icon: Brain, keywords: 'lembrar contexto', run: () => { setRightPanelOpen(true); setRightTab('memory'); savePanels(sidebarOpen, true) } },
    { id: 'panel-files', label: 'Abrir arquivos', hint: 'Navegar no projeto', group: 'Painéis', icon: FolderOpen, keywords: 'explorador', run: () => { setRightPanelOpen(true); setRightTab('files'); savePanels(sidebarOpen, true) } },
  ]

  const fullScreenZone = showDiagnostics ? (
    <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} onOpenAgents={onOpenAgents} />
  ) : showWhatsApp ? (
    whatsappZone
  ) : hubOpen ? (
    hubZone
  ) : teamMode && activeSession ? (
    teamsZone
  ) : (
    chatZone
  )

  return (
    <MotionConfig reducedMotion={prefs?.appearance.motion === 'full' || !prefs ? 'never' : 'always'}>
    <div className="ui-root" style={{ '--ui-scale': uiScale } as React.CSSProperties}>
      {(prefs?.appearance.particles ?? true) && prefs?.appearance.motion !== 'off' && <NeuralBackground intensity={streaming ? 2.4 : 1} />}
      <div className="hud-overlay" aria-hidden style={{ display: prefs?.appearance.motion === 'off' ? 'none' : undefined }} />
      <BootSequence />
      <InfraAlerts onOpen={() => openOverlay('infra')} />
      <NavRail active={railActive} onSelect={onRailSelect} onKeys={() => openOverlay('keys')} onSettings={() => openOverlay('settings')} keysMissing={keysMissing} />
      {/* ─── LEFT SIDEBAR ─── */}
      <AnimatePresence mode="popLayout">
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ width: 260 }}
            className="relative z-10 glass-panel border-r border-cyan-500/10 flex flex-col flex-shrink-0 overflow-hidden"
          >
            {/* Header + tabs */}
            <div className="px-3 pt-3 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 mb-2.5 px-1">
                <h1 className="font-bold text-sm jarvis-title tracking-[0.25em]">JARVIS</h1>
                <div className="status-dot online ml-auto" title="Online" />
              </div>
              <div role="tablist" className="flex gap-1 p-0.5 rounded-lg bg-white/[0.03]">
                {(['chat', 'memory'] as const).map(t => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={sidebarTab === t}
                    onClick={() => onSidebarTab(t)}
                    className={`relative flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors ${sidebarTab === t ? 'text-cyan-200' : 'text-white/40 hover:text-white/70'}`}
                  >
                    {sidebarTab === t && <motion.span layoutId="sidebar-tab-pill" className="absolute inset-0 rounded-md bg-cyan-500/15 border border-cyan-400/20" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                    <span className="relative">{t === 'chat' ? 'Conversas' : 'Memória'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sidebarTab === 'chat' && sessionsPanel}
              {sidebarTab === 'memory' && (
                <div>
                  <p className="panel-title px-2 mb-2">Memórias ({memoryEntries.length})</p>
                  <div className="mo-stagger">
                    {(memoryEntries as Array<{ id: string; type: string; content: string }>).slice(0, 20).map(m => (
                      <div key={m.id} className="mo-spot p-2 mb-1 rounded-lg bg-white/[.02] border border-white/5 hover:border-cyan-500/20 transition-colors">
                        <div className="text-[10px] text-cyan-400/50 uppercase">{m.type}</div>
                        <div className="text-xs text-white/60 truncate">{m.content}</div>
                      </div>
                    ))}
                  </div>
                  {memoryEntries.length === 0 && (
                    <p className="text-xs text-white/20 text-center py-8">Sem memórias salvas</p>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ─── MAIN AREA (zone) ─── */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0" {...dropHandlers}>
        <AnimatePresence>
          {dragOver && (
            <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-3 z-40 rounded-2xl border-2 border-dashed border-cyan-400/60 bg-[#06101c]/85 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-center">
              <Layers size={34} className="text-cyan-300 animate-pulse" />
              <div className="text-base font-semibold text-white">Solte para jogar como contexto</div>
              <div className="text-xs text-white/50 max-w-sm">Documentos, PDFs, planilhas, código e textos viram contexto da conversa · imagens vão para a análise visual</div>
            </motion.div>
          )}
        </AnimatePresence>
        <TopBar
          title={title}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          agentMode={agentMode}
          onToggleAgentMode={onToggleAgentMode}
          currentModel={currentModel}
          autoModel={autoModel}
          onOpenModels={() => openOverlay('models')}
          onToggleAuto={onToggleAuto}
          connected={connected}
          onOpenPalette={() => setShowPalette(true)}
          rightPanelOpen={rightPanelOpen}
          onToggleRightPanel={toggleRightPanel}
          streaming={streaming}
          status={status}
          clock={clock}
        />
        <div className="topbar-hairline" aria-hidden />
        {streaming && <div className="stream-bar" role="progressbar" aria-label="JARVIS respondendo" />}

        {fullScreenZone}
        <StatusBar
          streaming={streaming}
          agentMode={agentMode}
          model={autoModel ? 'Automático' : currentModel}
          projectId={projectId}
          connected={connected}
        />
      </div>

      {/* ─── RIGHT PANEL ─── */}
      <AnimatePresence mode="popLayout">
        {rightPanelOpen && (
          <motion.aside
            key="rightpanel"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ width: 340 }}
            className="relative z-10 glass-panel border-l border-cyan-500/10 flex flex-col flex-shrink-0 overflow-hidden"
          >
            <div role="tablist" className="flex p-2 gap-1 border-b border-white/5">
              {([
                ...(activeRunId ? [{ id: 'run' as const, icon: Zap, label: 'Execução' }] : []),
                { id: 'terminal', icon: Terminal, label: 'Terminal' },
                { id: 'memory', icon: Brain, label: 'Memória' },
                { id: 'files', icon: FolderOpen, label: 'Arquivos' },
              ] as const).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={rightTab === id}
                  onClick={() => setRightTab(id)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-all ${rightTab === id ? 'text-cyan-300' : 'text-white/30 hover:text-white/60'}`}
                >
                  {rightTab === id && <motion.span layoutId="right-tab-pill" className="absolute inset-0 rounded-lg bg-cyan-500/15 border border-cyan-400/20" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                  <Icon size={12} className="relative" />
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
            {rightTab === 'run' && activeRunId && runPanel}
            {rightTab === 'terminal' && terminalPanel}
            {rightTab === 'memory' && (
              <div className="flex-1 overflow-y-auto p-3">
                <p className="panel-title mb-3">Memória Persistente</p>
                {(memoryEntries as Array<{ id: string; type: string; content: string; tags: string }>).map(m => (
                  <div key={m.id} className="mb-2 p-2.5 rounded-xl bg-white/[.02] border border-white/5">
                    <div className="text-[10px] text-cyan-400/60 uppercase mb-1">{m.type}</div>
                    <div className="text-xs text-white/60">{m.content}</div>
                    <div className="flex gap-1 mt-1.5">
                      {JSON.parse(m.tags || '[]').map((t: string) => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
                {memoryEntries.length === 0 && (
                  <div className="text-center py-16 text-white/20 text-xs">
                    <Brain size={24} className="mx-auto mb-2 opacity-30" />
                    Sem memórias salvas
                  </div>
                )}
              </div>
            )}
            {rightTab === 'files' && filesPanel}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ─── CENTRAL DE COMANDOS ─── */}
      {showPalette && (
        <CommandPalette
          open={showPalette}
          onClose={() => setShowPalette(false)}
          commands={paletteCommands}
          currentModel={currentModel}
          onSelectModel={onPaletteSelectModel}
        />
      )}

      {/* ─── MODALS ─── */}
      <>
        {overlay === 'models' && (
          <ModelManagerModal key="mm" onClose={() => onSetOverlay(null)} onSelect={onModelSelect} onOpenKeys={() => openOverlay('keys')} currentModel={currentModel} />
        )}
        {overlay === 'keys' && (
          <ApiKeysModal key="keys" onClose={() => { onSetOverlay(null); refreshModels() }} />
        )}
        {overlay === 'skills' && (
          <SkillEnginePanel key="skills" onClose={() => onSetOverlay(null)} />
        )}
        {showFirstRun && (
          <FirstRunSetup key="first-run" onDone={onFirstRunDone} onSkip={onFirstRunSkip} />
        )}
        {overlay === 'motion' && (
          <StudioPanel key="motion" onClose={() => onSetOverlay(null)} />
        )}
        {overlay === 'infra' && (
          <InfraPanel key="infra" onClose={() => onSetOverlay(null)} />
        )}
        {overlay === 'social' && (
          <SocialPanel key="social" onClose={() => onSetOverlay(null)} />
        )}
        {overlay === 'settings' && (
          <SettingsPanel
            key="settings"
            onClose={() => onSetOverlay(null)}
            onOpenKeys={() => openOverlay('keys')}
            model={currentModel}
            onModel={onModelSelect}
            autoModel={autoModel}
            onAutoModel={onToggleAuto}
            onExample={onExample}
          />
        )}
      </>
    </div>
    </MotionConfig>
  )
}
