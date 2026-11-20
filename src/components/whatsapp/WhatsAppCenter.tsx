'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  MessageCircle, Settings, RefreshCw, Send, Search, User, Phone, Paperclip,
  CheckCircle2, XCircle, Plug, Unplug, Shield, Bell, Zap, Brain, Languages,
  FileText, Image as ImageIcon, Mic, MapPin, Download, Trash2, Plus, Tag,
  Clock, AlertCircle, ChevronRight, X, Upload, Sparkles, ListChecks, Eye,
} from 'lucide-react'
import { toast } from 'sonner'

type Status = any

const api = {
  get: (p: string) => fetch(p, { cache: 'no-store' }).then(r => r.json()),
  post: (p: string, b: any) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
}

export default function WhatsAppCenter() {
  const [status, setStatus] = useState<Status | null>(null)
  const [conversations, setConversations] = useState<any[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [convDetail, setConvDetail] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [sending, setSending] = useState(false)
  const [config, setConfig] = useState({ appId: '', appSecret: '', apiVersion: 'v20.0', redirectUri: '', verifyToken: '' })
  const [showConfig, setShowConfig] = useState(false)
  const [notifications, setNotifications] = useState<any[]>([])
  const [automations, setAutomations] = useState<any[]>([])
  const [aiBusy, setAiBusy] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [contacts, setContacts] = useState<any[]>([])
  const [mediaUploading, setMediaUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const loadStatus = useCallback(async () => {
    try { setStatus(await api.get('/api/whatsapp/status')) } catch {}
  }, [])
  const loadConversations = useCallback(async () => {
    try {
      const d = await api.get('/api/whatsapp/conversations')
      setConversations(d.conversations || [])
    } catch {}
  }, [])
  const loadNotifications = useCallback(async () => {
    try {
      const d = await api.get('/api/whatsapp/notifications')
      setNotifications(d.notifications || [])
    } catch {}
  }, [])
  const loadAutomations = useCallback(async () => {
    try {
      const d = await api.get('/api/whatsapp/automations')
      setAutomations(d.automations || [])
    } catch {}
  }, [])
  const loadContacts = useCallback(async () => {
    try {
      const d = await api.get('/api/whatsapp/contacts')
      setContacts(d.contacts || [])
    } catch {}
  }, [])

  const openConversation = useCallback(async (id: string) => {
    setSelected(id)
    try {
      const d = await api.get(`/api/whatsapp/conversations?id=${encodeURIComponent(id)}`)
      setConvDetail(d.conversation)
      setMessages(d.messages || [])
      await api.post('/api/whatsapp/conversations', { action: 'mark-read', id })
      loadConversations()
    } catch {}
  }, [loadConversations])

  useEffect(() => {
    loadStatus(); loadConversations(); loadNotifications(); loadAutomations(); loadContacts()
    // SSE
    const es = new EventSource('/api/whatsapp/events')
    esRef.current = es
    es.addEventListener('message', (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.message) {
          loadConversations()
          if (selected && (d.message.conversationId === selected || d.message.to === selected)) {
            setMessages(prev => [...prev, d.message])
          }
          loadNotifications()
        }
        if (d.status) {
          setMessages(prev => prev.map(m => m.id === d.status.messageId ? { ...m, status: d.status.status } : m))
        }
      } catch {}
    })
    es.addEventListener('ready', () => {})
    return () => { es.close() }
  }, [loadStatus, loadConversations, loadNotifications, loadAutomations, loadContacts, selected])

  // sync config form from status
  useEffect(() => {
    if (status?.config) {
      setConfig(c => ({
        ...c,
        appId: status.config.appId || c.appId,
        apiVersion: status.config.apiVersion || c.apiVersion,
        redirectUri: status.config.redirectUri || c.redirectUri,
        verifyToken: status.config.verifyToken || c.verifyToken,
      }))
    }
  }, [status])

  const saveConfig = async () => {
    const r = await api.post('/api/whatsapp/status', { action: 'save-config', ...config })
    if (r?.error) toast.error(r.error); else { toast.success('Configuração salva'); loadStatus() }
  }

  const connect = async () => {
    const r = await api.get('/api/whatsapp/oauth/start')
    if (r?.error) { toast.error(r.error); return }
    const popup = window.open(r.url, 'wa-oauth', 'width=600,height=700')
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'wa-oauth') {
        window.removeEventListener('message', handler)
        if (ev.data.ok) { toast.success('WhatsApp conectado'); loadStatus(); loadConversations() }
        else toast.error(ev.data.error || 'Falha na conexão')
      }
    }
    window.addEventListener('message', handler)
  }

  const disconnect = async (erase = false) => {
    await api.post('/api/whatsapp/status', { action: 'save-config' }).catch(() => {})
    // use service disconnect via? no direct route; call status? add disconnect action
    await fetch('/api/whatsapp/disconnect', { method: 'POST' }).catch(() => {})
    loadStatus()
  }

  const send = async () => {
    if (!msgInput.trim() || !selected) return
    setSending(true)
    try {
      const r = await api.post('/api/whatsapp/send', { to: selected, type: 'text', text: msgInput })
      if (r?.error) toast.error(r.error)
      else {
        setMsgInput('')
        setMessages(prev => [...prev, { id: r.messageId || `tmp-${Date.now()}`, conversationId: selected, direction: 'outbound', from: 'me', to: selected, type: 'text', text: msgInput, timestamp: Date.now(), status: 'sent' }])
        loadConversations()
      }
    } finally { setSending(false) }
  }

  const uploadAndSendMedia = async (file: File) => {
    setMediaUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('/api/whatsapp/media', { method: 'POST', body: form }).then(x => x.json())
      if (r?.error) { toast.error(r.error); return }
      const type = file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'document'
      const sr = await api.post('/api/whatsapp/send', { to: selected, type, mediaId: r.id, caption: msgInput || undefined, filename: file.name })
      if (sr?.error) toast.error(sr.error)
      else {
        setMsgInput('')
        toast.success('Mídia enviada')
        loadConversations()
      }
    } finally { setMediaUploading(false) }
  }

  const diagnose = async () => {
    const r = await api.post('/api/whatsapp/status', { action: 'diagnose' })
    toast.success('Diagnóstico concluído')
    console.log(r)
  }

  const simulate = async () => {
    await api.post('/api/whatsapp/status', { action: 'simulate-webhook' })
    toast.success('Webhook simulado')
    loadConversations()
  }

  const runAI = async (action: string, extra?: any) => {
    setAiBusy(action)
    setAiResult('')
    try {
      const r = await api.post('/api/whatsapp/ai', { action, conversationId: selected, ...extra })
      if (r?.error) toast.error(r.error)
      else setAiResult(r.summary || r.suggestion || r.category || r.tasks || r.translation || JSON.stringify(r))
    } catch (e: any) { toast.error(e.message) }
    finally { setAiBusy('') }
  }

  const filteredConvs = conversations.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.id || '').includes(s)
  })

  const cfgOk = status?.config?.hasAppSecret && status?.config?.appId

  return (
    <div className="flex flex-col h-full bg-[#05080f] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/30 flex items-center justify-center">
            <MessageCircle size={18} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">JARVIS WhatsApp Center</h1>
            <p className="text-xs text-white/40">Integração oficial Meta Cloud API</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${status?.config?.connected ? 'border-green-500/30 text-green-300 bg-green-500/10' : 'border-white/10 text-white/40'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status?.config?.connected ? 'bg-green-400' : 'bg-white/30'}`} />
            {status?.config?.connected ? 'Conectado' : 'Desconectado'}
          </span>
          <button onClick={() => setShowConfig(s => !s)} className="p-2 rounded-lg hover:bg-white/5 text-white/60"><Settings size={16} /></button>
          <button onClick={loadStatus} className="p-2 rounded-lg hover:bg-white/5 text-white/60"><RefreshCw size={16} /></button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="border-b border-white/5 px-6 py-4 bg-white/[0.02]">
          <div className="grid grid-cols-2 gap-3 max-w-4xl">
            <div>
              <label className="text-[11px] text-white/50">App ID (Meta)</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={config.appId} onChange={e => setConfig({ ...config, appId: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] text-white/50">App Secret</label>
              <input type="password" className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={config.appSecret} onChange={e => setConfig({ ...config, appSecret: e.target.value })} placeholder={status?.config?.hasAppSecret ? '•••••• (salvo)' : ''} />
            </div>
            <div>
              <label className="text-[11px] text-white/50">API Version</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={config.apiVersion} onChange={e => setConfig({ ...config, apiVersion: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] text-white/50">Redirect URI (OAuth callback)</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={config.redirectUri} onChange={e => setConfig({ ...config, redirectUri: e.target.value })} placeholder="https://seu-dominio/api/whatsapp/oauth/callback" />
            </div>
            <div>
              <label className="text-[11px] text-white/50">Verify Token (webhook)</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" value={config.verifyToken} onChange={e => setConfig({ ...config, verifyToken: e.target.value })} placeholder={status?.config?.verifyToken ? 'salvo' : 'gerar automaticamente'} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveConfig} className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium">Salvar</button>
            <button onClick={diagnose} className="px-4 py-2 rounded-lg border border-white/10 text-sm">Diagnosticar</button>
            <button onClick={simulate} className="px-4 py-2 rounded-lg border border-white/10 text-sm">Simular webhook</button>
          </div>
          <div className="mt-3 text-[11px] text-white/40 space-y-1">
            <p>Callback URL do webhook (configure no painel Meta): <span className="text-white/70 font-mono">https://SEU_DOMINIO_PUBLICO/api/whatsapp/webhook</span></p>
            <p>Verify Token: <span className="text-white/70 font-mono">{status?.config?.verifyToken || '(salve para gerar)'}</span></p>
            <p>Escopos: whatsapp_business_messaging, whatsapp_business_management</p>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Left: conversations */}
        <div className="w-[320px] border-r border-white/5 flex flex-col">
          {/* Connect card */}
          <div className="p-4 border-b border-white/5">
            {!status?.config?.connected ? (
              <div className="space-y-2">
                <button
                  onClick={connect}
                  disabled={!cfgOk}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-500 text-black font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plug size={16} /> Conectar WhatsApp
                </button>
                {!cfgOk && <p className="text-[11px] text-amber-300/80">Configure App ID e App Secret antes de conectar.</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 size={16} className="text-green-400" />
                  <span className="truncate">{status.config.verifiedName || status.config.displayPhoneNumber}</span>
                </div>
                <p className="text-[11px] text-white/40">{status.config.displayPhoneNumber}</p>
                <div className="flex gap-2">
                  <button onClick={() => api.post('/api/whatsapp/status', { action: 'diagnose' }).then(d => { console.log(d); toast.success('Diagnóstico ok') })} className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 text-xs">Diagnosticar</button>
                  <button onClick={() => { if (confirm('Desconectar?')) disconnect(true) }} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 text-xs"><Unplug size={12} /></button>
                </div>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5">
              <Search size={14} className="text-white/40" />
              <input className="flex-1 bg-transparent text-sm outline-none" placeholder="Pesquisar contatos/mensagens" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.length === 0 && (
              <div className="p-6 text-center text-xs text-white/30">
                {status?.config?.connected ? 'Nenhuma conversa ainda. Envie ou receba uma mensagem.' : 'Conecte o WhatsApp para ver conversas.'}
              </div>
            )}
            {filteredConvs.map(c => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] ${selected === c.id ? 'bg-white/[0.06]' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{c.name || c.phone || c.id}</span>
                  {c.unread > 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500 text-black">{c.unread}</span>}
                </div>
                <div className="text-xs text-white/40 truncate mt-0.5">{c.lastMessagePreview || ''}</div>
                <div className="text-[10px] text-white/25 mt-0.5">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('pt-BR') : ''}</div>
              </button>
            ))}
          </div>

          {/* Pending replies */}
          <div className="p-3 border-t border-white/5">
            <button
              onClick={async () => {
                const r = await api.get('/api/whatsapp/conversations?pending=1')
                toast.info(`${(r.conversations || []).length} conversas aguardando resposta`)
              }}
              className="w-full text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5"
            >
              Quem está aguardando resposta?
            </button>
          </div>
        </div>

        {/* Middle: chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{convDetail?.name || selected}</div>
                  <div className="text-[11px] text-white/40">{convDetail?.phone || selected}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => runAI('summarize')} disabled={!!aiBusy} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 flex items-center gap-1"><ListChecks size={12} /> Resumir</button>
                  <button onClick={() => runAI('suggest_reply')} disabled={!!aiBusy} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 flex items-center gap-1"><Sparkles size={12} /> Sugerir resposta</button>
                  <button onClick={() => runAI('extract_tasks')} disabled={!!aiBusy} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 flex items-center gap-1"><Brain size={12} /> Tarefas</button>
                </div>
              </div>

              {aiResult && (
                <div className="mx-5 mt-3 p-3 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white/80 whitespace-pre-wrap">
                  <div className="flex justify-between mb-1">
                    <span className="text-white/50 text-[10px] uppercase">IA</span>
                    <button onClick={() => setAiResult('')}><X size={12} /></button>
                  </div>
                  {aiResult}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setMsgInput(aiResult); setAiResult('') }} className="text-[11px] px-2 py-1 rounded bg-white text-black">Usar como resposta</button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm ${m.direction === 'outbound' ? 'bg-green-500/20 border border-green-500/20' : 'bg-white/5 border border-white/10'}`}>
                      {m.type !== 'text' && (
                        <div className="text-[10px] text-white/40 mb-1 flex items-center gap-1">
                          {m.type === 'image' && <ImageIcon size={10} />}
                          {m.type === 'audio' && <Mic size={10} />}
                          {m.type === 'video' && <ImageIcon size={10} />}
                          {m.type === 'document' && <FileText size={10} />}
                          {m.type === 'location' && <MapPin size={10} />}
                          {m.type}
                          {m.media?.id && (
                            <a href={`/api/whatsapp/media?id=${m.media.id}`} target="_blank" className="underline ml-1">ver</a>
                          )}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{m.text || (m.location ? `${m.location.latitude}, ${m.location.longitude}` : '')}</div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-white/30">
                        <span>{new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        {m.direction === 'outbound' && <span>{m.status}</span>}
                        {m.quotedMessageId && <span className="italic">respondendo</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <div className="text-center text-xs text-white/30 py-12">Sem mensagens.</div>}
              </div>

              <div className="px-5 py-3 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <input type="file" ref={fileInputRef} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAndSendMedia(f); e.target.value = '' }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={mediaUploading} className="p-2 rounded-lg border border-white/10 hover:bg-white/5 text-white/60">
                    {mediaUploading ? <RefreshCw size={16} className="animate-spin" /> : <Paperclip size={16} />}
                  </button>
                  <input
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm outline-none"
                    placeholder="Digite uma mensagem..."
                    value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  />
                  <button onClick={send} disabled={sending || !msgInput.trim()} className="p-2 rounded-lg bg-green-500 text-black disabled:opacity-40">
                    <Send size={16} />
                  </button>
                </div>
                <div className="text-[10px] text-white/30 mt-1">
                  Janela de 24h: envio livre apenas se o contato enviou mensagem nas últimas 24h; caso contrário use template aprovado.
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-white/30">
              Selecione uma conversa
            </div>
          )}
        </div>

        {/* Right: contacts/automations/notifications */}
        <div className="w-[340px] border-l border-white/5 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2 flex items-center gap-2"><Bell size={12} /> Notificações</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {notifications.slice(0, 10).map(n => (
                <div key={n.id} className={`p-2 rounded-lg border ${n.read ? 'border-white/5 bg-white/[0.02]' : 'border-green-500/20 bg-green-500/5'}`}>
                  <div className="text-xs font-medium">{n.contactName || n.phone}</div>
                  <div className="text-[11px] text-white/50 truncate">{n.preview}</div>
                  <div className="text-[10px] text-white/30">{new Date(n.timestamp).toLocaleString('pt-BR')}</div>
                  {!n.read && <button onClick={async () => { await api.post('/api/whatsapp/notifications', { action: 'read', id: n.id }); loadNotifications() }} className="text-[10px] text-green-300 mt-1">Marcar lida</button>}
                </div>
              ))}
              {notifications.length === 0 && <div className="text-xs text-white/30">Sem notificações.</div>}
            </div>
          </div>

          <div className="p-4 border-b border-white/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2 flex items-center gap-2"><Tag size={12} /> Contatos</h3>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {contacts.slice(0, 20).map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs py-1">
                  <span className="truncate">{c.name || c.waId}</span>
                  <span className="text-white/30">{c.category || ''}</span>
                </div>
              ))}
              {contacts.length === 0 && <div className="text-xs text-white/30">Sem contatos.</div>}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50 flex items-center gap-2"><Zap size={12} /> Automações</h3>
              <button
                onClick={() => {
                  const name = prompt('Nome da automação')
                  if (!name) return
                  upsertAutomation({
                    id: `auto-${Date.now()}`,
                    name,
                    enabled: true,
                    trigger: { type: 'keyword', keyword: '' },
                    action: { type: 'notify' },
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  })
                }}
                className="text-[10px] px-2 py-1 rounded border border-white/10"
              ><Plus size={10} /></button>
            </div>
            <div className="space-y-2">
              {automations.map(a => (
                <div key={a.id} className="p-2 rounded-lg border border-white/5 bg-white/[0.02]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">{a.name}</span>
                    <button
                      onClick={async () => {
                        await api.post('/api/whatsapp/automations', { action: 'toggle', id: a.id, enabled: !a.enabled })
                        loadAutomations()
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded ${a.enabled ? 'bg-green-500/20 text-green-300' : 'bg-white/5 text-white/40'}`}
                    >{a.enabled ? 'ON' : 'OFF'}</button>
                  </div>
                  <div className="text-[10px] text-white/30 mt-0.5">{a.trigger?.type} → {a.action?.type}</div>
                </div>
              ))}
              {automations.length === 0 && <div className="text-xs text-white/30">Sem automações.</div>}
            </div>
          </div>

          <div className="p-4 border-t border-white/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2 flex items-center gap-2"><Shield size={12} /> Diagnóstico</h3>
            <button onClick={diagnose} className="w-full text-xs px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5">Executar diagnóstico</button>
            <div className="text-[10px] text-white/30 mt-2">
              Contatos: {status?.counts?.contacts ?? 0} · Conversas: {status?.counts?.conversations ?? 0} · Mensagens: {status?.counts?.messages ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  async function upsertAutomation(a: any) {
    await api.post('/api/whatsapp/automations', { action: 'upsert', automation: a })
    loadAutomations()
  }
}

function diagnose() { /* placeholder at module scope not used */ }