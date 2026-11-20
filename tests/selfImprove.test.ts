import path from 'path'
import fs from 'fs'
import os from 'os'
import { describe, expect, it, beforeEach } from 'vitest'
import { scanRepo, setSelfImproveLlm, selfImproveRunner, runSelfImprove } from '@/lib/ai/selfImprove'

describe('JARVIS Self-Improvement', () => {
  it('scan mede o repositório de verdade (sem inventar números)', () => {
    const signals = scanRepo(process.cwd())
    expect(signals.totalFiles).toBeGreaterThan(50)
    expect(signals.totalLines).toBeGreaterThan(3000)
    expect(signals.bigFiles.length).toBeGreaterThan(0)
    expect(signals.bigFiles[0].lines).toBeGreaterThanOrEqual(signals.bigFiles[signals.bigFiles.length - 1].lines)
    expect(signals.tests.testFiles).toBeGreaterThan(0)
    expect(signals.echo).toMatchObject({ todo: expect.any(Number), fixme: expect.any(Number), anyCast: expect.any(Number), consoleLog: expect.any(Number) })
  })

  it('respeita o root informado (não vaza entre projetos)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'self-improve-test-'))
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const x = 1\n// TODO arrumar isto\n')
    const signals = scanRepo(tmp)
    expect(signals.totalFiles).toBe(1)
    expect(signals.echo.todo).toBe(1)
  })

  it('com IA indisponível devolve os sinais determinísticos sem mentir', async () => {
    setSelfImproveLlm(async () => { throw Object.assign(new Error('429 rate limit'), { status: 429 }) as never })
    const r = await runSelfImprove()
    expect(r.report).toContain('Sinais do repositório')
    expect(r.report).not.toContain('undefined')
    expect(r.scanned.totalFiles).toBeGreaterThan(0)
  })

  it('com IA disponível entrega o relatório do revisor', async () => {
    setSelfImproveLlm(async () => ({ text: '1. Modularizar a faixa de agentes\n2. Reduzir any casts\n3. Cobrir o terminal com testes\n4. Fix do rate limit do Pollinations\n5. Documentar o pipeline de vídeo', usage: { inputTokens: 10, outputTokens: 5 } } as never))
    const r = await runSelfImprove()
    expect(r.report).toContain('Modularizar')
    expect(r.model).toBeTruthy()
  })

  it('o runner reconhece /self-improve e ignora o resto', () => {
    expect(selfImproveRunner('/self-improve')).toBeTypeOf('function')
    expect(selfImproveRunner('/auto-melhorar')).toBeTypeOf('function')
    expect(selfImproveRunner('/council x')).toBeNull()
    expect(selfImproveRunner('bom dia')).toBeNull()
  })
})
