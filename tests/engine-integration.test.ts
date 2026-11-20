import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { getEngine } from '@/lib/engine/engine'
import { mcp } from '@/lib/engine/mcp'
import { updateExtension } from '@/lib/engine/installer'
import { AgentRuntime } from '@/lib/agents/runtime'
import { createProject, readEvents } from '@/lib/agents/store'
import type { CompleteFn } from '@/lib/agents/models'
import { act, acts, completion, fakeProviders, json, tempProject, whoAmI } from './helpers'

const roots: string[] = []
function tmpDir(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-engine-int-'))
  roots.push(dir)
  write(dir, files)
  return dir
}
function write(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
  }
}
afterAll(async () => {
  await mcp.closeAll()
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

/** A dependency-free MCP server speaking the real protocol (newline-delimited JSON-RPC over stdio). */
const MCP_SERVER = `import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
const send = m => process.stdout.write(JSON.stringify(m) + '\\n')
const tools = [{ name: 'somar', description: 'Soma dois números', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }]
rl.on('line', line => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'calc-teste', version: '1.0.0' } } })
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools } })
  else if (msg.method === 'tools/call') {
    const { a, b } = msg.params.arguments
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'resultado=' + (Number(a) + Number(b)) }] } })
  } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
})
`

function mcpPackage() {
  return tmpDir({
    'package.json': JSON.stringify({ name: 'mcp-calc-teste', version: '1.0.0', description: 'Servidor MCP de calculadora para testes', type: 'module', bin: 'server.mjs', keywords: ['mcp'] }),
    'server.mjs': MCP_SERVER,
  })
}

describe('MCP de verdade', () => {
  it('instala um servidor MCP local, lista as ferramentas pelo protocolo e executa uma', async () => {
    const outcome = await getEngine().installSource(mcpPackage(), { requestedBy: 'teste' })
    expect(outcome.status).toBe('installed')
    if (outcome.status !== 'installed') return
    const ext = outcome.extension
    try {
      expect(ext.kind).toBe('mcp')
      expect(ext.lastTest?.ok).toBe(true)
      expect(ext.tools.map(t => t.name)).toEqual(['somar'])
      expect(await getEngine().callTool(ext.id, 'somar', { a: 2, b: 3 })).toContain('resultado=5')
      // Per-agent permission: restrict to QA, the backend role is refused
      getEngine().setPermissions(ext.id, { agents: ['qa'] })
      await expect(getEngine().callTool(ext.id, 'somar', { a: 1, b: 1 }, 'backend')).rejects.toThrow(/permissão/)
      expect(await getEngine().callTool(ext.id, 'somar', { a: 1, b: 1 }, 'qa')).toContain('resultado=2')
    } finally {
      await getEngine().remove(ext.id)
    }
  })

  it('um agente da equipe encontra e usa a ferramenta MCP durante a execução', async () => {
    const outcome = await getEngine().installSource(mcpPackage(), { requestedBy: 'teste' })
    if (outcome.status !== 'installed') throw new Error(outcome.status)
    const ext = outcome.extension
    const seen: string[] = []
    const complete: CompleteFn = async (model, messages) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(json({ complexity: 'trivial', summary: 'usar calculadora', tasks: [{ id: 'a', title: 'Somar', description: 'some 20 e 22', role: 'fullstack', dependsOn: [], files: [] }] }), model)
      if (me.kind === 'report') return completion('ok', model)
      seen.push(me.last || '')
      if (me.step === 0) return completion(act('skill_find', { query: 'calculadora somar números' }), model)
      if (me.step === 1) return completion(acts(['skill_use', { extension: ext.id, tool: 'somar', args: { a: 20, b: 22 } }]), model)
      return completion(act('finish', { summary: 'soma feita' }), model)
    }
    const rt = new AgentRuntime()
    rt.complete = complete
    rt.providers = async () => fakeProviders()
    try {
      const project = createProject('Engine+agentes', tempProject())
      const ctrl = rt.startRun({ projectId: project.id, request: 'some 20 e 22 com a calculadora' })
      await ctrl.done
      expect(ctrl.run.status).toBe('completed')
      // The task context already listed the tool, skill_find found it, skill_use returned the real MCP result
      expect(seen[0]).toContain(ext.id)
      expect(seen[1]).toContain('somar')
      expect(seen[2]).toContain('resultado=42')
      expect(readEvents(ctrl.run.sessionId, ctrl.run.id, 500).some(e => e.type === 'skill_use')).toBe(true)
    } finally {
      await getEngine().remove(ext.id)
    }
  })
})

const toolFiles = (version: string, testOk: boolean) => ({
  'jarvis-tool.json': JSON.stringify({ name: 'Versionada', description: 'Ferramenta com versões', version, script: 'index.mjs', tools: [{ name: 'versao', description: 'Diz a versão', inputSchema: { type: 'object', properties: {} } }] }),
  'index.mjs': `process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ result: '${version}' })))\n`,
  'tests/test.mjs': testOk ? 'process.exit(0)\n' : 'console.error("teste falhou de propósito"); process.exit(1)\n',
})

describe('limpeza', () => {
  it('remove pastas de extensões que não estão mais no registro', () => {
    const orphan = path.join(process.env.JARVIS_DATA_DIR!, 'engine', 'extensions', 'sobra-de-crash', '1.0.0')
    fs.mkdirSync(orphan, { recursive: true })
    fs.writeFileSync(path.join(orphan, 'index.mjs'), 'x')
    expect(getEngine().cleanupOrphans()).toContain('sobra-de-crash')
    expect(fs.existsSync(path.dirname(orphan))).toBe(false)
  })
})

describe('contrato das ferramentas', () => {
  it('reprova uma ferramenta cujo manifesto declara nomes que o código não implementa', async () => {
    const dir = tmpDir({
      'jarvis-tool.json': JSON.stringify({ name: 'Contrato Quebrado', description: 'nomes divergentes', version: '1.0.0', script: 'index.mjs', tools: [{ name: 'celsius_to_fahrenheit', description: 'converte', inputSchema: { type: 'object', properties: { celsius: { type: 'number' } }, required: ['celsius'] } }] }),
      'index.mjs': `let raw = ''\nprocess.stdin.on('data', d => { raw += d })\nprocess.stdin.on('end', () => {\n  const { tool, args } = JSON.parse(raw)\n  const tools = { celsiusToFahrenheit: a => a.celsius * 9 / 5 + 32 }\n  if (!tools[tool]) return console.log(JSON.stringify({ error: 'Tool "' + tool + '" não reconhecida' }))\n  console.log(JSON.stringify({ result: tools[tool](args) }))\n})\n`,
      'tests/test.mjs': 'process.exit(0)\n',
    })
    const outcome = await getEngine().installSource(dir, { requestedBy: 'teste' })
    if (outcome.status !== 'installed') throw new Error(outcome.status)
    try {
      expect(outcome.extension.lastTest?.ok).toBe(false)
      expect(outcome.extension.status).toBe('broken')
      expect(outcome.extension.lastTest?.output).toMatch(/celsius_to_fahrenheit/)
    } finally {
      await getEngine().remove(outcome.extension.id)
    }
  })
})

describe('versões', () => {
  it('reverte sozinho uma atualização que falha no teste, aplica uma boa e restaura a anterior', async () => {
    const dir = tmpDir(toolFiles('1.0.0', true))
    const outcome = await getEngine().installSource(dir, { requestedBy: 'teste' })
    if (outcome.status !== 'installed') throw new Error(outcome.status)
    const id = outcome.extension.id
    try {
      write(dir, toolFiles('2.0.0', false))
      const bad = await updateExtension(getEngine().get(id)!, 'teste')
      expect(bad.updated).toBe(false)
      expect(bad.message).toMatch(/falhou/)
      expect(getEngine().get(id)!.version).toBe('1.0.0')
      expect(await getEngine().callTool(id, 'versao', {})).toBe('1.0.0')
      expect(getEngine().history(20, id).some(h => h.action === 'rollback')).toBe(true)

      write(dir, toolFiles('3.0.0', true))
      const good = await updateExtension(getEngine().get(id)!, 'teste')
      expect(good.updated).toBe(true)
      expect(await getEngine().callTool(id, 'versao', {})).toBe('3.0.0')

      const v1 = getEngine().get(id)!.versions.find(v => v.version === '1.0.0')!
      await getEngine().restore(id, v1.dir)
      expect(await getEngine().callTool(id, 'versao', {})).toBe('1.0.0')
    } finally {
      await getEngine().remove(id)
    }
    // Instala, atualiza duas vezes (cada uma roda os testes da skill em processo
    // separado) e restaura: com a suíte inteira em paralelo, 20s não bastam.
  }, 60_000)
})

describe('criação de Skills pelo JARVIS', () => {
  it('a equipe construtora escreve, testa, analisa e registra uma Skill nova', async () => {
    const files = {
      'jarvis-tool.json': JSON.stringify({ name: 'contador-palavras', description: 'Conta palavras de um texto', version: '1.0.0', categories: ['estudos'], script: 'index.mjs', env: [], tools: [{ name: 'contar', description: 'Conta palavras', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }] }),
      'index.mjs': `let raw = ''\nprocess.stdin.on('data', d => { raw += d })\nprocess.stdin.on('end', () => {\n  const { args } = JSON.parse(raw)\n  if (typeof args.texto !== 'string') return console.log(JSON.stringify({ error: 'texto obrigatório' }))\n  console.log(JSON.stringify({ result: args.texto.trim().split(/\\s+/).filter(Boolean).length }))\n})\n`,
      'SKILL.md': '---\nname: contador-palavras\ndescription: Conta palavras\n---\nUse contar com {"texto": "..."}.\n',
      'tests/test.mjs': `import { execFileSync } from 'node:child_process'\nimport assert from 'node:assert/strict'\nconst out = execFileSync(process.execPath, ['index.mjs'], { input: JSON.stringify({ tool: 'contar', args: { texto: 'um dois três' } }) }).toString()\nassert.equal(JSON.parse(out).result, 3)\nconsole.log('ok')\n`,
    }
    const complete: CompleteFn = async (model, messages) => {
      const me = whoAmI(messages)
      if (me.kind === 'planner') return completion(json({ complexity: 'small', summary: 'criar skill', tasks: [{ id: 'a', title: 'Construir', description: 'escrever a skill', role: 'fullstack', dependsOn: [], files: [] }, { id: 'b', title: 'Validar', description: 'rodar testes', role: 'qa', dependsOn: ['a'], files: [] }] }), model)
      if (me.kind === 'report') return completion('ok', model)
      if (me.role === 'Engenheiro Full-stack') {
        if (me.step === 0) return completion(json({ thought: '', actions: Object.entries(files).map(([p, content]) => ({ tool: 'write_file', args: { path: p, content } })) }), model)
        if (me.step === 1) return completion(act('run_command', { command: 'node tests/test.mjs' }), model)
        return completion(act('finish', { summary: 'skill escrita' }), model)
      }
      return completion(act('finish', { summary: 'validada', status: 'done' }), model)
    }
    const log: string[] = []
    const result = await getEngine().create('contar palavras de textos', 'teste', s => log.push(s), { complete, providers: async () => fakeProviders() })
    expect(result.status).toBe('installed')
    if (result.status !== 'installed') return
    try {
      expect(result.extension.source.type).toBe('created')
      expect(result.extension.lastTest?.ok).toBe(true)
      expect(await getEngine().callTool(result.extension.id, 'contar', { texto: 'a b c d' })).toBe('4')
      expect(log.some(l => /Pronta/.test(l))).toBe(true)
    } finally {
      await getEngine().remove(result.extension.id)
    }
  })
})
