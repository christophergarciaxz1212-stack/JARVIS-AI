'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ExternalLink, FileUp, FolderOpen, Globe, LogIn, Plus, RefreshCw, ShieldAlert, Trash2, Unplug, XCircle, Radio, QrCode, Users } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/agents/shared'
import { hub, SOURCE_META, type WhatsAppLive } from './hubApi'
import type { Connection, HubSource } from '@/lib/hub/types'

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Conectado', cls: 'bg-green-500/15 text-green-300' },
  disconnected: { label: 'Não conectado', cls: 'bg-white/5 text-white/40' },
  'needs-auth': { label: 'Entrar de novo', cls: 'bg-amber-400/15 text-amber-200' },
  error: { label: 'Erro', cls: 'bg-red-500/15 text-red-300' },
  syncing: { label: 'Sincronizando', cls: 'bg-cyan-500/15 text-cyan-200 animate-pulse' },
}

const FILE_FILTERS: Partial<Record<HubSource, Array<{ name: string; extensions: string[] }>>> = {
  whatsapp: [{ name: 'Exportação do WhatsApp', extensions: ['zip', 'txt'] }],
  chatgpt: [{ name: 'Exportação do ChatGPT', extensions: ['zip', 'json'] }],
  gemini: [{ name: 'Google Takeout', extensions: ['zip', 'json', 'html'] }],
  calendar: [{ name: 'Calendário', extensions: ['ics'] }],
}

export default function HubConnections({ onChanged }: { onChanged: () => void }) {
  const [conns, setConns] = useState<Connection[]>([])
  const [teamsLogin, setTeamsLogin] = useState<{ user_code: string; verification_uri: string; status: string; error?: string } | undefined>()
  const [live, setLive] = useState<WhatsAppLive | undefined>()
  const [busy, setBusy] = useState('')
  const [erase, setErase] = useState<Connection | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await hub.connections()
      setConns(d.connections)
      setTeamsLogin(d.teamsLogin)
      setLive(d.whatsappLive)
    } catch (e) { toast.error((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  // While the Microsoft sign-in is pending, watch for it to finish
  useEffect(() => {
    if (teamsLogin?.status !== 'pending') return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [teamsLogin?.status, load])

  // QR expira e re-renderiza: atualiza enquanto pareia
  useEffect(() => {
    if (live?.status !== 'pairing') return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [live?.status, load])

  const run = async (key: string, fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast.success(ok(r))
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
      load()
    }
  }

  const syncResult = (r: unknown) => {
    const x = r as { added?: number; organized?: { tasksCreated: number; examsCreated: number }; warnings?: string[] }
    return `${x.added ?? 0} novidade(s) · ${x.organized?.tasksCreated ?? 0} tarefa(s) e ${x.organized?.examsCreated ?? 0} prova(s) identificadas${x.warnings?.length ? ` · ${x.warnings.length} aviso(s)` : ''}`
  }

  const importFile = (c: Connection) => run(`import-${c.id}`, async () => {
    const file = await window.electron?.pickFile?.(FILE_FILTERS[c.id])
    if (!file) throw new Error('Nenhum arquivo escolhido')
    return hub.act('import', { source: c.id, path: file })
  }, syncResult)

  const portal = conns.find(c => c.id === 'portal')
  const portalPages = (portal?.config.pages as Array<{ url: string; title: string }>) || []

  const capturePortal = () => run('portal-capture', async () => {
    const capture = await window.electron?.portalCapture?.()
    if (!capture) throw new Error('A captura só funciona no aplicativo JARVIS')
    const r = await hub.act<{ extracted: Record<string, number> }>('portal-capture', { capture })
    return r
  }, r => {
    const e = (r as { extracted: Record<string, number> }).extracted
    return `Página lida: ${e.courses} disciplina(s), ${e.tasks} trabalho(s), ${e.exams} prova(s), ${e.materials} material(is), ${e.notices} aviso(s)`
  })

  const syncPortal = () => run('portal-sync', async () => {
    const captures = await window.electron?.portalSyncPages?.(portalPages.map(p => p.url))
    if (!captures) throw new Error('A sincronização do portal só funciona no aplicativo JARVIS')
    let ok = 0
    for (const c of captures) {
      if (c.error || c.loginRequired) continue
      await hub.act('portal-capture', { capture: c })
      ok++
    }
    if (!ok) throw new Error('A sessão do portal expirou: clique em “Abrir portal”, entre e capture uma página')
    return { ok }
  }, r => `${(r as { ok: number }).ok} página(s) do portal atualizada(s)`)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {conns.map(c => {
        const meta = SOURCE_META[c.id]
        const st = STATUS[c.status] || STATUS.disconnected
        return (
          <motion.div key={c.id} layout className="p-4 rounded-2xl border border-white/[0.07] bg-[rgba(6,14,24,0.88)]">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}55` }}>{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{c.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">{c.mode === 'api' ? 'API oficial' : c.mode === 'export' ? 'exportação oficial' : c.mode === 'browser' ? 'sua sessão no app' : c.mode === 'feed' ? 'link iCal' : 'pasta local'}</span>
                </div>
                {c.account && <div className="text-[11px] text-cyan-200/70 mt-0.5 truncate">{c.account}</div>}
                <div className="text-[11px] text-white/35 mt-0.5">
                  {c.counts?.items ? `${c.counts.items} item(ns)` : 'sem dados'}{c.lastSync ? ` · última vez ${new Date(c.lastSync).toLocaleString('pt-BR')}` : ''}
                </div>
                {c.lastError && <div className="text-[11px] text-amber-200/80 mt-1 break-words">{c.lastError}</div>}
                <ul className="mt-2 space-y-0.5">{(c.notes || []).map((n, i) => <li key={i} className="text-[11px] text-white/40">• {n}</li>)}</ul>
              </div>
            </div>

            {/* Source-specific setup */}
            <div className="mt-3 space-y-2">
              {c.id === 'teams' && <TeamsSetup c={c} login={teamsLogin} busy={busy} run={run} />}
              {c.id === 'calendar' && <CalendarSetup c={c} run={run} />}
              {c.id === 'portal' && (
                <>
                  <PortalSetup c={c} pages={portalPages} busy={busy} capture={capturePortal} sync={syncPortal} run={run} />
                  <PlaywrightPortalSetup c={c} busy={busy} run={run} />
                </>
              )}
              {c.id === 'whatsapp' && <WhatsAppLiveSetup c={c} live={live} busy={busy} run={run} onChanged={load} />}
            </div>

            <div className="mt-3 flex items-center gap-1.5 flex-wrap border-t border-white/5 pt-3">
              {(c.id === 'github' || c.id === 'teams' || c.id === 'calendar' || c.id === 'files') && (
                <Btn icon={RefreshCw} spin={busy === `sync-${c.id}`} label="Sincronizar" onClick={() => run(`sync-${c.id}`, () => hub.act('sync', { source: c.id }), syncResult)} />
              )}
              {FILE_FILTERS[c.id] && <Btn icon={FileUp} spin={busy === `import-${c.id}`} label="Importar arquivo" onClick={() => importFile(c)} />}
              {c.id === 'files' && (
                <Btn icon={FolderOpen} label={c.config.folder ? 'Trocar pasta' : 'Escolher pasta'} onClick={() => run('folder', async () => {
                  const folder = await window.electron?.pickFolder?.()
                  if (!folder) throw new Error('Nenhuma pasta escolhida')
                  await hub.act('configure', { source: 'files', config: { folder } })
                  return hub.act('sync', { source: 'files' })
                }, syncResult)} />
              )}
              {c.id === 'github' && c.status === 'disconnected' && <span className="text-[11px] text-white/35">Precisa do token em 🔑 Chaves de API › GitHub</span>}
              <div className="flex-1" />
              {c.status !== 'disconnected' && <Btn icon={Unplug} label="Desconectar" onClick={() => run('disc', () => hub.act('disconnect', { source: c.id, erase: false }), () => 'Desconectado (dados mantidos)')} />}
              {(c.counts?.items || 0) > 0 && <Btn icon={Trash2} danger label="Apagar dados" onClick={() => setErase(c)} />}
            </div>
          </motion.div>
        )
      })}

      <AnimatePresence>
        {erase && (
          <ConfirmDialog
            title={`Apagar tudo que veio de ${erase.name}?`}
            confirmLabel="Desconectar e apagar"
            onClose={() => setErase(null)}
            onConfirm={async () => { await hub.act('disconnect', { source: erase.id, erase: true, confirm: true }); toast.success('Dados apagados'); onChanged(); load() }}
          >
            <p>{erase.counts?.items} item(ns) importados, anexos salvos, o login dessa fonte e as tarefas/provas que só apareceram nela serão removidos do JARVIS.</p>
            <p className="text-white/40">Nada é apagado na plataforma original (WhatsApp, Teams, GitHub…).</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </div>
  )
}

function Btn({ icon: Icon, label, onClick, spin, danger }: { icon: typeof RefreshCw; label: string; onClick: () => void; spin?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={spin} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs disabled:opacity-50 ${danger ? 'text-red-300/80 hover:bg-red-500/10' : 'text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20'}`}>
      <Icon size={12} className={spin ? 'animate-spin' : ''} /> {label}
    </button>
  )
}

type Run = (key: string, fn: () => Promise<unknown>, ok?: (r: unknown) => string) => Promise<void>

function WhatsAppLiveSetup({ c, live, busy, run, onChanged }: { c: Connection; live?: WhatsAppLive; busy: string; run: Run; onChanged: () => void }) {
  const academic = new Set(live?.academicJids || [])
  const chats = live?.chats || []
  const toggleChat = (jid: string, enabled: boolean) => run(`wa-${jid}`, async () => {
    await hub.act('whatsapp-toggle-chat', { jid, academic: enabled })
    toast.success(enabled ? 'Grupo marcado como acadêmico — as próximas mensagens dele serão lidas' : 'Grupo desmarcado')
  })
  const toggleAll = (enable: boolean) => run('wa-all', () => hub.act('whatsapp-toggle-chats', { jids: enable ? chats.map(x => x.jid) : [] }), () => (enable ? 'Todos os grupos marcados como acadêmicos' : 'Todos desmarcados'))

  return (
    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <ShieldAlert size={14} className="text-amber-300 mt-0.5 flex-shrink-0" />
        <p className="text-[10.5px] leading-snug text-amber-200/80">
          <strong>AO VIVO (experimental):</strong> não é API oficial — lê os seus grupos pelo protocolo do WhatsApp Web. A Meta pode limitar ou até banir a conta. Leia apenas os grupos da faculdade; mensagens de colegas são dados pessoais de terceiros. Nada é enviado em seu nome sem aprovação.
        </p>
      </div>
      {live?.status === 'connected' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-emerald-200/90">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> conectado ao WhatsApp</span>
          <span>recebidas: <b>{live.stats.received}</b> · no Hub: <b>{live.stats.ingested}</b> · ignoradas: <b>{live.stats.skipped}</b></span>
          <span>{academic.size} grupo(s) acadêmico(s) marcado(s)</span>
        </div>
      )}
      {live?.status === 'pairing' && (
        <div className="rounded-lg bg-black/40 p-3 flex flex-col items-center gap-2">
          {live.qr ? <>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR data URI gerado localmente, não é asset otimizado */}
            <img src={live.qr} alt="QR do WhatsApp" className="rounded-lg border border-white/10" width={168} height={168} />
          </> : <QrCode size={120} className="text-white/30" />}
          <p className="text-[11px] text-white/60 text-center">Abra o WhatsApp no celular → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → escaneie este QR.</p>
        </div>
      )}
      {live?.status === 'error' && <p className="text-[11px] text-red-300">{live.error || 'Erro de conexão'}</p>}
      {live?.status !== 'connected' && (
        <button
          disabled={busy === 'wa-connect'}
          onClick={() => run('wa-connect', () => hub.act('whatsapp-connect'), () => 'Aguardando o QR — escaneie com o celular')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-green-500/15 text-green-200 border border-green-500/25 hover:bg-green-500/25 disabled:opacity-40"
        >
          {busy === 'wa-connect' ? <RefreshCw size={12} className="animate-spin" /> : <Radio size={12} />} {busy === 'wa-connect' ? 'Conectando…' : 'Conectar ao vivo (parear QR)'}
        </button>
      )}
      {live?.status === 'connected' && (
        <button onClick={() => run('wa-discover', () => hub.act('whatsapp-discover').then(() => onChanged()), () => 'Grupos atualizados')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20"><RefreshCw size={11} /> Atualizar grupos</button>
      )}
      {chats.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
          <div className="flex items-center justify-between px-2 py-1.5 sticky top-0 bg-black/60 backdrop-blur-sm">
            <span className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1"><Users size={11} /> Seus grupos ({chats.length})</span>
            <div className="flex gap-1">
              <button onClick={() => toggleAll(true)} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/60 hover:text-white">Marcar todos</button>
              <button onClick={() => toggleAll(false)} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/60 hover:text-white">Limpar</button>
            </div>
          </div>
          {chats.map(x => (
            <label key={x.jid} className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/[0.03] cursor-pointer text-[11px]">
              <input type="checkbox" checked={academic.has(x.jid)} onChange={e => toggleChat(x.jid, e.target.checked)} className="accent-green-500" />
              <span className="flex-1 truncate text-white/70" title={x.name}>{x.name}</span>
              {x.suggested && <span title="O nome sugere que é um grupo acadêmico — confirme marcando a caixa" className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-200/90 border border-amber-500/20">provável faculdade</span>}
              <span className="text-[9px] text-white/30 font-mono">{x.participants} mem.</span>
            </label>
          ))}
        </div>
      )}
      {live?.status === 'connected' && chats.length === 0 && (
        <p className="text-[10.5px] text-white/40">Nenhum grupo descoberto ainda — clique em “Atualizar grupos”.</p>
      )}
    </div>
  )
}

function TeamsSetup({ c, login, busy, run }: { c: Connection; login?: { user_code: string; verification_uri: string; status: string; error?: string }; busy: string; run: Run }) {
  const [clientId, setClientId] = useState(String(c.config.clientId || ''))
  const [tenant, setTenant] = useState(String(c.config.tenant || 'organizations'))
  const [channels, setChannels] = useState(c.config.channelScopes === true)
  return (
    <div className="space-y-2">
      <details className="text-[11px] text-white/45">
        <summary className="cursor-pointer text-cyan-200/80">Como obter o ID do aplicativo (uma vez só)</summary>
        <ol className="list-decimal pl-4 mt-1 space-y-0.5">
          <li>Abra portal.azure.com › Microsoft Entra ID › Registros de aplicativo › Novo registro.</li>
          <li>Tipos de conta: “Contas em qualquer diretório organizacional e contas Microsoft pessoais”.</li>
          <li>Em Autenticação, ative “Permitir fluxos de cliente público”.</li>
          <li>Copie o “ID do aplicativo (cliente)” e cole abaixo.</li>
        </ol>
        <p className="mt-1">Se a faculdade bloquear aplicativos externos, o Teams avisará que precisa de aprovação do administrador.</p>
      </details>
      <div className="flex gap-2">
        <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="ID do aplicativo (cliente)" className="input-jarvis flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] font-mono" />
        <select value={tenant} onChange={e => setTenant(e.target.value)} className="input-jarvis px-2 rounded-lg text-[11px]">
          <option value="organizations">Conta da faculdade</option>
          <option value="common">Qualquer conta</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-white/50"><input type="checkbox" checked={channels} onChange={e => setChannels(e.target.checked)} /> Ler e publicar em canais (exige aprovação do administrador na maioria das faculdades)</label>
      <button
        disabled={!clientId || busy === 'teams-login'}
        onClick={() => run('teams-login', async () => {
          await hub.act('configure', { source: 'teams', config: { clientId: clientId.trim(), tenant, channelScopes: channels } })
          const r = await hub.act<{ flow: { verification_uri: string; user_code: string } }>('teams-login')
          window.open(r.flow.verification_uri, '_blank')
          return r
        }, () => 'Digite o código na página da Microsoft que abriu')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#7b83eb]/25 text-white hover:bg-[#7b83eb]/40 disabled:opacity-40"
      >
        <LogIn size={12} /> Entrar com Microsoft
      </button>
      {login && (
        <div className={`p-2 rounded-lg text-[11px] ${login.status === 'error' ? 'bg-red-500/10 text-red-200' : login.status === 'done' ? 'bg-green-500/10 text-green-200' : 'bg-cyan-500/10 text-cyan-100'}`}>
          {login.status === 'pending' && <>Código: <span className="font-mono text-base tracking-widest">{login.user_code}</span> — digite em <a className="underline" href={login.verification_uri} target="_blank" rel="noreferrer">{login.verification_uri}</a>. Aguardando você entrar…</>}
          {login.status === 'done' && <><CheckCircle2 size={12} className="inline mr-1" />Conta conectada. Clique em Sincronizar.</>}
          {login.status === 'error' && <><XCircle size={12} className="inline mr-1" />{login.error}</>}
        </div>
      )}
    </div>
  )
}

function CalendarSetup({ c, run }: { c: Connection; run: Run }) {
  const urls = (c.config.urls as Array<{ name: string; url: string }>) || []
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  return (
    <div className="space-y-1.5">
      {urls.map((u, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] text-white/60">
          <Globe size={11} /> <span className="flex-1 truncate">{u.name}</span>
          <button onClick={() => run('cal-rm', () => hub.act('configure', { source: 'calendar', config: { urls: urls.filter((_, j) => j !== i) } }))} className="text-white/30 hover:text-red-300"><XCircle size={12} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome (ex.: Agenda da faculdade)" className="input-jarvis w-40 px-2 py-1.5 rounded-lg text-[11px]" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Link iCal secreto (https://… .ics)" className="input-jarvis flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] font-mono" />
        <button disabled={!url} onClick={() => run('cal-add', async () => {
          await hub.act('configure', { source: 'calendar', config: { urls: [...urls, { name: name || 'Calendário', url: url.trim() }] } })
          setName(''); setUrl('')
          return hub.act('sync', { source: 'calendar' })
        }, () => 'Calendário adicionado e sincronizado')} className="px-2 rounded-lg bg-cyan-500/15 text-cyan-200 disabled:opacity-40"><Plus size={12} /></button>
      </div>
    </div>
  )
}

function PlaywrightPortalSetup({ c, busy, run }: { c: Connection; busy: string; run: Run }) {
  const [status, setStatus] = useState<string>('idle')
  const [err, setErr] = useState('')
  const [last, setLast] = useState<{ title: string; at: number; courses: number; tasks: number; exams: number; materials: number; notices: number } | null>(null)
  const poll = useCallback(async () => {
    try { const d = await hub.act<{ status: string; error?: string; lastCapture?: typeof last }>('portal-status'); setStatus(d.status); setErr(d.error || ''); if (d.lastCapture) setLast(d.lastCapture) } catch {}
  }, [])
  useEffect(() => { poll() }, [poll])
  useEffect(() => {
    if (status === 'opening' || status === 'capturing' || status === 'window-open') {
      const t = setInterval(poll, 2500)
      return () => clearInterval(t)
    }
  }, [status, poll])
  const startUrl = String(c.config.startUrl || 'https://www.serverso.com.br/home')
  return (
    <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-cyan-300/60">Alternativa via Playwright (navegador real, sessão persistida)</p>
      <ol className="text-[11px] text-white/45 list-decimal pl-4 space-y-0.5">
        <li>Clique em “Abrir portal (Playwright)”.</li>
        <li>Uma janela do SERVERSO abre; faça login nela (login/senha só aí, nunca no JARVIS).</li>
        <li>Volte aqui e clique em “Capturar agora” para importar notas, faltas, atividades e avisos.</li>
      </ol>
      <div className="flex flex-wrap gap-1.5">
        <button disabled={busy === 'pw-open'} onClick={() => run('pw-open', () => hub.act('portal-open', { url: startUrl }).then(() => poll()), () => 'Janela do SERVERSO aberta (o login é seu)')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-emerald-500/15 text-emerald-100 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40">{busy === 'pw-open' ? <RefreshCw size={11} className="animate-spin" /> : <Globe size={11} />} Abrir portal (Playwright)</button>
        <button disabled={status !== 'window-open'} onClick={() => run('pw-capture', () => hub.act('portal-capture-now').then(r => { poll(); return r }), r => { const x = r as { courses: number; tasks: number; exams: number; materials: number; notices: number }; return `Capturado: ${x.courses} disciplina(s), ${x.tasks} trabalho(s), ${x.exams} prova(s), ${x.materials} material(is), ${x.notices} aviso(s)` })} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-cyan-500/15 text-cyan-100 border border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">{busy === 'pw-capture' ? <RefreshCw size={11} className="animate-spin" /> : <FileUp size={11} />} Capturar agora</button>
        {status === 'window-open' && <button onClick={() => run('pw-close', () => hub.act('portal-close').then(() => poll()))} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-white/55 hover:bg-white/5">Fechar janela</button>}
      </div>
      <div className="text-[10px] text-white/35">Status: {status === 'window-open' ? 'janela aberta (session salva)' : status === 'opening' ? 'abrindo…' : status === 'capturing' ? 'capturando…' : status}{err ? ` · ${err}` : ''}</div>
      {last && <div className="text-[10px] text-white/30">Última captura: <b>{last.title}</b> — {last.courses} disciplinas · {last.tasks} trabalhos · {last.exams} provas · {last.materials} materiais · {last.notices} avisos</div>}
    </div>
  )
}

function PortalSetup({ c, pages, busy, capture, sync, run }: { c: Connection; pages: Array<{ url: string; title: string }>; busy: string; capture: () => void; sync: () => void; run: Run }) {
  const [url, setUrl] = useState(String(c.config.startUrl || 'https://www.unama.br/'))
  const native = typeof window !== 'undefined' && !!window.electron?.portalOpen
  if (!native) return <p className="text-[11px] text-amber-200/80">Abra o JARVIS pelo aplicativo (atalho na área de trabalho) para usar o portal.</p>
  return (
    <div className="space-y-2">
      <ol className="text-[11px] text-white/45 list-decimal pl-4 space-y-0.5">
        <li>Clique em “Abrir portal”, entre com o seu login na janela que abrir e vá até notas, faltas, atividades ou avisos.</li>
        <li>Em cada página útil, volte aqui e clique em “Capturar página”.</li>
        <li>Depois, “Sincronizar páginas” atualiza todas de uma vez com a sua sessão.</li>
      </ol>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} className="input-jarvis flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px] font-mono" />
        <button onClick={() => run('portal-open', async () => {
          await hub.act('configure', { source: 'portal', config: { startUrl: url } })
          return window.electron!.portalOpen!(url)
        })} className="flex items-center gap-1 px-2.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-200"><ExternalLink size={12} /> Abrir portal</button>
      </div>
      <div className="flex gap-2">
        <Btn icon={FileUp} spin={busy === 'portal-capture'} label="Capturar página" onClick={capture} />
        {pages.length > 0 && <Btn icon={RefreshCw} spin={busy === 'portal-sync'} label={`Sincronizar ${pages.length} página(s)`} onClick={sync} />}
      </div>
      {pages.length > 0 && <div className="text-[10px] text-white/30">{pages.slice(-6).map(p => p.title).join(' · ')}</div>}
    </div>
  )
}
