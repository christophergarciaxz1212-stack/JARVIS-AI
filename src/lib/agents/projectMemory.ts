/**
 * Memória de projeto: o que o JARVIS precisa saber antes de mexer num projeto.
 *
 * Duas origens, que se somam:
 *
 * 1. **Arquivos de instrução na própria pasta** — `JARVIS.md`, `CLAUDE.md`,
 *    `AGENTS.md`, `.github/copilot-instructions.md`. São o formato que já virou
 *    padrão entre agentes de código: se o projeto do usuário já tem um, o JARVIS
 *    obedece sem que ninguém precise reescrever nada. Versionados junto com o
 *    código, então valem para a equipe inteira.
 *
 * 2. **Memória guardada pelo JARVIS** — objetivo, arquitetura, convenções,
 *    decisões técnicas e pendências que o agente foi anotando ou que o usuário
 *    escreveu. Fica em `data/projects/<id>/memory.json`, fora do repositório.
 *
 * Cada projeto tem a sua: nada vaza de um projeto para outro, porque tudo é
 * endereçado pelo id do projeto.
 */
import fs from 'fs'
import path from 'path'
import { dataDir, writeJsonAtomic } from './fsutil'

/** Arquivos lidos da raiz do projeto, na ordem de preferência. */
export const INSTRUCTION_FILES = [
  'JARVIS.md',
  'CLAUDE.md',
  'AGENTS.md',
  '.jarvis/instructions.md',
  '.github/copilot-instructions.md',
]

export interface ProjectMemory {
  /** Para que serve o projeto. */
  objetivo: string
  /** Como está montado (camadas, pastas, fluxo). */
  arquitetura: string
  /** Linguagens, frameworks e serviços. */
  tecnologias: string
  /** Padrões de código e de nomes a respeitar. */
  convencoes: string
  /** Escolhas técnicas já feitas, com o motivo. */
  decisoes: string[]
  /** O que ficou para depois. */
  pendencias: string[]
  /** Preferências do usuário sobre este projeto. */
  preferencias: string
  updatedAt: number
}

export const EMPTY_MEMORY: ProjectMemory = {
  objetivo: '', arquitetura: '', tecnologias: '', convencoes: '',
  decisoes: [], pendencias: [], preferencias: '', updatedAt: 0,
}

const LIST_LIMIT = 40
const FIELD_LIMIT = 4000
const INSTRUCTIONS_LIMIT = 12_000

const memoryFile = (projectId: string) => path.join(dataDir(), 'projects', projectId, 'memory.json')

const text = (v: unknown) => String(v ?? '').slice(0, FIELD_LIMIT)
const list = (v: unknown) =>
  (Array.isArray(v) ? v : []).map(x => String(x ?? '').slice(0, 500)).filter(Boolean).slice(0, LIST_LIMIT)

/** Aceita só o que conhecemos: um JSON estranho no disco não vira memória torta. */
export function sanitizeMemory(raw: unknown): ProjectMemory {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    objetivo: text(r.objetivo),
    arquitetura: text(r.arquitetura),
    tecnologias: text(r.tecnologias),
    convencoes: text(r.convencoes),
    decisoes: list(r.decisoes),
    pendencias: list(r.pendencias),
    preferencias: text(r.preferencias),
    updatedAt: Number(r.updatedAt) || 0,
  }
}

export function readMemory(projectId: string): ProjectMemory {
  if (!projectId) return { ...EMPTY_MEMORY }
  try {
    return sanitizeMemory(JSON.parse(fs.readFileSync(memoryFile(projectId), 'utf-8')))
  } catch {
    return { ...EMPTY_MEMORY }
  }
}

export function writeMemory(projectId: string, patch: Partial<ProjectMemory>): ProjectMemory {
  if (!projectId) throw new Error('Informe o projeto')
  const current = readMemory(projectId)
  const next = sanitizeMemory({ ...current, ...patch, updatedAt: Date.now() })
  const file = memoryFile(projectId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJsonAtomic(file, next)
  return next
}

/** Acrescenta uma decisão ou pendência sem repetir o que já está lá. */
export function appendMemory(projectId: string, field: 'decisoes' | 'pendencias', entry: string): ProjectMemory {
  const value = entry.trim().slice(0, 500)
  if (!value) throw new Error('Escreva o que registrar')
  const current = readMemory(projectId)
  const already = current[field].some(x => x.toLowerCase() === value.toLowerCase())
  if (already) return current
  return writeMemory(projectId, { [field]: [...current[field], value].slice(-LIST_LIMIT) })
}

/** Remove uma decisão ou pendência pelo texto (o usuário pode apagar o que não vale mais). */
export function removeMemory(projectId: string, field: 'decisoes' | 'pendencias', entry: string): ProjectMemory {
  const current = readMemory(projectId)
  return writeMemory(projectId, { [field]: current[field].filter(x => x !== entry) })
}

export function clearMemory(projectId: string): ProjectMemory {
  return writeMemory(projectId, { ...EMPTY_MEMORY })
}

export interface Instructions {
  /** Nome do arquivo encontrado, relativo à raiz. */
  file: string
  content: string
}

/** Lê o primeiro arquivo de instrução que existir na raiz do projeto. */
export function readInstructions(root: string): Instructions | null {
  if (!root) return null
  for (const rel of INSTRUCTION_FILES) {
    const abs = path.join(root, rel)
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
      const content = fs.readFileSync(abs, 'utf-8').slice(0, INSTRUCTIONS_LIMIT)
      if (content.trim()) return { file: rel, content }
    } catch { /* ilegível: tenta o próximo */ }
  }
  return null
}

const section = (title: string, body: string) => (body.trim() ? `## ${title}\n${body.trim()}\n` : '')
const bullets = (title: string, items: string[]) =>
  (items.length ? `## ${title}\n${items.map(i => `- ${i}`).join('\n')}\n` : '')

/** Bloco em markdown para entrar no prompt do agente. Vazio quando não há nada a dizer. */
export function projectContext(opts: { projectId: string; root: string }): string {
  const parts: string[] = []

  const instructions = readInstructions(opts.root)
  if (instructions) {
    parts.push(`# Instruções do projeto (${instructions.file})\nSiga estas instruções: elas valem mais que qualquer suposição sua sobre o projeto.\n\n${instructions.content.trim()}\n`)
  }

  const m = readMemory(opts.projectId)
  const saved = [
    section('Objetivo', m.objetivo),
    section('Arquitetura', m.arquitetura),
    section('Tecnologias', m.tecnologias),
    section('Convenções de código', m.convencoes),
    bullets('Decisões técnicas já tomadas', m.decisoes),
    bullets('Pendências', m.pendencias),
    section('Preferências do usuário neste projeto', m.preferencias),
  ].filter(Boolean).join('\n')

  if (saved) parts.push(`# Memória deste projeto\n${saved}`)
  return parts.join('\n')
}

/** Resumo curto para a interface. */
export function memorySummary(projectId: string, root: string) {
  const m = readMemory(projectId)
  const instructions = readInstructions(root)
  const filled = [m.objetivo, m.arquitetura, m.tecnologias, m.convencoes, m.preferencias].filter(s => s.trim()).length
  return {
    instructionsFile: instructions?.file ?? null,
    filled,
    decisoes: m.decisoes.length,
    pendencias: m.pendencias.length,
    updatedAt: m.updatedAt,
  }
}
