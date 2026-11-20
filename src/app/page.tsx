'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, MotionConfig, AnimatePresence } from 'framer-motion'
import NeuralBackground from '@/components/NeuralBackground'
import BootSequence from '@/components/BootSequence'
import SessionsPanel from '@/components/agents/SessionsPanel'
import AgentsWorkspace from '@/components/agents/AgentsWorkspace'
import RunInlineCard from '@/components/agents/RunInlineCard'
import { api as agentsApi } from '@/components/agents/api'
import type { Project, SessionMeta } from '@/lib/agents/types'
import {
  Terminal, Settings, Zap, Brain,
  Code2, Video, Image as ImageIcon, BookOpen, Share2, Database,
  ChevronRight, Send, Mic, MicOff,
  Paperclip, Trash2, RefreshCw, X, Check,
  Sparkles, Globe, FileText, Package,
  Play, Square,
  FolderOpen, PanelLeft,
  KeyRound, Users, GraduationCap, TrendingUp,
  Server, MessageSquarePlus, MessageCircle, ClipboardPaste, Layers,
  ShieldCheck,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import type { Message, Conversation, Provider } from '@/types'
import FilesPanel from '@/components/FilesPanel'
import SkillEnginePanel from '@/components/engine/SkillEnginePanel'
import HubWorkspace from '@/components/hub/HubWorkspace'
// Implementação nova (esta sessão): integra com as rotas reais /api/whatsapp/*.
// O scaffold anterior em ./components/whatsapp/WhatsAppCenter.tsx (outra sessão) foi preservado.
import WhatsAppCenter from '@/components/WhatsAppCenter'
import VideoStudio from '@/components/video/VideoStudio'
import VideoJobInline from '@/components/video/VideoJobInline'
import FirstRunSetup from '@/components/firstRun/FirstRunSetup'
import ImageJobInline from '@/components/image/ImageJobInline'
import InfraPanel from '@/components/infra/InfraPanel'
import InfraAlerts from '@/components/infra/InfraButton'
import NavRail, { type RailItem } from '@/components/layout/NavRail'
import TopBar from '@/components/layout/TopBar'
import StatusBar from '@/components/layout/StatusBar'
import CommandPalette, { type PaletteCommand } from '@/components/layout/CommandPalette'
import SocialPanel from '@/components/social/SocialPanel'
import SlashMenu from '@/components/SlashMenu'
import ContextBar from '@/components/chat/ContextBar'
import { useChatContext } from '@/components/chat/useChatContext'
import SettingsPanel from '@/components/settings/SettingsPanel'
import { usePrefs } from '@/components/settings/usePrefs'
import { post as apiPost } from '@/components/agents/api'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'
import { PERMISSION_LABELS, PERMISSION_MODES, type PermissionMode } from '@/lib/agents/permissions'
import { hidePartialMarker } from '@/lib/motion/inline'
import { SSEParser } from '@/lib/ai/sse'
import { shortModelName, type StreamStatus } from '@/lib/ai/status'

// ─── Types ─────────────────────────────────────────────────────────────────

interface TerminalEntry {
  id: string
  type: 'cmd' | 'stdout' | 'stderr' | 'info' | 'success' | 'error'
  text: string
  timestamp: number
}

import JarvisLogo from '@/components/chat/JarvisLogo'
import TypingIndicator from '@/components/chat/TypingIndicator'
import { HeroTitle, TypedTagline, TiltCard } from '@/components/chat/Welcome'
import MessageBubble from '@/components/chat/MessageBubble'
import { lastTopologyIn } from '@/lib/netlab/intent'
import ModelManagerModal from '@/components/chat/ModelManagerModal'
import ApiKeysModal from '@/components/chat/ApiKeysModal'

// ─── Main JARVIS App ─────────────────────────────────────────────────────────

export default function JarvisApp() {
  // State
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentModel, setCurrentModelState] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [connectedProviders, setConnectedProviders] = useState<number | null>(null)
  const [conversationId, setConversationId] = useState<string>('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showModelManager, setShowModelManager] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // The conversation gets the room by default; the terminal/files panel opens on demand
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'terminal' | 'memory' | 'files'>('terminal')
  const [terminalOutput, setTerminalOutput] = useState<TerminalEntry[]>([])
  const [terminalInput, setTerminalInput] = useState('')
  const [terminalRunning, setTerminalRunning] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'skills' | 'memory'>('chat')
  const [autoModel, setAutoModel] = useState(false)
  const [projectId, setProjectIdState] = useState('geral')
  const [projects, setProjects] = useState<Project[]>([])
  const [activeSession, setActiveSession] = useState<SessionMeta | null>(null)
  const [sessionsRefresh, setSessionsRefresh] = useState(0)
  const bumpSessions = useCallback(() => setSessionsRefresh(x => x + 1), [])
  const [memoryEntries, setMemoryEntries] = useState<unknown[]>([])
  const [isMicActive, setIsMicActive] = useState(false)
  const [hubOpen, setHubOpen] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)
  const [showMotion, setShowMotion] = useState(false)
  const [showInfra, setShowInfra] = useState(false)
  const [showSocial, setShowSocial] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null)
  // Full-screen panels are mutually exclusive: opening one closes the others
  type OverlayName = 'keys' | 'models' | 'skills' | 'motion' | 'infra' | 'social' | 'settings'
  const openOverlay = useCallback((name: OverlayName, toggle = false) => {
    setShowKeys(prev => (name === 'keys' ? (toggle ? !prev : true) : false))
    setShowModelManager(prev => (name === 'models' ? (toggle ? !prev : true) : false))
    setShowSkills(prev => (name === 'skills' ? (toggle ? !prev : true) : false))
    setShowMotion(prev => (name === 'motion' ? (toggle ? !prev : true) : false))
    setShowInfra(prev => (name === 'infra' ? (toggle ? !prev : true) : false))
    setShowSocial(prev => (name === 'social' ? (toggle ? !prev : true) : false))
    setShowSettings(prev => (name === 'settings' ? (toggle ? !prev : true) : false))
  }, [])
  const closeOverlays = useCallback(() => {
    setShowKeys(false); setShowModelManager(false); setShowSkills(false); setShowMotion(false)
    setShowInfra(false); setShowSocial(false); setShowSettings(false)
  }, [])
  const [prefs, updatePrefs] = usePrefs()
  const [agentMode, setAgentMode] = useState(true)
  // Relógio HUD da barra superior (atualiza 1x por segundo)
  const [clock, setClock] = useState('')
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('pt-BR', { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  // Read after mount: reading it during the first render breaks hydration of the prerendered page
  useEffect(() => {
    try { const saved = localStorage.getItem('jarvis.agentMode'); if (saved !== null) setAgentMode(saved === 'true') } catch {}
  }, [])
  const [tipsHidden, setTipsHidden] = useState(false)
  const agentModeInit = useRef(false)
  useEffect(() => {
    if (!prefs) return
    if (!agentModeInit.current) { agentModeInit.current = true; setAgentMode(prefs.agentModeDefault) }
    const ap = prefs.appearance
    const look: Record<string, string> = { motion: ap.motion, theme: ap.theme, accent: ap.accent, font: ap.font, chatWidth: ap.chatWidth, panels: ap.panels }
    Object.assign(document.documentElement.dataset, look)
    try { localStorage.setItem('jarvis.look', JSON.stringify(look)) } catch {}
  }, [prefs])

  // Assistente de primeira configuração: aparece só na primeira execução (marcador no servidor) — ou até o usuário pular
  const [showFirstRun, setShowFirstRun] = useState(false)
  useEffect(() => {
    let skip = false
    try { skip = localStorage.getItem('jarvis.firstRunSkipped') === '1' } catch {}
    if (skip) return
    fetch('/api/setup?action=status', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.firstRun) setShowFirstRun(true) })
      .catch(() => {})
  }, [])

  // Notificações do WhatsApp em qualquer lugar do JARVIS (SSE em tempo real)
  const waNotifyRef = useRef({ desktop: true, sound: false, importantOnly: false })
  useEffect(() => {
    fetch('/api/whatsapp/config', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.notify) waNotifyRef.current = { desktop: !!d.notify.desktop, sound: !!d.notify.sound, importantOnly: !!d.notify.importantOnly } })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource('/api/whatsapp/sse')
    const beep = () => {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AC()
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.type = 'sine'; o.frequency.value = 880
        g.gain.setValueAtTime(0.08, ctx.currentTime)
        o.connect(g); g.connect(ctx.destination)
        o.start(); o.stop(ctx.currentTime + 0.18)
        o.onended = () => void ctx.close().catch(() => {})
      } catch {}
    }
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data) as { type?: string; phone?: string; name?: string; text?: string; important?: boolean; starred?: boolean }
        if (d.type !== 'message' || !d.phone) return
        const prefs = waNotifyRef.current
        const important = !!d.important || !!d.starred
        if (prefs.importantOnly && !important) return // usuário pediu só conversas importantes
        const name = d.name || `+${d.phone}`
        const open = () => { setShowWhatsApp(true); if (d.phone) window.dispatchEvent(new CustomEvent('jarvis:open-whatsapp', { detail: { phone: d.phone } })) }
        toast.success(`💬 Nova mensagem de ${name}`, {
          description: String(d.text || '').slice(0, 140),
          duration: 6000,
          action: { label: 'Abrir', onClick: open },
        })
        if (!showWhatsApp && prefs.sound) beep()
        if (!showWhatsApp && prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('NOVA MENSAGEM NO WHATSAPP', { body: `${name}: ${String(d.text || '').slice(0, 160)}` }) } catch {}
        }
      } catch {}
    }
    return () => es.close()
  }, [showWhatsApp])

  // Escala global proporcional à janela, na largura E na altura (referência 1500×900 → 1.0).
  // Antes só a largura contava: em 1920×1080 com letra grande a escala ia a ~1.5 e sobravam
  // ~660 px de altura úteis — tudo espremido. Agora a interface sempre tem pelo menos
  // 1180×720 px "de desenho", então cresce junto com a janela sem cortar nem apertar.
  const [uiScale, setUiScale] = useState(1)
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth, h = window.innerHeight
      let s = Math.min(w / 1500, h / 900)
      s = Math.max(0.72, Math.min(1.55, s))
      if (prefs?.appearance.fontSize === 'large') s *= 1.12
      if (prefs?.appearance.fontSize === 'small') s *= 0.9
      s *= (prefs?.appearance.zoom ?? 100) / 100
      // Teto: nunca deixar menos que 1180×720 de espaço útil (o zoom manual ainda pode passar disso)
      const fit = Math.min(w / 1180, h / 720) * Math.max(1, (prefs?.appearance.zoom ?? 100) / 100)
      s = Math.max(0.6, Math.min(s, fit))
      setUiScale(Math.round(s * 1000) / 1000)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [prefs?.appearance.fontSize, prefs?.appearance.zoom])

  // Which side panels are open is remembered between launches (read after mount: the page is prerendered)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('jarvis.panels') || 'null') as { left?: boolean; right?: boolean } | null
      if (saved) { setSidebarOpen(saved.left !== false); setRightPanelOpen(saved.right === true) }
    } catch {}
  }, [])
  const savePanels = (left: boolean, right: boolean) => {
    try { localStorage.setItem('jarvis.panels', JSON.stringify({ left, right })) } catch {}
  }
  const toggleSidebar = () => { setSidebarOpen(!sidebarOpen); savePanels(!sidebarOpen, rightPanelOpen) }
  const toggleRightPanel = () => { setRightPanelOpen(!rightPanelOpen); savePanels(sidebarOpen, !rightPanelOpen) }

  /** Autonomia do agente nesta conversa; fica salva nas preferências. */
  const permissionMode: PermissionMode = prefs?.agent?.permissionMode ?? 'supervisionado'

  const cyclePermissionMode = useCallback(() => {
    if (!prefs) return
    const next = PERMISSION_MODES[(PERMISSION_MODES.indexOf(permissionMode) + 1) % PERMISSION_MODES.length]
    updatePrefs({ agent: { ...prefs.agent, permissionMode: next } }).catch(() => {})
    toast.success(`${PERMISSION_LABELS[next].name}: ${PERMISSION_LABELS[next].hint}`)
  }, [permissionMode, prefs, updatePrefs])

  const toggleAgentMode = useCallback(() => {
    const next = !agentMode
    setAgentMode(next)
    try { localStorage.setItem('jarvis.agentMode', String(next)) } catch {}
    updatePrefs({ agentModeDefault: next }).catch(() => {})
    toast.success(next ? 'Modo agente ligado — o JARVIS executa e mostra cada passo' : 'Modo agente desligado — apenas conversa')
  }, [agentMode, updatePrefs])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const termInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Id of a chat that the in-flight answer just created; its messages are already on screen
  const streamingConvRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [imageAtts, setImageAtts] = useState<Array<{ id: string; name: string; data: string; preview: string }>>([])
  // Contexto jogado para a IA (arquivos, documentos, textos colados) — vale para a conversa inteira
  const chatCtx = useChatContext(conversationId)
  const { pendingPayload: pendingContext, setNote: setContextNote } = chatCtx
  const [pasteOpen, setPasteOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const recognitionRef = useRef<any>(null)

  const setCurrentModel = useCallback((id: string) => {
    setCurrentModelState(id)
    try { localStorage.setItem('jarvis.model', id) } catch {}
    // A local model takes seconds to load into the GPU: load it now, not on the first message
    if (id.startsWith('ollama|')) fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warm: id }) }).catch(() => {})
  }, [])

  const refreshModels = useCallback(async () => {
    try {
      const d = await fetch('/api/models').then(r => r.json())
      const connected = (d.providers as Provider[] || []).filter(p => p.status === 'connected' && p.models.length)
      setConnectedProviders(connected.length)
      const ids = new Set(connected.flatMap(p => p.models.map(m => m.id)))
      let saved = ''
      try { saved = localStorage.getItem('jarvis.model') || '' } catch {}
      setCurrentModelState(prev => ids.has(prev) ? prev : ids.has(saved) ? saved : (d.defaultModel || ''))
    } catch {}
  }, [])

  useEffect(() => { refreshModels() }, [refreshModels])

  // Atalhos globais: Ctrl+K abre a central de comandos · Ctrl+, abre Configurações
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === ',' || e.code === 'Comma') { e.preventDefault(); openOverlay('settings') }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setShowPalette(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openOverlay])

  // Load conversations
  useEffect(() => {
    fetch('/api/memory?action=conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations || []))
      .catch(() => {})

    fetch('/api/memory?action=list')
      .then(r => r.json())
      .then(d => setMemoryEntries(d.entries || []))
      .catch(() => {})
  }, [])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversationId || conversationId === streamingConvRef.current) return
    fetch(`/api/chat?conversationId=${conversationId}`)
      .then(r => r.json())
      .then(d => {
        if (d.messages) {
          setMessages(d.messages.map((m: { id: string; role: string; content: string; created_at: number; model?: string }) => ({
            id: m.id,
            role: m.role as Message['role'],
            content: m.content,
            createdAt: m.created_at,
            model: m.model,
          })))
        }
      })
      .catch(() => {})
  }, [conversationId])

  const startNewConversation = () => {
    streamingConvRef.current = ''
    setConversationId('')
    setMessages([])
  }

  // "Estúdio Motion" buttons inside inline chat videos open the Motion studio panel
  useEffect(() => {
    const onOpen = () => openOverlay('motion')
    window.addEventListener('jarvis:open-motion', onOpen)
    return () => window.removeEventListener('jarvis:open-motion', onOpen)
  }, [openOverlay])

  const loadConversation = useCallback((id: string) => {
    streamingConvRef.current = ''
    setConversationId(id)
  }, [])

  // ─── Sessions & projects ───────────────────────────────────────────────────

  useEffect(() => {
    try { const saved = localStorage.getItem('jarvis.project'); if (saved) setProjectIdState(saved) } catch {}
  }, [])

  useEffect(() => { agentsApi.projects().then(setProjects).catch(() => {}) }, [projectId, sessionsRefresh])

  const changeProject = useCallback((id: string) => {
    setProjectIdState(id)
    try { localStorage.setItem('jarvis.project', id) } catch {}
    setActiveSession(null)
    streamingConvRef.current = ''
    setConversationId('')
    setMessages([])
    setSessionsRefresh(x => x + 1)
  }, [])

  const openSession = useCallback((s: SessionMeta) => {
    closeOverlays()
    setHubOpen(false)
    setActiveSession(s)
    if (s.kind === 'chat') loadConversation(s.id)
    else { streamingConvRef.current = ''; setConversationId(''); setMessages([]) }
  }, [loadConversation, closeOverlays])

  const openRunSession = useCallback(async (sessionId: string) => {
    try {
      const sessions = await agentsApi.sessions({})
      const s = sessions.find(x => x.id === sessionId)
      if (!s) { toast.error('Sessão da execução não encontrada'); return }
      if (s.projectId !== projectId) setProjectIdState(s.projectId)
      openSession(s)
    } catch (e) { toast.error((e as Error).message) }
  }, [openSession, projectId])

  const newChat = useCallback(() => {
    closeOverlays()
    setHubOpen(false)
    setActiveSession(null)
    startNewConversation()
  }, [closeOverlays])

  // Esc interrompe uma geração em andamento; Ctrl+N começa uma conversa nova
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && isStreaming) {
        abortRef.current?.abort()
        setIsStreaming(false)
        toast.info('Geração interrompida')
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStreaming, newChat])

  const newTeamSession = async () => {
    closeOverlays()
    try {
      const res = await agentsApi.sessionAction('create', { kind: 'team', projectId })
      if (res.session) { openSession(res.session); setSessionsRefresh(x => x + 1) }
    } catch (e) { toast.error((e as Error).message) }
  }

  const onSessionsDeleted = (ids: string[]) => {
    if ((activeSession && ids.includes(activeSession.id)) || ids.includes(conversationId)) newChat()
    setConversations(prev => prev.filter(c => !ids.includes(c.id)))
    setSessionsRefresh(x => x + 1)
  }

  const teamMode = activeSession?.kind === 'team'

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado!')
  }

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && imageAtts.length === 0) || isStreaming) return
    // Infrastructure has no button: "/infra" opens its dashboard (monitors, servers, backups)
    if (/^\/infra\s*$/i.test(input.trim())) { setInput(''); openOverlay('infra'); return }

    // Com imagens anexadas o pedido segue para o /api/chat (visão/edição multimodal)
    const hasImgAtts = imageAtts.length > 0

    // Video production: detect requests like "crie um vídeo", "faça um vídeo", "produza um vídeo"
    const videoReq = !hasImgAtts && (/^\/video\s+(.+)$/i.exec(input.trim()) || /(?:crie|fa[cç]a|produza|gere|monte)\s+(?:um\s+)?(?:v[ií]deo|cli?pe|an[uú]ncio|reels?|shorts?|document[aá]rio)\b/i.test(input.trim()))
    if (videoReq) {
      const request = input.trim().replace(/^\/video\s+/i, '')
      setInput('')
      try {
        const { job } = await apiPost<{ job: { id: string; title?: string } }>('/api/video', {
          action: 'create',
          prompt: request,
          formatId: 'youtube',
          seconds: 30,
          fps: 30,
          narration: 'auto',
          music: 'auto',
        })
        setMessages(prev => [...prev,
          { id: uuidv4(), role: 'user', content: request, createdAt: Date.now() },
          { id: uuidv4(), role: 'assistant', content: '', createdAt: Date.now() + 1, video: { jobId: job.id } },
        ])
        toast.success('Produção de vídeo iniciada — acompanhe na conversa')
      } catch (e) {
        setInput(request)
        toast.error((e as Error).message)
      }
      return
    }

    // Image generation: detect requests like "crie uma imagem", "gere uma imagem", "desenhe"
    const imageReq = !hasImgAtts && (/^\/image\s+(.+)$/i.exec(input.trim()) || /(?:crie|gere|desenhe|fa[cç]a|produza)\s+(?:uma\s+)?(?:imagem|foto|arte|ilustra[cç][aã]o|thumbnail|logo|poster)\b/i.test(input.trim()))
    if (imageReq) {
      const request = input.trim().replace(/^\/image\s+/i, '')
      setInput('')
      try {
        const r = await apiPost<{ image: { id: string }; url: string }>('/api/media', {
          prompt: request,
          aspect: '1:1',
          provider: 'auto',
        })
        setMessages(prev => [...prev,
          { id: uuidv4(), role: 'user', content: request, createdAt: Date.now() },
          { id: uuidv4(), role: 'assistant', content: '', createdAt: Date.now() + 1, image: { url: r.url, prompt: request } },
        ])
        toast.success('Imagem gerada — veja na conversa')
      } catch (e) {
        setInput(request)
        toast.error((e as Error).message)
      }
      return
    }

    // "/plan <pedido>": investiga e apresenta o plano, sem tocar no projeto até você aprovar.
    const planCmd = /^\/plan(?:ejar)?\b\s*([\s\S]*)$/i.exec(input.trim())

    // Agent mode: JARVIS executes the request (files, commands) - the work shows up live, inline in the conversation
    if (agentMode && !hasImgAtts && (planCmd?.[1]?.trim() || shouldRunAgent(input, !!lastTopologyIn(messages.map(m => m.content || ''))))) {
      const request = (planCmd ? planCmd[1] : input).trim()
      setInput('')
      try {
        const p = prefs?.agent
        const { run } = await apiPost<{ run: { id: string; sessionId: string; projectId: string } }>('/api/agents/runs', {
          agentMode: true, projectId, request, teamId: 'preset-solo',
          options: {
            ...(p ? { maxSteps: p.maxSteps, maxParallel: p.maxParallel, fixRounds: p.fixRounds } : {}),
            autoFallback: true,
            permissionMode,
            // O comando /plan liga o Plan Mode só nesta execução.
            planFirst: planCmd ? true : (p?.planFirst ?? false),
          },
        })
        if (run.projectId !== projectId) { setProjectIdState(run.projectId); try { localStorage.setItem('jarvis.project', run.projectId) } catch {} }
        setMessages(prev => [...prev,
          { id: uuidv4(), role: 'user', content: request, createdAt: Date.now() },
          { id: uuidv4(), role: 'assistant', content: '', createdAt: Date.now() + 1, run: { id: run.id, sessionId: run.sessionId } },
        ])
        setSessionsRefresh(x => x + 1)
        toast.success(planCmd
          ? 'JARVIS vai investigar e apresentar o plano — nada será alterado antes da sua aprovação'
          : 'JARVIS começou a trabalhar — acompanhe ao vivo na conversa')
      } catch (e) {
        setInput(request)
        toast.error((e as Error).message)
      }
      return
    }

    const attachNote = imageAtts.length ? `\n\n📎 imagem anexada: ${imageAtts.map(a => a.name).join(', ')}` : ''
    const outgoing = imageAtts.map(a => ({ name: a.name, mimeType: 'image/jpeg' as const, data: a.data }))
    const outgoingText = `${input.trim()}${attachNote}`
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: outgoingText,
      createdAt: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    const userInput = outgoingText
    setInput('')
    setImageAtts([])
    setIsStreaming(true)

    const assistantId = uuidv4()
    let assistantContent = ''
    let assistantReasoning = ''
    const sentAt = Date.now()
    let firstAt = 0

    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: autoModel ? 'auto' : currentModel,
    }])

    abortRef.current = new AbortController()
    let frame = 0

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: userInput,
          model: autoModel ? 'auto' : currentModel,
          projectId,
          attachments: outgoing.length ? outgoing : undefined,
          // Numa conversa nova, o contexto jogado antes da 1ª mensagem vai junto (o servidor guarda)
          context: !conversationId && pendingContext().length ? pendingContext() : undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Erro na requisição (${res.status})`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      const parser = new SSEParser()
      setStreamStatus(null)

      // Fast models send hundreds of tiny chunks per second; repaint at most once per frame
      const flush = () => {
        frame = 0
        const content = hidePartialMarker(assistantContent)
        const reasoning = assistantReasoning || undefined
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content, reasoning } : m))
      }

      // Um único caminho para eventos completos e para o resto do buffer no fim do stream
      const apply = (data: {
        type?: string
        content?: string
        model?: string
        message?: string
        conversationId?: string
        phase?: StreamStatus['phase']
        attempt?: number
        delayMs?: number
        reason?: string
        from?: string
        usage?: Message['metadata']
        elapsedMs?: number
        usedChars?: number
        totalChars?: number
        clipped?: boolean
      }) => {
        // Quanto do contexto o modelo recebeu (aviso visível quando o limite dele cortou o material)
        if (data.type === 'context' && data.model) {
          setContextNote({ model: data.model, usedChars: data.usedChars || 0, totalChars: data.totalChars || 0, clipped: !!data.clipped })
        }

        // Any event (even an error) may carry the id of the chat this message just created
        if (data.conversationId && !conversationId && streamingConvRef.current !== data.conversationId) {
          streamingConvRef.current = data.conversationId
          setConversationId(data.conversationId)
        }

        if (data.type === 'chunk' && data.content) {
          assistantContent += data.content
          firstAt ||= Date.now()
          if (!frame) frame = requestAnimationFrame(flush)
          // A barra superior passa de "conectando" para "gerando" no primeiro token
          setStreamStatus(prev => (prev && prev.phase !== 'streaming' ? { phase: 'streaming', model: prev.model } : prev))
        }

        if (data.type === 'reasoning' && data.content) {
          assistantReasoning += data.content
          firstAt ||= Date.now()
          if (!frame) frame = requestAnimationFrame(flush)
        }

        if (data.type === 'status') {
          setStreamStatus({
            phase: data.phase || 'connecting',
            model: data.model,
            from: data.from,
            attempt: data.attempt,
            delayMs: data.delayMs,
            reason: data.reason,
            message: data.message,
          })
          // Troca de modelo descarta o raciocínio do anterior; retry no mesmo modelo, não.
          if (data.phase === 'fallback') {
            assistantReasoning = ''
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, reasoning: undefined } : m))
            toast.info(data.from ? `${shortModelName(data.from)} não respondeu — trocando de modelo` : 'Trocando de modelo')
          }
        }

        if (data.type === 'model') {
          // Compatibilidade com servidores antigos
          assistantReasoning = ''
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, model: data.model, reasoning: undefined } : m))
          toast.info(`Modelo ocupado — trocando para ${shortModelName(data.model)}`)
        }

        if (data.type === 'done') {
          if (frame) cancelAnimationFrame(frame)
          flush()
          const stats = { firstMs: firstAt ? firstAt - sentAt : undefined, totalMs: Date.now() - sentAt }
          const usage = data.usage && typeof data.usage === 'object' ? data.usage : undefined
          setMessages(prev => prev.map(m => m.id === assistantId ? {
            ...m,
            model: data.model,
            stats,
            metadata: usage ? { ...m.metadata, usage, elapsedMs: data.elapsedMs } : m.metadata,
          } : m))
          setIsStreaming(false)
          setStreamStatus(null)
          fetch('/api/memory?action=conversations')
            .then(r => r.json())
            .then(d => setConversations(d.conversations || []))
            .catch(() => {})
          setSessionsRefresh(x => x + 1)
        }

        if (data.type === 'error') {
          throw new Error(data.message || 'Erro na geração')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // O parser remonta eventos cortados entre pacotes e ignora heartbeats/comentários
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          try { apply(JSON.parse(event.data)) } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
      for (const event of parser.flush()) {
        try { apply(JSON.parse(event.data)) } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
      if (frame) { cancelAnimationFrame(frame); flush() }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast.info('Geração interrompida')
      } else {
        // A pending repaint would overwrite the error with the partial text
        if (frame) cancelAnimationFrame(frame)
        const msg = error instanceof Error ? error.message : 'Erro desconhecido'
        const keyProblem = /chave|key|401|403|não configurad|nenhuma ia/i.test(msg)
        toast.error(`Erro: ${msg}`, keyProblem ? { action: { label: 'Chaves de API', onClick: () => openOverlay('keys') } } : undefined)
        const partial = hidePartialMarker(assistantContent)
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: `${partial ? `${partial}\n\n` : ''}❌ **Erro:** ${msg}${keyProblem ? '\n\nAbra **🔑 Chaves de API** no topo da tela para configurar.' : ''}` } : m
        ))
      }
    } finally {
      setIsStreaming(false)
      setStreamStatus(null)
    }
  }, [input, isStreaming, currentModel, conversationId, autoModel, projectId, agentMode, prefs, messages, openOverlay, imageAtts, pendingContext, setContextNote])

  const stopGeneration = () => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  // Voz real do navegador: reconhecimento em pt-BR para preencher o campo.
  const toggleMic = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Reconhecimento de fala indisponível. Use Chrome ou Edge.')
      return
    }
    if (isMicActive) {
      recognitionRef.current?.stop()
      setIsMicActive(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'pt-BR'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result: any) => result[0].transcript)
        .join(' ')
      setInput(transcript)
    }
    recognition.onend = () => setIsMicActive(false)
    recognition.onerror = () => setIsMicActive(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsMicActive(true)
  }

  // Foto/imagem para o chat: redimensiona (máx. 1280px, JPEG) e guarda em base64 na mensagem
  const attachImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await handleImageFiles(files)
  }
  const handleImageFiles = async (files: File[]) => {
    for (const file of files.slice(0, 2)) {
      if (!/^image\//.test(file.type)) { toast.error(`${file.name} não é uma imagem`); continue }
      try {
        const bitmap = await createImageBitmap(file)
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        const data = dataUrl.split(',')[1] || ''
        if (data.length > 2_900_000) { toast.error(`${file.name} ficou grande demais mesmo compactada`); continue }
        setImageAtts(prev => [...prev.slice(-1), { id: uuidv4(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) + '.jpg', data, preview: dataUrl }])
      } catch {
        toast.error(`Não consegui ler ${file.name}`)
      }
    }
  }
  const removeImageAtt = (id: string) => setImageAtts(prev => prev.filter(a => a.id !== id))

  // Jogar contexto: arquivos (texto, código, PDF, Word, Excel, PowerPoint…) viram contexto da conversa.
  // Antes o clipe colava só 12 mil caracteres de um arquivo de texto dentro da mensagem.
  const attachFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await chatCtx.addFiles(files)
  }

  /** Arquivos soltos no chat ou colados: imagens vão para a análise visual, o resto vira contexto. */
  const takeFiles = (files: File[]) => {
    const images = files.filter(f => /^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type))
    const docs = files.filter(f => !images.includes(f))
    if (images.length) handleImageFiles(images)
    if (docs.length) chatCtx.addFiles(docs)
  }
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth.current++; setDragOver(true) },
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false) },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      takeFiles(Array.from(e.dataTransfer.files))
    },
  }
  // Ctrl+V de arquivo vira contexto; um texto muito longo colado também (em vez de lotar a mensagem)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || [])
    if (files.length) { e.preventDefault(); takeFiles(files); return }
    const text = e.clipboardData.getData('text/plain')
    if (text.length > 8000) {
      e.preventDefault()
      chatCtx.addText(text)
      toast.info(`Texto longo (${text.length.toLocaleString('pt-BR')} caracteres) adicionado como contexto da conversa`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const runTerminalCommand = async () => {
    if (!terminalInput.trim() || terminalRunning) return
    const cmd = terminalInput.trim()
    setTerminalInput('')
    setTerminalRunning(true)

    setTerminalOutput(prev => [...prev, {
      id: uuidv4(), type: 'cmd', text: `> ${cmd}`, timestamp: Date.now(),
    }])

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, shell: 'powershell', stream: false }),
      })
      const data = await res.json()

      if (data.stdout) {
        setTerminalOutput(prev => [...prev, {
          id: uuidv4(), type: 'stdout', text: data.stdout, timestamp: Date.now(),
        }])
      }
      if (data.stderr) {
        setTerminalOutput(prev => [...prev, {
          id: uuidv4(), type: 'stderr', text: data.stderr, timestamp: Date.now(),
        }])
      }
      if (data.error) {
        setTerminalOutput(prev => [...prev, {
          id: uuidv4(), type: 'error', text: data.error, timestamp: Date.now(),
        }])
      }

      if (typeof data.exitCode === 'number') {
        setTerminalOutput(prev => [...prev, {
          id: uuidv4(), type: data.exitCode === 0 ? 'success' : 'error',
          text: `Saiu com código ${data.exitCode} · ${data.duration}ms`,
          timestamp: Date.now(),
        }])
      }
    } catch {
      setTerminalOutput(prev => [...prev, {
        id: uuidv4(), type: 'error', text: 'Falha ao executar comando', timestamp: Date.now(),
      }])
    } finally {
      setTerminalRunning(false)
    }
  }

  const quickActions: Array<{ icon: typeof Code2; label: string; prompt: string; open?: () => void }> = [
    { icon: Code2, label: 'Programar', prompt: 'Crie um projeto de software completo, com código, testes e README.' },
    { icon: Video, label: 'Vídeo', prompt: '', open: () => openOverlay('motion') },
    { icon: ImageIcon, label: 'Imagem', prompt: 'Gere uma imagem de ' },
    { icon: BookOpen, label: 'Faculdade', prompt: '', open: () => { closeOverlays(); setHubOpen(true) } },
    { icon: Share2, label: 'Social', prompt: 'Crie um calendário de conteúdo para redes sociais e escreva os posts.' },
    { icon: Database, label: 'Dados', prompt: 'Analise os dados que eu enviar e gere um relatório com insights.' },
    { icon: MessageCircle, label: 'WhatsApp', prompt: '', open: () => { closeOverlays(); setHubOpen(false); setShowWhatsApp(true) } },
  ]

  const railActive: RailItem = showWhatsApp ? 'whatsapp' : showSocial ? 'social' : showMotion ? 'motion' : showSkills ? 'skills' : hubOpen ? 'hub' : teamMode && activeSession ? 'team' : 'chat'
  const onRail = (item: RailItem) => {
    if (item === 'chat') { closeOverlays(); setShowWhatsApp(false); if (hubOpen) setHubOpen(false); else newChat() }
    else if (item === 'team') { closeOverlays(); setShowWhatsApp(false); setHubOpen(false); newTeamSession() }
    else if (item === 'hub') { closeOverlays(); setShowWhatsApp(false); setHubOpen(o => !o) }
    else if (item === 'whatsapp') { closeOverlays(); setHubOpen(false); setShowWhatsApp(o => !o) }
    else if (item === 'social') openOverlay('social', true)
    else if (item === 'motion') openOverlay('motion', true)
    else openOverlay('skills', true)
  }
  const firstAsk = messages.find(m => m.role === 'user' && m.content)?.content
  const headerTitle = showWhatsApp ? 'JARVIS WhatsApp Center' : hubOpen ? 'Hub Escolar' : teamMode && activeSession ? activeSession.title || 'Equipe de agentes' : firstAsk ? firstAsk.replace(/\s+/g, ' ').slice(0, 80) : 'Nova conversa'

  // Ações reais da tela para a central de comandos (Ctrl+K). Nada aqui é decorativo.
  const paletteCommands: PaletteCommand[] = [
    { id: 'new-chat', label: 'Nova conversa', hint: 'Começar do zero', group: 'Ações', icon: MessageSquarePlus, shortcut: 'Ctrl N', keywords: 'chat limpar', run: newChat },
    { id: 'new-team', label: 'Nova sessão de equipe', hint: 'Abrir o workspace multiagente', group: 'Ações', icon: Users, keywords: 'agentes time', run: () => { void newTeamSession() } },
    { id: 'agent-mode', label: agentMode ? 'Desligar modo agente' : 'Ligar modo agente', hint: agentMode ? 'Voltar a só conversar' : 'Permitir execução de arquivos e comandos', group: 'Ações', icon: Zap, keywords: 'executar ferramenta', run: toggleAgentMode },
    { id: 'auto-model', label: autoModel ? 'Desligar IA automática' : 'Ligar IA automática', hint: 'Escolher o melhor modelo por tarefa', group: 'Ações', icon: Sparkles, keywords: 'roteamento modelo', run: () => setAutoModel(v => !v) },
    { id: 'council', label: 'Conselho de IA', hint: 'Vários modelos respondem a mesma pergunta; o árbitro consolida', group: 'Ações', icon: Sparkles, keywords: 'council conselho consultar modelos especialistas', run: () => { setInput('/council '); inputRef.current?.focus(); closeOverlays() } },
    { id: 'models', label: 'Gerenciar modelos', hint: 'Nuvem, locais, testes e downloads', group: 'Ações', icon: Server, keywords: 'catálogo ollama', run: () => openOverlay('models') },
    { id: 'keys', label: 'Chaves de API', hint: 'Conectar provedores gratuitos', group: 'Ações', icon: KeyRound, keywords: 'credencial provedor', run: () => openOverlay('keys') },
    { id: 'settings', label: 'Configurações', hint: 'Aparência, agente e preferências', group: 'Ações', icon: Settings, shortcut: 'Ctrl ,', keywords: 'preferências tema', run: () => openOverlay('settings') },
    { id: 'hub', label: 'Hub Escolar', hint: 'Disciplinas, provas e trabalhos', group: 'Navegação', icon: GraduationCap, keywords: 'faculdade estudo', run: () => { closeOverlays(); setHubOpen(true) } },
  { id: 'whatsapp', label: 'WhatsApp Center', hint: 'Integração oficial Meta', group: 'Navegação', icon: MessageCircle, keywords: 'whatsapp meta mensagens', run: () => { closeOverlays(); setHubOpen(false); setShowWhatsApp(true) } },
    { id: 'skills', label: 'Skills e MCP', hint: 'Extensões, plugins e servidores', group: 'Navegação', icon: Package, keywords: 'plugin ferramenta', run: () => openOverlay('skills') },
    { id: 'motion', label: 'Estúdio de Vídeo', hint: 'Vídeos profissionais com IA', group: 'Navegação', icon: Video, keywords: 'vídeo clipe render documentário anúncio shorts reels', run: () => openOverlay('motion') },
    { id: 'social', label: 'Social', hint: 'Instagram e TikTok via Metricool', group: 'Navegação', icon: TrendingUp, keywords: 'post conteúdo', run: () => openOverlay('social') },
    { id: 'infra', label: 'Infraestrutura', hint: 'Monitores, servidores e backups', group: 'Navegação', icon: Database, keywords: 'servidor rede', run: () => openOverlay('infra') },
    { id: 'sidebar', label: sidebarOpen ? 'Esconder conversas' : 'Mostrar conversas', hint: 'Barra lateral de sessões', group: 'Painéis', icon: PanelLeft, keywords: 'histórico', run: toggleSidebar },
    { id: 'panel-toggle', label: rightPanelOpen ? 'Esconder terminal e arquivos' : 'Mostrar terminal e arquivos', hint: 'Painel direito', group: 'Painéis', icon: Terminal, keywords: 'shell', run: toggleRightPanel },
    { id: 'panel-terminal', label: 'Abrir terminal', hint: 'PowerShell integrado', group: 'Painéis', icon: Terminal, keywords: 'comando shell', run: () => { setRightPanelOpen(true); setRightTab('terminal'); savePanels(sidebarOpen, true) } },
    { id: 'panel-memory', label: 'Abrir memória', hint: 'Memórias persistentes', group: 'Painéis', icon: Brain, keywords: 'lembrar contexto', run: () => { setRightPanelOpen(true); setRightTab('memory'); savePanels(sidebarOpen, true) } },
    { id: 'panel-files', label: 'Abrir arquivos', hint: 'Navegar no projeto', group: 'Painéis', icon: FolderOpen, keywords: 'explorador', run: () => { setRightPanelOpen(true); setRightTab('files'); savePanels(sidebarOpen, true) } },
  ]

  return (
    <MotionConfig reducedMotion={prefs?.appearance.motion === 'full' || !prefs ? 'never' : 'always'}>
    <div className="ui-root" style={{ '--ui-scale': uiScale } as React.CSSProperties}>
      {(prefs?.appearance.particles ?? true) && prefs?.appearance.motion !== 'off' && <NeuralBackground intensity={isStreaming ? 2.4 : 1} />}
      <div className="hud-overlay" aria-hidden style={{ display: prefs?.appearance.motion === 'off' ? 'none' : undefined }} />
      <BootSequence />
      <InfraAlerts onOpen={() => openOverlay('infra')} />
      <NavRail active={railActive} onSelect={onRail} onKeys={() => openOverlay('keys')} onSettings={() => openOverlay('settings')} keysMissing={connectedProviders === 0} />
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
                    onClick={() => setSidebarTab(t)}
                    className={`relative flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors ${sidebarTab === t ? 'text-cyan-200' : 'text-white/40 hover:text-white/70'}`}
                  >
                    {sidebarTab === t && <motion.span layoutId="sidebar-tab-pill" className="absolute inset-0 rounded-md bg-cyan-500/15 border border-cyan-400/20" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                    <span className="relative">{t === 'chat' ? 'Conversas' : 'Memória'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2">
              {sidebarTab === 'chat' && (
                <SessionsPanel
                  projectId={projectId}
                  onProjectChange={changeProject}
                  activeSessionId={activeSession?.id || conversationId}
                  onOpen={openSession}
                  onNewChat={newChat}
                  onNewTeam={newTeamSession}
                  refreshKey={sessionsRefresh}
                  onDeleted={onSessionsDeleted}
                />
              )}

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

      {/* ─── MAIN CHAT AREA ─── */}
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
          title={headerTitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          agentMode={agentMode}
          onToggleAgentMode={toggleAgentMode}
          currentModel={currentModel}
          autoModel={autoModel}
          onOpenModels={() => openOverlay('models')}
          onToggleAuto={() => setAutoModel(v => !v)}
          connected={connectedProviders}
          onOpenPalette={() => setShowPalette(true)}
          rightPanelOpen={rightPanelOpen}
          onToggleRightPanel={toggleRightPanel}
          streaming={isStreaming}
          status={streamStatus}
          clock={clock}
        />
        <div className="topbar-hairline" aria-hidden />
        {isStreaming && <div className="stream-bar" role="progressbar" aria-label="JARVIS respondendo" />}

        {showWhatsApp ? (
          <WhatsAppCenter onClose={() => setShowWhatsApp(false)} />
        ) : hubOpen ? (
          <HubWorkspace onOpenSession={(s) => { openSession(s); setSessionsRefresh(x => x + 1) }} />
        ) : teamMode && activeSession ? (
          <AgentsWorkspace
            key={activeSession.id}
            session={activeSession}
            project={projects.find(p => p.id === activeSession.projectId)}
            onChanged={bumpSessions}
            onProjectChange={(id) => {
              setActiveSession(s => (s ? { ...s, projectId: id } : s))
              setProjectIdState(id)
              try { localStorage.setItem('jarvis.project', id) } catch {}
              setSessionsRefresh(x => x + 1)
            }}
          />
        ) : (<>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 py-12">
              <motion.div
                initial={false}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ duration: 1, ease: [0.2, 0.9, 0.2, 1] }}
                whileHover={{ scale: 1.06 }}
                className="mb-6 hero-atom cursor-pointer mo-float"
                onClick={() => inputRef.current?.focus()}
              >
                <div className="jarvis-radar" aria-hidden />
                <div className="hero-beam" aria-hidden />
                <div className="hero-ring r3" />
                <div className="hero-ring r1" />
                <div className="hero-ring r2" />
                <div className="hero-shock" /><div className="hero-shock s2" /><div className="hero-shock s3" />
                <span className="hero-logo-wrap"><JarvisLogo size={96} speed={1.4} /></span>
              </motion.div>
              <HeroTitle />
              <TypedTagline />

              {connectedProviders === 0 && (
                <motion.button
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  onClick={() => openOverlay('keys')}
                  className="mo-spot mb-8 w-full max-w-2xl flex items-center gap-4 p-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] hover:bg-amber-400/10 text-left transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center flex-shrink-0">
                    <KeyRound size={18} className="text-amber-300" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-amber-100">Nenhuma IA conectada ainda</div>
                    <div className="text-xs text-white/40 mt-0.5">Adicione uma chave grátis (Gemini, Groq, Cerebras…) para o JARVIS começar a executar.</div>
                  </div>
                  <ChevronRight size={16} className="text-amber-300/70" />
                </motion.button>
              )}

              {prefs?.showTips !== false && !tipsHidden && (
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mb-6 w-full max-w-2xl hud-corners rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={14} className="text-cyan-300" />
                    <div className="text-xs font-semibold text-white/80">Primeiros passos</div>
                    <button onClick={() => setTipsHidden(true)} title="Ocultar dicas" className="ml-auto p-1 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5"><X size={13} /></button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2 mo-stagger">
                    <button onClick={() => openOverlay('keys')} className="mo-spot flex items-start gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 text-left transition-colors">
                      <div className="w-5 h-5 rounded-full bg-cyan-500/15 text-cyan-200 text-[10px] flex items-center justify-center flex-shrink-0">{connectedProviders === 0 ? '1' : <Check size={11} />}</div>
                      <div>
                        <div className="text-[11px] text-white/85">Conecte uma IA</div>
                        <div className="text-[10px] text-white/35">Chave grátis em 1 minuto</div>
                      </div>
                    </button>
                    <button onClick={() => openOverlay('settings')} className="mo-spot flex items-start gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 text-left transition-colors">
                      <div className="w-5 h-5 rounded-full bg-cyan-500/15 text-cyan-200 text-[10px] flex items-center justify-center flex-shrink-0">2</div>
                      <div>
                        <div className="text-[11px] text-white/85">Configure</div>
                        <div className="text-[10px] text-white/35">Agente, aparência e mais</div>
                      </div>
                    </button>
                    <button onClick={() => { setInput('Crie um projeto de software completo, com testes e README.'); inputRef.current?.focus() }} className="mo-spot flex items-start gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 text-left transition-colors">
                      <div className="w-5 h-5 rounded-full bg-cyan-500/15 text-cyan-200 text-[10px] flex items-center justify-center flex-shrink-0">3</div>
                      <div>
                        <div className="text-[11px] text-white/85">Dê a primeira ordem</div>
                        <div className="text-[10px] text-white/35">Ele executa de verdade</div>
                      </div>
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="grid grid-cols-3 gap-2 w-full max-w-2xl">
                {quickActions.map(({ icon: Icon, label, prompt, open }, i) => (
                  <TiltCard key={label} delay={0.08 * i + 0.7} onClick={() => { if (open) { open(); return } setInput(prompt); inputRef.current?.focus() }}>
                    <div className="relative">
                      <div className="w-9 h-9 mb-3 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 group-hover:bg-cyan-500/20 group-hover:shadow-[0_0_18px_rgba(0,212,255,0.45)] transition-all">
                        <Icon size={18} className="text-cyan-300 group-hover:scale-110 group-hover:rotate-[-8deg] transition-transform" />
                      </div>
                      <div className="text-sm font-semibold text-white/85 group-hover:text-white transition-colors">{label}</div>
                      <ChevronRight size={14} className="absolute right-0 top-1 text-cyan-300/0 group-hover:text-cyan-300/80 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </TiltCard>
                ))}
              </div>
            </div>
          ) : (
            <div className="pb-4 chat-column">
              {messages.map((msg, i) => (isStreaming && !msg.content && !msg.reasoning && msg.role === 'assistant' && !msg.run) ? null : msg.run ? (
                <div key={msg.id} className="px-4 py-1.5 flex justify-start">
                  <RunInlineCard
                    runId={msg.run.id}
                    sessionId={msg.run.sessionId}
                    title={[...messages].reverse().find(m => m.role === 'user' && m.content)?.content}
                    onOpenWorkspace={openRunSession}
                    onChanged={() => setSessionsRefresh(x => x + 1)}
                  />
                </div>
              ) : msg.video ? (
                <div key={msg.id} className="px-4 py-1.5 flex justify-start">
                  <VideoJobInline jobId={msg.video.jobId} />
                </div>
              ) : msg.image ? (
                <div key={msg.id} className="px-4 py-1.5 flex justify-start">
                  <ImageJobInline prompt={msg.image.prompt} imageUrl={msg.image.url} />
                </div>
              ) : (
                <motion.div
                  key={msg.id}
                  className="px-4 py-1.5 flex"
                  style={{ justifyContent: msg.role === 'user' ? 'end' : 'start' }}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.2, 0.9, 0.2, 1] }}
                >
                  <MessageBubble
                    msg={msg}
                    onCopy={copyToClipboard}
                    streaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
                  />
                </motion.div>
              ))}
              {isStreaming && messages[messages.length - 1]?.content === '' && !messages[messages.length - 1]?.reasoning && (
                <TypingIndicator
                  model={streamStatus?.model || (autoModel ? undefined : currentModel)}
                  status={streamStatus}
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4">
          <div className="relative chat-column">
            <SlashMenu input={input} onPick={t => { setInput(t); inputRef.current?.focus() }} />
            <ContextBar ctx={chatCtx} pasteOpen={pasteOpen} onClosePaste={() => setPasteOpen(false)} />
            {imageAtts.length > 0 && (
              <div className="flex items-center gap-2 px-2 pb-2 flex-wrap">
                {imageAtts.map(img => (
                  <div key={img.id} className="relative">
                    <img src={img.preview} alt={img.name} className="h-14 w-14 rounded-lg object-cover border border-cyan-400/30" />
                    <button
                      onClick={() => removeImageAtt(img.id)}
                      title="Remover imagem"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black/85 border border-white/25 text-white/85 flex items-center justify-center hover:text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <span className="text-[10px] text-cyan-200/60">Anexada(s) — o Gemini analisa nesta mensagem; peça edições, análise ou “transforme em vídeo”</span>
              </div>
            )}
            <div className={`energy-border ${isStreaming ? 'streaming' : ''}`}>
            <div className="energy-inner relative flex items-end gap-2 p-3">
              <button
                onClick={toggleMic}
                title={isMicActive ? 'Parar de ouvir' : 'Falar com o JARVIS'}
                className={`p-2 rounded-xl transition-all relative ${isMicActive ? 'mic-live bg-red-500/20 text-red-400 jarvis-voice-ring' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
              >
                {isMicActive ? (
                  <>
                    <MicOff size={16} />
                    <div className="jarvis-eq" aria-hidden>
                      <i /><i /><i /><i /><i />
                    </div>
                  </>
                ) : <Mic size={16} />}
              </button>

              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Dê uma ordem ao JARVIS: execute, crie, corrija, investigue…"
                rows={1}
                className="flex-1 bg-transparent resize-none text-sm text-white/90 placeholder-white/20 outline-none py-1 max-h-32 leading-6"
                style={{ lineHeight: '1.5rem' }}
                onInput={e => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = `${Math.min(target.scrollHeight, 128)}px`
                }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                title="Jogar contexto: arquivos de texto, código, PDF, Word, Excel, PowerPoint… (ou arraste para o chat)"
                aria-label="Adicionar arquivos como contexto"
                className={`relative p-2 rounded-xl transition-all ${chatCtx.items.length ? 'text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
              >
                <Paperclip size={16} />
                {chatCtx.items.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-0.5 rounded-full bg-cyan-500 text-[9px] font-bold text-black flex items-center justify-center">{chatCtx.items.length}</span>}
              </button>
              <input ref={fileInputRef} type="file" hidden multiple onChange={attachFile} />
              <button
                onClick={() => setPasteOpen(v => !v)}
                title="Colar um texto longo como contexto da conversa"
                aria-label="Colar texto como contexto"
                aria-expanded={pasteOpen}
                className={`p-2 rounded-xl transition-all ${pasteOpen ? 'text-cyan-300 bg-cyan-500/15' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
              >
                <ClipboardPaste size={16} />
              </button>
              <button
                onClick={() => imageInputRef.current?.click()}
                title="Anexar imagem (o Gemini analisa e edita)"
                className="p-2 rounded-xl text-white/30 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all"
              >
                <ImageIcon size={16} />
              </button>
              <input ref={imageInputRef} type="file" hidden accept="image/*" multiple onChange={attachImages} />

              {isStreaming ? (
                <button
                  onClick={stopGeneration}
                  className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                >
                  <Square size={16} />
                </button>
              ) : (
                <motion.button
                  onClick={sendMessage}
                  disabled={!input.trim() && imageAtts.length === 0}
                  whileHover={input.trim() || imageAtts.length ? { scale: 1.08 } : undefined}
                  whileTap={input.trim() || imageAtts.length ? { scale: 0.9, rotate: -12 } : undefined}
                  className={`p-2 rounded-xl transition-colors jarvis-send-pulse ${input.trim() || imageAtts.length ? 'send-ready bg-cyan-500/25 text-cyan-300 hover:bg-cyan-500/35' : 'text-white/15 cursor-not-allowed'}`}
                >
                  <Send size={16} />
                </motion.button>
              )}
            </div>
            </div>
            <div className="flex items-center justify-between mt-2 px-1 gap-3">
              <button
                onClick={toggleAgentMode}
                title={agentMode ? 'Clique para desligar o modo agente' : 'Clique para ligar o modo agente'}
                className={`flex items-center gap-1.5 text-[10px] font-mono rounded-md px-1.5 py-0.5 border transition-colors ${agentMode ? 'text-emerald-300/90 border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20' : 'text-white/35 border-white/10 hover:text-white/60 hover:bg-white/5'}`}
              >
                <Zap size={10} />
                {agentMode ? 'AGENTE: executa de verdade' : 'CHAT: só responde'}
              </button>
              {agentMode && (
                <button
                  onClick={cyclePermissionMode}
                  title={PERMISSION_LABELS[permissionMode].hint}
                  className="flex items-center gap-1.5 text-[10px] font-mono rounded-md px-1.5 py-0.5 border border-white/10 text-white/45 hover:text-white/75 hover:bg-white/5 transition-colors"
                >
                  <ShieldCheck size={10} />
                  {PERMISSION_LABELS[permissionMode].name.toUpperCase()}
                </button>
              )}
              <div className="flex-1" />
              <span className="text-[10px] text-white/20 hidden sm:inline">Enter envia · Shift+Enter nova linha · Ctrl+K comandos · Esc interrompe</span>
            </div>
          </div>
        </div>
        </>)}
        <StatusBar
          streaming={isStreaming}
          agentMode={agentMode}
          model={autoModel ? 'Automático' : currentModel}
          projectId={projectId}
          connected={connectedProviders}
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
            {/* Panel tabs */}
            <div role="tablist" className="flex p-2 gap-1 border-b border-white/5">
              {([
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

            {/* Terminal */}
            {rightTab === 'terminal' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-2 flex items-center justify-between border-b border-white/5">
                  <span className="text-[11px] text-white/40 font-mono">PowerShell · JARVIS</span>
                  <button onClick={() => setTerminalOutput([])} className="p-1 rounded hover:bg-white/5">
                    <Trash2 size={11} className="text-white/30" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 font-mono text-xs terminal-output">
                  <div className="dim mb-2" suppressHydrationWarning>JARVIS Terminal — PowerShell {new Date().toLocaleString('pt-BR')}</div>
                  {terminalOutput.map(e => (
                    <div key={e.id} className={`mb-0.5 ${e.type === 'cmd' ? 'cmd' : e.type === 'stderr' ? 'error' : e.type === 'error' ? 'error' : e.type === 'success' ? 'success' : ''}`}>
                      {e.text}
                    </div>
                  ))}
                  {terminalRunning && <div className="text-cyan-400 animate-pulse">Executando...</div>}
                </div>
                <div className="p-2 border-t border-white/5">
                  <div className="flex items-center gap-2 bg-black/50 rounded-lg px-3 py-2 border border-white/5">
                    <span className="text-cyan-400 font-mono text-xs">PS &gt;</span>
                    <input
                      ref={termInputRef}
                      value={terminalInput}
                      onChange={e => setTerminalInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && runTerminalCommand()}
                      placeholder="Digite um comando..."
                      className="flex-1 bg-transparent text-xs font-mono text-white/80 outline-none placeholder-white/20"
                    />
                    <button
                      onClick={runTerminalCommand}
                      disabled={terminalRunning}
                      className="text-cyan-400/60 hover:text-cyan-400 transition-colors disabled:opacity-30"
                    >
                      {terminalRunning ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Memory */}
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

            {/* Files */}
            {rightTab === 'files' && <FilesPanel />}
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
          onSelectModel={id => {
            setCurrentModel(id)
            setAutoModel(false)
            toast.success(`Modelo ativo: ${shortModelName(id)}`)
          }}
        />
      )}

      {/* ─── MODALS ─── */}
      <>
        {showModelManager && (
          <ModelManagerModal
            key="mm"
            onClose={() => setShowModelManager(false)}
            onSelect={setCurrentModel}
            onOpenKeys={() => openOverlay('keys')}
            currentModel={currentModel}
          />
        )}
        {showKeys && (
          <ApiKeysModal
            key="keys"
            onClose={() => { setShowKeys(false); refreshModels() }}
          />
        )}
        {showSkills && (
          <SkillEnginePanel
            key="skills"
            onClose={() => setShowSkills(false)}
          />
        )}
        {showFirstRun && (
          <FirstRunSetup
            key="first-run"
            onDone={() => setShowFirstRun(false)}
            onSkip={() => { try { localStorage.setItem('jarvis.firstRunSkipped', '1') } catch {} ; setShowFirstRun(false) }}
          />
        )}
        {showMotion && (
          <VideoStudio
            key="motion"
            onClose={() => setShowMotion(false)}
          />
        )}
        {showInfra && (
          <InfraPanel
            key="infra"
            onClose={() => setShowInfra(false)}
          />
        )}
        {showSocial && (
          <SocialPanel
            key="social"
            onClose={() => setShowSocial(false)}
          />
        )}
        {showSettings && (
          <SettingsPanel
            key="settings"
            onClose={() => setShowSettings(false)}
            onOpenKeys={() => openOverlay('keys')}
            model={currentModel}
            onModel={id => { if (id) setCurrentModel(id); else { try { localStorage.removeItem('jarvis.model') } catch {} setCurrentModelState(''); refreshModels() } }}
            autoModel={autoModel}
            onAutoModel={setAutoModel}
            onExample={text => {
              setShowSettings(false)
              setInput(text)
              setTimeout(() => inputRef.current?.focus(), 60)
            }}
          />
        )}
      </>
    </div>
    </MotionConfig>
  )
}