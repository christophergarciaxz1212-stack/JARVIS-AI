import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  applyRepair, detectSystem, ensureDirectories, markSetupDone, setupMarker, systemHealth, wingetInstall, updateCheck,
} from '@/lib/setup/system'

let tmp: string
let oldEnv: string | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-setup-'))
  oldEnv = process.env.JARVIS_DATA_DIR
  process.env.JARVIS_DATA_DIR = tmp
})
afterEach(() => {
  if (oldEnv === undefined) delete process.env.JARVIS_DATA_DIR
  else process.env.JARVIS_DATA_DIR = oldEnv
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('detecção de sistema (medição real)', () => {
  it('retorna todas as seções do relatório com tipos corretos', async () => {
    const r = await detectSystem()
    expect(['win32', 'linux', 'darwin']).toContain(r.platform.id)
    expect(r.cpu.cores).toBeGreaterThan(0)
    expect(r.memory.totalGB).toBeGreaterThan(0)
    expect(Array.isArray(r.warnings)).toBe(true)
    expect(Array.isArray(r.keys.configured)).toBe(true)
    expect(Array.isArray(r.keys.missing)).toBe(true)
    expect(r.tools.node.ok).toBe(true) // o próprio processo Node existe
    expect(r.directories.ok).toBe(true)
  })

  it('diretórios são criados e graváveis (probe real)', () => {
    const first = ensureDirectories()
    expect(first.ok).toBe(true)
    expect(first.created.length).toBeGreaterThan(0)
    for (const d of ['images', 'video', 'logs', 'temp', 'cache', 'models']) {
      expect(fs.existsSync(path.join(tmp, d))).toBe(true)
    }
    const second = ensureDirectories()
    expect(second.ok).toBe(true)
    expect(second.created).toEqual([])
  })
})

describe('reparos (explícitos e reversíveis)', () => {
  it('applyRepair("keys-file") cria keys.json e nunca sobrescreve o existente', () => {
    expect(fs.existsSync(path.join(tmp, 'keys.json'))).toBe(false)
    const created = applyRepair('keys-file')
    expect(created.ok).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'keys.json'))).toBe(true)
    fs.writeFileSync(path.join(tmp, 'keys.json'), JSON.stringify({ CUSTOM: 'x' }))
    const kept = applyRepair('keys-file')
    expect(kept.ok).toBe(true)
    expect((JSON.parse(fs.readFileSync(path.join(tmp, 'keys.json'), 'utf8')) as { CUSTOM: string }).CUSTOM).toBe('x')
  })

  it('applyRepair("prefs") cria prefs.json uma única vez', () => {
    const created = applyRepair('prefs')
    expect(created.ok).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'prefs.json'))).toBe(true)
    const kept = applyRepair('prefs')
    expect(kept.detail).toMatch(/preservado/i)
  })
})

describe('instalador WinGet (explícito, com whitelist)', () => {
  it('recusa pacotes fora da whitelist sem executar nada', async () => {
    const result = await wingetInstall('Totally.NotAllowed')
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/não permitido/i)
    expect(result.before).toBe('')
  })
})

describe('marcador de primeira execução', () => {
  it('começa como firstRun e vira done após o ack', () => {
    expect(setupMarker().done).toBe(false)
    const ack = markSetupDone()
    expect(ack.ok).toBe(true)
    expect(setupMarker().done).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'logs', '.first-run-done'))).toBe(true)
  })
})

describe('saúde do sistema (permanente)', () => {
  it('retorna os itens esperados e registra log', async () => {
    const health = await systemHealth()
    const ids = health.items.map(i => i.id)
    for (const id of ['dirs', 'chrome', 'keys', 'internet', 'disk', 'ollama']) {
      expect(ids).toContain(id)
    }
    expect(typeof health.ok).toBe('boolean')
    expect(fs.existsSync(health.logFile)).toBe(true)
  })
})

describe('atualização honesta', () => {
  it('sem JARVIS_UPDATE_REPO, reporta não configurado (nunca finge ter verificado)', async () => {
    delete process.env.JARVIS_UPDATE_REPO
    const update = await updateCheck()
    expect(update.supported).toBe(false)
    expect(update.message).toMatch(/não configurada/i)
  })
})
