'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Copy, Plus, Save, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { api } from './api'
import { ConfirmDialog, Modal, ModelPicker } from './shared'
import type { AgentConfig, RoleTemplate, Team } from '@/lib/agents/types'
import { PRESET_TEAMS } from '@/lib/agents/roles'

export default function TeamsManager({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [roles, setRoles] = useState<RoleTemplate[]>([])
  const [draft, setDraft] = useState<Team | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null)

  const load = async (selectId?: string) => {
    const d = await api.teams()
    setTeams(d.teams)
    setRoles(d.roles)
    const pick = d.teams.find(t => t.id === (selectId || draft?.id)) || d.teams[0]
    if (pick) setDraft(structuredClone(pick))
  }

  useEffect(() => { load().catch(e => toast.error(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const role = (id: string) => roles.find(r => r.id === id)

  const updateAgent = (i: number, patch: Partial<AgentConfig>) => {
    if (!draft) return
    const agents = draft.agents.map((a, j) => (j === i ? { ...a, ...patch } : a))
    setDraft({ ...draft, agents })
  }

  const addAgent = () => {
    if (!draft) return
    const r = roles.find(x => x.id === 'fullstack') || roles[0]
    setDraft({ ...draft, agents: [...draft.agents, { id: uuidv4(), name: r.name, roleId: r.id, model: 'auto', scope: [...r.scope], enabled: true, color: r.color }] })
  }

  const save = async () => {
    if (!draft) return
    try {
      const saved = await api.saveTeam(draft)
      toast.success(draft.preset ? `Cópia personalizada "${saved.name}" salva` : 'Equipe salva')
      await load(saved.id)
      onChanged?.()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal onClose={onClose} width="max-w-5xl">
      <div className="p-5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center"><Users size={18} className="text-violet-300" /></div>
          <div>
            <h2 className="text-lg font-semibold jarvis-title">EQUIPES DE AGENTES</h2>
            <p className="text-xs text-white/40">Salve equipes com modelos e funções e reutilize em qualquer projeto</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5"><X size={18} className="text-white/50" /></button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-60 border-r border-white/5 p-3 overflow-y-auto space-y-1">
          {teams.map(t => (
            <button key={t.id} onClick={() => setDraft(structuredClone(t))} className={`sidebar-item w-full ${draft?.id === t.id ? 'active' : ''}`}>
              <Users size={12} />
              <span className="flex-1 truncate text-left">{t.name}</span>
              <span className="text-[10px] text-white/30">{t.agents.length}</span>
            </button>
          ))}
          <button
            onClick={() => setDraft({ id: '', name: 'Nova equipe', description: '', agents: [], createdAt: 0, updatedAt: 0 })}
            className="sidebar-item w-full border border-dashed border-white/10 hover:border-cyan-500/30 mt-2"
          >
            <Plus size={12} className="text-cyan-400" /> Nova equipe
          </button>
        </div>

        {draft && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Começo rápido: uma equipe pronta em um clique (configurações avançadas abaixo) */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wide text-white/35 mb-2">Começo rápido — equipes prontas</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TEAMS.map(p => (
                  <button
                    key={p.id}
                    title={p.description}
                    onClick={async () => {
                      try {
                        const t = await api.saveTeam({ name: `${p.name} (cópia)`, description: p.description, agents: p.agents.map(a => ({ ...a, id: uuidv4() })) })
                        toast.success(`Equipe "${t.name}" criada`)
                        await load(t.id)
                        onChanged?.()
                      } catch (e) { toast.error((e as Error).message) }
                    }}
                    className="jv-btn jv-btn-sm"
                  >
                    <span>{p.agents[0]?.roleId === 'leader' ? '🎯' : '👥'}</span>
                    <span className="max-w-[160px] truncate">{p.name}</span>
                  </button>
                ))}
              </div>
              <p className="jv-hint">Clique para criar uma cópia editável. Abaixo você ajusta nomes, funções e modelos.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-white/40">Nome</span>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="input-jarvis w-full mt-1 px-3 py-2 rounded-lg text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-white/40">Descrição</span>
                <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="input-jarvis w-full mt-1 px-3 py-2 rounded-lg text-sm" />
              </label>
            </div>
            {draft.preset && <p className="text-xs text-amber-300/80">Equipe padrão: ao salvar, uma cópia personalizada é criada.</p>}

            <div className="space-y-2">
              {draft.agents.map((a, i) => {
                const r = role(a.roleId)
                return (
                  <div key={a.id} className={`p-3 rounded-xl border bg-white/[0.02] ${a.enabled ? 'border-white/[.08]' : 'border-white/5 opacity-50'}`} style={{ borderLeft: `3px solid ${a.color || r?.color || '#00d4ff'}` }}>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{r?.icon || '🤖'}</span>
                      <input value={a.name} onChange={e => updateAgent(i, { name: e.target.value })} className="input-jarvis flex-1 px-2 py-1 rounded text-sm font-medium" />
                      <select
                        value={a.roleId}
                        onChange={e => { const nr = role(e.target.value); updateAgent(i, { roleId: e.target.value, scope: nr ? [...nr.scope] : a.scope, color: nr?.color, name: a.name === r?.name && nr ? nr.name : a.name }) }}
                        className="input-jarvis px-2 py-1 rounded text-xs"
                      >
                        {roles.map(x => <option key={x.id} value={x.id}>{x.icon} {x.name}</option>)}
                      </select>
                      <div className="w-56"><ModelPicker value={a.model} onChange={m => updateAgent(i, { model: m })} /></div>
                      <label className="flex items-center gap-1 text-[11px] text-white/50">
                        <input type="checkbox" checked={a.enabled} onChange={e => updateAgent(i, { enabled: e.target.checked })} /> ativo
                      </label>
                      <button onClick={() => setDraft({ ...draft, agents: draft.agents.filter((_, j) => j !== i) })} className="p-1 rounded text-white/30 hover:text-red-300" title="Remover agente"><Trash2 size={13} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <label className="block">
                        <span className="text-[10px] text-white/35">Escopo de escrita (globs separados por vírgula; vazio = só leitura; ! exclui)</span>
                        <input value={a.scope.join(', ')} onChange={e => updateAgent(i, { scope: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} className="input-jarvis w-full mt-0.5 px-2 py-1 rounded text-[11px] font-mono" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-white/35">Responsabilidades extras</span>
                        <input value={a.responsibilities || ''} onChange={e => updateAgent(i, { responsibilities: e.target.value })} placeholder={r?.responsibilities.slice(0, 2).join('; ')} className="input-jarvis w-full mt-0.5 px-2 py-1 rounded text-[11px]" />
                      </label>
                    </div>
                  </div>
                )
              })}
              <button onClick={addAgent} className="w-full p-2 rounded-xl border border-dashed border-white/10 hover:border-cyan-500/30 text-xs text-white/50 hover:text-cyan-200 flex items-center justify-center gap-1.5">
                <Plus size={13} /> Adicionar agente
              </button>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button onClick={save} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/80 hover:bg-cyan-500 text-black"><Save size={14} /> Salvar equipe</button>
              {draft.id && (
                <button
                  onClick={async () => { try { const t = await api.duplicateTeam(draft.id); toast.success('Equipe duplicada'); await load(t.id); onChanged?.() } catch (e) { toast.error((e as Error).message) } }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5"
                ><Copy size={14} /> Duplicar</button>
              )}
              {draft.id && !draft.preset && (
                <button onClick={() => setConfirmDelete(draft)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-300/80 hover:bg-red-500/10 ml-auto"><Trash2 size={14} /> Excluir</button>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDialog
            title={`Excluir a equipe "${confirmDelete.name}"?`}
            confirmLabel="Excluir equipe"
            onClose={() => setConfirmDelete(null)}
            onConfirm={async () => { await api.deleteTeam(confirmDelete.id); toast.success('Equipe excluída'); setDraft(null); await load(); onChanged?.() }}
          >
            <p>Sessões que já usaram esta equipe continuam com seu histórico.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Modal>
  )
}
