import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { removeDir } from '../agents/fsutil'
import { candidateId, githubHeadSha, githubRepoMeta, npmLatest } from './discovery'
import { mcp } from './mcp'
import { detectSetup, missingFields } from './setup'
import { extensionsDir, getExtension, listExtensions, logHistory, quarantineDir, saveExtension, deleteExtension, getSettings } from './registry'
import { download, extractTarGz, nodeBinary, npm, runProcess, sandboxEnv } from './sandbox'
import { levelOf, metadataFindings, scanDirectory } from './scanner'
import type { Candidate, Extension, ExtensionKind, ExtensionSource, Finding, McpEntry, ScanReport, ScriptEntry, ToolDef } from './types'

export interface Analysis {
  kind: ExtensionKind | 'unknown'
  name: string
  description: string
  version: string
  sha?: string
  categories: string[]
  mcp?: McpEntry
  script?: ScriptEntry
  instructions?: string
  skills?: Array<{ name: string; description: string; path: string }>
  tools: ToolDef[]
  dependencies: string[]
  requires?: string
  unsupported?: string
  declaredEnv: string[]
}

export interface Prepared {
  token: string
  candidate: Candidate
  root: string
  analysis: Analysis
  risk: ScanReport
  at: number
}

const prepared = new Map<string, Prepared>()

export function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'extensao'
}

export function parseFrontmatter(raw: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { meta: {} as Record<string, string>, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim())
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return { meta, body: m[2] }
}

// ─── Fetch into quarantine ───────────────────────────────────────────────────

async function fetchSource(source: ExtensionSource, token: string): Promise<{ root: string; sha?: string; version?: string }> {
  const q = path.join(quarantineDir(), token)
  fs.mkdirSync(q, { recursive: true })

  if (source.type === 'github') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source.ref)) throw new Error('Repositório inválido')
    const sha = await githubHeadSha(source.ref).catch(() => undefined)
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const file = path.join(q, 'src.tar.gz')
    await download(`https://api.github.com/repos/${source.ref}/tarball/${sha || ''}`.replace(/\/$/, ''), file, headers)
    const root = await extractTarGz(file, path.join(q, 'x'))
    fs.rmSync(file, { force: true })
    const sub = (source.subPath || '').replace(/\\/g, '/')
    if (sub) {
      // "./a", "a/./b" and "a/b/../c" all resolve before the containment check — no escape via ../
      const joined = path.resolve(root, sub)
      const rel = path.relative(root, joined)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('subPath fora do repositório — instalação recusada')
      }
      return { root: joined, sha }
    }
    return { root, sha }
  }

  if (source.type === 'npm') {
    if (!/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(source.ref)) throw new Error('Pacote npm inválido')
    // The tarball lands in the working directory (q), so no filesystem path goes through the shell
    const r = await npm(['pack', source.ref, '--silent'], q, `pack-${token}`, 180_000)
    if (r.code !== 0) throw new Error(`npm pack falhou: ${(r.stderr || r.stdout).slice(0, 300)}`)
    const tgz = fs.readdirSync(q).find(f => f.endsWith('.tgz'))
    if (!tgz) throw new Error('npm pack não gerou o pacote')
    const root = await extractTarGz(path.join(q, tgz), path.join(q, 'x'))
    fs.rmSync(path.join(q, tgz), { force: true })
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version?: string }
    return { root, version: pkg.version }
  }

  if (source.type === 'local' || source.type === 'created') {
    const abs = path.resolve(source.ref)
    if (!fs.existsSync(abs)) throw new Error(`Pasta não encontrada: ${source.ref}`)
    const dest = path.join(q, 'x')
    fs.cpSync(abs, dest, { recursive: true, filter: src => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src.slice(abs.length)) })
    return { root: dest }
  }

  if (source.type === 'remote-mcp') {
    // Nothing is downloaded: the server runs elsewhere
    return { root: q }
  }

  throw new Error(`Fonte não suportada: ${source.type}`)
}

// ─── Analysis ────────────────────────────────────────────────────────────────

function findSkillFiles(root: string) {
  const found: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 6 || found.length > 400) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, depth + 1)
      else if (/^skill\.md$/i.test(e.name)) found.push(abs)
    }
  }
  walk(root, 0)
  return found
}

const CATEGORY_WORDS: Record<string, RegExp> = {
  desenvolvimento: /code|coding|program|git|debug|test|lint|refactor|developer|typescript|python|terminal|cli\b/i,
  imagem: /image|imagem|photo|design|figma|canva|svg|draw|flux|stable diffusion|dall/i,
  video: /video|vídeo|ffmpeg|remotion|youtube|tiktok|reels|editing|render/i,
  social: /instagram|tiktok|twitter|linkedin|facebook|social|post(ing)?|reels/i,
  estudos: /study|estudo|academic|acad[eê]mic|school|university|faculdade|teams|classroom|moodle|canvas|notion/i,
  pesquisa: /search|research|pesquisa|web|browser|scrap|crawl|fetch|docs|wiki/i,
  automacao: /automat|workflow|zapier|n8n|schedule|browser|playwright|puppeteer|api/i,
  dados: /database|sql|postgres|mysql|sqlite|mongo|supabase|data|csv|excel|sheet/i,
  engenharia: /architect|review|security|audit|devops|docker|kubernetes|ci\b/i,
}

export function categorize(text: string) {
  return Object.entries(CATEGORY_WORDS).filter(([, re]) => re.test(text)).map(([c]) => c)
}

type RawTool = Partial<ToolDef> & { type?: string; parameters?: Record<string, unknown>; function?: Partial<ToolDef> & { parameters?: Record<string, unknown> } }

function normalizeTools(raw: RawTool[]): ToolDef[] {
  return raw.map(t => {
    const fn = t.function || t
    return {
      name: String(fn.name || ''),
      description: String(fn.description || ''),
      inputSchema: (fn.inputSchema || fn.parameters || { type: 'object', properties: {} }) as Record<string, unknown>,
    }
  }).filter(t => /^[A-Za-z0-9_-]{1,64}$/.test(t.name))
}

/** Reads JARVIS, OpenAI-compatible and Claude/plugin manifests with one code path. */
function readToolManifest(root: string): Analysis | null {
  const candidates = ['jarvis-tool.json', 'openai-tool.json', 'openai-tools.json']
  const file = candidates.map(f => path.join(root, f)).find(f => fs.existsSync(f))
  if (!file) return null
  let m: {
    name?: string; description?: string; version?: string; categories?: string[]; script?: string
    tools?: RawTool[]; functions?: RawTool[]; env?: string[]
  }
  try { m = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
  const tools = normalizeTools(m.tools || m.functions || [])
  const label = path.basename(file)
  if (!m.script || !tools.length) {
    return {
      kind: 'unknown', name: m.name || 'extensao', description: m.description || '', version: m.version || '1.0.0',
      categories: [], tools: [], dependencies: [], declaredEnv: m.env || [],
      unsupported: `${label} sem "script" ou ferramentas válidas`,
    }
  }
  const skillMd = fs.existsSync(path.join(root, 'SKILL.md')) ? 'SKILL.md' : undefined
  return {
    kind: 'tool',
    name: m.name || 'extensao',
    description: m.description || '',
    version: m.version || '1.0.0',
    categories: m.categories?.length ? m.categories : categorize(`${m.name || ''} ${m.description || ''}`),
    script: { runtime: 'node', script: m.script },
    tools,
    instructions: skillMd,
    dependencies: [],
    declaredEnv: m.env || [],
  }
}

/** Supports .mcp.json / mcp.json / claude_desktop_config.json shipped by MCP and plugin repos. */
function readMcpConfig(root: string): Analysis | null {
  const file = ['.mcp.json', 'mcp.json', 'claude_desktop_config.json'].map(f => path.join(root, f)).find(f => fs.existsSync(f))
  if (!file) return null
  let servers: Record<string, { command?: string; args?: string[]; url?: string; env?: Record<string, string> }> = {}
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { mcpServers?: typeof servers; servers?: typeof servers }
    servers = data.mcpServers || data.servers || {}
  } catch { return null }
  const entry = Object.entries(servers)[0]
  if (!entry) return null
  const [name, s] = entry
  const env = Object.keys(s.env || {})
  const base: Analysis = {
    kind: 'mcp', name, description: `Servidor MCP configurado em ${path.basename(file)}`, version: '1.0.0',
    categories: categorize(`${name} mcp`), tools: [], dependencies: [], declaredEnv: env,
  }
  if (s.url) return { ...base, mcp: { transport: 'http', url: s.url } }
  if (!s.command) return { ...base, unsupported: 'Configuração MCP sem comando nem URL' }
  const command = path.basename(s.command).replace(/\.exe$/i, '')
  if (command === 'node') {
    const args = (s.args || []).map(a => (a.startsWith('./') || a.startsWith('.\\') ? a : a))
    return { ...base, mcp: { transport: 'stdio', command: 'node', args } }
  }
  if (command === 'npx' || command === 'uvx' || command === 'python' || command === 'python3') {
    return { ...base, requires: command === 'npx' ? undefined : 'Python 3', unsupported: `Depende de "${command}" e baixa código na execução; instale a versão publicada no npm ou um pacote JARVIS auditável` }
  }
  return { ...base, unsupported: `Comando MCP não suportado: ${command}` }
}

const COMMON_PLUGIN_MANIFESTS = ['.claude-plugin/plugin.json', 'plugin.json']

/** Anthropic/Claude plugin manifests expose commands as markdown instruction files. */
function analyzePlugin(root: string, candidate: Candidate): Analysis | null {
  const file = COMMON_PLUGIN_MANIFESTS.map(f => path.join(root, f)).find(f => fs.existsSync(f))
  if (!file) return null
  let meta: { name?: string; description?: string; version?: string; skills?: unknown; commands?: unknown } = {}
  try { meta = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
  const found: string[] = []
  const walk = (d: string, depth = 0) => {
    if (depth > 5 || found.length > 200) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(abs, depth + 1) }
      else if (/\.md$/i.test(e.name)) found.push(abs)
    }
  }
  for (const dir of ['commands', 'skills', 'agents']) {
    const abs = path.join(root, dir)
    if (fs.existsSync(abs)) walk(abs)
  }
  const list = found.map(f => {
    const { meta: fm, body } = parseFrontmatter(fs.readFileSync(f, 'utf-8'))
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
    return { name: fm.name || heading || path.basename(f, '.md'), description: fm.description || body.slice(0, 160).replace(/\s+/g, ' '), path: path.relative(root, f).split(path.sep).join('/') }
  })
  if (!list.length) return null
  const single = list.length === 1
  return {
    kind: 'skill',
    name: meta.name || (single ? list[0].name : candidate.name),
    description: meta.description || (single ? list[0].description : `${list.length} comandos do plugin`),
    version: meta.version || '1.0.0',
    categories: categorize(`${meta.name || ''} ${meta.description || ''} ${list.map(s => s.name).join(' ')}`),
    tools: [], dependencies: [], declaredEnv: [],
    instructions: single ? list[0].path : undefined,
    skills: single ? undefined : list,
  }
}

export function analyze(root: string, candidate: Candidate): Analysis {
  const base: Analysis = { kind: 'unknown', name: candidate.name, description: candidate.description, version: '1.0.0', categories: [], tools: [], dependencies: [], declaredEnv: [] }

  if (candidate.source.type === 'remote-mcp') {
    return { ...base, kind: 'mcp', mcp: { transport: 'http', url: candidate.source.ref }, version: 'remoto', categories: categorize(`${candidate.name} ${candidate.description}`) }
  }

  // JARVIS tool manifest (also produced by the skill builder) and OpenAI-compatible function files
  const manifest = readToolManifest(root)
  if (manifest) return { ...manifest, name: manifest.name || base.name, description: manifest.description || base.description }

  const mcpConfig = readMcpConfig(root)
  if (mcpConfig) return mcpConfig

  const plugin = analyzePlugin(root, candidate)
  if (plugin && !findSkillFiles(root).length) return plugin

  const pkgFile = path.join(root, 'package.json')
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8')) as { name?: string; version?: string; description?: string; bin?: string | Record<string, string>; main?: string; dependencies?: Record<string, string>; keywords?: string[]; workspaces?: unknown }
    const deps = Object.keys(pkg.dependencies || {})
    const isMcp = deps.some(d => d.startsWith('@modelcontextprotocol/')) || (pkg.keywords || []).some(k => /mcp/i.test(k)) || /mcp/i.test(pkg.name || '')
    if (isMcp && !pkg.workspaces) {
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin ? Object.values(pkg.bin)[0] : pkg.main
      const entry = bin ? path.join(root, bin) : ''
      if (!entry || !fs.existsSync(entry)) {
        return { ...base, kind: 'mcp', name: pkg.name || base.name, unsupported: 'O código precisa ser compilado (não há arquivo executável publicado). Prefira a versão do npm.' }
      }
      return {
        ...base,
        kind: 'mcp',
        name: pkg.name || base.name,
        description: pkg.description || base.description,
        version: pkg.version || '0.0.0',
        categories: categorize(`${pkg.name} ${pkg.description} ${(pkg.keywords || []).join(' ')}`),
        mcp: { transport: 'stdio', command: 'node', args: ['./' + path.relative(root, entry).split(path.sep).join('/')] },
        dependencies: deps,
      }
    }
  }

  if (fs.existsSync(path.join(root, 'pyproject.toml')) && /mcp/i.test(fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf-8'))) {
    return { ...base, kind: 'mcp', requires: 'Python 3 (não instalado neste PC)', unsupported: 'Servidor MCP em Python: instale o Python 3 para usar' }
  }

  const skills = findSkillFiles(root)
  if (skills.length) {
    const list = skills.map(f => {
      const { meta } = parseFrontmatter(fs.readFileSync(f, 'utf-8'))
      return { name: meta.name || path.basename(path.dirname(f)), description: meta.description || '', path: path.relative(root, f).split(path.sep).join('/') }
    })
    const single = list.length === 1
    return {
      ...base,
      kind: 'skill',
      name: single ? list[0].name : base.name,
      description: single ? list[0].description || base.description : `${base.description} (${list.length} skills)`.trim(),
      categories: categorize(`${base.name} ${base.description} ${list.map(s => `${s.name} ${s.description}`).join(' ')}`),
      instructions: single ? list[0].path : undefined,
      skills: single ? undefined : list,
    }
  }

  return { ...base, unsupported: 'Não encontrei SKILL.md, servidor MCP ou jarvis-tool.json neste pacote' }
}

async function dependencyAudit(root: string, token: string): Promise<Finding[]> {
  if (!fs.existsSync(path.join(root, 'package.json'))) return []
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> }
  if (!Object.keys(pkg.dependencies || {}).length) return []
  const lock = await npm(['install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-fund', '--no-audit'], root, `audit-${token}`, 240_000)
  if (lock.code !== 0) return [{ severity: 'medium', rule: 'deps-unresolved', message: 'Não consegui resolver as dependências para auditoria' }]
  const audit = await npm(['audit', '--omit=dev', '--json'], root, `audit-${token}`, 120_000)
  try {
    const v = (JSON.parse(audit.stdout) as { metadata?: { vulnerabilities?: Record<string, number> } }).metadata?.vulnerabilities || {}
    const out: Finding[] = []
    if (v.critical) out.push({ severity: 'high', rule: 'vuln-critical', message: `${v.critical} dependência(s) com vulnerabilidade CRÍTICA conhecida` })
    if (v.high) out.push({ severity: 'medium', rule: 'vuln-high', message: `${v.high} dependência(s) com vulnerabilidade alta conhecida` })
    if (v.moderate) out.push({ severity: 'info', rule: 'vuln-moderate', message: `${v.moderate} vulnerabilidade(s) moderada(s) em dependências` })
    return out
  } catch {
    return []
  } finally {
    fs.rmSync(path.join(root, 'package-lock.json'), { force: true })
  }
}

/** Downloads into quarantine, analyses and scans. Nothing from the package runs. */
export async function prepare(candidate: Candidate): Promise<Prepared> {
  const token = uuidv4()
  let source = candidate.source
  let fetched = await fetchSource(source, token)
  let analysis = analyze(fetched.root, candidate)

  // GitHub MCP repos usually publish a compiled build to npm: use it instead of building from source
  if (analysis.unsupported && source.type === 'github' && analysis.kind === 'mcp' && analysis.name.length && !analysis.name.includes(' ')) {
    try {
      await npmLatest(analysis.name)
      source = { type: 'npm', ref: analysis.name, url: candidate.source.url }
      fetched = await fetchSource(source, `${token}-npm`)
      analysis = analyze(fetched.root, { ...candidate, source })
      candidate = { ...candidate, source, id: candidateId(source) }
    } catch {}
  }

  let meta: Parameters<typeof metadataFindings>[0] = {}
  if (source.type === 'github') meta = await githubRepoMeta(source.ref).catch(() => ({}))
  if (source.type === 'npm') {
    const l = await npmLatest(source.ref.replace(/@[\w.^~-]+$/, '')).catch(() => null)
    meta = { license: l?.license, stars: undefined }
  }

  const scan = source.type === 'remote-mcp'
    ? { level: 'low' as const, findings: [], inferred: { network: true, shell: false, fsWrite: false, envVars: [] }, files: 0, bytes: 0, scannedAt: Date.now() }
    : scanDirectory(fetched.root)
  const findings = [...scan.findings, ...metadataFindings(meta)]
  if (source.type === 'remote-mcp') findings.push({ severity: 'medium', rule: 'remote', message: 'Servidor remoto: os dados enviados às ferramentas saem do seu computador' })
  if (analysis.kind !== 'skill' && source.type !== 'remote-mcp') findings.push(...await dependencyAudit(fetched.root, token))
  const risk: ScanReport = { ...scan, findings, level: levelOf(findings) }

  const p: Prepared = { token, candidate, root: fetched.root, analysis: { ...analysis, sha: fetched.sha, version: fetched.version || (fetched.sha ? fetched.sha.slice(0, 7) : analysis.version) }, risk, at: Date.now() }
  prepared.set(token, p)
  logHistory('scan', risk.level !== 'critical', `Análise de ${candidate.name}: risco ${risk.level}, ${risk.findings.filter(f => f.severity !== 'info').length} alerta(s)`)
  return p
}

export function getPrepared(token: string) {
  return prepared.get(token)
}

export function discardPrepared(token: string) {
  const p = prepared.get(token)
  prepared.delete(token)
  if (p) removeDir(path.join(quarantineDir(), token))
}

// ─── Policy ──────────────────────────────────────────────────────────────────

export type Decision = { action: 'install' } | { action: 'approve'; reason: string } | { action: 'block'; reason: string }

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i

export function decide(p: Prepared): Decision {
  if (p.analysis.unsupported) return { action: 'block', reason: p.analysis.unsupported }
  if (p.risk.level === 'critical') return { action: 'block', reason: `Comportamento perigoso detectado: ${p.risk.findings.filter(f => f.severity === 'critical').map(f => f.message).join('; ')}` }
  const reasons: string[] = []
  if (p.risk.level === 'high' || p.risk.level === 'medium') reasons.push(`risco ${p.risk.level === 'high' ? 'alto' : 'médio'}: ${p.risk.findings.filter(f => f.severity === 'high' || f.severity === 'medium').map(f => f.message).join('; ')}`)
  const creds = [...new Set([...p.analysis.declaredEnv, ...p.risk.inferred.envVars])].filter(n => SECRET.test(n))
  if (creds.length) reasons.push(`precisa de credenciais: ${creds.join(', ')}`)
  if (p.candidate.source.type === 'remote-mcp') reasons.push('servidor remoto (dados saem do computador)')
  if (getSettings().autonomy === 'manual') reasons.push('modo manual: toda instalação precisa de aprovação')
  return reasons.length ? { action: 'approve', reason: reasons.join(' · ') } : { action: 'install' }
}

// ─── Tool argument validation ────────────────────────────────────────────────

type Schema = { type?: string; properties?: Record<string, { type?: string; items?: Schema }>; required?: string[] }

/**
 * Coerces the JSON values models frequently send as strings and checks the declared
 * input schema before third-party code runs. Additional properties are allowed.
 */
export function prepareToolArgs(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  const schema = (tool.inputSchema || {}) as Schema
  const out: Record<string, unknown> = { ...args }
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    const value = out[key]
    if (value === undefined || value === null) continue
    if (prop.type === 'number' || prop.type === 'integer') {
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) out[key] = Number(value)
    } else if (prop.type === 'boolean') {
      if (value === 'true' || value === '1') out[key] = true
      if (value === 'false' || value === '0') out[key] = false
    } else if (prop.type === 'array' && typeof value === 'string') {
      try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) out[key] = parsed } catch {}
    } else if (prop.type === 'object' && typeof value === 'string') {
      try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out[key] = parsed } catch {}
    }
  }

  const missing = (schema.required || []).filter(k => out[k] === undefined || out[k] === null || out[k] === '')
  if (missing.length) throw new Error(`Faltam parâmetros obrigatórios em "${tool.name}": ${missing.join(', ')}`)

  const wrong: string[] = []
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    const value = out[key]
    if (value === undefined || value === null || !prop.type) continue
    const ok =
      prop.type === 'string' ? typeof value === 'string'
        : prop.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : prop.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
            : prop.type === 'boolean' ? typeof value === 'boolean'
              : prop.type === 'array' ? Array.isArray(value)
                : prop.type === 'object' ? typeof value === 'object' && !Array.isArray(value)
                  : true
    if (!ok) wrong.push(`${key} deve ser ${prop.type}`)
  }
  if (wrong.length) throw new Error(`Parâmetros inválidos em "${tool.name}": ${wrong.join('; ')}`)
  return out
}

// ─── Install / test ──────────────────────────────────────────────────────────

function uniqueId(name: string) {
  const ids = new Set(listExtensions().map(e => e.id))
  const base = slug(name)
  let id = base
  for (let i = 2; ids.has(id); i++) id = `${base}-${i}`
  return id
}

async function materialize(p: Prepared, extId: string): Promise<string> {
  const dir = path.join(extensionsDir(), extId, `${slug(p.analysis.version)}-${Date.now()}`)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  if (p.candidate.source.type === 'remote-mcp') fs.mkdirSync(dir, { recursive: true })
  else fs.cpSync(p.root, dir, { recursive: true })
  if (p.analysis.kind !== 'skill' && fs.existsSync(path.join(dir, 'package.json')) && p.analysis.dependencies.length) {
    const r = await npm(['install', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', '--no-package-lock'], dir, extId, 420_000)
    if (r.code !== 0) throw new Error(`Falha ao instalar dependências: ${(r.stderr || r.stdout).slice(-400)}`)
  }
  return dir
}

function buildExtension(p: Prepared, id: string, dir: string, grantEnv: string[], existing?: Extension): Extension {
  const a = p.analysis
  const now = Date.now()
  return {
    id,
    name: a.name,
    kind: a.kind as ExtensionKind,
    description: a.description,
    categories: a.categories,
    source: p.candidate.source,
    version: a.version,
    sha: a.sha,
    dir,
    versions: [...(existing?.versions || []), { version: a.version, sha: a.sha, dir, installedAt: now }],
    enabled: existing?.enabled ?? true,
    status: 'ok',
    mcp: a.mcp,
    script: a.script,
    instructions: a.instructions,
    skills: a.skills,
    requires: a.requires,
    tools: a.tools,
    dependencies: a.dependencies,
    permissions: existing?.permissions
      ? { ...existing.permissions, env: [...new Set([...existing.permissions.env, ...grantEnv])] }
      : { network: p.risk.inferred.network, shell: p.risk.inferred.shell, fsWrite: p.risk.inferred.fsWrite, env: grantEnv, agents: ['*'] },
    risk: p.risk,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
  }
}

/** Minimal valid arguments for a JSON Schema, used to probe that a declared tool exists. */
export function sampleArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties || {}) as Record<string, { type?: string | string[]; enum?: unknown[]; default?: unknown; minimum?: number }>
  const out: Record<string, unknown> = {}
  for (const [k, p] of Object.entries(props)) {
    if (p.default !== undefined) { out[k] = p.default; continue }
    if (p.enum?.length) { out[k] = p.enum[0]; continue }
    const type = Array.isArray(p.type) ? p.type[0] : p.type
    out[k] = type === 'number' || type === 'integer' ? (p.minimum ?? 1) : type === 'boolean' ? true : type === 'array' ? [] : type === 'object' ? {} : 'teste'
  }
  return out
}

const UNKNOWN_TOOL = /(n[aã]o (reconhecid|encontrad|existe|implementad)|desconhecid|unknown (tool|action|command)|not (recognized|found|implemented|supported)|invalid tool|no such tool)/i

/**
 * Calls each declared tool once with schema-shaped sample input. A validation error is fine
 * (the tool exists); "unknown tool", a crash or no JSON answer means the manifest lies.
 */
async function contractTest(ext: Extension): Promise<{ ok: boolean; output: string }> {
  const node = nodeBinary()
  const missing: string[] = []
  for (const tool of ext.tools) {
    const r = await runProcess(node.command, [path.join(ext.dir, ext.script!.script)], {
      cwd: ext.dir,
      env: { ...sandboxEnv(ext.id, ext.permissions.env), ...node.env },
      timeoutMs: 30_000,
      input: JSON.stringify({ tool: tool.name, args: sampleArgs(tool.inputSchema) }),
    })
    const line = r.stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
    let error = ''
    try { error = line ? String((JSON.parse(line) as { error?: unknown }).error || '') : 'sem resposta JSON' } catch { error = 'resposta JSON inválida' }
    if (r.timedOut) missing.push(`${tool.name}: excedeu 30 s`)
    else if (!line) missing.push(`${tool.name}: não respondeu JSON (código ${r.code}) ${r.stderr.slice(0, 160)}`)
    else if (UNKNOWN_TOOL.test(error)) missing.push(`${tool.name}: ${error.slice(0, 200)}`)
  }
  return missing.length
    ? { ok: false, output: `Ferramentas declaradas no jarvis-tool.json que o script não implementa (os nomes em "tools[].name" devem ser exatamente os tratados no index.mjs):\n- ${missing.join('\n- ')}` }
    : { ok: true, output: `Contrato verificado: ${ext.tools.length} ferramenta(s) respondem` }
}

/** Functional test per kind. MCP servers are started and asked for their tools. */
export async function testExtension(ext: Extension): Promise<{ ok: boolean; output: string; tools?: ToolDef[] }> {
  try {
    if (ext.requires) return { ok: false, output: `Requer ${ext.requires}` }
    if (ext.kind === 'skill') {
      const files = ext.instructions ? [ext.instructions] : (ext.skills || []).map(s => s.path)
      if (!files.length) return { ok: false, output: 'Nenhum SKILL.md' }
      const missing = files.filter(f => !fs.existsSync(path.join(ext.dir, f)))
      if (missing.length) return { ok: false, output: `Arquivos ausentes: ${missing.slice(0, 5).join(', ')}` }
      // Templates, assets, examples and fixtures are copied or read, never executed (often deliberately partial code)
      const NOT_RUN = /(^|[\\/])(node_modules|expected_outputs?|fixtures?|__fixtures__|examples?|samples?|templates?|assets|testdata|test-data|__snapshots__|snapshots?)([\\/]|$)/i
      const scripts = fs.readdirSync(ext.dir, { recursive: true }).map(String).filter(f => /\.(m?js|cjs)$/.test(f) && !NOT_RUN.test(f)).slice(0, 20)
      const node = nodeBinary()
      for (const s of scripts) {
        const r = await runProcess(node.command, ['--check', path.join(ext.dir, s)], { cwd: ext.dir, env: { ...sandboxEnv(ext.id), ...node.env }, timeoutMs: 20_000 })
        if (r.code !== 0) return { ok: false, output: `Erro de sintaxe em ${s}: ${r.stderr.slice(0, 300)}` }
      }
      return { ok: true, output: `${files.length} instrução(ões) válidas${scripts.length ? `, ${scripts.length} script(s) sem erro de sintaxe` : ''}` }
    }
    if (ext.kind === 'mcp') {
      await mcp.close(ext.id)
      const tools = await mcp.listTools(ext)
      return { ok: tools.length > 0, output: `Servidor respondeu com ${tools.length} ferramenta(s): ${tools.slice(0, 12).map(t => t.name).join(', ')}`, tools }
    }
    if (ext.kind === 'tool') {
      const node = nodeBinary()
      const check = await runProcess(node.command, ['--check', path.join(ext.dir, ext.script!.script)], { cwd: ext.dir, env: { ...sandboxEnv(ext.id), ...node.env }, timeoutMs: 20_000 })
      if (check.code !== 0) return { ok: false, output: `Erro de sintaxe: ${check.stderr.slice(0, 500)}` }
      // Contract: every tool the manifest declares must actually be handled by the script
      const contract = await contractTest(ext)
      if (!contract.ok) return contract
      const testFile = ['tests/test.mjs', 'test.mjs', 'tests/test.js'].find(f => fs.existsSync(path.join(ext.dir, f)))
      if (testFile) {
        const r = await runProcess(node.command, [path.join(ext.dir, testFile)], { cwd: ext.dir, env: { ...sandboxEnv(ext.id, ext.permissions.env), ...node.env }, timeoutMs: 120_000 })
        return { ok: r.code === 0, output: `${contract.output}\n${testFile} → código ${r.code}\n${(r.stdout + r.stderr).slice(-1500)}` }
      }
      return { ok: true, output: `${contract.output} (sem testes próprios)` }
    }
    return { ok: false, output: 'Tipo desconhecido' }
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  }
}

async function finishTest(ext: Extension) {
  const t = await testExtension(ext)
  ext.lastTest = { ok: t.ok, at: Date.now(), output: t.output.slice(0, 3000) }
  if (t.tools) ext.tools = t.tools
  if (t.ok) {
    if (ext.status === 'broken' || ext.status === 'needs-setup') { ext.status = 'ok'; ext.statusReason = undefined }
    return t
  }
  // A server that stops because it lacks a key/argument isn't broken: it needs setup (and says what)
  const fields = ext.kind === 'mcp' ? detectSetup(ext, t.output) : []
  if (fields.length) ext.setup = { fields, values: ext.setup?.values || {}, configuredAt: ext.setup?.configuredAt }
  const missing = ext.setup ? missingFields(ext) : []
  if (ext.status === 'disabled') return t
  if (ext.requires || missing.length) {
    ext.status = 'needs-setup'
    ext.statusReason = missing.length ? `Falta configurar: ${missing.map(f => f.label).join('; ')}` : `Requer ${ext.requires}`
  } else {
    ext.status = 'broken'
    ext.statusReason = t.output.slice(0, 300)
  }
  return t
}

export async function installPrepared(p: Prepared, opts: { grantEnv?: string[]; requestedBy: string }): Promise<Extension> {
  const existing = listExtensions().find(e => candidateId(e.source) === p.candidate.id)
  if (existing) throw new Error(`${existing.name} já está instalada (use atualizar)`)
  const id = uniqueId(p.analysis.name)
  let dir = ''
  try {
    dir = await materialize(p, id)
    const ext = buildExtension(p, id, dir, opts.grantEnv || [])
    const t = await finishTest(ext)
    saveExtension(ext)
    logHistory('install', t.ok, `Instalada (${ext.kind}, v${ext.version}) por ${opts.requestedBy}. Teste: ${t.output.slice(0, 300)}`, ext)
    return ext
  } catch (e) {
    if (dir) removeDir(path.join(extensionsDir(), id))
    logHistory('error', false, `Falha ao instalar ${p.analysis.name}: ${(e as Error).message}`)
    throw e
  } finally {
    discardPrepared(p.token)
  }
}

/** Installs the new version beside the current one; if its test fails the previous version stays active. */
export async function updateExtension(ext: Extension, requestedBy: string): Promise<{ updated: boolean; message: string }> {
  const candidate: Candidate = { id: candidateId(ext.source), name: ext.name, description: ext.description, kind: ext.kind, source: ext.source, installed: true, score: 0 }
  const p = await prepare(candidate)
  try {
    const d = decide(p)
    if (d.action === 'block') throw new Error(d.reason)
    const before = ext.risk.level
    // Riskier than what the user accepted before: ask again
    if (d.action === 'approve' && levelRank(p.risk.level) > levelRank(before)) throw new Error(`A nova versão é mais arriscada (${p.risk.level}): ${d.reason}`)
    if (p.analysis.sha && p.analysis.sha === ext.sha || p.analysis.version === ext.version && ext.source.type === 'npm') {
      return { updated: false, message: 'Já está na versão mais recente' }
    }
    const previous = { dir: ext.dir, version: ext.version, sha: ext.sha, tools: ext.tools }
    const dir = await materialize(p, ext.id)
    const next = buildExtension(p, ext.id, dir, [], ext)
    await mcp.close(ext.id)
    const t = await finishTest(next)
    if (!t.ok) {
      // Automatic rollback: the old version stays active, the failed one is discarded
      removeDir(dir)
      Object.assign(ext, { dir: previous.dir, version: previous.version, sha: previous.sha, tools: previous.tools })
      saveExtension(ext)
      logHistory('rollback', true, `Atualização para ${p.analysis.version} falhou no teste e foi revertida: ${t.output.slice(0, 300)}`, ext)
      return { updated: false, message: `Nova versão falhou no teste; mantida a ${previous.version}` }
    }
    next.updateAvailable = undefined
    saveExtension(next)
    logHistory('update', true, `${previous.version} → ${next.version} (${requestedBy}). Backup da versão anterior mantido.`, next)
    return { updated: true, message: `Atualizada para ${next.version}` }
  } finally {
    discardPrepared(p.token)
  }
}

const levelRank = (l: string) => ['low', 'medium', 'high', 'critical'].indexOf(l)

export async function restoreVersion(ext: Extension, dir: string) {
  const v = ext.versions.find(x => x.dir === dir)
  if (!v || !fs.existsSync(v.dir)) throw new Error('Versão não encontrada no backup')
  await mcp.close(ext.id)
  const previous = {
    dir: ext.dir, version: ext.version, sha: ext.sha, tools: ext.tools,
    status: ext.status, statusReason: ext.statusReason, lastTest: ext.lastTest,
  }
  ext.dir = v.dir
  ext.version = v.version
  ext.sha = v.sha
  const test = await finishTest(ext)
  if (!test.ok) {
    // Restore the in-memory pointer too; do not persist an unverified version as active.
    Object.assign(ext, previous)
    saveExtension(ext)
    logHistory('restore', false, `Restauração para ${v.version} falhou no teste; versão anterior ${previous.version} preservada: ${test.output.slice(0, 300)}`, ext)
    throw new Error(`A versão restaurada falhou na validação; mantida ${previous.version}: ${test.output.slice(0, 300)}`)
  }
  saveExtension(ext)
  logHistory('restore', true, `Restaurada a versão ${v.version} (estava ${previous.version})`, ext)
  return ext
}

export async function repairExtension(ext: Extension) {
  await mcp.close(ext.id)
  if (fs.existsSync(path.join(ext.dir, 'package.json')) && ext.dependencies.length) {
    removeDir(path.join(ext.dir, 'node_modules'))
    const r = await npm(['install', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', '--no-package-lock'], ext.dir, ext.id, 420_000)
    if (r.code !== 0) throw new Error(`Reinstalação das dependências falhou: ${(r.stderr || r.stdout).slice(-300)}`)
  }
  const t = await finishTest(ext)
  saveExtension(ext)
  logHistory('repair', t.ok, t.output.slice(0, 400), ext)
  return t
}

export async function retest(ext: Extension) {
  const t = await finishTest(ext)
  saveExtension(ext)
  logHistory('test', t.ok, t.output.slice(0, 400), ext)
  return t
}

export async function removeExtension(id: string) {
  const ext = getExtension(id)
  if (!ext) throw new Error('Extensão não encontrada')
  await mcp.close(id)
  removeDir(path.join(extensionsDir(), id))
  deleteExtension(id)
  logHistory('remove', true, 'Removida (arquivos e versões apagados)', ext)
}

/** Duplicates and clashes: same source twice, same tool name in two enabled extensions, same skill name. */
export function findConflicts() {
  const exts = listExtensions()
  const out: Array<{ type: 'tool-name' | 'same-source' | 'skill-name'; message: string; extensions: string[] }> = []
  const bySource = new Map<string, string[]>()
  const byTool = new Map<string, string[]>()
  const bySkill = new Map<string, string[]>()
  for (const e of exts) {
    bySource.set(candidateId(e.source), [...(bySource.get(candidateId(e.source)) || []), e.id])
    if (e.enabled) for (const t of e.tools) byTool.set(t.name, [...(byTool.get(t.name) || []), e.id])
    if (e.kind === 'skill') bySkill.set(e.name.toLowerCase(), [...(bySkill.get(e.name.toLowerCase()) || []), e.id])
  }
  for (const [k, ids] of bySource) if (ids.length > 1) out.push({ type: 'same-source', message: `Mesma origem instalada ${ids.length} vezes (${k})`, extensions: ids })
  for (const [k, ids] of byTool) if (ids.length > 1) out.push({ type: 'tool-name', message: `Ferramenta "${k}" existe em mais de uma extensão ativa`, extensions: ids })
  for (const [k, ids] of bySkill) if (ids.length > 1) out.push({ type: 'skill-name', message: `Skill "${k}" duplicada`, extensions: ids })
  return out
}

export async function refreshUpdateFlags(exts: Extension[], check: (e: Extension) => Promise<{ version: string; sha?: string } | null>) {
  let found = 0
  for (const e of exts) {
    try {
      const u = await check(e)
      e.updateAvailable = u ? { ...u, checkedAt: Date.now() } : undefined
      if (u) found++
      saveExtension(e)
    } catch {}
  }
  return found
}
