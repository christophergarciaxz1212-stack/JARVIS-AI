'use client'

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Code2, Copy, Database, FileArchive,
  FileAudio, FileCode, FileImage, FileJson, FileSpreadsheet, FileTerminal, FileText, FileVideo,
  Folder, FolderOpen, Key, Package, Pencil, Pin, PinOff, Plus, RefreshCw, Save, X,
} from 'lucide-react'
import { toast } from 'sonner'

interface Entry {
  name: string
  dir: boolean
  size: number
  rel: string
}

interface OpenTab {
  file: string
  content: string
  dirty: boolean
  pinned: boolean
}

type Icon = ComponentType<{ size?: number | string }>

/** Ícone por extensão (sufpe/arquivo desconhecido cai no FileText). */
const EXT: Record<string, Icon> = {
  ts: Code2, tsx: Code2, js: FileCode, jsx: FileCode, mjs: FileCode, cjs: FileCode, vue: FileCode,
  json: FileJson,
  css: FileCode, scss: FileCode, less: FileCode, sass: FileCode, html: FileCode, htm: FileCode,
  md: FileText, txt: FileText,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage, ico: FileImage, bmp: FileImage,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive, tar: FileArchive, gz: FileArchive,
  mp4: FileVideo, mov: FileVideo, mkv: FileVideo, avi: FileVideo,
  mp3: FileAudio, wav: FileAudio, m4a: FileAudio, flac: FileAudio,
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  sql: Database, db: Database, sqlite: Database,
  ps1: FileTerminal, bat: FileTerminal, cmd: FileTerminal, sh: FileTerminal, zsh: FileTerminal, fish: FileTerminal,
  pem: Key, key: Key, crt: Key, cer: Key, pub: Key,
  npm: Package, exe: Package, dll: Package,
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const iconFor = (name: string): Icon => EXT[extOf(name)] || FileText

/** Tamanho humanizado: B, kB, MB. */
const formatSize = (size: number) => {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function apiGet<T extends { error?: string }>(url: string): Promise<T> {
  const res = await fetch(url)
  const data = (await res.json()) as T
  if (data && data.error) throw new Error(String(data.error))
  return data
}

async function apiPost(body: Record<string, unknown>): Promise<{ error?: string }> {
  const res = await fetch('/api/fs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { error?: string }
  if (data?.error) throw new Error(String(data.error))
  return data
}

export default function FilesPanel() {
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<Record<string, Entry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeFile, setActiveFile] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ rel: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [addRow, setAddRow] = useState<'file' | 'pasta' | null>(null)
  const [addName, setAddName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editorOpen, setEditorOpen] = useState(true)

  const load = useCallback(async (dir: string) => {
    setLoading(true)
    try {
      const data = await apiGet<{ path: string; entries: Entry[] }>(`/api/fs?path=${encodeURIComponent(dir)}`)
      setEntries(data.entries || [])
      setPath(data.path || '.')
    } catch (error) {
      toast.error(`Arquivos: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadChildren = useCallback(async (rel: string) => {
    try {
      const data = await apiGet<{ entries: Entry[] }>(`/api/fs?path=${encodeURIComponent(rel)}`)
      setChildren(prev => ({ ...prev, [rel]: data.entries || [] }))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [])

  useEffect(() => { void load('.') }, [load])

  async function openFile(rel: string) {
    try {
      const data = await apiGet<{ file: string; content: string }>(`/api/fs?file=${encodeURIComponent(rel)}`)
      setTabs(prev => (prev.some(t => t.file === data.file) ? prev : [...prev, { file: data.file, content: data.content, dirty: false, pinned: false }]))
      setActiveFile(data.file)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function save() {
    const tab = tabs.find(t => t.file === activeFile)
    if (!tab) return
    try {
      await apiPost({ path: tab.file, content: tab.content })
      toast.success('Arquivo salvo')
    } catch (error) {
      toast.error((error as Error).message)
    }
    setTabs(prev => prev.map(t => (t.file === tab.file ? { ...t, dirty: false } : t)))
  }

  function toggle(entry: Entry) {
    if (entry.dir) {
      setExpanded(prev => ({ ...prev, [entry.rel]: !prev[entry.rel] }))
      if (!(entry.rel in children)) void loadChildren(entry.rel)
    } else {
      void openFile(entry.rel)
    }
  }

  function up() {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    load(parts.length ? parts.join('/') : '.')
  }

  function closeTab(file: string) {
    setTabs(prev => prev.filter(t => t.file !== file))
    setActiveFile(cur => (cur === file ? (tabs.find(t => t.file !== file)?.file || '') : cur))
  }

  function togglePin(file: string) {
    setTabs(prev => prev.map(t => (t.file === file ? { ...t, pinned: !t.pinned } : t)))
  }

  function startRename(entry: Entry) {
    setRenameTarget({ rel: entry.rel, name: entry.name })
    setRenameValue(entry.name)
  }

  async function submitRename() {
    if (!renameTarget) return
    const target = renameTarget
    setRenameTarget(null)
    const name = renameValue.trim()
    if (!name || name === target.name) { setRenameValue(''); return }
    const parts = target.rel.split('/')
    parts[parts.length - 1] = name
    const nextRel = parts.join('/')
    try {
      await apiPost({ action: 'rename', from: target.rel, to: nextRel })
      toast.success(`Renomeado: ${name}`)
      setTabs(prev => prev.map(t => (t.file === target.rel ? { ...t, file: nextRel } : t)))
      setActiveFile(cur => (cur === target.rel ? nextRel : cur))
      setExpanded(prev => {
        if (!prev[target.rel]) return prev
        const next = { ...prev }
        delete next[target.rel]
        next[nextRel] = true
        return next
      })
      setChildren(prev => {
        const next = { ...prev }
        const old = next[target.rel]
        delete next[target.rel]
        if (old) next[nextRel] = old
        return next
      })
      await load(path)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  function toggleAdd(kind: 'file' | 'pasta') {
    setAddRow(cur => (cur === kind ? null : kind))
    setAddName('')
  }

  async function submitAdd() {
    const name = addName.trim()
    if (!name) { setAddRow(null); setAddName(''); return }
    setCreating(true)
    try {
      const rel = path === '.' ? name : `${path}/${name}`
      if (addRow === 'pasta') {
        await apiPost({ action: 'mkdir', path: rel })
        setExpanded(prev => ({ ...prev, [rel]: true }))
        setChildren(prev => ({ ...prev, [rel]: [] }))
        toast.success(`Pasta: ${name}`)
      } else {
        await apiPost({ path: rel, content: '' })
        setTabs(prev => [...prev, { file: rel, content: '', dirty: false, pinned: false }])
        setActiveFile(rel)
        toast.success(`Criado: ${name}`)
      }
      setAddRow(null)
      setAddName('')
      await load(path)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function copyPath(rel: string) {
    try {
      await navigator.clipboard.writeText(rel)
      toast.success('Caminho copiado')
    } catch {
      toast.error('Falha ao copiar')
    }
  }

  function setTabContent(file: string, content: string) {
    setTabs(prev => prev.map(t => (t.file === file ? { ...t, content, dirty: true } : t)))
  }

  const renderEntry = (entry: Entry, depth: number): ReactNode => {
    const isExpanded = !!expanded[entry.rel]
    const openTab = tabs.find(t => t.file === entry.rel)
    const FileIcon = iconFor(entry.name)
    const row = (
      <div
        onClick={() => toggle(entry)}
        title={entry.rel}
        className="group flex w-full items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors text-[color:var(--jv-muted)] hover:text-white/85 hover:bg-[var(--jv-panel)]"
      >
        {entry.dir ? (
          <>
            <ChevronRight
              size={11}
              className={`text-[color:var(--jv-muted)] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            />
            {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
          </>
        ) : (
          <>
            <span className="w-[11px] flex-shrink-0" />
            <FileIcon size={12} />
          </>
        )}
        <span className="flex-1 truncate">{entry.name}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {!entry.dir && entry.size > 0 && (
            <span className="text-[9px]">{formatSize(entry.size)}</span>
          )}
          {openTab?.dirty && <span className="jv-badge jv-badge-warn" title="Modificado">M</span>}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); startRename(entry) }}
            title="Renomear"
            className="opacity-0 group-hover:opacity-100 text-[color:var(--jv-muted)] hover:text-white/80 transition-opacity"
          >
            <Pencil size={10} />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); void copyPath(entry.rel) }}
            title="Copiar caminho"
            className="opacity-0 group-hover:opacity-100 text-[color:var(--jv-muted)] hover:text-white/80 transition-opacity"
          >
            <Copy size={10} />
          </button>
        </span>
        <span className="jv-tooltip-text">{entry.rel}</span>
      </div>
    )
    return (
      <div key={entry.rel} data-tooltip={entry.rel} className="relative" style={{ marginLeft: `${depth * 12}px` }}>
        {renameTarget && renameTarget.rel === entry.rel ? (
          <div className="flex items-center gap-1 px-2.5 py-1.5">
            <input
              value={renameValue}
              autoFocus
              onClick={e => e.stopPropagation()}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => void submitRename()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void submitRename() }
                else if (e.key === 'Escape') { setRenameTarget(null) }
              }}
              className="jv-input text-[11px] flex-1 min-w-0"
            />
            <button type="button" title="Confirmar" className="jv-btn" onClick={() => void submitRename()}>
              <Check size={11} />
            </button>
            <button type="button" title="Cancelar" className="jv-btn" onClick={() => setRenameTarget(null)}>
              <X size={11} />
            </button>
          </div>
        ) : row}
        {entry.dir && isExpanded && (children[entry.rel] || []).map(child => renderEntry(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--jv-panel)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--jv-border)]">
        <span className="truncate font-[var(--jv-font-mono)] text-[10px] text-[color:var(--jv-muted)]" title={path}>{path}</span>
        <div className="flex items-center gap-1">
          <button type="button" className="jv-btn" onClick={() => toggleAdd('file')} title="Novo arquivo"><Plus size={11} />Novo arquivo</button>
          <button type="button" className="jv-btn" onClick={() => toggleAdd('pasta')} title="Nova pasta"><Plus size={11} />Nova pasta</button>
          {path !== '.' && (
            <button type="button" className="jv-btn-ghost" title="Voltar" onClick={up}><ChevronLeft size={11} /></button>
          )}
          <button type="button" className="jv-btn-ghost" title="Atualizar" onClick={() => void load(path)}><RefreshCw size={11} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {addRow && (
          <div className="flex items-center gap-1 py-1 px-0.5">
            <input
              value={addName}
              autoFocus
              placeholder={addRow === 'pasta' ? 'Nome da pasta' : 'Nome do arquivo'}
              onChange={e => setAddName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void submitAdd() }
                else if (e.key === 'Escape') { setAddRow(null); setAddName('') }
              }}
              className="jv-input text-[11px] flex-1 min-w-0"
            />
            <button type="button" title="Adicionar" disabled={creating} className="jv-btn" onClick={() => void submitAdd()}>
              <Check size={11} />
            </button>
            <button type="button" title="Cancelar" className="jv-btn" onClick={() => { setAddRow(null); setAddName('') }}>
              <X size={11} />
            </button>
          </div>
        )}
        {entries.map(entry => renderEntry(entry, 0))}
        {!entries.length && !loading && <p className="py-8 text-center text-[11px] text-[color:var(--jv-muted)]">Pasta vazia</p>}
        {loading && !entries.length && <p className="py-4 text-center text-[10px] text-[color:var(--jv-muted)]">Carregando…</p>}
      </div>
      {tabs.length ? (
        editorOpen ? (
          <>
            <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-[var(--jv-border)] overflow-x-auto">
              {tabs.map(t => {
                const active = t.file === activeFile
                const TabIcon = iconFor(t.file)
                return (
                  <div
                    key={t.file}
                    title={t.file}
                    className={`group flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] flex-shrink-0 cursor-pointer transition-colors border ${
                      active
                        ? 'bg-[rgb(var(--acc-glow)/.10)] border-[rgb(var(--acc-glow)/.35)] text-white'
                        : 'border-transparent text-[color:var(--jv-muted)] hover:bg-[var(--jv-panel)]'
                    }`}
                    onClick={() => setActiveFile(t.file)}
                  >
                    <TabIcon size={11} />
                    <span className="truncate max-w-[110px]">{t.file.split('/').pop()}</span>
                    {t.dirty && <span className="jv-badge jv-badge-warn" title="Modificado">modificado</span>}
                    <button type="button" title="Fixar aba" className="opacity-0 group-hover:opacity-100 text-[color:var(--jv-muted)] hover:text-white/80 transition-opacity" onClick={e => { e.stopPropagation(); togglePin(t.file) }}>
                      {t.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                    </button>
                    <button type="button" title="Fechar" className="opacity-0 group-hover:opacity-100 text-[color:var(--jv-muted)] hover:text-red-300 transition-opacity" onClick={e => { e.stopPropagation(); closeTab(t.file) }}>
                      <X size={10} />
                    </button>
                  </div>
                )
              })}
              <div className="flex-1" />
              <button type="button" title="Salvar (Ctrl+S)" className="jv-btn" onClick={() => void save()}>
                <Save size={11} />
              </button>
              <button type="button" title="Expandir/colapsar entrada direita" className="jv-btn-ghost" onClick={() => setEditorOpen(o => !o)}>
                <ChevronUp size={11} />
              </button>
            </div>
            <textarea
              value={tabs.find(t => t.file === activeFile)?.content ?? ''}
              onChange={e => { const t = tabs.find(x => x.file === activeFile); if (t) setTabContent(t.file, e.target.value) }}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save() } }}
              spellCheck={false}
              className="flex-1 min-h-0 resize-none rounded-lg bg-transparent p-3 font-[var(--jv-font-mono)] text-[11px] leading-relaxed text-[color:var(--jv-fg)] outline-none"
            />
          </>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--jv-border)]">
            <button type="button" className="jv-btn" onClick={() => setEditorOpen(true)}>
              <ChevronDown size={11} /> Editor
            </button>
          </div>
        )
      ) : null}
    </div>
  )
}
