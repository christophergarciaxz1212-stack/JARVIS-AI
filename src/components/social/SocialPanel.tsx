'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, ExternalLink, Film, ImageIcon, Link2, Loader2, LogOut, Plug, RefreshCw, Send, Sparkles, Trash2, TrendingUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '@/components/agents/api'
import { ConfirmDialog, Modal } from '@/components/agents/shared'
import type { Brand, MetricoolConfig, PostMetric, ScheduledPost, Series } from '@/lib/social/metricool'

type Tab = 'overview' | 'compose' | 'calendar' | 'account'
type Settled<T> = { ok: true; value: T } | { ok: false; error: string }
interface Overview { days: number; igFollowers: Settled<Series>; igContent: Settled<PostMetric[]>; ttFollowers: Settled<Series>; ttViews: Settled<Series>; ttContent: Settled<PostMetric[]> }
interface LibItem { kind: 'image' | 'video'; id: string; title: string; thumb?: string; createdAt: number; aspect?: string }
interface Status { connected: boolean; hasToken: boolean; config: MetricoolConfig | null }

const API = '/api/social'
const input = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-pink-400/50'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-40'
const btnMain = `${btn} bg-pink-500/15 text-pink-100 border-pink-400/30 hover:bg-pink-500/25`
const btnGhost = `${btn} text-white/60 border-white/10 hover:bg-white/5 hover:text-white`
const card = 'rounded-xl border border-white/[0.07] bg-white/[0.02] p-4'
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(Math.round(n)))
const when = (s?: string) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="h-10 text-[10px] text-white/30 flex items-center">sem série no período</div>
  const min = Math.min(...values), max = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - ((v - min) / (max - min || 1)) * 32}`).join(' ')
  return <svg viewBox="0 0 100 38" preserveAspectRatio="none" className="w-full h-10"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>
}

function NetworkCard({ title, color, series, sum, extra, error }: { title: string; color: string; series?: Series; sum?: boolean; extra?: React.ReactNode; error?: string }) {
  const values = series?.values.map(v => v.value) || []
  const big = sum ? values.reduce((a, b) => a + b, 0) : values[values.length - 1] ?? series?.total ?? 0
  return (
    <div className={card}>
      <div className="text-xs text-white/60">{title}</div>
      {error ? <div className="text-[11px] text-amber-200/80 mt-2">{error}</div> : <>
        <div className="text-2xl text-white font-semibold mt-1">{sum && big > 0 ? '+' : ''}{fmt(big)}</div>
        <Spark values={values} color={color} />
        {extra}
      </>}
    </div>
  )
}

function PostsTable({ items }: { items: PostMetric[] }) {
  const top = [...items].sort((a, b) => (b.views + b.likes * 5 + b.comments * 10) - (a.views + a.likes * 5 + a.comments * 10)).slice(0, 8)
  if (!top.length) return <div className="text-xs text-white/40">Nenhum post no período.</div>
  return (
    <div className="space-y-1.5">
      {top.map(p => (
        <div key={`${p.kind}-${p.id}`} className="flex items-center gap-3 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.image ? <img src={p.image} alt="" className="w-10 h-10 rounded object-cover bg-white/5" /> : <div className="w-10 h-10 rounded bg-white/5" />}
          <div className="flex-1 min-w-0">
            <div className="text-white/80 truncate">{p.text || '(sem legenda)'}</div>
            <div className="text-[10px] text-white/40">{p.kind === 'reel' ? 'Reel' : p.kind === 'tiktok' ? 'TikTok' : 'Post'} · {when(p.publishedAt)}</div>
          </div>
          <div className="text-[11px] text-white/60 text-right whitespace-nowrap">👁 {fmt(p.views)} · ❤ {fmt(p.likes)} · 💬 {fmt(p.comments)}</div>
          {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-white/40 hover:text-white"><ExternalLink size={12} /></a>}
        </div>
      ))}
    </div>
  )
}

function OverviewTab() {
  const [d, setD] = useState<Overview | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try { setD(await get<Overview>(`${API}?action=overview&days=${days}`)) } catch (e) { toast.error((e as Error).message) } finally { setLoading(false) }
  }, [days])
  useEffect(() => { load() }, [load])
  const ig = d?.igContent.ok ? d.igContent.value : []
  const tt = d?.ttContent.ok ? d.ttContent.value : []
  const sum = (xs: PostMetric[], k: keyof PostMetric) => xs.reduce((a, x) => a + (x[k] as number), 0)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {[7, 30, 90].map(n => <button key={n} onClick={() => setDays(n)} className={`px-2 py-1 rounded text-[11px] ${days === n ? 'bg-pink-500/20 text-pink-100' : 'text-white/45 hover:text-white'}`}>{n} dias</button>)}
        <button className={`${btnGhost} ml-auto`} onClick={load} disabled={loading}>{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Atualizar</button>
      </div>
      {!d ? <div className="text-sm text-white/40 py-10 text-center"><Loader2 className="inline animate-spin mr-2" size={14} />Buscando métricas no Metricool…</div> : <>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <NetworkCard title={`Instagram · novos seguidores (${d.days} d)`} color="#f472b6" series={d.igFollowers.ok ? d.igFollowers.value : undefined} sum error={d.igFollowers.ok ? undefined : d.igFollowers.error}
            extra={<div className="text-[11px] text-white/45">{ig.length} publicações · ❤ {fmt(sum(ig, 'likes'))} · 👁 {fmt(sum(ig, 'views'))} · alcance {fmt(sum(ig, 'reach'))}</div>} />
          <NetworkCard title="TikTok · seguidores" color="#22d3ee" series={d.ttFollowers.ok ? d.ttFollowers.value : undefined} error={d.ttFollowers.ok ? undefined : d.ttFollowers.error}
            extra={<div className="text-[11px] text-white/45">{tt.length} vídeos · ❤ {fmt(sum(tt, 'likes'))} · 💬 {fmt(sum(tt, 'comments'))}</div>} />
          <NetworkCard title={`TikTok · visualizações (${d.days} d)`} color="#a78bfa" series={d.ttViews.ok ? d.ttViews.value : undefined} sum error={d.ttViews.ok ? undefined : d.ttViews.error} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className={card}><div className="text-sm text-white/80 mb-2">Melhores do Instagram</div>{d.igContent.ok ? <PostsTable items={ig} /> : <div className="text-[11px] text-amber-200/80">{d.igContent.error}</div>}</div>
          <div className={card}><div className="text-sm text-white/80 mb-2">Melhores do TikTok</div>{d.ttContent.ok ? <PostsTable items={tt} /> : <div className="text-[11px] text-amber-200/80">{d.ttContent.error}</div>}</div>
        </div>
      </>}
    </div>
  )
}

function localNow(offsetMin: number) {
  const d = new Date(Date.now() + offsetMin * 60_000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function ComposeTab({ onDone }: { onDone: () => void }) {
  const [networks, setNetworks] = useState<Array<'instagram' | 'tiktok'>>(['instagram'])
  const [text, setText] = useState('')
  const [idea, setIdea] = useState('')
  const [igType, setIgType] = useState<'POST' | 'REEL' | 'STORY'>('POST')
  const [privacy, setPrivacy] = useState('PUBLIC_TO_EVERYONE')
  const [whenAt, setWhenAt] = useState(localNow(60))
  const [lib, setLib] = useState<LibItem[]>([])
  const [picked, setPicked] = useState<LibItem[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { get<{ items: LibItem[] }>(`${API}?action=library`).then(d => setLib(d.items)).catch(() => {}) }, [])
  const hasVideo = picked.some(p => p.kind === 'video') || /\.(mp4|mov)(\?|$)/i.test(url)
  useEffect(() => { if (hasVideo && igType === 'POST') setIgType('REEL') }, [hasVideo, igType])
  const toggle = (n: 'instagram' | 'tiktok') => setNetworks(xs => xs.includes(n) ? xs.filter(x => x !== n) : [...xs, n])
  const pick = (it: LibItem) => setPicked(xs => xs.some(x => x.id === it.id) ? xs.filter(x => x.id !== it.id) : [...xs, it].slice(0, 10))

  const genCaption = async () => {
    setBusy('caption')
    try { setText((await post<{ caption: string }>(API, { action: 'caption', idea: idea || picked.map(p => p.title).join('; ') || text, networks })).caption) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const submit = async (draft: boolean) => {
    setBusy(draft ? 'draft' : 'send')
    try {
      const attachments = [...picked.map(p => ({ kind: p.kind, id: p.id })), ...(url.trim() ? [{ kind: 'url', url: url.trim() }] : [])]
      await post(API, { action: 'create', text, networks, when: whenAt, instagramType: igType, tiktokPrivacy: privacy, attachments, draft })
      toast.success(draft ? 'Rascunho salvo no Metricool' : `Agendado para ${when(whenAt)}`)
      setText(''); setPicked([]); setUrl('')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      <div className="space-y-3">
        <div className="flex gap-2">
          {(['instagram', 'tiktok'] as const).map(n => (
            <button key={n} onClick={() => toggle(n)} className={`${btn} ${networks.includes(n) ? 'bg-pink-500/15 text-white border-pink-400/40' : 'text-white/50 border-white/10'}`}>{networks.includes(n) && <Check size={12} />}{n === 'instagram' ? 'Instagram' : 'TikTok'}</button>
          ))}
          {networks.includes('instagram') && (
            <select value={igType} onChange={e => setIgType(e.target.value as typeof igType)} className={`${input} w-auto py-1 text-xs`}>
              <option value="POST" disabled={hasVideo}>Feed</option><option value="REEL">Reel</option><option value="STORY">Story</option>
            </select>
          )}
          {networks.includes('tiktok') && (
            <select value={privacy} onChange={e => setPrivacy(e.target.value)} className={`${input} w-auto py-1 text-xs`}>
              <option value="PUBLIC_TO_EVERYONE">TikTok: público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="FOLLOWER_OF_CREATOR">Seguidores</option><option value="SELF_ONLY">Só eu</option>
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <input value={idea} onChange={e => setIdea(e.target.value)} placeholder="Sobre o que é o post? (a IA escreve a legenda)" className={input} />
          <button className={btnGhost} disabled={busy === 'caption'} onClick={genCaption}>{busy === 'caption' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Legenda com IA</button>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={2200} placeholder="Legenda + hashtags" className={`${input} resize-y`} />
        <div className="text-[10px] text-white/30 text-right -mt-2">{text.length}/2200</div>
        <div className="flex gap-2 items-center">
          <CalendarClock size={14} className="text-white/50" />
          <input type="datetime-local" value={whenAt} min={localNow(5)} onChange={e => setWhenAt(e.target.value)} className={`${input} w-auto`} />
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} disabled={!!busy} onClick={() => submit(true)}>{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : null} Salvar rascunho</button>
            <button className={btnMain} disabled={!!busy || !networks.length || (!picked.length && !url.trim())} onClick={() => setConfirm(true)}>{busy === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Agendar</button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Link2 size={14} className="text-white/50" />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="ou cole um link https público de imagem/vídeo" className={input} />
        </div>
        {picked.length > 0 && <div className="text-[11px] text-white/50">Anexos: {picked.map(p => `${p.kind === 'video' ? '🎬' : '🖼'} ${p.title.slice(0, 30)}`).join(' · ')}</div>}
      </div>
      <div className={`${card} p-3`}>
        <div className="text-xs text-white/70 mb-2">Mídia do JARVIS (clique para anexar)</div>
        <div className="grid grid-cols-3 gap-1.5 max-h-[52vh] overflow-y-auto">
          {lib.map(it => {
            const on = picked.some(p => p.id === it.id)
            return (
              <button key={it.id} onClick={() => pick(it)} title={it.title} className={`relative aspect-square rounded-lg overflow-hidden border ${on ? 'border-pink-400 ring-2 ring-pink-400/40' : 'border-white/10'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.thumb ? <img src={it.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5" />}
                <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-black/70 rounded px-1">{it.kind === 'video' ? <Film size={9} className="inline" /> : <ImageIcon size={9} className="inline" />}</span>
                {on && <span className="absolute top-0.5 right-0.5 bg-pink-500 rounded-full p-0.5"><Check size={9} /></span>}
              </button>
            )
          })}
          {!lib.length && <div className="col-span-3 text-[11px] text-white/40">Gere imagens (“gere uma imagem de…”) ou vídeos (Estúdio Motion) e eles aparecem aqui.</div>}
        </div>
      </div>
      {confirm && (
        <ConfirmDialog title="Agendar publicação?" danger={false} confirmLabel="Agendar" onClose={() => setConfirm(false)} onConfirm={() => submit(false)}>
          <p>Vai ao ar em <b>{when(whenAt)}</b> no {networks.map(n => (n === 'instagram' ? `Instagram (${igType === 'POST' ? 'feed' : igType.toLowerCase()})` : 'TikTok')).join(' e ')}, publicado automaticamente pelo Metricool.</p>
          <p className="text-white/40">Você pode cancelar até lá na aba Calendário ou no próprio Metricool.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function CalendarTab({ refresh }: { refresh: number }) {
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null)
  const [del, setDel] = useState<ScheduledPost | null>(null)
  const load = useCallback(() => get<{ posts: ScheduledPost[] }>(`${API}?action=scheduled`).then(d => setPosts(d.posts)).catch(e => { toast.error(e.message); setPosts([]) }), [])
  useEffect(() => { load() }, [load, refresh])
  if (!posts) return <div className="text-sm text-white/40 py-10 text-center"><Loader2 className="inline animate-spin mr-2" size={14} />Carregando calendário…</div>
  if (!posts.length) return <div className="text-sm text-white/40 py-10 text-center">Nada agendado para os próximos 30 dias.</div>
  return (
    <div className="space-y-2">
      {posts.map(p => (
        <div key={p.id} className={`${card} flex items-start gap-3`}>
          <div className="text-xs text-pink-200 w-24 shrink-0">{when(p.publicationDate?.dateTime)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/85 line-clamp-2 whitespace-pre-wrap">{p.text}</div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {p.draft && <span className="text-[10px] px-1.5 rounded bg-white/10 text-white/60">rascunho</span>}
              {(p.providers || []).map(pr => (
                <span key={pr.network} className={`text-[10px] px-1.5 rounded ${pr.status === 'ERROR' ? 'bg-red-500/20 text-red-200' : pr.status === 'PUBLISHED' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/60'}`} title={pr.detailedStatus}>
                  {pr.network} · {pr.status === 'PUBLISHED' ? 'publicado' : pr.status === 'ERROR' ? 'erro' : pr.status === 'PENDING' ? 'agendado' : (pr.status || 'agendado').toLowerCase()}
                </span>
              ))}
              {p.media?.length ? <span className="text-[10px] text-white/40">{p.media.length} mídia(s)</span> : null}
            </div>
          </div>
          {!(p.providers || []).every(pr => pr.status === 'PUBLISHED') && <button className={btnGhost} onClick={() => setDel(p)}><Trash2 size={12} /></button>}
        </div>
      ))}
      {del && <ConfirmDialog title="Cancelar este agendamento?" confirmLabel="Cancelar post" onClose={() => setDel(null)} onConfirm={async () => { await post(API, { action: 'delete', id: del.id }); load() }}>O post de {when(del.publicationDate?.dateTime)} será removido do Metricool e não será publicado.</ConfirmDialog>}
    </div>
  )
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="max-w-lg mx-auto space-y-3 py-4">
      <div className="text-sm text-white">Conectar o Metricool</div>
      <ol className="text-xs text-white/60 list-decimal pl-5 space-y-1">
        <li>A API do Metricool está disponível nos planos <b>Advanced</b> e <b>Custom</b>.</li>
        <li>No Metricool, abra <b>Configurações da conta › API</b> e copie o token.</li>
        <li>O <b>userId</b> aparece na barra de endereço do Metricool (<span className="font-mono">userId=123456</span>).</li>
        <li>Conecte o Instagram e o TikTok à sua marca dentro do próprio Metricool.</li>
      </ol>
      <input value={token} onChange={e => setToken(e.target.value)} type="password" autoComplete="off" placeholder="Token da API" className={input} />
      <input value={userId} onChange={e => setUserId(e.target.value.replace(/\D/g, ''))} placeholder="userId (número)" className={input} />
      <button className={btnMain} disabled={busy || !token.trim() || !userId} onClick={async () => {
        setBusy(true)
        try { await post(API, { action: 'connect', token, userId }); toast.success('Metricool conectado'); onConnected() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
      }}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />} Conectar</button>
      <div className="text-[11px] text-white/35">O token fica guardado só neste computador, junto das outras chaves do JARVIS, e nunca é enviado para a IA.</div>
    </div>
  )
}

function AccountTab({ status, onChange }: { status: Status; onChange: () => void }) {
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [tz, setTz] = useState(status.config?.timezone || '')
  useEffect(() => { get<{ brands: Brand[] }>(`${API}?action=brands`).then(d => setBrands(d.brands)).catch(e => { toast.error(e.message); setBrands([]) }) }, [])
  const choose = async (b: Brand) => { await post(API, { action: 'select-brand', blogId: b.blogId, label: b.label }); toast.success(`Marca: ${b.label}`); onChange() }
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="text-sm text-white/80 mb-2">Marca usada pelo JARVIS</div>
        {!brands ? <Loader2 size={14} className="animate-spin text-white/40" /> : brands.map(b => (
          <button key={b.blogId} onClick={() => choose(b)} className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left ${status.config?.blogId === b.blogId ? 'bg-pink-500/10 border border-pink-400/40' : 'hover:bg-white/5 border border-transparent'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {b.picture ? <img src={b.picture} alt="" className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 rounded-full bg-white/10" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white">{b.label}</div>
              <div className="text-[10px] text-white/45">Instagram: {b.instagram || 'não conectado'} · TikTok: {b.tiktok || 'não conectado'}</div>
            </div>
            {status.config?.blogId === b.blogId && <Check size={14} className="text-pink-300" />}
          </button>
        ))}
      </div>
      <div className={`${card} flex items-center gap-2`}>
        <span className="text-xs text-white/60">Fuso horário dos agendamentos</span>
        <input value={tz} onChange={e => setTz(e.target.value)} className={`${input} w-56`} />
        <button className={btnGhost} onClick={async () => { await post(API, { action: 'timezone', timezone: tz }); toast.success('Fuso salvo'); onChange() }}>Salvar</button>
      </div>
      <button className={`${btn} text-red-200 border-red-400/30 hover:bg-red-500/15`} onClick={async () => { await post(API, { action: 'disconnect' }); toast.success('Metricool desconectado'); onChange() }}><LogOut size={12} /> Desconectar</button>
    </div>
  )
}

export default function SocialPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [refresh, setRefresh] = useState(0)
  const load = useCallback(() => get<Status>(`${API}?action=status`).then(setStatus).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const needsBrand = status?.connected && !status.config?.blogId
  const tabs = useMemo(() => ([['overview', 'Visão geral', TrendingUp], ['compose', 'Agendar post', Send], ['calendar', 'Calendário', CalendarClock], ['account', 'Conta', Plug]] as const), [])
  return (
    <Modal onClose={onClose} width="max-w-6xl">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-pink-500/15 flex items-center justify-center"><TrendingUp size={18} className="text-pink-300" /></div>
        <div>
          <div className="text-base font-semibold text-white">Social · Metricool</div>
          <div className="text-[11px] text-white/45">Instagram e TikTok: métricas, agendamento e calendário{status?.config?.brandLabel ? ` · ${status.config.brandLabel}` : ''}</div>
        </div>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/5 text-white/40"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ maxHeight: 'calc(88vh - 70px)' }}>
        {!status ? <Loader2 className="animate-spin text-white/40" size={16} /> : !status.connected ? <ConnectForm onConnected={() => { load(); setTab('account') }} /> : <>
          <div className="flex gap-1 mb-4 flex-wrap">
            {tabs.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${tab === id ? 'bg-pink-500/15 text-pink-100' : 'text-white/55 hover:bg-white/5 hover:text-white'}`}><Icon size={13} /> {label}</button>
            ))}
          </div>
          {needsBrand && tab !== 'account' ? <div className="text-sm text-white/60 py-6 text-center">Escolha a marca na aba <button className="text-pink-300 underline" onClick={() => setTab('account')}>Conta</button>.</div> : <>
            {tab === 'overview' && <OverviewTab />}
            {tab === 'compose' && <ComposeTab onDone={() => { setRefresh(x => x + 1); setTab('calendar') }} />}
            {tab === 'calendar' && <CalendarTab refresh={refresh} />}
            {tab === 'account' && <AccountTab status={status} onChange={load} />}
          </>}
        </>}
      </div>
    </Modal>
  )
}
