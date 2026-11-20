import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { applySetup, detectSetup, launchConfig, missingFields, secretEnvName } from '@/lib/engine/setup'
import { retest } from '@/lib/engine/installer'
import { getExtension, saveExtension } from '@/lib/engine/registry'
import { getEngine } from '@/lib/engine/engine'
import { mcp } from '@/lib/engine/mcp'
import { redact } from '@/lib/redact'
import type { Extension } from '@/lib/engine/types'

const ext = (over: Partial<Extension>): Extension => ({
  id: 'x', name: 'x', kind: 'mcp', description: '', categories: [], source: { type: 'npm', ref: 'pkg' }, version: '1', dir: os.tmpdir(), versions: [],
  enabled: true, status: 'ok', tools: [], dependencies: [], permissions: { network: true, shell: false, fsWrite: false, env: [], agents: ['*'] },
  risk: { level: 'low', findings: [] }, installedAt: 0, updatedAt: 0, ...over,
} as Extension)

afterAll(async () => { await mcp.closeAll() })

describe('what an extension needs to start', () => {
  it('knows the official MCP servers', () => {
    expect(detectSetup(ext({ source: { type: 'npm', ref: '@modelcontextprotocol/server-brave-search' } }), '').map(f => [f.name, f.kind, f.secret])).toEqual([['BRAVE_API_KEY', 'env', true]])
    expect(detectSetup(ext({ source: { type: 'npm', ref: '@modelcontextprotocol/server-filesystem' } }), '')[0]).toMatchObject({ name: 'ALLOWED_DIRS', kind: 'arg', multiline: true })
    expect(detectSetup(ext({ source: { type: 'npm', ref: '@modelcontextprotocol/server-postgres' } }), '')[0]).toMatchObject({ kind: 'arg', secret: true })
    expect(detectSetup(ext({ source: { type: 'npm', ref: '@modelcontextprotocol/server-gitlab' } }), '').map(f => f.name)).toEqual(['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_API_URL'])
  })

  it('reads unknown servers from what they print', () => {
    expect(detectSetup(ext({}), 'Error: WEATHER_API_KEY environment variable is required').map(f => [f.name, f.secret])).toEqual([['WEATHER_API_KEY', true]])
    expect(detectSetup(ext({}), 'Usage: my-server <database-file>')[0]).toMatchObject({ kind: 'arg', help: expect.stringMatching(/Usage/) })
    expect(detectSetup(ext({ mcp: { transport: 'http', url: 'https://x' } }), 'Error POSTing: {"error":"Missing or invalid Authorization header"}')[0]).toMatchObject({ kind: 'header', name: 'Authorization' })
    expect(detectSetup(ext({}), 'TypeError: cannot read properties of undefined')).toEqual([])
  })

  it('keeps secrets in the vault (masked in logs) and builds the launch config', () => {
    const e = ext({ id: 'gitlab', source: { type: 'npm', ref: '@modelcontextprotocol/server-gitlab' } })
    e.setup = { fields: detectSetup(e, ''), values: {} }
    expect(missingFields(e).map(f => f.name)).toEqual(['GITLAB_PERSONAL_ACCESS_TOKEN'])
    applySetup(e, { GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-supersecret-123', GITLAB_API_URL: 'https://gitlab.example/api/v4' })
    expect(JSON.stringify(e)).not.toContain('glpat-supersecret-123')
    expect(process.env[secretEnvName('gitlab', 'GITLAB_PERSONAL_ACCESS_TOKEN')]).toBe('glpat-supersecret-123')
    expect(redact('token glpat-supersecret-123')).not.toContain('glpat-supersecret-123')
    expect(launchConfig(e).env).toEqual({ GITLAB_PERSONAL_ACCESS_TOKEN: 'glpat-supersecret-123', GITLAB_API_URL: 'https://gitlab.example/api/v4' })
    expect(missingFields(e)).toEqual([])
  })

  it('refuses to open the whole disk or the whole user folder to the file server', () => {
    const e = ext({ id: 'fs', source: { type: 'npm', ref: '@modelcontextprotocol/server-filesystem' } })
    e.setup = { fields: detectSetup(e, ''), values: {} }
    expect(() => applySetup(e, { ALLOWED_DIRS: 'C:\\' })).toThrow(/disco inteiro/)
    expect(() => applySetup(e, { ALLOWED_DIRS: os.homedir() })).toThrow(/pasta do usuário/)
    applySetup(e, { ALLOWED_DIRS: `${path.join(os.homedir(), 'Documents', 'JARVIS Projetos')}\n${os.tmpdir()}` })
    expect(launchConfig(e).args).toHaveLength(2)
  })
})

// A real MCP stdio server (newline-delimited JSON-RPC) that refuses to start without FOO_API_KEY
const SERVER = `
if (!process.env.FOO_API_KEY) { console.error('Error: FOO_API_KEY environment variable is required'); process.exit(1) }
let buf = ''
process.stdin.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.id === undefined) continue
    const reply = r => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n')
    if (m.method === 'initialize') reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'foo', version: '1.0.0' } })
    else if (m.method === 'tools/list') reply({ tools: [{ name: 'foo_lookup', description: 'Consulta', inputSchema: { type: 'object', properties: {} } }] })
    else reply({})
  }
})
`

describe('engine: a server missing its key is "needs setup", and works after configuring', () => {
  it('end to end with a real MCP process', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-mcp-'))
    fs.writeFileSync(path.join(dir, 'server.js'), SERVER)
    const e = ext({ id: 'foo-mcp', name: 'Foo MCP', dir, source: { type: 'npm', ref: 'foo-mcp' }, mcp: { transport: 'stdio', command: 'node', args: ['./server.js'] } })
    saveExtension(e)

    const first = await retest(getExtension('foo-mcp')!)
    expect(first.ok).toBe(false)
    expect(first.output).toMatch(/FOO_API_KEY environment variable is required/)
    const after = getExtension('foo-mcp')!
    expect(after.status).toBe('needs-setup')
    expect(after.statusReason).toMatch(/Falta configurar: FOO_API_KEY/)

    const r = await getEngine().configure('foo-mcp', { FOO_API_KEY: 'foo-secret-value' })
    expect(r.test.ok).toBe(true)
    expect(r.ext?.status).toBe('ok')
    expect(r.ext?.tools.map(t => t.name)).toEqual(['foo_lookup'])
    expect(JSON.stringify(r.ext)).not.toContain('foo-secret-value')
  }, 60_000)
})
