'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

export interface ContextChip {
  id: string
  name: string
  kind: 'file' | 'text'
  chars: number
  truncated?: boolean
  preview?: string
  /** Ainda não salvo no servidor (conversa nova): vai junto com a primeira mensagem. */
  pending?: boolean
  text?: string
}

export interface ContextNote { model: string; usedChars: number; totalChars: number; clipped: boolean }

const MAX_FILE = 10 * 1024 * 1024

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((d as { error?: string }).error || `Erro ${res.status}`)
  return d as T
}

/**
 * Contexto da conversa no chat: arquivos e textos que vão para a IA em todas as mensagens.
 * Numa conversa nova os itens ficam pendentes no navegador e seguem com a primeira mensagem;
 * numa conversa existente vão direto para o servidor (data/context/<id>.json).
 */
export function useChatContext(conversationId: string) {
  const [items, setItems] = useState<ContextChip[]>([])
  const [busy, setBusy] = useState(0)
  const [note, setNote] = useState<ContextNote | null>(null)
  const convRef = useRef(conversationId)
  convRef.current = conversationId

  const prevId = useRef(conversationId)
  useEffect(() => {
    // Conversa nova recebendo o id na 1ª resposta: o aviso de contexto dessa resposta continua valendo
    const justCreated = !prevId.current && !!conversationId
    prevId.current = conversationId
    if (!justCreated) setNote(null)
    if (!conversationId) { setItems([]); return }
    let alive = true
    fetch(`/api/context?conversationId=${encodeURIComponent(conversationId)}`)
      .then(r => r.json())
      .then((d: { items?: ContextChip[] }) => { if (alive) setItems(d.items || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [conversationId])

  const addTexts = useCallback(async (list: Array<{ name: string; text: string; kind: 'file' | 'text'; truncated?: boolean }>) => {
    if (!list.length) return
    const id = convRef.current
    if (id) {
      const d = await api<{ items: ContextChip[] }>({ action: 'add', conversationId: id, items: list })
      setItems(d.items)
    } else {
      setItems(prev => [...prev, ...list.map(x => ({ id: uuidv4(), name: x.name, kind: x.kind, chars: x.text.length, truncated: x.truncated, preview: x.text.slice(0, 160), pending: true, text: x.text }))])
    }
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(n => n + files.length)
    const ready: Array<{ name: string; text: string; kind: 'file'; truncated?: boolean }> = []
    for (const f of files) {
      try {
        if (f.size > MAX_FILE) throw new Error('grande demais (máx. 10 MB)')
        if (!f.size) throw new Error('arquivo vazio')
        const d = await api<{ name: string; text: string; kind: string; chars: number; originalChars: number; truncated: boolean }>({ action: 'extract', name: f.name, data: await toBase64(f) })
        ready.push({ name: f.name, text: d.text, kind: 'file', truncated: d.truncated })
        toast.success(`${f.name} virou contexto · ${d.kind} · ${d.chars.toLocaleString('pt-BR')} caracteres${d.truncated ? ` (cortado de ${d.originalChars.toLocaleString('pt-BR')})` : ''}`)
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`)
      } finally {
        setBusy(n => n - 1)
      }
    }
    try { await addTexts(ready) } catch (e) { toast.error((e as Error).message) }
  }, [addTexts])

  const addText = useCallback(async (text: string, name?: string) => {
    const clean = text.trim()
    if (!clean) return
    try {
      await addTexts([{ name: name?.trim() || `Texto colado (${clean.length.toLocaleString('pt-BR')} caracteres)`, text: clean, kind: 'text' }])
    } catch (e) { toast.error((e as Error).message) }
  }, [addTexts])

  const remove = useCallback(async (chip: ContextChip) => {
    if (chip.pending || !convRef.current) { setItems(prev => prev.filter(i => i.id !== chip.id)); return }
    try {
      const d = await api<{ items: ContextChip[] }>({ action: 'remove', conversationId: convRef.current, id: chip.id })
      setItems(d.items)
    } catch (e) { toast.error((e as Error).message) }
  }, [])

  const clear = useCallback(async () => {
    if (!convRef.current) { setItems([]); return }
    try { await api({ action: 'clear', conversationId: convRef.current }); setItems([]) } catch (e) { toast.error((e as Error).message) }
  }, [])

  /** Itens pendentes para mandar junto da primeira mensagem de uma conversa nova. */
  const pendingPayload = useCallback(() => items.filter(i => i.pending && i.text).map(i => ({ name: i.name, text: i.text!, kind: i.kind })), [items])

  return { items, busy: busy > 0, note, setNote, addFiles, addText, remove, clear, pendingPayload }
}
