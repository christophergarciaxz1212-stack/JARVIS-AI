import { describe, expect, it } from 'vitest'
import { classifyModuleError, summarize, collectModuleStatus, resolveBuildIdentity } from '@/lib/diagnostics/modules'

describe('diagnóstico interno', () => {
  it('classifica falha externa como atenção e falha interna como erro', () => {
    expect(classifyModuleError({ kind: 'rate_limit' })).toBe('attention')
    expect(classifyModuleError({ kind: 'auth' })).toBe('attention')
    expect(classifyModuleError({ kind: 'network' })).toBe('attention')
    expect(classifyModuleError(new Error('arquivo não gravado'))).toBe('error')
  })

  it('resumo conta os quatro status', () => {
    expect(summarize([
      { status: 'ok' }, { status: 'error' }, { status: 'attention' }, { status: 'ok' },
    ] as never)).toEqual({ ok: 2, error: 1, attention: 1, unknown: 0 })
  })

  it('coleta módulos reais com evidência e sem valores de chave', async () => {
    const report = await collectModuleStatus({ now: 1_700_000_000_000 })
    expect(report.modules.length).toBeGreaterThanOrEqual(5)
    expect(report.checkedAt).toBe(1_700_000_000_000)
    for (const m of report.modules) {
      expect(m.id).toBeTruthy()
      expect(['nucleo', 'ia', 'agentes', 'integracoes', 'dados', 'build']).toContain(m.category)
      expect(['ok', 'error', 'attention', 'unknown']).toContain(m.status)
      expect(m.evidence.length).toBeGreaterThan(0)
      expect(JSON.stringify(m)).not.toMatch(/sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,}/)
    }
    expect(report.summary).toHaveProperty('ok')
  })

  it('identifica o build instalado mesmo sem git', () => {
    const fromGit = resolveBuildIdentity({ gitSha: '3b4e364', buildId: 'uhsW', version: '1.2.2' })
    expect(fromGit).toEqual({ evidence: '3b4e364', status: 'ok' })

    const packaged = resolveBuildIdentity({ gitSha: null, buildId: 'uhsW_2XIIpicOVDOn8Pdo', version: '1.2.2' })
    expect(packaged.status).toBe('ok')
    expect(packaged.evidence).toContain('1.2.2')
    expect(packaged.evidence).toContain('uhsW_2XIIpicOVDOn8Pdo')

    const nothing = resolveBuildIdentity({ gitSha: null, buildId: null, version: null })
    expect(nothing).toEqual({ evidence: 'desconhecido', status: 'unknown' })
  })

  it('reports the real watchdog state in the self-check', async () => {
    const { getInfraCore } = await import('@/lib/infra/core')
    const { gatherDiagnostics } = await import('@/lib/infra/diagnostics')
    const core = getInfraCore()
    const wasRunning = core.watchdog.running
    core.watchdog.start()
    try {
      expect(core.watchdog.running).toBe(true)
      const d = await gatherDiagnostics()
      const row = d.selfcheck.checks.find(c => c.id === 'watchdog')
      expect(row?.status).toBe('ok')
      expect(row?.detail).toBe('Ativo, sem incidentes abertos')
    } finally {
      if (!wasRunning) core.watchdog.stop()
    }
  })

  it('GET /api/diagnostics devolve módulos e resumo', async () => {
    const { GET } = await import('@/app/api/diagnostics/route')
    const res = await GET()
    const body = await res.json()
    expect(Array.isArray(body.modules)).toBe(true)
    expect(body.summary).toHaveProperty('ok')
  })
})
