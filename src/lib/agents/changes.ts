/**
 * O que uma execução mudou no projeto, arquivo por arquivo — e como desfazer.
 *
 * A execução já guarda o original de cada arquivo antes da primeira escrita
 * (ver `snapshot` em tools.ts): `manifest.json` diz quais arquivos foram tocados
 * e se existiam antes, e `files/<caminho>` guarda o conteúdo original.
 * Aqui esse material vira diff para a conversa e reversão por arquivo.
 */
import fs from 'fs'
import path from 'path'
import { resolveInside } from './fsutil'
import { snapshotDir } from './store'
import { fileDiff, type FileDiff } from './diff'
import type { Run } from './types'

/** `{ caminho relativo: o arquivo já existia antes da execução }` */
type Manifest = Record<string, boolean>

const manifestPath = (dir: string) => path.join(dir, 'manifest.json')

/**
 * Lê o manifesto do snapshot.
 *
 * Arquivo ausente significa de verdade "esta execução não tocou em nada".
 * Arquivo ilegível NÃO significa isso: devolver `{}` faria o JARVIS afirmar que
 * nada mudou e esconderia o Desfazer de alterações que existem no disco. Mesma
 * regra do `readJson` em fsutil — quem chama não pode "começar vazio" calado.
 */
function readManifest(dir: string): Manifest {
  let bruto: string
  try {
    bruto = fs.readFileSync(manifestPath(dir), 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`Não consegui ler o registro de alterações desta execução: ${(e as Error).message}`)
  }
  try {
    const parsed = JSON.parse(bruto)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('formato inesperado')
    return parsed as Manifest
  } catch (e) {
    throw new Error(`O registro de alterações desta execução está corrompido (${(e as Error).message}). Os originais continuam em ${path.join(dir, 'files')}.`)
  }
}

/** Lê um arquivo de texto; devolve null quando não existe. */
function readIfExists(abs: string): string | null {
  try { return fs.readFileSync(abs, 'utf-8') } catch { return null }
}

/** O original guardado no snapshot, ou null quando o arquivo foi criado pela execução. */
function originalOf(dir: string, manifest: Manifest, rel: string): string | null {
  if (!manifest[rel]) return null
  return readIfExists(path.join(dir, 'files', rel))
}

export interface RunChanges {
  files: FileDiff[]
  /** Arquivos que ainda têm alteração desta execução no disco. */
  pending: number
}

/** Diff de cada arquivo que a execução tocou. */
export function runChanges(run: Pick<Run, 'sessionId' | 'id' | 'projectPath'>): RunChanges {
  const dir = snapshotDir(run.sessionId, run.id)
  const manifest = readManifest(dir)
  const files: FileDiff[] = []

  for (const rel of Object.keys(manifest)) {
    let d: FileDiff
    try {
      d = diffFor(run.projectPath, dir, manifest, rel)
    } catch {
      // Caminho que não resolve mais (projeto movido, entrada antiga): pula só
      // este, em vez de derrubar o diff de todos os outros arquivos.
      continue
    }
    // Arquivo já revertido (ou devolvido ao original à mão) não é mais alteração.
    if (d.added === 0 && d.removed === 0 && !d.binary) continue
    files.push(d)
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'))
  return { files, pending: files.length }
}

/** Diff de um arquivo específico da execução. */
export function runFileChange(run: Pick<Run, 'sessionId' | 'id' | 'projectPath'>, rel: string): FileDiff | null {
  const dir = snapshotDir(run.sessionId, run.id)
  const manifest = readManifest(dir)
  if (!(rel in manifest)) return null
  return diffFor(run.projectPath, dir, manifest, rel)
}

function diffFor(root: string, dir: string, manifest: Manifest, rel: string): FileDiff {
  const abs = resolveInside(root, rel)
  return fileDiff({ path: rel, before: originalOf(dir, manifest, rel), after: readIfExists(abs) })
}

export type ChangeOutcome =
  | { ok: true; action: 'restaurado' | 'removido' | 'aceito' }
  | { ok: false; reason: string }

/**
 * Desfaz a alteração de UM arquivo: devolve o original, ou apaga o que a execução
 * criou. A entrada sai do manifesto, então o arquivo deixa de contar como alterado
 * e um rollback posterior da execução inteira não mexe mais nele.
 */
export function revertFile(run: Pick<Run, 'sessionId' | 'id' | 'projectPath'>, rel: string): ChangeOutcome {
  const dir = snapshotDir(run.sessionId, run.id)
  const manifest = readManifest(dir)
  if (!(rel in manifest)) return { ok: false, reason: 'Este arquivo não foi alterado por esta execução' }

  let abs: string
  try {
    abs = resolveInside(run.projectPath, rel)
  } catch {
    return { ok: false, reason: 'Caminho fora do projeto' }
  }

  const existedBefore = manifest[rel]
  let action: 'restaurado' | 'removido'
  if (existedBefore) {
    const original = path.join(dir, 'files', rel)
    if (!fs.existsSync(original)) return { ok: false, reason: 'O conteúdo original não está mais guardado' }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.copyFileSync(original, abs)
    action = 'restaurado'
  } else {
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    action = 'removido'
  }

  delete manifest[rel]
  fs.writeFileSync(manifestPath(dir), JSON.stringify(manifest), 'utf-8')
  return { ok: true, action }
}

/**
 * Aceita a alteração de um arquivo: ela fica como está e deixa de ser proposta.
 * O original sai do snapshot, então o rollback da execução não a desfaz depois.
 */
export function acceptFile(run: Pick<Run, 'sessionId' | 'id'>, rel: string): ChangeOutcome {
  const dir = snapshotDir(run.sessionId, run.id)
  const manifest = readManifest(dir)
  if (!(rel in manifest)) return { ok: false, reason: 'Este arquivo não foi alterado por esta execução' }

  const original = path.join(dir, 'files', rel)
  try { if (fs.existsSync(original)) fs.unlinkSync(original) } catch {}
  delete manifest[rel]
  fs.writeFileSync(manifestPath(dir), JSON.stringify(manifest), 'utf-8')
  return { ok: true, action: 'aceito' }
}
