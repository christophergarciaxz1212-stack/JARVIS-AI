'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  QrCode, Download, Play, Square, Unlink, X, Send, AlertTriangle, Terminal,
  RefreshCw, CheckCircle2, Loader2, Smartphone, Globe, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'

const api = {
  get: (p: string) => fetch(p, { cache: 'no-store' }).then(r => r.json()),
  post: (p: string, b?: any) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()),
}

type OwStatus = any

/**
 * Botão "Vincular com OpenWA" no WhatsApp Center:
 * instala o OpenWA na máquina (ou conecta num externo), pareia o número por QR
 * e mantém a sessão viva para o JARVIS ler/enviar mensagens.
 */
export default function OpenWALink() {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<OwStatus | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [forceConfirm, setForceConfirm] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advUrl, setAdvUrl] = useState('')
  const [advKey, setAdvKey] = useState('')
  const [sendTo, setSendTo] = useState('')
  const [sendText, setSendText] = useState('')
  const [events, setEvents] = useState<any[]>([])
  const [log, setLog] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try { setSt(await api.get('/api/openwa/status')) } catch { /* offline */ }
  }, [])
  const loadEvents = useCallback(async () => {
    try { const d = await api.get('/api/openwa/events?limit=5'); setEvents(d.events || []) } catch {}
  }, [])

  useEffect(() => {
    if (!open) return
    load(); loadEvents()
    pollRef.current = setInterval(() => { load(); loadEvents() }, 2500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, load, loadEvents])

  // Quando a sessão fica ready, o QR fica obsoleto
  useEffect(() => {
    if (st?.session?.status === 'ready') setQr(null)
  }, [st?.session?.status])

  const session = st?.session
  const installing = st?.install?.running
  const installed = st?.openwa?.installed
  const running = st?.openwa?.reachable
  const hasKey = st?.hasApiKey

  const doInstall = async () => {
    setBusy('install')
    const r = await api.post('/api/openwa/install', {})
    if (r?.error) toast.error(r.error)
    else toast.success('Instalação do OpenWA iniciada — acompanhe o progresso abaixo.')
    setBusy('')
    load()
  }
  const doStart = async () => {
    setBusy('start')
    const r = await api.post('/api/openwa/start')
    if (r?.error) toast.error(r.error)
    else toast.success('OpenWA iniciado.')
    setBusy('')
    load()
  }
  const doStop = async () => {
    setBusy('stop')
    const r = await api.post('/api/openwa/stop')
    if (r?.error) toast.error(r.error)
    else toast.success('OpenWA parado.')
    setBusy('')
    load()
  }
  const doConnect = async () => {
    setBusy('qr')
    const r = await api.post('/api/openwa/connect')
    if (r?.error) { toast.error(r.error); setBusy(''); return }
    if (r.status === 'ready') { toast.success(`WhatsApp vinculado${r.phone ? ` (${r.phone})` : ''}!`) }
    else if (r.qr) setQr(r.qr)
    else toast.success('Sessão iniciando — o QR aparece em alguns segundos…')
    if (r.warning) toast.warning(r.warning)
    setBusy('')
    load()
  }
  const pollQr = async () => {
    const r = await api.get('/api/openwa/qr')
    if (r?.qr) setQr(r.qr)
    if (r?.status === 'ready') { setQr(null); toast.success('WhatsApp vinculado!') }
    load()
  }
  const doSend = async () => {
    if (!sendText.trim()) return
    setBusy('send')
    const r = await api.post('/api/openwa/send', { chatId: sendTo.trim() || session?.phone || '', text: sendText.trim() })
    if (r?.error) toast.error(r.error)
    else { toast.success('Mensagem enviada!'); setSendText('') }
    setBusy('')
  }
  const doDisconnect = async () => {
    if (!forceConfirm) { setForceConfirm(true); return }
    setBusy('unlink')
    const r = await api.post('/api/openwa/disconnect', { logout: true })
    if (r?.error) toast.error(r.error)
    else { toast.success(r.warning ? 'Desvinculado (com aviso)' : 'WhatsApp desvinculado do JARVIS.'); if (r.warning) toast.warning(r.warning) }
    setForceConfirm(false)
    setBusy('')
    load()
  }
  const saveAdvanced = async () => {
    setBusy('save')
    const body: any = {}
    if (advUrl.trim()) body.baseUrl = advUrl.trim()
    if (advKey.trim()) body.apiKey = advKey.trim()
    const r = await api.post('/api/openwa/config', body)
    if (r?.error) toast.error(r.error)
    else { toast.success('OpenWA configurado.'); setAdvKey(''); setShowAdvanced(false) }
    setBusy('')
    load()
  }
  const showLogs = async () => {
    const r = await api.get('/api/openwa/logs')
    setLog(r.log || '(vazio)')
  }

  const statusPill = (s?: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      ready: { label: 'Vinculado', cls: 'text-green-300 border-green-500/40 bg-green-500/10' },
      qr_ready: { label: 'Aguardando QR…', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
      initializing: { label: 'Iniciando…', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
      authenticating: { label: 'Autenticando…', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
      disconnected: { label: 'Desvinculado', cls: 'text-white/50 border-white/10 bg-white/5' },
      failed: { label: 'Falha', cls: 'text-red-300 border-red-500/40 bg-red-500/10' },
      action_required: { label: 'Ação necessária', cls: 'text-red-300 border-red-500/40 bg-red-500/10' },
      created: { label: 'Criada', cls: 'text-white/50 border-white/10 bg-white/5' },
    }
    const m = map[s || ''] || { label: s || 'desconhecido', cls: 'text-white/50 border-white/10 bg-white/5' }
    return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Vincular seu WhatsApp pessoal ao JARVIS (QR code via OpenWA)"
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
      >
        <QrCode size={14} /> OpenWA
      </button>

      {open && (
        <div className="mo-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="modal-pop w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1120] text-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Smartphone size={16} className="text-emerald-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Vincular WhatsApp (OpenWA)</div>
                  <div className="text-[10px] text-white/35">Acesso ao seu número pessoal via QR code — não-oficial</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => { load() }} className="p-1.5 rounded-lg hover:bg-white/5 text-white/50" title="Atualizar"><RefreshCw size={14} /></button>
                <button type="button" onClick={() => { setOpen(false); setQr(null); setLog(null); setForceConfirm(false) }} className="p-1.5 rounded-lg hover:bg-white/5 text-white/50"><X size={16} /></button>
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              {/* Aviso */}
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[10.5px] leading-snug text-amber-200/80">
                  OpenWA usa o protocolo do WhatsApp Web (não-oficial). Há risco real de restrição/banimento — use um número dedicado, não o seu principal. O JARVIS nunca envia nada sem o seu comando.
                </p>
              </div>

              {/* Serviço OpenWA */}
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Serviço OpenWA</div>
                  {st === null ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-white/40 bg-white/5 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Verificando…</span>
                  ) : installing ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-300 bg-sky-500/10 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Instalando…</span>
                  ) : running ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-green-500/40 text-green-300 bg-green-500/10">Rodando{st?.openwa?.version ? ` · v${st.openwa.version}` : ''} · porta {st?.openwa?.port}</span>
                  ) : installed ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-white/50 bg-white/5">Instalado (parado)</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-white/50 bg-white/5">Não instalado</span>
                  )}
                </div>

                {/* Progresso da instalação */}
                {(installing || st?.install?.done) && !running && (
                  <div className="mt-2 text-[11px] text-sky-100/80 font-mono max-h-28 overflow-y-auto whitespace-pre-wrap">
                    {(st?.install?.steps || []).map((s: string, i: number) => <div key={i}>{s}</div>)}
                    {st?.install?.error && <div className="text-red-300">{st.install.error}</div>}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {st !== null && !installed && !installing && (
                    <button type="button" onClick={doInstall} disabled={!!busy} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium">
                      {busy === 'install' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Instalar OpenWA neste PC
                    </button>
                  )}
                  {installed && !running && !installing && (
                    <button type="button" onClick={doStart} disabled={!!busy} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium">
                      {busy === 'start' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Iniciar OpenWA
                    </button>
                  )}
                  {running && !installing && (
                    <button type="button" onClick={doStop} disabled={!!busy} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-white/55 hover:bg-white/5 disabled:opacity-50">
                      {busy === 'stop' ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />} Parar
                    </button>
                  )}
                  <button type="button" onClick={() => setShowAdvanced(v => !v)} className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-white/55 hover:bg-white/5">
                    <Globe size={12} /> OpenWA externo <ChevronDown size={11} className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  <button type="button" onClick={showLogs} title="Ver logs do serviço" className="p-1.5 rounded-lg border border-white/10 text-white/55 hover:bg-white/5"><Terminal size={12} /></button>
                </div>

                {showAdvanced && (
                  <div className="mt-3 border-t border-white/5 pt-3 flex flex-col gap-2">
                    <label className="text-[10px] text-white/45">URL base do OpenWA (ex.: http://192.168.0.10:2785)</label>
                    <input className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs" placeholder={st?.baseUrl || 'http://127.0.0.1:2785'} value={advUrl} onChange={e => setAdvUrl(e.target.value)} />
                    <label className="text-[10px] text-white/45">API key do OpenWA {hasKey && <span className="text-emerald-400">(••••{st?.apiKeyHint?.slice(-4) || 'salva'})</span>}</label>
                    <input type="password" className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs" placeholder={hasKey ? '•••••••• (salva)' : 'cole a admin key'} value={advKey} onChange={e => setAdvKey(e.target.value)} />
                    <button type="button" onClick={saveAdvanced} disabled={!!busy} className="self-start flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50">{busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null} Salvar configuração</button>
                  </div>
                )}
                {log !== null && <pre className="mt-3 max-h-32 overflow-auto text-[9.5px] leading-snug bg-black/50 border border-white/5 rounded-lg p-2 text-white/60 whitespace-pre-wrap">{log}</pre>}
              </div>

              {/* Sessão / QR */}
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Sessão do JARVIS</div>
                  {statusPill(session?.status)}
                </div>

                {session?.status === 'ready' ? (
                  <div className="mt-2.5">
                    <div className="flex items-center gap-2 text-green-300 text-xs">
                      <CheckCircle2 size={14} /> Vinculado como <b>{session.pushName || 'WhatsApp'}{session.phone ? ` · ${session.phone}` : ''}</b>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <input className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs" placeholder={session.phone ? `${session.phone} (você) ou outro número` : 'DDI+DDD+número (5511…)'} value={sendTo} onChange={e => setSendTo(e.target.value)} />
                      <button type="button" onClick={doSend} disabled={!!busy || !sendText.trim()} className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40">{busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
                    </div>
                    <input className="w-full mt-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs" placeholder="Mensagem de teste (ex.: oi, sou o JARVIS)" value={sendText} onChange={e => setSendText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSend() }} />
                    <div className="flex items-center gap-2 mt-3">
                      <button type="button" onClick={doDisconnect} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${forceConfirm ? 'border-red-500/50 text-red-300 bg-red-500/10' : 'border-white/10 text-white/55 hover:bg-white/5'}`}>
                        {busy === 'unlink' ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />} {forceConfirm ? 'Clique de novo para DESVINCULAR' : 'Desvincular aparelho'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5">
                    {!qr ? (
                      <button type="button" onClick={doConnect} disabled={!!busy || !running || !hasKey} title={!running ? 'Inicie o OpenWA primeiro' : !hasKey ? 'OpenWA sem API key — veja o passo acima' : 'Gerar o QR de vinculação'} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm">
                        {busy === 'qr' ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} Gerar QR Code de vinculação
                      </button>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-1">
                        {/* eslint-disable-next-line @next/next/no-img-element -- QR é data URI gerado em runtime; next/image não otimiza */}
                        <img src={qr} alt="QR code de vinculação do WhatsApp" className="w-52 h-52 rounded-xl border border-white/10 bg-white p-1.5" />
                        <p className="text-[11px] text-white/60 text-center leading-snug">No celular: <b>WhatsApp → Aparelhos conectados → Conectar um aparelho</b><br />e aponte a câmera para este QR.</p>
                        <button type="button" onClick={pollQr} className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"><RefreshCw size={12} /> Já escaneei — verificar</button>
                      </div>
                    )}
                    {session?.status === 'failed' && session?.lastError && <p className="mt-2 text-[11px] text-red-300/90">Erro: {session.lastError}</p>}
                  </div>
                )}
              </div>

              {/* Últimas mensagens recebidas */}
              {events.length > 0 && (
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1.5">Chegaram via OpenWA</div>
                  <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
                    {events.map((e, i) => (
                      <div key={i} className="text-[10.5px] leading-snug flex items-baseline gap-2">
                        <span className="text-white/30 shrink-0">{new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-emerald-300/80 shrink-0">{e.from || e.event}</span>
                        <span className="text-white/70 truncate">{e.body || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[9.5px] text-white/30 leading-snug">
                O OpenWA roda localmente em <code>data/openwa</code> (porta {st?.openwa?.port || 2785}). Guia completo em <code>GUIA-OPENWA.md</code>. Repositório: github.com/rmyndharis/OpenWA (MIT).
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
