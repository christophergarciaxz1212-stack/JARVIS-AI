import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto'
import { dataDir } from '../agents/fsutil'
import { runProgram, which } from './exec'
import { loadStore, newId, saveStore } from './store'

export type BackupProfile = 'essencial' | 'completo'

export interface BackupEntry {
  id: string
  createdAt: number
  label: string
  source: string
  profile: BackupProfile
  file: string
  size: number
  sha256: string
  encrypted: boolean
  entries: number
  trigger: 'manual' | 'agendado' | 'agente' | 'pre-restauracao'
  verifiedAt?: number
  verifyOk?: boolean
  verifyError?: string
}

const FILE = 'backups.json'
const MAGIC = Buffer.from('JVBK1')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

export const backupsDir = () => path.join(dataDir(), 'backups')
export const restoresDir = () => path.join(dataDir(), 'restores')
export const listBackups = () => loadStore<BackupEntry[]>(FILE, []).sort((a, b) => b.createdAt - a.createdAt)

/** Paths (relative to the source root) that never go into a backup of the JARVIS data folder. */
function dataExcludes(profile: BackupProfile, encrypted: boolean) {
  // engine/home/<sandbox>/tmp holds thousands of npm leftovers from extension audits: never worth backing up
  const ex = ['./backups', './restores', './logs', './engine/npm-cache', './engine/quarantine', './engine/builds', './engine/workspace', './engine/home/*/tmp', '*.tmp', '*.partial', '*.corrupt-*']
  if (profile === 'essencial') ex.push('./engine/extensions', '*.mp4', '*.webm', '*.mov', '*.wav')
  // API keys only leave this machine's data folder inside an encrypted archive
  if (!encrypted) ex.push('./keys.json')
  return ex
}

function deriveKey(passphrase: string, salt: Buffer) {
  if (passphrase.length < 8) throw new Error('A senha do backup precisa ter pelo menos 8 caracteres')
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

async function sha256File(file: string) {
  const h = createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

async function encryptFile(plain: string, out: string, passphrase: string) {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  const ws = fs.createWriteStream(out)
  ws.write(Buffer.concat([MAGIC, salt, iv]))
  await pipeline(fs.createReadStream(plain), cipher, ws, { end: false })
  await new Promise<void>((resolve, reject) => ws.end(cipher.getAuthTag(), () => resolve()).on('error', reject))
}

async function decryptFile(enc: string, out: string, passphrase: string) {
  const size = fs.statSync(enc).size
  const head = Buffer.alloc(MAGIC.length + SALT_LEN + IV_LEN)
  const tag = Buffer.alloc(TAG_LEN)
  const fd = fs.openSync(enc, 'r')
  try {
    fs.readSync(fd, head, 0, head.length, 0)
    fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN)
  } finally {
    fs.closeSync(fd)
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Arquivo não é um backup criptografado do JARVIS')
  const salt = head.subarray(MAGIC.length, MAGIC.length + SALT_LEN)
  const iv = head.subarray(MAGIC.length + SALT_LEN)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  decipher.setAuthTag(tag)
  try {
    await pipeline(fs.createReadStream(enc, { start: head.length, end: size - TAG_LEN - 1 }), decipher, fs.createWriteStream(out))
  } catch {
    fs.rmSync(out, { force: true })
    throw new Error('Senha incorreta ou backup adulterado (falha na autenticação AES-GCM)')
  }
}

async function tarList(archive: string) {
  const r = await runProgram('tar', ['-tzf', archive], { timeoutMs: 300_000, maxOutput: 20_000_000 })
  if (r.exitCode !== 0) throw new Error(`Arquivo de backup ilegível: ${r.stderr.trim().slice(0, 300)}`)
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

async function requireTar() {
  if (!(await which('tar'))) throw new Error('tar não encontrado (vem com o Windows 10+; no Linux instale o pacote tar)')
}

export async function createBackup(opts: { source?: string; label?: string; passphrase?: string; profile?: BackupProfile; trigger?: BackupEntry['trigger']; keep?: number } = {}): Promise<BackupEntry> {
  await requireTar()
  const source = path.resolve(opts.source || dataDir())
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`Pasta de origem não existe: ${source}`)
  const isData = source === path.resolve(dataDir())
  const encrypted = !!opts.passphrase
  const profile = opts.profile || 'essencial'
  const id = newId('bkp')
  fs.mkdirSync(backupsDir(), { recursive: true })
  if (!isData && path.resolve(backupsDir()).startsWith(source + path.sep)) throw new Error('A pasta de backups fica dentro da origem: escolha outra origem')
  const tmp = path.join(backupsDir(), `${id}.tar.gz.partial`)
  const final = path.join(backupsDir(), `${id}.tar.gz${encrypted ? '.enc' : ''}`)
  const excludes = isData ? dataExcludes(profile, encrypted) : ['./node_modules', './.next', './.git', '*.tmp']
  try {
    const r = await runProgram('tar', ['-czf', tmp, ...excludes.flatMap(e => ['--exclude', e]), '-C', source, '.'], { timeoutMs: 1_800_000 })
    if (r.exitCode !== 0 || !fs.existsSync(tmp)) throw new Error(`tar falhou: ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
    const entries = (await tarList(tmp)).length
    if (encrypted) {
      await encryptFile(tmp, final, opts.passphrase!)
      fs.rmSync(tmp, { force: true })
    } else fs.renameSync(tmp, final)
    const entry: BackupEntry = {
      id, createdAt: Date.now(), label: (opts.label || (isData ? 'Dados do JARVIS' : path.basename(source))).slice(0, 80), source, profile,
      file: final, size: fs.statSync(final).size, sha256: await sha256File(final), encrypted, entries, trigger: opts.trigger || 'manual',
      verifiedAt: Date.now(), verifyOk: true,
    }
    saveStore(FILE, [entry, ...listBackups()])
    rotateBackups(source, opts.keep ?? 10)
    return entry
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(final, { force: true })
    throw e
  }
}

/** Keeps the newest `keep` backups of a source; older archives are deleted (retention policy). */
export function rotateBackups(source: string, keep: number) {
  const all = listBackups()
  const same = all.filter(b => b.source === source && b.trigger !== 'pre-restauracao')
  const drop = new Set(same.slice(Math.max(1, keep)).map(b => b.id))
  if (!drop.size) return 0
  for (const b of all) if (drop.has(b.id)) fs.rmSync(b.file, { force: true })
  saveStore(FILE, all.filter(b => !drop.has(b.id)))
  return drop.size
}

export function getBackup(id: string) {
  const b = listBackups().find(x => x.id === id)
  if (!b) throw new Error('Backup não encontrado')
  return b
}

function updateEntry(id: string, patch: Partial<BackupEntry>) {
  const all = listBackups()
  const b = all.find(x => x.id === id)
  if (b) { Object.assign(b, patch); saveStore(FILE, all) }
}

export async function verifyBackup(id: string, passphrase?: string) {
  const b = getBackup(id)
  const fail = (msg: string) => { updateEntry(id, { verifiedAt: Date.now(), verifyOk: false, verifyError: msg }); return { ok: false, error: msg } }
  if (!fs.existsSync(b.file)) return fail('Arquivo do backup sumiu do disco')
  if ((await sha256File(b.file)) !== b.sha256) return fail('SHA-256 não confere: o arquivo foi corrompido ou alterado')
  let listed = b.entries
  if (!b.encrypted) listed = (await tarList(b.file).catch(e => { throw e })).length
  else if (passphrase) {
    const tmp = path.join(backupsDir(), `${id}.verify.partial`)
    try { await decryptFile(b.file, tmp, passphrase); listed = (await tarList(tmp)).length } catch (e) { return fail((e as Error).message) } finally { fs.rmSync(tmp, { force: true }) }
  }
  if (listed !== b.entries) return fail(`Conteúdo diferente do registrado (${listed} itens, esperado ${b.entries})`)
  updateEntry(id, { verifiedAt: Date.now(), verifyOk: true, verifyError: undefined })
  return { ok: true, entries: listed, deepChecked: !b.encrypted || !!passphrase }
}

/** Extracts into a NEW folder under data/restores — live data is never overwritten. */
export async function restoreBackup(id: string, passphrase?: string) {
  await requireTar()
  const b = getBackup(id)
  const check = await verifyBackup(id, passphrase)
  if (!check.ok) throw new Error(`Backup não passou na verificação: ${'error' in check ? check.error : 'erro desconhecido'}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(restoresDir(), `${id}-${stamp}`)
  fs.mkdirSync(dest, { recursive: true })
  let archive = b.file
  const tmp = path.join(backupsDir(), `${id}.restore.partial`)
  try {
    if (b.encrypted) {
      if (!passphrase) throw new Error('Este backup é criptografado: informe a senha')
      await decryptFile(b.file, tmp, passphrase)
      archive = tmp
    }
    // bsdtar/GNU tar refuse absolute paths and ".." members by default (no -P), so nothing escapes dest
    const r = await runProgram('tar', ['-xzf', archive, '-C', dest], { timeoutMs: 1_800_000 })
    if (r.exitCode !== 0) throw new Error(`Falha ao extrair: ${r.stderr.trim().slice(0, 400)}`)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  return { path: dest, entries: b.entries }
}

/** Restores ONE missing file of the data folder from the newest unencrypted backup that has it. */
export async function restoreDataFile(rel: string) {
  const clean = rel.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!clean || clean.includes('..')) throw new Error('Caminho inválido')
  const target = path.join(dataDir(), clean)
  if (fs.existsSync(target)) throw new Error('O arquivo existe: nada a restaurar (o JARVIS não sobrescreve dados vivos)')
  const member = `./${clean}`
  for (const b of listBackups().filter(x => !x.encrypted && x.source === path.resolve(dataDir()) && fs.existsSync(x.file))) {
    const names = await tarList(b.file).catch(() => [] as string[])
    if (!names.includes(member)) continue
    const tmp = fs.mkdtempSync(path.join(backupsDir(), 'one-'))
    try {
      const r = await runProgram('tar', ['-xzf', b.file, '-C', tmp, member], { timeoutMs: 300_000 })
      const extracted = path.join(tmp, clean)
      if (r.exitCode !== 0 || !fs.existsSync(extracted)) continue
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(extracted, target, fs.constants.COPYFILE_EXCL)
      return { restored: clean, from: b.id, createdAt: b.createdAt }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  throw new Error(`Nenhum backup sem criptografia contém ${clean}`)
}

/**
 * Removes leftovers of backups interrupted by a crash/kill. A live tar keeps touching its
 * file, so anything idle for `maxIdleMs` belongs to a process that no longer exists.
 */
export function cleanOrphanPartials(maxIdleMs = 10 * 60_000) {
  let removed = 0
  let entries: string[] = []
  try { entries = fs.readdirSync(backupsDir()) } catch { return 0 }
  for (const name of entries) {
    const abs = path.join(backupsDir(), name)
    try {
      const st = fs.statSync(abs)
      if (!name.endsWith('.partial') && !(st.isDirectory() && name.startsWith('one-'))) continue
      if (Date.now() - st.mtimeMs < maxIdleMs) continue
      fs.rmSync(abs, { recursive: true, force: true })
      removed++
    } catch {}
  }
  return removed
}

export function deleteBackup(id: string) {
  const b = getBackup(id)
  fs.rmSync(b.file, { force: true })
  saveStore(FILE, listBackups().filter(x => x.id !== id))
}
