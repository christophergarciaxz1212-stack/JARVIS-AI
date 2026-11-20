'use client'

/**
 * JARVIS WHATSAPP CENTER — integração oficial com a WhatsApp Cloud API (Meta).
 * Identidade visual JARVIS (preto/branco, minimalista). Zero envio sem ação do usuário.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, MessageCircle, Search, Send, Star, Flag, ExternalLink, Copy, Check, RefreshCw,
  ShieldCheck, ShieldAlert, Bot, FileText, Phone, Settings2, Bell, Zap, Clock, Trash2,
  Plus, ChevronDown, Loader2, AlertTriangle, BadgeCheck, Sparkles, ListChecks,
} from 'lucide-react'
import { toast } from 'sonner'
import OpenWALink from './whatsapp/OpenWALink'

type Tab = 'conversas' | 'contatos' | 'automacoes' | 'lembretes' | 'diagnostico' | 'preferencias'

interface CfgStatus {
  phoneNumberId: string; wabaId: string; appId: string; configId: string; displayName: string
  hasAccessToken: boolean; hasAppSecret: boolean; verifyTokenHint: string
  requireConfirmSend: boolean
  notify: { desktop: boolean; sound: boolean; importantOnly: boolean }
  businessHours: { enabled: boolean; start: string; end: string }
  autoReply: { enabled: boolean; text: string }
  urgentKeywords: string[]
  automations: Record<string, boolean>
  stats: { received: number; sent: number; lastWebhookAt?: number; lastSendAt?: number }
  configured: boolean
}
interface Conversation {
  phone: string; name?: string; lastText: string; lastAt: number; unread: number; important: boolean
  starred?: boolean; displayName?: string; windowExpiresAt?: number; insideWindow?: boolean
}
interface Message {
  id: string; wamid?: string; direction: 'in' | 'out'; type: string; text: string
  at: number; status?: string; mediaId?: string; mediaMime?: string; mediaName?: string
}
interface Contact { phone: string; alias?: string; name?: string; tags: string[]; notes: string; category?: string; starred: boolean }
interface Reminder { id: string; phone: string; text: string; at?: number; createdAt: number; done: boolean }
interface HealthItem { id: string; label: string; ok: boolean; detail: string; fix?: string }
interface Health { ok: boolean; checkedAt: number; items: HealthItem[]; phoneNumber?: { display: string; verifiedName: string; quality: string; status: string }; token?: { valid: boolean; expiresAt?: number; scopes?: string[] } }

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayOf = (ts: number) => {
  const d = new Date(ts); const now = new Date()
  if (d.toDateString() === now.toDateString()) return timeOf(ts)
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + timeOf(ts)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '?').join('')

export default function WhatsAppCenter({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('conversas')
  const [cfg, setCfg] = useState<CfgStatus | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [meta, setMeta] = useState<{ name?: string; windowExpiresAt?: number; insideWindow?: boolean; contact?: Contact } | null>(null)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState('')
  const [aiOutput, setAiOutput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConfig = useCallback(async () => {
    try { setCfg(await fetch('/api/whatsapp/config').then(r => r.json())) } catch {}
  }, [])
  const loadConvs = useCallback(async () => {
    setLoadingConvs(true)
    try { const d = await fetch('/api/whatsapp/conversations').then(r => r.json()); setConvs(d.conversations || []) } catch {}
    setLoadingConvs(false)
  }, [])
  useEffect(() => { void loadConfig(); void loadConvs() }, [loadConfig, loadConvs])

  const loadThread = useCallback(async (phone: string) => {
    setLoadingMsgs(true)
    try {
      const d = await fetch(`/api/whatsapp/conversations?phone=${encodeURIComponent(phone)}`).then(r => r.json())
      setMessages(d.messages || [])
      setMeta({ name: d.name, windowExpiresAt: d.windowExpiresAt, insideWindow: d.insideWindow, contact: d.contact })
    } catch {}
    setLoadingMsgs(false)
  }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (selected) void loadThread(selected) }, [selected, loadThread])

  // Tempo real: SSE
  useEffect(() => {
    const es = new EventSource('/api/whatsapp/sse')
    es.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data) as { type?: string; phone?: string; fromMe?: boolean; text?: string; name?: string }
        if (data.type === 'message') {
          void loadConvs()
          if (data.phone && data.phone === selected) void loadThread(data.phone)
        } else if (data.type === 'status' || data.type === 'important' || data.type === 'reminder' || data.type === 'question' || data.type === 'document') {
          void loadConvs()
          if (data.type === 'reminder') toast.info('📌 Lembrete criado a partir da conversa')
          if (data.type === 'important') toast.warning('⚠️ Conversa marcada como importante')
        }
      } catch {}
    }
    return () => es.close()
  }, [selected, loadConvs, loadThread])

  // Abrir conversa via notificação do JARVIS (window event)
  useEffect(() => {
    const open = (e: Event) => {
      const phone = (e as CustomEvent).detail?.phone
      if (phone) { setTab('conversas'); setSelected(phone) }
    }
    window.addEventListener('jarvis:open-whatsapp', open)
    return () => window.removeEventListener('jarvis:open-whatsapp', open)
  }, [])

  const filtered = useMemo(() => convs.filter(c => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (c.displayName || '').toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '')) || (c.lastText || '').toLowerCase().includes(q)
  }), [convs, query])

  const send = async () => {
    if (!selected || !composer.trim()) return
    setSending(true)
    try {
      const d = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selected, text: composer.trim() }),
      }).then(r => r.json())
      if (d.ok) { setComposer(''); await loadThread(selected); await loadConvs(); await loadConfig() }
      else if (d.windowClosed) toast.error(d.error)
      else toast.error(d.error || 'Falha ao enviar')
    } catch (e) { toast.error((e as Error).message) }
    setSending(false)
  }

  const runAi = async (action: string, extra: Record<string, string> = {}) => {
    if (!selected) return
    setAiBusy(action); setAiOutput('')
    try {
      const d = await fetch('/api/whatsapp/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selected, action, ...extra }),
      }).then(r => r.json())
      if (d.ok) setAiOutput(d.result)
      else toast.error(d.error || 'Falha na IA')
    } catch (e) { toast.error((e as Error).message) }
    setAiBusy('')
  }

  const runHealth = async () => {
    setHealthBusy(true)
    try { const d = await fetch('/api/whatsapp/health').then(r => r.json()); setHealth(d.health) } catch {}
    setHealthBusy(false)
  }

  const savePrefs = async (patch: Record<string, unknown>) => {
    const d = await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ...patch }) }).then(r => r.json())
    if (d.ok || d.config) { await loadConfig() } else toast.error(d.error || 'Falha ao salvar')
  }

  const toggleFlag = async (phone: string, kind: 'important' | 'star', value: boolean) => {
    await fetch('/api/whatsapp/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, action: kind, value }) })
    await loadConvs(); if (selected === phone) await loadThread(phone)
  }

  const selectedConv = convs.find(c => c.phone === selected)
  const currentName = meta?.name || selectedConv?.displayName || (selected ? `+${selected}` : '')
  const configured = !!cfg?.configured

  const tabs: Array<[Tab, string]> = [
    ['conversas', 'Conversas'],
    ['contatos', 'Contatos'],
    ['automacoes', 'Automações'],
    ['lembretes', 'Lembretes'],
    ['diagnostico', 'Diagnóstico'],
    ['preferencias', 'Preferências'],
  ]

  return (
    <div className="mo-backdrop fixed inset-0 z-[90] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="JARVIS WhatsApp Center">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="w-full max-w-6xl h-[92vh] rounded-2xl border border-white/10 bg-[#0d0d10] shadow-2xl shadow-black/70 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/10">
              <MessageCircle size={17} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-wide text-white/90 truncate">JARVIS <span className="text-white/35 font-normal">WHATSAPP CENTER</span></div>
              <div className="text-[10px] text-white/30">{configured ? `${cfg?.displayName || 'WhatsApp Business Cloud API'} · ${cfg?.stats.received ?? 0} recebidas · ${cfg?.stats.sent ?? 0} enviadas` : 'Integração oficial pela Meta · WhatsApp Business Cloud API'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {configured
              ? <span className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />Online</span>
              : <span className="hidden sm:flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-200">Não configurado</span>}
            <OpenWALink />
            <button onClick={onClose} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white/80" title="Fechar"><X size={17} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/5 px-4 py-2 shrink-0">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${tab === id ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/75'}`}>{label}</button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {/* ───────── CONVERSAS ───────── */}
          {tab === 'conversas' && (
            <div className="flex h-full min-h-0">
              {/* Lista */}
              <div className="w-full sm:w-80 shrink-0 border-r border-white/5 flex flex-col min-h-0">
                <div className="p-2 border-b border-white/5">
                  <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
                    <Search size={13} className="text-white/35 shrink-0" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar contato ou mensagem…" className="w-full bg-transparent text-[12px] text-white/85 placeholder-white/25 outline-none" />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  {!configured && (
                    <div className="p-6 text-center">
                      <AlertTriangle size={20} className="mx-auto text-amber-300/80 mb-2" />
                      <p className="text-[11px] text-white/55 leading-relaxed">A conexão com a Meta ainda não está configurada.</p>
                      <button onClick={() => setTab('diagnostico')} className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/25">Configurar a conexão →</button>
                    </div>
                  )}
                  {configured && loadingConvs && <div className="p-4 text-center text-[11px] text-white/35"><Loader2 size={15} className="animate-spin inline" /> Carregando…</div>}
                  {configured && !loadingConvs && filtered.length === 0 && <p className="p-4 text-[11px] text-white/35 text-center">Nenhuma conversa ainda. Quando o webhook receber mensagens, elas aparecem aqui automaticamente.</p>}
                  {filtered.map(c => (
                    <button key={c.phone} onClick={() => setSelected(c.phone)} className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] ${selected === c.phone ? 'bg-white/[0.06]' : ''}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/25 to-cyan-500/25 border border-emerald-400/20 text-[11px] font-semibold text-emerald-100">{initials(c.displayName || '+')}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-white/85">{c.displayName}</span>
                          {c.starred && <Star size={10} className="text-amber-300 fill-amber-300 shrink-0" />}
                          {c.important && <Flag size={10} className="text-red-300 fill-red-300 shrink-0" />}
                          <span className="ml-auto text-[9px] text-white/30 shrink-0">{dayOf(c.lastAt)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="truncate text-[11px] text-white/45 flex-1">{c.lastText || '(mídia)'}</span>
                          {c.unread > 0 && <span className="shrink-0 rounded-full bg-emerald-500/25 border border-emerald-400/30 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200">{c.unread}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Thread */}
              <div className="hidden sm:flex flex-1 flex-col min-w-0 min-h-0 bg-[radial-gradient(ellipse_at_top,rgba(52,211,153,0.04),transparent_60%)]">
                {!selected && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                    <MessageCircle size={40} className="text-white/10 mb-3" />
                    <p className="text-sm text-white/40">Selecione uma conversa para ver o histórico.</p>
                    <p className="mt-2 max-w-sm text-[11px] text-white/25">As mensagens chegam pelo webhook oficial da Meta — em tempo real, sem polling. O número usado é o da WhatsApp Cloud API (não é o WhatsApp pessoal).</p>
                  </div>
                )}
                {selected && (
                  <>
                    {/* Cabeçalho do thread */}
                    <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 shrink-0 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white/90 flex items-center gap-1.5">{currentName}{meta?.contact?.starred && <Star size={11} className="text-amber-300 fill-amber-300" />}</div>
                        <div className="text-[10px] text-white/35 flex items-center gap-1.5 flex-wrap"><Phone size={9} />+{selected}
                          {meta?.insideWindow ? <span className="text-emerald-300/80">· janela aberta</span> : <span className="text-amber-300/90">· janela fechada — só template</span>}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <IconBtn title="Destacar conversa" active={!!meta?.contact?.starred} onClick={() => toggleFlag(selected, 'star', !meta?.contact?.starred)}><Star size={13} /></IconBtn>
                        <IconBtn title="Marcar importante" active={!!selectedConv?.important} onClick={() => toggleFlag(selected, 'important', !selectedConv?.important)}><Flag size={13} /></IconBtn>
                        <button onClick={() => runAi('summarize')} disabled={!!aiBusy} className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40" title="Resumir conversa">{aiBusy === 'summarize' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}</button>
                        <button onClick={() => runAi('draft')} disabled={!!aiBusy} className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40" title="Rascunhar resposta">{aiBusy === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}</button>
                        <button onClick={() => runAi('commitments')} disabled={!!aiBusy} className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40" title="Compromissos">{aiBusy === 'commitments' ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}</button>
                      </div>
                    </div>
                    {/* Саídas IA */}
                    <AnimatePresence>
                      {aiOutput && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mx-3 mt-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.08] px-3 py-2 shrink-0">
                          <div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-violet-200/80 flex items-center gap-1"><Sparkles size={10} /> IA do JARVIS</span><button onClick={() => setAiOutput('')} className="text-white/35 hover:text-white/70"><X size={12} /></button></div>
                          <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-white/80">{aiOutput}</pre>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
                      {loadingMsgs && <div className="text-center text-[11px] text-white/30"><Loader2 size={13} className="animate-spin inline" /></div>}
                      {messages.map(m => (
                        <div key={m.id} className={`max-w-[78%] rounded-2xl px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words ${m.direction === 'out' ? 'ml-auto bg-emerald-500/15 border border-emerald-400/20 text-emerald-50 rounded-br-sm' : 'bg-white/[0.05] border border-white/[0.06] text-white/85 rounded-bl-sm'}`}>
                          {m.mediaId && m.mediaMime?.startsWith('image') && <img src={`/api/whatsapp/media?id=${m.mediaId}`} alt="imagem recebida" className="max-h-44 rounded-lg mb-1 object-cover" />}
                          {m.mediaId && m.mediaMime?.startsWith('audio') && <audio controls src={`/api/whatsapp/media?id=${m.mediaId}`} className="w-56 max-w-full mb-0.5" />}
                          {m.mediaId && !m.mediaMime?.startsWith('image') && <a href={`/api/whatsapp/media?id=${m.mediaId}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-cyan-200/90 underline underline-offset-2 mb-0.5"><FileText size={11} />{m.mediaName || 'abrir documento'}</a>}
                          {m.text}
                          <div className="mt-1 flex items-center gap-1.5 text-[9px] text-white/30">{dayOf(m.at)}{m.direction === 'out' && m.status && <span>· {m.status === 'read' ? '✓✓ lido' : m.status === 'delivered' ? '✓✓ entregue' : '✓ enviado'}</span>}</div>
                        </div>
                      ))}
                      <div ref={bottomRef} />
                    </div>
                    {/* Composer */}
                    <div className="border-t border-white/5 p-3 shrink-0">
                      {!meta?.insideWindow && <p className="mb-1.5 text-[10px] text-amber-200/80 flex items-center gap-1"><AlertTriangle size={10} /> Janela de 24h fechada. O envio exige um template aprovado pela Meta.</p>}
                      <div className="flex items-center gap-2">
                        <input
                          value={composer}
                          onChange={e => setComposer(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                          disabled={!meta?.insideWindow || sending}
                          placeholder={meta?.insideWindow ? 'Escreva e pressione Enter…' : 'Só template aprovado…'}
                          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/90 outline-none placeholder-white/25 focus:border-emerald-400/40 disabled:opacity-50"
                        />
                        <button onClick={send} disabled={!composer.trim() || sending || !meta?.insideWindow} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-white hover:bg-emerald-500 disabled:opacity-35 transition-colors" aria-label="Enviar">
                          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'contatos' && <ContactsTab />}
          {tab === 'automacoes' && <AutomationsTab cfg={cfg} onSaved={loadConfig} />}
          {tab === 'lembretes' && <RemindersTab />}
          {tab === 'diagnostico' && <DiagnosticsTab cfg={cfg} health={health} healthBusy={healthBusy} onRun={runHealth} />}
          {tab === 'preferencias' && <PrefsTab cfg={cfg} onSave={savePrefs} onReload={loadConfig} />}
        </div>
      </motion.div>
    </div>
  )
}

function IconBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick?: () => void; title?: string; active?: boolean }) {
  return <button onClick={onClick} title={title} className={`rounded-lg border p-1.5 transition-colors ${active ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-white/10 bg-white/5 text-white/55 hover:text-white hover:bg-white/10'}`}>{children}</button>
}

/* ───────── Contatos ───────── */
function ContactsTab() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [, setReminders] = useState<Reminder[]>([])
  const [q, setQ] = useState('')
  const [editPhone, setEditPhone] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const [tags, setTags] = useState('')
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [newPhone, setNewPhone] = useState('')

  const load = useCallback(async () => {
    const d = await fetch(`/api/whatsapp/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(r => r.json()).catch(() => ({ contacts: [], reminders: [] }))
    setContacts(d.contacts || []); setReminders(d.reminders || [])
  }, [q])
  useEffect(() => { void load() }, [load])

  const saveContact = async (phone: string, patch: Record<string, unknown>) => {
    const d = await fetch('/api/whatsapp/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', phone, ...patch }) }).then(r => r.json())
    if (d.ok) { toast.success('Contato salvo'); setEditPhone(null); void load() } else toast.error(d.error || 'Falha ao salvar')
  }
  const add = async () => {
    const phone = newPhone.replace(/\D/g, '')
    if (phone.length < 10) { toast.error('Número incompleto'); return }
    await saveContact(phone, { alias: undefined })
    setNewPhone('')
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 min-w-56 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2">
          <Search size={13} className="text-white/35" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por apelido, nome, número, tag ou nota…" className="w-full bg-transparent text-[12px] outline-none text-white/85 placeholder-white/25" />
        </div>
        <div className="flex items-center gap-1.5">
          <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Novo: 5511987654321" className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-[11px] outline-none w-44 placeholder-white/25" />
          <button onClick={add} className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 p-2 text-emerald-200 hover:bg-emerald-500/25"><Plus size={14} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {contacts.map(c => (
          <div key={c.phone} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-[11px] font-semibold text-white/60">{initials(c.alias || c.name || '+')}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-white/85 truncate">{c.alias || c.name || `+${c.phone}`}</div>
                <div className="text-[9px] text-white/35">+{c.phone}{c.category ? ` · ${c.category}` : ''}</div>
              </div>
              <button onClick={() => saveContact(c.phone, { starred: !c.starred })} className="text-amber-300/80 hover:text-amber-200"><Star size={14} className={c.starred ? 'fill-amber-300' : ''} /></button>
              <button onClick={() => { setEditPhone(editPhone === c.phone ? null : c.phone); setAlias(c.alias || ''); setTags((c.tags || []).join(', ')); setCategory(c.category || ''); setNotes(c.notes || '') }} className="text-white/35 hover:text-white/75"><Settings2 size={14} /></button>
            </div>
            {c.tags?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{c.tags.map(t => <span key={t} className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8.5px] text-white/50">{t}</span>)}</div>}
            {editPhone === c.phone && (
              <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
                <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Apelido (ex.: João da obra)" className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" />
                <div className="flex gap-1.5">
                  <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Categoria (cliente, pessoal…)" className="flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" />
                  <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags separadas por vírgula" className="flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" />
                </div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observações internas…" rows={2} className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none resize-none" />
                <button onClick={() => saveContact(c.phone, { alias: alias.trim() || undefined, tags: tags.split(',').map(t => t.trim()).filter(Boolean), category: category.trim() || undefined, notes })} className="rounded-md bg-emerald-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-500">Salvar</button>
              </div>
            )}
            {c.notes && <p className="mt-1.5 text-[9.5px] text-white/40 leading-snug line-clamp-2">{c.notes}</p>}
          </div>
        ))}
        {contacts.length === 0 && <p className="text-[11px] text-white/35 md:col-span-2 text-center py-6">Nenhum contato ainda — cadastre pelo número, ou deixe o webhook salvar o nome do perfil automaticamente.</p>}
      </div>
      <p className="mt-4 text-[9.5px] text-white/30">Lembretes criados automaticamente a partir de mensagens aparecem na aba Lembretes. Contatos estrelares marcam conversas como importantes.</p>
    </div>
  )
}

/* ───────── Automações ───────── */
const AUTOMATION_META: Array<{ id: string; label: string; desc: string }> = [
  { id: 'urgent', label: 'Detectar urgência', desc: 'Mensagens com as palavras-chave abaixo destacam a conversa e notificam você.' },
  { id: 'commitment', label: 'Detectar compromissos', desc: 'Datas, prazos e cobranças viram um lembrete automático na aba Lembretes.' },
  { id: 'document', label: 'Documento recebido', desc: 'Avisa você quando chegar um arquivo (com o nome dele).' },
  { id: 'question', label: 'Perguntas sem resposta', desc: 'Identifica perguntas e oferece rascunho de resposta na conversa.' },
  { id: 'starredSender', label: 'Contato estrelado', desc: 'Mensagens de contatos estrelares marcam a conversa como importante.' },
  { id: 'outsideHours', label: 'Auto-resposta fora do horário', desc: 'Envia o texto configurado fora do horário de atendimento (também exige ligar abaixo).' },
]

function AutomationsTab({ cfg, onSaved }: { cfg: CfgStatus | null; onSaved: () => Promise<void> | void }) {
  const [keywords, setKeywords] = useState('')
  useEffect(() => { setKeywords((cfg?.urgentKeywords || []).join(', ')) }, [cfg?.urgentKeywords])
  const toggle = async (id: string, value: boolean) => {
    await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', automations: { ...(cfg?.automations || {}), [id]: value } }) })
    await onSaved()
  }
  const saveKeywords = async () => {
    const list = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    await fetch('/api/whatsapp/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'urgent-keywords', keywords: list }) })
    toast.success('Palavras-chave salvas')
  }
  return (
    <div className="h-full overflow-y-auto p-5 max-w-3xl">
      <p className="text-[11px] text-white/45">Cada automação pode ser ligada ou desligada individualmente. Nenhuma envia mensagem sem sua ativação explícita — e a auto-resposta só funciona fora do horário configurado.</p>
      <div className="mt-3 space-y-2">
        {AUTOMATION_META.map(a => {
          const on = !!cfg?.automations?.[a.id]
          return (
            <div key={a.id} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              <button role="switch" aria-checked={on} onClick={() => toggle(a.id, !on)} className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors relative ${on ? 'bg-emerald-500' : 'bg-white/10'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <div className="min-w-0"><div className="text-[12px] font-medium text-white/85">{a.label}</div><p className="text-[10px] text-white/40 leading-snug">{a.desc}</p></div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="text-[11px] font-semibold text-white/75 flex items-center gap-1.5"><Zap size={11} className="text-amber-300" /> Palavras-chave de urgência</div>
        <textarea value={keywords} onChange={e => setKeywords(e.target.value)} rows={2} className="mt-1.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none resize-none" placeholder="urgente, emergência, prazo…" />
        <button onClick={saveKeywords} className="mt-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 hover:bg-white/10">Salvar palavras-chave</button>
      </div>
    </div>
  )
}

/* ───────── Lembretes ───────── */
function RemindersTab() {
  const [items, setItems] = useState<Reminder[]>([])
  const load = useCallback(async () => {
    const d = await fetch('/api/whatsapp/contacts').then(r => r.json()).catch(() => ({ reminders: [] }))
    setItems(d.reminders || [])
  }, [])
  useEffect(() => { void load() }, [load])
  const done = async (id: string) => { await fetch('/api/whatsapp/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reminder-done', id }) }); void load() }
  const pending = items.filter(r => !r.done)
  return (
    <div className="h-full overflow-y-auto p-5 max-w-2xl">
      <p className="text-[11px] text-white/45">Criados automaticamente quando uma mensagem menciona compromisso, prazo ou cobrança (com a automação ligada). Você também pode criar lembretes pedindo à IA: “resuma a conversa com X” e confirmando.</p>
      <div className="mt-3 space-y-1.5">
        {pending.length === 0 && <p className="py-6 text-center text-[11px] text-white/30">Nenhum lembrete pendente.</p>}
        {pending.map(r => (
          <div key={r.id} className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <input type="checkbox" onChange={() => done(r.id)} className="mt-0.5 accent-emerald-500" />
            <div className="min-w-0 flex-1"><p className="text-[11px] text-white/80 leading-snug">{r.text}</p><p className="text-[9px] text-white/30 mt-0.5">{new Date(r.createdAt).toLocaleString('pt-BR')} · +{r.phone}</p></div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────── Diagnóstico ───────── */
function DiagnosticsTab({ cfg, health, healthBusy, onRun }: { cfg: CfgStatus | null; health: Health | null; healthBusy: boolean; onRun: () => void }) {
  const [tokenVisible, setTokenVisible] = useState(false)
  const [copied, setCopied] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [webhookReady, setWebhookReady] = useState(false)
  useEffect(() => { try { setWebhookReady(location.protocol === 'https:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) } catch {} }, [])

  const copy = async (text: string, id: string) => { try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1400) } catch {} }
  const revealToken = async () => {
    const d = await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reveal-verify-token' }) }).then(r => r.json())
    if (d.verifyToken) { setVerifyToken(d.verifyToken); setTokenVisible(v => !v) }
  }
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '/api/whatsapp/webhook'
  // Porta real deste JARVIS (o app instalado usa a primeira livre a partir de 3001)
  const localOrigin = typeof window !== 'undefined' ? `http://127.0.0.1:${window.location.port || '80'}` : 'http://127.0.0.1:3001'

  return (
    <div className="h-full overflow-y-auto p-5 max-w-3xl space-y-4">
      {/* Status rápido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <StatPill ok={!!cfg?.phoneNumberId} label="Phone Number ID" />
        <StatPill ok={!!cfg?.hasAccessToken} label="Token" />
        <StatPill ok={!!cfg?.hasAppSecret} label="App Secret" />
        <StatPill ok={webhookReady} label={webhookReady ? 'Webhook público' : 'Webhook (localhost)'} />
      </div>

      {/* Passo a passo honesto da configuração */}
      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.05] p-4">
        <div className="text-[12px] font-semibold text-cyan-100 flex items-center gap-1.5"><BadgeCheck size={13} /> Como conectar de verdade (Meta for Developers)</div>
        <ol className="mt-2 list-decimal pl-4 text-[10.5px] leading-relaxed text-white/65 space-y-1.5">
          <li>Acesse <a className="text-cyan-200 underline underline-offset-2" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps <ExternalLink size={9} className="inline" /></a> → <b>Criar app</b> → tipo <b>Empresa</b> → adicione o produto <b>WhatsApp</b>.</li>
          <li>Em <b>WhatsApp → Configuração da API</b>, copie o <b>Phone number ID</b> (o número de <u>teste</u> já vem ativo; para produção, registre seu número).</li>
          <li>Gere um <b>token permanente</b>: em business.facebook.com → <b>Usuários do sistema</b> → gere um System User token com <code className="text-cyan-100">whatsapp_business_messaging</code> + <code className="text-cyan-100">whatsapp_business_management</code>. (O token temporário de 24h da tela expira.)</li>
          <li>Cole o <b>App Secret</b> (Configurações → Básico) e o token nas <b>🔑 Chaves de API</b> do JARVIS (chaves “WhatsApp (token de acesso)” e “WhatsApp (App Secret)”) — ou nos campos abaixo.</li>
          <li><b>Webhook:</b> a Meta exige uma URL <b>HTTPS pública</b>. Em desenvolvimento: <code className="text-cyan-100">cloudflared tunnel --url {localOrigin}</code> (instalação: <code className="text-cyan-100">winget install Cloudflare.cloudflared</code>) ou ngrok. No painel: <b>WhatsApp → Configuração → Webhook → Editar</b>: URL = <code className="text-cyan-100">{webhookUrl}</code> e Verify Token = o que você gerou aqui (botão abaixo). Assine o campo <b>messages</b>.</li>
          <li>Salve, depois clique em <b>Verificar e salvar</b> no painel — a Meta chama o <code className="text-cyan-100">GET /api/whatsapp/webhook</code> para confirmar.</li>
        </ol>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px]">
          <code className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white/70 max-w-full break-all">{webhookUrl}</code>
          <button onClick={() => copy(webhookUrl, 'url')} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/70 hover:bg-white/10">{copied === 'url' ? <Check size={10} /> : <Copy size={10} />} copiar URL</button>
          <button onClick={revealToken} className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-100 hover:bg-amber-500/20">{tokenVisible ? <ChevronDown size={11} /> : <ChevronDown size={11} className="rotate-180" />} {tokenVisible ? 'OCULTAR' : 'VERIFY TOKEN (copiar para o painel)'}</button>
          {copied === 'url' && <span className="text-emerald-300">Copiado!</span>}
        </div>
        {tokenVisible && verifyToken && (
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-amber-400/25 bg-black/40 px-2 py-1.5 text-[10px] text-amber-100">{verifyToken}</code>
            <button onClick={() => copy(verifyToken, 'vt')} className="shrink-0 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-amber-100">{copied === 'vt' ? <Check size={11} /> : <Copy size={11} />}</button>
          </div>
        )}
        {webhookReady ? <p className="mt-2 text-[10px] text-emerald-300/80 flex items-center gap-1"><ShieldCheck size={10} /> Este endereço é HTTPS público — o painel da Meta deve aceitar.</p> : <p className="mt-2 text-[10px] text-amber-200/90 flex items-center gap-1"><ShieldAlert size={10} /> Você está em localhost. A Meta <b>não aceita</b> webhook público em http://localhost — use o túnel (passo 5) e cole a URL https gerada por ele.</p>}
      </div>

      {/* Campos do JARVIS */}
      <InlineConfigForm cfg={cfg} onSaved={() => {}} />

      {/* Diagnóstico ao vivo */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-white/80 flex items-center gap-1.5"><ShieldCheck size={13} /> Diagnóstico ao vivo (chama a Meta de verdade)</div>
          <button onClick={onRun} disabled={healthBusy} className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">{healthBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Verificar agora</button>
        </div>
        {health && (
          <div className="mt-3 space-y-1.5">
            {health.items.map(i => (
              <div key={i.id} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-black/30 px-2.5 py-1.5">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${i.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <div className="min-w-0 flex-1"><div className="text-[10.5px] font-medium text-white/80">{i.label}</div><p className="text-[9.5px] text-white/40 leading-snug">{i.detail}</p>{!i.ok && i.fix && <p className="text-[9.5px] text-amber-200/75 leading-snug mt-0.5">→ {i.fix}</p>}</div>
              </div>
            ))}
            {health.phoneNumber && <p className="text-[10px] text-white/45">Número na Meta: {health.phoneNumber.display} · {health.phoneNumber.verifiedName} · qualidade {health.phoneNumber.quality}</p>}
            {health.token?.valid === false && <p className="text-[10px] text-red-300">Token inválido/expirado — gere um System User token permanente.</p>}
            {health.token?.expiresAt && <p className="text-[9.5px] text-white/35">Token expira em {new Date(health.token.expiresAt).toLocaleString('pt-BR')} · escopos: {(health.token.scopes || []).join(', ')}</p>}
          </div>
        )}
        {cfg?.stats?.lastWebhookAt && <p className="mt-2 text-[9.5px] text-white/30">Último webhook recebido: {new Date(cfg.stats.lastWebhookAt).toLocaleString('pt-BR')}</p>}
      </div>
    </div>
  )
}

function StatPill({ ok, label }: { ok: boolean; label: string }) {
  return <div className={`rounded-lg border px-2 py-1.5 text-center ${ok ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/[0.03] text-white/40'}`}>{label}</div>
}

function InlineConfigForm({ cfg, onSaved }: { cfg: CfgStatus | null; onSaved: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [appId, setAppId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setPhoneNumberId(cfg?.phoneNumberId || ''); setWabaId(cfg?.wabaId || ''); setAppId(cfg?.appId || '') }, [cfg?.phoneNumberId, cfg?.wabaId, cfg?.appId])

  const save = async () => {
    setBusy(true)
    try {
      const r1 = await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', phoneNumberId, wabaId, appId }) }).then(r => r.json())
      const r2 = (accessToken || appSecret) ? await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-secrets', accessToken, appSecret }) }).then(r => r.json()) : { ok: true }
      if (r1.ok !== false && r2.ok !== false) { toast.success('Configuração salva'); setAccessToken(''); setAppSecret(''); onSaved() } else toast.error(r1.error || r2.error || 'Falha ao salvar')
    } catch (e) { toast.error((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
      <div className="text-[12px] font-semibold text-white/80 flex items-center gap-1.5"><Bot size={13} /> Credenciais do seu app Meta (ficam só neste computador)</div>
      <div className="mt-2 grid sm:grid-cols-3 gap-1.5">
        <label className="text-[9px] text-white/40">Phone Number ID<input value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} className="mt-0.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" placeholder="1234567890" /></label>
        <label className="text-[9px] text-white/40">WABA ID (opcional)<input value={wabaId} onChange={e => setWabaId(e.target.value)} className="mt-0.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" /></label>
        <label className="text-[9px] text-white/40">App ID (opcional)<input value={appId} onChange={e => setAppId(e.target.value)} className="mt-0.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" /></label>
        <label className="text-[9px] text-white/40 sm:col-span-2">Token de acesso permanente (EAA…)<input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} autoComplete="off" className="mt-0.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" placeholder={cfg?.hasAccessToken ? '•••• (salvo — cole para trocar)' : 'EAA…'} /></label>
        <label className="text-[9px] text-white/40">App Secret<input type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)} autoComplete="off" className="mt-0.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none" placeholder={cfg?.hasAppSecret ? '•••• (salvo)' : '••••••'} /></label>
      </div>
      <button onClick={save} disabled={busy} className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">{busy ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Salvar credenciais</button>
    </div>
  )
}

/* ───────── Preferências ───────── */
function PrefsTab({ cfg, onSave, onReload }: { cfg: CfgStatus | null; onSave: (patch: Record<string, unknown>) => Promise<void> | void; onReload: () => Promise<void> | void }) {
  const notify = cfg?.notify
  const bh = cfg?.businessHours
  const ar = cfg?.autoReply
  return (
    <div className="h-full overflow-y-auto p-5 max-w-2xl space-y-4">
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="text-[12px] font-semibold text-white/85 flex items-center gap-1.5"><ShieldCheck size={13} /> Envios pelo chat</div>
        <label className="mt-2 flex items-start gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={!!cfg?.requireConfirmSend} onChange={e => onSave({ requireConfirmSend: e.target.checked })} className="mt-0.5 accent-emerald-500" />
          <span className="text-[11px] text-white/75 leading-snug"><b>Exigir confirmação antes de enviar</b> (recomendado). Com isto ligado, “JARVIS, responda para Maria que está tudo certo” prepara o envio e só manda depois de você responder <b>CONFIRMAR ENVIO</b>.</span>
        </label>
      </section>

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="text-[12px] font-semibold text-white/85 flex items-center gap-1.5"><Bell size={13} /> Notificações</div>
        <div className="mt-2 space-y-1.5 text-[11px] text-white/75">
          <Toggle label="Notificação no Windows (área de trabalho)" checked={!!notify?.desktop} onChange={v => { onSave({ notify: { ...(notify || {}), desktop: v } }); if (v && typeof Notification !== 'undefined') Notification.requestPermission() }} />
          <Toggle label="Som ao receber mensagem" checked={!!notify?.sound} onChange={v => onSave({ notify: { ...(notify || {}), sound: v } })} />
          <Toggle label="Notificar apenas conversas importantes/estrelares" checked={!!notify?.importantOnly} onChange={v => onSave({ notify: { ...(notify || {}), importantOnly: v } })} />
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="text-[12px] font-semibold text-white/85 flex items-center gap-1.5"><Clock size={13} /> Horário de atendimento (para auto-resposta fora de horário)</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/75">
          <Toggle label="Ativar horário" checked={!!bh?.enabled} onChange={v => onSave({ businessHours: { ...(bh || { start: '08:00', end: '18:00' }), enabled: v } })} />
          <label>Início <input type="time" value={bh?.start || '08:00'} onChange={e => onSave({ businessHours: { ...(bh || { enabled: true, end: '18:00' }), start: e.target.value } })} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 outline-none" /></label>
          <label>Fim <input type="time" value={bh?.end || '18:00'} onChange={e => onSave({ businessHours: { ...(bh || { enabled: true, start: '08:00' }), end: e.target.value } })} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 outline-none" /></label>
        </div>
        <div className="mt-2 text-[10px] text-white/35">Fins de semana (sáb/dom) contam como fora de horário.</div>
      </section>

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="text-[12px] font-semibold text-white/85 flex items-center gap-1.5"><Bot size={13} /> Auto-resposta fora do horário</div>
        <Toggle label="Ativar (também exige ligar a automação “Auto-resposta fora do horário” em Automações)" checked={!!ar?.enabled} onChange={v => onSave({ autoReply: { ...(ar || { text: '' }), enabled: v } })} />
        <textarea value={ar?.text || ''} onChange={e => onSave({ autoReply: { ...(ar || { enabled: false }), text: e.target.value } })} rows={2} placeholder="Ex.: Olá! No momento estou fora do horário de atendimento. Retorno amanhã às 8h." className="mt-1.5 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] outline-none resize-none" />
      </section>

      <section className="rounded-xl border border-red-400/15 bg-red-500/[0.04] p-4">
        <div className="text-[12px] font-semibold text-red-200/90 flex items-center gap-1.5"><Trash2 size={13} /> Desconectar</div>
        <p className="mt-1 text-[10.5px] text-white/45">Apaga as credenciais salvas (token e App Secret). Conversas e contatos locais NÃO são apagados.</p>
        <button onClick={async () => { await fetch('/api/whatsapp/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear-secrets' }) }); toast.success('Credenciais apagadas'); onReload() }} className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-100 hover:bg-red-500/20">Apagar token e App Secret</button>
      </section>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-emerald-500" />
      <span className="text-[11px] text-white/70 leading-snug">{label}</span>
    </label>
  )
}
