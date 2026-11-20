import path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { nodeBinary, sandboxEnv } from './sandbox'
import { redact } from './registry'
import { launchConfig } from './setup'
import type { Extension, ToolDef } from './types'

interface Live {
  client: Client
  close: () => Promise<void>
  lastUsed: number
}

/** One MCP connection per extension, shared by every agent; idle servers are shut down. */
class McpManager {
  private live = new Map<string, Live>()
  private connecting = new Map<string, Promise<Live>>()
  private reaper: ReturnType<typeof setInterval>

  constructor() {
    this.reaper = setInterval(() => {
      for (const [id, l] of this.live) if (Date.now() - l.lastUsed > 5 * 60_000) void this.close(id)
    }, 60_000)
    this.reaper.unref?.()
  }

  private async connect(ext: Extension): Promise<Live> {
    if (!ext.mcp) throw new Error(`${ext.name} não é um servidor MCP`)
    const client = new Client({ name: 'jarvis', version: '1.0.0' })
    const cfg = launchConfig(ext)
    if (ext.mcp.transport === 'http') {
      const headers: Record<string, string> = { ...cfg.headers }
      // A granted credential named *TOKEN/*KEY is sent as bearer auth to the remote server
      const cred = ext.permissions.env.find(n => process.env[n])
      if (cred && !headers.Authorization) headers.Authorization = `Bearer ${process.env[cred]}`
      const transport = new StreamableHTTPClientTransport(new URL(ext.mcp.url!), { requestInit: { headers } })
      await client.connect(transport)
      return { client, close: () => client.close(), lastUsed: Date.now() }
    }
    const node = nodeBinary()
    const command = ext.mcp.command === 'node' ? node.command : ext.mcp.command!
    const args = [...(ext.mcp.args || []).map(a => (a.startsWith('./') || a.startsWith('.\\') ? path.join(ext.dir, a) : a)), ...cfg.args]
    const transport = new StdioClientTransport({
      command,
      args,
      cwd: ext.dir,
      env: { ...sandboxEnv(ext.id, ext.permissions.env), ...cfg.env, ...(ext.mcp.command === 'node' ? node.env : {}) },
      stderr: 'pipe',
    })
    // The server's own words ("Usage: …", "X_API_KEY is required") are the only useful part of a failed start
    let stderr = ''
    transport.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-4000) })
    try {
      await client.connect(transport)
    } catch (e) {
      await new Promise(r => setTimeout(r, 300))
      const said = redact(stderr.trim()).split(/\r?\n/).filter(Boolean).slice(-8).join('\n')
      throw new Error(`${(e as Error).message}${said ? `\nO servidor disse:\n${said}` : ''}`)
    }
    return { client, close: () => client.close(), lastUsed: Date.now() }
  }

  async get(ext: Extension): Promise<Live> {
    const l = this.live.get(ext.id)
    if (l) { l.lastUsed = Date.now(); return l }
    let p = this.connecting.get(ext.id)
    if (!p) {
      p = withTimeout(this.connect(ext), 45_000, `${ext.name} não respondeu ao iniciar`)
      this.connecting.set(ext.id, p)
    }
    try {
      const live = await p
      this.live.set(ext.id, live)
      return live
    } finally {
      this.connecting.delete(ext.id)
    }
  }

  async listTools(ext: Extension): Promise<ToolDef[]> {
    const { client } = await this.get(ext)
    const res = await withTimeout(client.listTools(), 30_000, 'tools/list sem resposta')
    return res.tools.map(t => ({ name: t.name, description: t.description || '', inputSchema: (t.inputSchema || { type: 'object' }) as Record<string, unknown> }))
  }

  async callTool(ext: Extension, name: string, args: Record<string, unknown>): Promise<string> {
    const { client } = await this.get(ext)
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })
    const content = (res.content || []) as Array<{ type: string; text?: string; mimeType?: string; uri?: string; resource?: { uri?: string; text?: string } }>
    const text = content.map(c => {
      if (c.type === 'text') return c.text || ''
      if (c.type === 'image') return `[imagem ${c.mimeType || ''} retornada]`
      if (c.type === 'resource') return c.resource?.text || `[recurso ${c.resource?.uri || ''}]`
      if (c.type === 'resource_link') return `[link ${c.uri || ''}]`
      return `[${c.type}]`
    }).join('\n')
    const out = redact(text).slice(0, 20_000)
    if (res.isError) throw new Error(out || 'A ferramenta MCP retornou erro')
    return out || '(sem conteúdo)'
  }

  async close(id: string) {
    const l = this.live.get(id)
    this.live.delete(id)
    if (l) try { await l.close() } catch {}
  }

  async closeAll() {
    await Promise.all([...this.live.keys()].map(id => this.close(id)))
  }

  running() {
    return [...this.live.keys()]
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

const g = globalThis as unknown as { __jarvisMcp?: McpManager }
export const mcp = (g.__jarvisMcp ??= new McpManager())
