import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { extractJson, parseAgentTurn } from '@/lib/agents/parse'
import { globToRegExp, matchesAny, matchesScope, resolveInside } from '@/lib/agents/fsutil'
import { FileLockManager } from '@/lib/agents/locks'
import { Scheduler, type SchedAgent, type SchedTask } from '@/lib/agents/scheduler'
import { breakCycles } from '@/lib/agents/orchestrator'
import { isSafeAgentCommand } from '@/lib/shell'
import { classifyModelError } from '@/lib/ai/client'
import { normalizeArgs } from '@/lib/agents/tools'
import { sleep } from './helpers'

describe('parse', () => {
  it('extracts JSON from prose, fences and think tags', () => {
    expect(extractJson('Claro! ```json\n{"a": 1}\n``` pronto')).toEqual({ a: 1 })
    expect(extractJson('<think>{"x":0}</think>{"b": [1,2,]}')).toEqual({ b: [1, 2] })
    expect(extractJson('{"c": "linha1\nlinha2"}')).toEqual({ c: 'linha1\nlinha2' })
  })

  it('parses agent turns and rejects turns without actions', () => {
    const t = parseAgentTurn('{"thought":"ok","actions":[{"tool":"read_file","args":{"path":"a"}}]}')
    expect(t.actions[0]).toEqual({ tool: 'read_file', args: { path: 'a' } })
    expect(() => parseAgentTurn('{"thought":"nada"}')).toThrow(/Nenhuma ação/)
  })
})

describe('paths and scopes', () => {
  it('matches globs like a shell', () => {
    expect(matchesAny('src/components/Button.tsx', ['**/*.tsx'])).toBe(true)
    expect(matchesAny('Button.tsx', ['**/*.tsx'])).toBe(true)
    expect(matchesAny('src/api/users/route.ts', ['**/api/**'])).toBe(true)
    expect(matchesAny('src/styles.css', ['**/api/**'])).toBe(false)
    expect(globToRegExp('src/*.js').test('src/a/b.js')).toBe(false)
  })

  it('applies "!" exclusions in role scopes', () => {
    const front = ['**/*.js', '**/*.html', '!**/server/**']
    expect(matchesScope('web/app.js', front)).toBe(true)
    expect(matchesScope('server/app.js', front)).toBe(false)
  })

  it('never resolves outside the project root', () => {
    expect(() => resolveInside('C:\\proj', '..\\other\\x.txt')).toThrow(/fora do projeto/)
    expect(resolveInside('C:\\proj', 'src/a.ts')).toMatch(/proj[\\/]src[\\/]a\.ts$/)
  })

  it('blocks existing symlinks that escape the project root', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-symlink-test-'))
    const root = path.join(parent, 'project')
    const outside = path.join(parent, 'outside')
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync(outside, path.join(root, 'escape'), 'junction')
    try {
      expect(() => resolveInside(root, 'escape/secret.txt')).toThrow(/atalho simbólico/i)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('blocks destructive agent commands', () => {
    expect(isSafeAgentCommand('npm test')).toBeNull()
    expect(isSafeAgentCommand('Remove-Item -Recurse src')).not.toBeNull()
    expect(isSafeAgentCommand('git push origin main')).not.toBeNull()
  })
})

describe('tool arguments', () => {
  it('accepts the parameter names models commonly use', () => {
    expect(normalizeArgs('write_file', { file_path: 'a.js', text: 'x' })).toMatchObject({ path: 'a.js', content: 'x' })
    expect(normalizeArgs('edit_file', { filePath: 'a.js', oldText: 'a', newText: 'b' })).toMatchObject({ path: 'a.js', old_text: 'a', new_text: 'b' })
    expect(normalizeArgs('run_command', { cmd: 'npm test' })).toMatchObject({ command: 'npm test' })
  })
})

describe('model error classification', () => {
  it('reads rate limits, overload and missing models', () => {
    const rl = classifyModelError(Object.assign(new Error('Rate limit reached. Please try again in 7.5s'), { status: 429 }))
    expect(rl.kind).toBe('rate_limit')
    expect(rl.retryAfterMs).toBe(7500)
    expect(classifyModelError(new Error('[503 ] This model is currently experiencing high demand')).kind).toBe('overloaded')
    expect(classifyModelError(Object.assign(new Error('The model x does not exist'), { status: 404 })).kind).toBe('unavailable')
  })

  it('trata plano/pagamento e conexão como externos, não como falha do modelo', () => {
    // Medido na auditoria real: 402 "not part of the free tier" e "Connection error."
    // apareciam como kind=other e viravam capacidade false na auditoria.
    const plano = classifyModelError(new Error('Compatível com Anthropic: erro 402. Hy4 is not part of the free tier.'))
    expect(plano.kind).toBe('auth')
    expect(classifyModelError(new Error('Connection error.')).kind).toBe('network')
  })
})

describe('FileLockManager', () => {
  it('serializes writers and wakes waiters on release', async () => {
    const locks = new FileLockManager()
    await locks.acquire('C:/p/a.ts', 'run:a', 'A')
    let bGot = false
    const b = locks.acquire('C:/p/a.ts', 'run:b', 'B').then(() => { bGot = true })
    await sleep(30)
    expect(bGot).toBe(false)
    expect(locks.holder('C:/p/a.ts')?.owner).toBe('run:a')
    locks.releaseAll('run:a')
    await b
    expect(locks.holder('C:/p/A.TS')?.owner).toBe('run:b')
  })

  it('times out with a clear message', async () => {
    const locks = new FileLockManager()
    await locks.acquire('x', 'o1', 'Backend')
    await expect(locks.acquire('x', 'o2', 'Frontend', { timeoutMs: 40 })).rejects.toThrow(/em uso por Backend/)
  })
})

function makeScheduler(tasks: SchedTask[], agents: SchedAgent[], work: (t: SchedTask, agentId: string) => Promise<'done' | 'failed'>, maxParallel = 4) {
  const ac = new AbortController()
  const log: Array<{ id: string; agentId: string; start: number; end: number }> = []
  const s = new Scheduler({
    tasks: () => tasks,
    agents: () => agents,
    maxParallel: () => maxParallel,
    isPaused: () => false,
    signal: ac.signal,
    execute: async (t, agentId) => {
      t.status = 'running'
      const start = Date.now()
      t.status = await work(t, agentId)
      log.push({ id: t.id, agentId, start, end: Date.now() })
    },
    onBlocked: (t) => { t.status = 'blocked' },
    onReassign: (t, _f, to) => { t.agentId = to },
  })
  return { s, log, ac }
}

const task = (id: string, agentId: string, roleId: string, dependsOn: string[] = []): SchedTask => ({ id, agentId, roleId, dependsOn, status: 'pending', createdAt: Number(id.slice(1)) })
const agent = (id: string, roleId: string): SchedAgent => ({ id, roleId, enabled: true, paused: false })

describe('Scheduler', () => {
  it('runs independent tasks in parallel and respects dependencies', async () => {
    const tasks = [task('t1', 'back', 'backend'), task('t2', 'front', 'frontend'), task('t3', 'qa', 'qa', ['t1', 't2'])]
    const { s, log } = makeScheduler(tasks, [agent('back', 'backend'), agent('front', 'frontend'), agent('qa', 'qa')], async () => { await sleep(60); return 'done' })
    await s.run()
    const [a, b, c] = ['t1', 't2', 't3'].map(id => log.find(l => l.id === id)!)
    expect(Math.abs(a.start - b.start)).toBeLessThan(40) // started together
    expect(c.start).toBeGreaterThanOrEqual(Math.max(a.end, b.end))
    expect(tasks.every(t => t.status === 'done')).toBe(true)
  })

  it('gives one agent one task at a time, and lets a same-role teammate take waiting work', async () => {
    const tasks = [task('t1', 'b1', 'backend'), task('t2', 'b1', 'backend'), task('t3', 'b1', 'backend')]
    const { s, log } = makeScheduler(tasks, [agent('b1', 'backend'), agent('b2', 'backend')], async () => { await sleep(40); return 'done' })
    await s.run()
    expect(new Set(log.map(l => l.agentId))).toEqual(new Set(['b1', 'b2']))
    for (const id of ['b1', 'b2']) {
      const mine = log.filter(l => l.agentId === id).sort((x, y) => x.start - y.start)
      for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end)
    }
  })

  it('blocks tasks whose dependency failed and resolves cycles instead of hanging', async () => {
    const tasks = [task('t1', 'a', 'x'), task('t2', 'a', 'x', ['t1'])]
    const { s } = makeScheduler(tasks, [agent('a', 'x')], async t => (t.id === 't1' ? 'failed' : 'done'))
    await s.run()
    expect(tasks[1].status).toBe('blocked')

    const cyc = [task('t1', 'a', 'x', ['t2']), task('t2', 'a', 'x', ['t1'])]
    const { s: s2 } = makeScheduler(cyc, [agent('a', 'x')], async () => 'done')
    await s2.run()
    expect(cyc.every(t => t.status === 'blocked')).toBe(true)
  })

  it('breakCycles keeps plans runnable', () => {
    const t = [{ id: 't1', dependsOn: ['t2'] }, { id: 't2', dependsOn: ['t1'] }, { id: 't3', dependsOn: ['t9'] }]
    breakCycles(t)
    expect(t[0].dependsOn.length + t[1].dependsOn.length).toBe(1)
    expect(t[2].dependsOn).toEqual([])
  })
})
