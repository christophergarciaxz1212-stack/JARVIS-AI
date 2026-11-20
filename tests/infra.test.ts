import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { checkpoint, clearCheckpoint, getSystemHealth, readCheckpoint, withRecovery } from '@/lib/infra/reliability'
import { tempProject } from './helpers'

describe('infra reliability', () => {
  it('retries transient failures and can recover automatically', async () => {
    let attempts = 0
    const value = await withRecovery(async () => {
      attempts += 1
      if (attempts < 2) throw new Error('transient')
      return 'ok'
    }, { retries: 3, retryDelayMs: 0, label: 'transient', shouldRetry: () => true })
    expect(value).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('reports metric shapes in the health snapshot', () => {
    const health = getSystemHealth()
    expect(health.status).toMatch(/healthy|warning|critical/)
    expect(health.totalMemoryMb).toBeGreaterThan(0)
    expect(health.cpuCount).toBeGreaterThan(0)
  })

  it('does not retry operations unless errors are explicitly classified as retryable', async () => {
    let attempts = 0
    await expect(withRecovery(() => {
      attempts += 1
      throw new Error('permanent')
    }, { retries: 4, retryDelayMs: 0 })).rejects.toThrow('permanent')
    expect(attempts).toBe(1)
  })

  it('uses distinct files for checkpoint keys that normalize similarly and detects corruption', () => {
    const prev = process.env.JARVIS_DATA_DIR
    const dir = tempProject()
    process.env.JARVIS_DATA_DIR = dir
    try {
      const first = checkpoint('task/a', { step: 1 })
      const second = checkpoint('task?a', { step: 2 })
      expect(first).not.toBe(second)
      expect(readCheckpoint('task/a')).toEqual({ step: 1 })
      expect(readCheckpoint('task?a')).toEqual({ step: 2 })
      fs.writeFileSync(first, '{ corrupt', 'utf-8')
      expect(() => readCheckpoint('task/a')).toThrow(/corrompido/i)
      expect(fs.existsSync(first)).toBe(true)
    } finally {
      if (prev) process.env.JARVIS_DATA_DIR = prev
      else delete process.env.JARVIS_DATA_DIR
    }
  })

  it('rejects empty checkpoint keys', () => {
    expect(() => checkpoint('  ', {})).toThrow(/chave.*vazia/i)
    expect(() => readCheckpoint('')).toThrow(/chave.*vazia/i)
    expect(() => clearCheckpoint('')).toThrow(/chave.*vazia/i)
  })

  it('persists checkpoints safely', () => {
    const prev = process.env.JARVIS_DATA_DIR
    const dir = tempProject()
    process.env.JARVIS_DATA_DIR = dir
    try {
      const file = checkpoint('task-1', { step: 'analysis', ok: true })
      expect(fs.existsSync(file)).toBe(true)
      expect(readCheckpoint<{ step: string }>('task-1')).toMatchObject({ step: 'analysis', ok: true })
      clearCheckpoint('task-1')
      expect(readCheckpoint('task-1')).toBeUndefined()
    } finally {
      if (prev) process.env.JARVIS_DATA_DIR = prev
      else delete process.env.JARVIS_DATA_DIR
    }
  })
})
