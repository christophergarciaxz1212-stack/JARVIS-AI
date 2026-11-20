'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive, ArchiveRestore, Check, CheckSquare, Copy, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Search,
  Square, StopCircle, Trash2, Users, X, CircleCheck, CirclePlay,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from './api'
import { ConfirmDialog, ProjectDialog } from './shared'
import type { Project, SessionMeta } from '@/lib/agents/types'

type Filter = 'all' | 'active' | 'paused' | 'completed' | 'archived'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'active', label: 'Ativas' },
  { id: 'paused', label: 'Pausadas' },
  { id: 'completed', label: 'Concluídas' },
  { id: 'archived', label: 'Arquivadas' },
]

const STATUS_DOT: Record<string, string> = { active: 'bg-cyan-400', paused: 'bg-orange-400', completed: 'bg-green-400' }

export default function SessionsPanel({
  projectId, onProjectChange, activeSessionId, onOpen, onNewChat, onNewTeam, refreshKey, onDeleted,
}: {
  projectId: string
  onProjectChange: (id: string, project?: Project) => void
  activeSessionId: string
  onOpen: (s: SessionMeta) => void
  onNewChat: () => void
  onNewTeam: () => void
  refreshKey: number
  onDeleted: (ids: string[]) => void
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState('')
  // Near the bottom of the list the actions menu opens upwards instead of being cut off by the scroll area
  const [menuUp, setMenuUp] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [newProject, setNewProject] = useState(false)
  const [confirmRemoveProject, setConfirmRemoveProject] = useState(false)
  const qRef = useRef(q)
  qRef.current = q

  const loadProjects = useCallback(() => api.projects().then(setProjects).catch(() => {}), [])

  const load = useCallback(async () => {
    const params: Record<string, string> = { projectId }
    if (filter === 'archived') params.archived = 'true'
    else if (filter !== 'all') params.status = filter
    if (qRef.current.trim()) params.q = qRef.current.trim()
    try { setSessions(await api.sessions(params)) } catch {}
  }, [projectId, filter])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q, load])

  // Running sessions change state on their own: poll while any is running
  const anyRunning = sessions.some(s => s.running)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [anyRunning, load])

  useEffect(() => { setSelected(new Set()) }, [projectId, filter])

  const project = projects.find(p => p.id === projectId)
  const selectedList = useMemo(() => [...selected], [selected])

  const act = async (action: string, ids: string[], extra: Record<string, unknown> = {}, ok?: string) => {
    try {
      const res = await api.sessionAction(action, { ids, ...extra })
      if (ok) toast.success(ok)
      await load()
      return res
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const deletingTitles = (confirmDelete || []).map(id => sessions.find(s => s.id === id)?.title || id)
  const deletingRunning = (confirmDelete || []).some(id => sessions.find(s => s.id === id)?.running)

  return (
    <div className="flex flex-col h-full">
      {/* Project */}
      <div className="flex items-center gap-1 mb-2">
        <select
          value={projectId}
          onChange={e => onProjectChange(e.target.value, projects.find(p => p.id === e.target.value))}
          className="input-jarvis flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs"
          title={project?.path || 'Projeto'}
        >
          {projects.map(p => <option key={p.id} value={p.id}>📁 {p.name}</option>)}
        </select>
        <button onClick={() => setNewProject(true)} title="Novo projeto" className="p-1.5 rounded-lg text-cyan-300/80 hover:bg-cyan-500/10">
          <FolderPlus size={14} />
        </button>
        {project && project.path && (
          <button onClick={() => setConfirmRemoveProject(true)} title="Remover projeto do JARVIS" className="p-1.5 rounded-lg text-white/30 hover:text-red-300 hover:bg-red-500/10">
            <X size={14} />
          </button>
        )}
      </div>

      {/* New */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <button onClick={onNewChat} className="sidebar-item justify-center border border-white/5 hover:border-cyan-500/30 !px-2">
          <Plus size={13} className="text-cyan-400" /><span className="text-xs">Conversa</span>
        </button>
        <button onClick={onNewTeam} className="sidebar-item justify-center border border-white/5 hover:border-violet-500/30 !px-2">
          <Users size={13} className="text-violet-300" /><span className="text-xs">Equipe</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome ou conteúdo" className="input-jarvis w-full pl-7 pr-2 py-1.5 rounded-lg text-xs" />
      </div>

      {/* Filters: five statuses + select, laid out as an even 3×2 grid instead of a ragged wrap */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`py-1 rounded-md text-[10px] transition-colors ${filter === f.id ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-inset ring-cyan-500/25' : 'text-white/40 hover:text-white/75 bg-white/[0.03] hover:bg-white/[0.06]'}`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => { setSelecting(s => !s); setSelected(new Set()) }}
          className={`flex items-center justify-center gap-1 py-1 rounded-md text-[10px] transition-colors ${selecting ? 'bg-violet-500/20 text-violet-200 ring-1 ring-inset ring-violet-400/30' : 'text-white/40 hover:text-white/75 bg-white/[0.03] hover:bg-white/[0.06]'}`}
          title="Selecionar várias sessões"
        >
          {selecting ? <X size={10} /> : <CheckSquare size={10} />}
          {selecting ? 'Cancelar' : 'Selecionar'}
        </button>
      </div>

      {/* Bulk bar */}
      <AnimatePresence>
        {selecting && (
          <motion.div initial={false} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex items-center gap-1 mb-2 p-1.5 rounded-lg bg-violet-500/[0.07] border border-violet-500/20">
              <button
                onClick={() => setSelected(selected.size === sessions.length ? new Set() : new Set(sessions.map(s => s.id)))}
                className="text-[10px] text-white/60 hover:text-white px-1"
              >
                {selected.size === sessions.length && sessions.length ? 'Nenhuma' : 'Todas'}
              </button>
              <span className="text-[10px] text-white/40 flex-1">{selected.size} selecionada(s)</span>
              <button disabled={!selected.size} onClick={() => act('stop', selectedList, {}, 'Sessões encerradas')} title="Encerrar execução" className="p-1 rounded text-white/50 hover:text-orange-300 disabled:opacity-30"><StopCircle size={13} /></button>
              <button disabled={!selected.size} onClick={() => act(filter === 'archived' ? 'restore' : 'archive', selectedList, {}, filter === 'archived' ? 'Restauradas' : 'Arquivadas').then(() => setSelected(new Set()))} title={filter === 'archived' ? 'Restaurar' : 'Arquivar'} className="p-1 rounded text-white/50 hover:text-cyan-300 disabled:opacity-30">
                {filter === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              </button>
              <button disabled={!selected.size} onClick={() => setConfirmDelete(selectedList)} title="Excluir selecionadas" className="p-1 rounded text-white/50 hover:text-red-300 disabled:opacity-30"><Trash2 size={13} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      <div ref={listRef} className="mo-stagger flex-1 overflow-y-auto -mx-1 px-1" onClick={() => setMenuFor('')}>
        {sessions.map(s => {
          const active = s.id === activeSessionId
          const isSel = selected.has(s.id)
          return (
            <div key={s.id} className="relative group">
              {renaming?.id === s.id ? (
                <form
                  className="flex items-center gap-1 p-1"
                  onSubmit={e => { e.preventDefault(); act('rename', [s.id], { title: renaming.title }).then(() => setRenaming(null)) }}
                >
                  <input autoFocus value={renaming.title} onChange={e => setRenaming({ id: s.id, title: e.target.value })} onBlur={() => setRenaming(null)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }} className="input-jarvis flex-1 px-2 py-1 rounded text-xs" />
                  <button type="submit" onMouseDown={e => e.preventDefault()} className="p-1 text-cyan-300"><Check size={13} /></button>
                </form>
              ) : (
                <button
                  onClick={() => (selecting ? toggle(s.id) : onOpen(s))}
                  onDoubleClick={() => !selecting && setRenaming({ id: s.id, title: s.title })}
                  className={`sidebar-item w-full pr-7 ${active && !selecting ? 'active' : ''} ${isSel ? 'bg-violet-500/10' : ''}`}
                >
                  {selecting
                    ? (isSel ? <CheckSquare size={13} className="text-violet-300 flex-shrink-0" /> : <Square size={13} className="flex-shrink-0" />)
                    : s.kind === 'team' ? <Users size={12} className="text-violet-300 flex-shrink-0" /> : <MessageSquare size={12} className="flex-shrink-0" />}
                  <span className="truncate flex-1 text-left">{s.title}</span>
                  {s.running
                    ? <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" title="Executando" />
                    : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.archived ? 'bg-white/20' : STATUS_DOT[s.status]}`} title={s.archived ? 'Arquivada' : s.status} />}
                </button>
              )}

              {!selecting && renaming?.id !== s.id && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const el = listRef.current
                    if (el) {
                      const list = el.getBoundingClientRect()
                      const row = e.currentTarget.getBoundingClientRect()
                      // The ~240px menu in screen pixels: the whole interface is zoomed to fit the window
                      const menuH = 240 * (list.height / (el.offsetHeight || list.height))
                      setMenuUp(row.bottom + menuH > list.bottom && row.top - menuH > list.top)
                    }
                    setMenuFor(menuFor === s.id ? '' : s.id)
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-60 hover:opacity-100 hover:bg-white/10 text-white/50" 
                  title="Ações"
                >
                  <MoreHorizontal size={13} />
                </button>
              )}

              {menuFor === s.id && (
                  <motion.div
                    initial={false}
                    animate={{ opacity: 1, y: 0 }}
                    className={`absolute right-1 z-30 w-44 py-1 rounded-xl glass border border-white/10 shadow-2xl ${menuUp ? 'bottom-full mb-1' : 'top-full'}`}
                    onClick={e => e.stopPropagation()}
                  >
                    <MenuItem icon={Pencil} label="Renomear" onClick={() => { setRenaming({ id: s.id, title: s.title }); setMenuFor('') }} />
                    <MenuItem icon={Copy} label="Duplicar" onClick={() => { setMenuFor(''); act('duplicate', [s.id], {}, 'Sessão duplicada') }} />
                    {s.status === 'completed'
                      ? <MenuItem icon={CirclePlay} label="Reabrir (ativa)" onClick={() => { setMenuFor(''); act('status', [s.id], { status: 'active' }) }} />
                      : <MenuItem icon={CircleCheck} label="Marcar concluída" onClick={() => { setMenuFor(''); act('status', [s.id], { status: 'completed' }) }} />}
                    {s.archived
                      ? <MenuItem icon={ArchiveRestore} label="Restaurar" onClick={() => { setMenuFor(''); act('restore', [s.id], {}, 'Sessão restaurada') }} />
                      : <MenuItem icon={Archive} label="Arquivar" onClick={() => { setMenuFor(''); act('archive', [s.id], {}, 'Sessão arquivada') }} />}
                    {s.running && <MenuItem icon={StopCircle} label="Encerrar execução" onClick={() => { setMenuFor(''); act('stop', [s.id], {}, 'Execução encerrada') }} />}
                    <div className="my-1 border-t border-white/5" />
                    <MenuItem icon={Trash2} label="Excluir…" danger onClick={() => { setMenuFor(''); setConfirmDelete([s.id]) }} />
                  </motion.div>
                )}
            </div>
          )
        })}
        {sessions.length === 0 && (
          <p className="text-xs text-white/25 text-center py-8">{q ? 'Nada encontrado' : filter === 'archived' ? 'Nenhuma sessão arquivada' : 'Nenhuma sessão neste projeto'}</p>
        )}
      </div>

      {confirmDelete && (
          <ConfirmDialog
            title={`Excluir ${confirmDelete.length} sessão(ões) permanentemente?`}
            confirmLabel="Excluir definitivamente"
            onClose={() => setConfirmDelete(null)}
            onConfirm={async () => {
              const res = await api.sessionAction('delete', { ids: confirmDelete, confirm: true })
              toast.success(`Excluído: ${res.removed?.sessions} sessão(ões), ${res.removed?.messages} mensagem(ns)`)
              onDeleted(confirmDelete)
              setSelected(new Set())
              await load()
            }}
          >
            <p>{deletingTitles.slice(0, 5).join(', ')}{deletingTitles.length > 5 ? ` e mais ${deletingTitles.length - 5}` : ''}</p>
            <p>Serão apagados o histórico, as execuções da equipe, os logs e os arquivos temporários dessas sessões. Não dá para desfazer.</p>
            {deletingRunning && <p className="text-orange-300">Há execuções em andamento: elas serão encerradas antes.</p>}
            <p className="text-white/40">Os arquivos do seu projeto não serão apagados.</p>
          </ConfirmDialog>
        )}
        {confirmRemoveProject && project && (
          <ConfirmDialog
            title={`Remover o projeto "${project.name}" do JARVIS?`}
            confirmLabel="Remover projeto"
            onClose={() => setConfirmRemoveProject(false)}
            onConfirm={async () => {
              await api.removeProject(project.id)
              toast.success('Projeto removido; as sessões foram para "Geral"')
              await loadProjects()
              onProjectChange('geral')
            }}
          >
            <p>As sessões deste projeto vão para o projeto &quot;Geral&quot;.</p>
            <p className="text-white/40">A pasta {project.path} e os arquivos dela não serão tocados.</p>
          </ConfirmDialog>
        )}
        {newProject && (
          <ProjectDialog
            onClose={() => setNewProject(false)}
            onCreated={p => { loadProjects(); onProjectChange(p.id, p) }}
          />
        )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/5 ${danger ? 'text-red-300' : 'text-white/70'}`}>
      <Icon size={12} /> {label}
    </button>
  )
}
