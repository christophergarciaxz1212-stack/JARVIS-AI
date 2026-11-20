import fs from 'fs'
import path from 'path'
import { listExtensions } from './registry'
import type { Candidate, Extension, ExtensionKind, ExtensionSource } from './types'

const UA = 'jarvis-skill-engine'
const cache = new Map<string, { at: number; data: Candidate[] }>()

function ghHeaders() {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

async function getJson<T>(url: string, headers: Record<string, string> = { 'User-Agent': UA }): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu ${res.status}`)
  return res.json() as Promise<T>
}

export const candidateId = (s: ExtensionSource) => `${s.type}:${s.ref}${s.subPath ? `#${s.subPath}` : ''}`

function installedIds(exts: Extension[]) {
  return new Set(exts.map(e => candidateId(e.source)))
}

function relevance(query: string, text: string) {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2)
  if (!terms.length) return 1
  const t = text.toLowerCase()
  return terms.filter(term => t.includes(term)).length / terms.length
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

interface GhRepo { full_name: string; name: string; description: string | null; stargazers_count: number; html_url: string; topics?: string[]; pushed_at: string; created_at: string; archived: boolean; license?: { spdx_id?: string } | null; default_branch: string }

const TOPICS: Record<'skill' | 'mcp' | 'tool', string[]> = {
  skill: ['agent-skills', 'claude-skills'],
  mcp: ['mcp-server', 'model-context-protocol'],
  // Repositories that ship OpenAI-compatible function definitions or JARVIS tool manifests
  tool: ['agent-tools', 'openai-tools'],
}

async function searchGithub(query: string, kind: 'skill' | 'mcp' | 'tool'): Promise<Candidate[]> {
  const topics = TOPICS[kind]
  const results = await Promise.allSettled(topics.map(topic =>
    getJson<{ items?: GhRepo[] }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} topic:${topic}`)}&sort=stars&order=desc&per_page=15`, ghHeaders()),
  ))
  const repos = new Map<string, GhRepo>()
  for (const r of results) if (r.status === 'fulfilled') for (const item of r.value.items || []) repos.set(item.full_name, item)
  if (!repos.size && results.every(r => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason
  return [...repos.values()].map(r => ({
    id: candidateId({ type: 'github', ref: r.full_name }),
    name: r.name,
    description: r.description || '',
    kind: kind as ExtensionKind,
    source: { type: 'github', ref: r.full_name, url: r.html_url },
    stars: r.stargazers_count,
    license: r.license?.spdx_id || undefined,
    updatedAt: r.pushed_at,
    archived: r.archived,
    homepage: r.html_url,
    installed: false,
    score: 0,
  }))
}

export async function githubRepoMeta(fullName: string) {
  const r = await getJson<GhRepo>(`https://api.github.com/repos/${fullName}`, ghHeaders())
  return { stars: r.stargazers_count, archived: r.archived, license: r.license?.spdx_id || undefined, createdAt: r.created_at, updatedAt: r.pushed_at, defaultBranch: r.default_branch, description: r.description || '' }
}

export async function githubHeadSha(fullName: string, branch?: string) {
  const ref = branch || (await githubRepoMeta(fullName)).defaultBranch
  const c = await getJson<{ sha: string }>(`https://api.github.com/repos/${fullName}/commits/${encodeURIComponent(ref)}`, ghHeaders())
  return c.sha
}

// ─── Official MCP registry ───────────────────────────────────────────────────

interface RegistryServer {
  name: string
  description?: string
  version?: string
  repository?: { url?: string }
  packages?: Array<{ registryType?: string; registry_name?: string; identifier?: string; name?: string; version?: string; environmentVariables?: Array<{ name: string; isSecret?: boolean; isRequired?: boolean }> }>
  remotes?: Array<{ type?: string; transport_type?: string; url: string }>
}

async function searchMcpRegistry(query: string): Promise<Candidate[]> {
  const data = await getJson<{ servers?: Array<RegistryServer | { server: RegistryServer }> }>(
    `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(query)}&limit=30`,
  )
  const out: Candidate[] = []
  for (const entry of data.servers || []) {
    const s = 'server' in entry ? entry.server : entry
    const npm = s.packages?.find(p => (p.registryType || p.registry_name) === 'npm')
    const remote = s.remotes?.find(r => /http/.test(r.type || r.transport_type || 'http'))
    const source: ExtensionSource | null = npm
      ? { type: 'npm', ref: npm.identifier || npm.name || '', url: s.repository?.url }
      : remote ? { type: 'remote-mcp', ref: remote.url, url: s.repository?.url } : null
    if (!source?.ref) continue
    out.push({
      id: candidateId(source),
      name: s.name.split('/').pop() || s.name,
      description: s.description || '',
      kind: 'mcp',
      source,
      homepage: s.repository?.url,
      installed: false,
      // Listed in the official, curated MCP registry
      score: 8,
    })
  }
  return out
}

// ─── npm ─────────────────────────────────────────────────────────────────────

async function searchNpm(query: string): Promise<Candidate[]> {
  const data = await getJson<{ objects?: Array<{ package: { name: string; description?: string; version: string; date?: string; links?: { repository?: string; npm?: string }; keywords?: string[] }; score?: { final?: number } }> }>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`${query} keywords:mcp`)}&size=20`,
  )
  // npm's own score changed scale over time (0–1, then hundreds); only its ordering is reliable
  return (data.objects || []).map((o, i) => ({
    id: candidateId({ type: 'npm', ref: o.package.name }),
    name: o.package.name,
    description: o.package.description || '',
    kind: 'mcp' as const,
    source: { type: 'npm' as const, ref: o.package.name, url: o.package.links?.repository || o.package.links?.npm },
    updatedAt: o.package.date,
    homepage: o.package.links?.npm,
    installed: false,
    score: Math.max(0, 8 - i * 0.4),
  }))
}

export async function npmLatest(pkg: string) {
  const d = await getJson<{ version: string; repository?: { url?: string } | string; license?: string; description?: string }>(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`)
  return d
}

// ─── Explicit sources (URL, npm package, npx command or local folder) ────────

/**
 * Turns what the user typed into an install candidate:
 * GitHub URL/owner-repo, npm package/URL, `npx` command, remote MCP URL or a local folder.
 * Nothing is downloaded here; `prepare` performs analysis and scanning.
 */
export function resolveSource(input: string): Candidate {
  const raw = String(input || '').trim().replace(/^["']|["']$/g, '')
  if (!raw) throw new Error('Informe uma URL do GitHub, pacote npm, comando npx, URL de MCP ou pasta local')

  const githubUrl = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/[^/\s]+\/([^?#\s]+))?/i.exec(raw)
  if (githubUrl) {
    const source: ExtensionSource = { type: 'github', ref: `${githubUrl[1]}/${githubUrl[2].replace(/\.git$/i, '')}`, url: raw }
    if (githubUrl[3]) {
      const sub = githubUrl[3].replace(/\/$/, '').replace(/\\/g, '/')
      // Reject traversal segments up front; the installer re-checks containment before copying
      if (sub.split('/').some(seg => seg === '..') || /^[A-Za-z]:/.test(sub)) {
        throw new Error('Caminho dentro do repositório inválido')
      }
      source.subPath = sub
    }
    return {
      id: candidateId(source), name: source.subPath ? source.subPath.split('/').filter(Boolean).pop()! : source.ref.split('/').pop() || source.ref, description: raw,
      kind: 'unknown', source, installed: false, score: 0,
    }
  }

  const npmUrl = /^https?:\/\/(?:www\.)?npmjs\.com\/package\/([^/?#\s]+(?:\/[^/?#\s]+)?)/i.exec(raw)
  if (npmUrl) {
    const source: ExtensionSource = { type: 'npm', ref: decodeURIComponent(npmUrl[1]), url: raw }
    return { id: candidateId(source), name: source.ref, description: raw, kind: 'mcp', source, installed: false, score: 0 }
  }

  if (/^npx(?:\.cmd)?\s/i.test(raw)) {
    const parts = raw.split(/\s+/).slice(1).filter(p => !/^-[yps]$|^--/.test(p))
    const pkg = parts.find(p => !p.startsWith('-'))
    if (!pkg) throw new Error('Comando npx sem pacote')
    const source: ExtensionSource = { type: 'npm', ref: pkg, url: undefined }
    return { id: candidateId(source), name: pkg.split('/').pop() || pkg, description: raw, kind: 'mcp', source, installed: false, score: 0 }
  }

  // Existing folder/file on disk
  try {
    const abs = path.resolve(raw)
    if (fs.existsSync(abs)) {
      const source: ExtensionSource = { type: 'local', ref: abs }
      return { id: candidateId(source), name: path.basename(abs), description: `Pasta local: ${abs}`, kind: 'unknown', source, installed: false, score: 0 }
    }
  } catch {}

  if (/^https?:\/\//i.test(raw)) {
    const source: ExtensionSource = { type: 'remote-mcp', ref: raw, url: raw }
    let name = raw
    try { name = new URL(raw).host } catch {}
    return { id: candidateId(source), name, description: `Servidor MCP remoto: ${raw}`, kind: 'mcp', source, installed: false, score: 0 }
  }

  // GitHub shorthand owner/repo (npm scoped packages start with @)
  if (!raw.startsWith('@') && /^[\w.-]+\/[\w.-]+$/.test(raw)) {
    const source: ExtensionSource = { type: 'github', ref: raw, url: `https://github.com/${raw}` }
    return { id: candidateId(source), name: raw.split('/')[1], description: raw, kind: 'unknown', source, installed: false, score: 0 }
  }

  if (/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(raw)) {
    const source: ExtensionSource = { type: 'npm', ref: raw }
    return { id: candidateId(source), name: raw, description: raw, kind: 'mcp', source, installed: false, score: 0 }
  }

  throw new Error('Não reconheci a origem. Use uma URL do GitHub, owner/repo, pacote npm, comando npx, URL de MCP ou o caminho de uma pasta local.')
}

/** Adds real description/license/stars to a candidate created from a URL or package name. */
export async function enrichCandidate(c: Candidate): Promise<Candidate> {
  if (c.description && c.description !== c.source.ref && c.description !== c.source.url) return c
  try {
    if (c.source.type === 'github') {
      const meta = await githubRepoMeta(c.source.ref)
      return { ...c, description: meta.description || c.description, stars: meta.stars, license: meta.license, updatedAt: meta.updatedAt, archived: meta.archived }
    }
    if (c.source.type === 'npm') {
      const l = await npmLatest(c.source.ref.replace(/@[\w.^~-]+$/, ''))
      return { ...c, description: l.description || c.description, license: l.license }
    }
  } catch {}
  return c
}

// ─── Unified discovery ───────────────────────────────────────────────────────

export interface DiscoverResult {
  candidates: Candidate[]
  errors: string[]
}

/** Live search across GitHub, the official MCP registry and npm. Nothing comes from a fixed list. */
export async function discover(query: string, kinds: Array<'skill' | 'mcp' | 'tool'> = ['skill', 'mcp', 'tool']): Promise<DiscoverResult> {
  const key = `${query}|${kinds.join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return { candidates: markInstalled(hit.data), errors: [] }

  const tasks: Array<[string, Promise<Candidate[]>]> = []
  if (kinds.includes('skill')) tasks.push(['GitHub (skills)', searchGithub(query, 'skill')])
  if (kinds.includes('tool')) tasks.push(['GitHub (ferramentas)', searchGithub(query, 'tool')])
  if (kinds.includes('mcp')) {
    tasks.push(['GitHub (MCP)', searchGithub(query, 'mcp')])
    tasks.push(['Registro oficial MCP', searchMcpRegistry(query)])
    tasks.push(['npm', searchNpm(query)])
  }
  const settled = await Promise.allSettled(tasks.map(t => t[1]))
  const errors: string[] = []
  const all = new Map<string, Candidate>()
  settled.forEach((r, i) => {
    if (r.status === 'rejected') { errors.push(`${tasks[i][0]}: ${(r.reason as Error).message}`); return }
    for (const c of r.value) if (!all.has(c.id)) all.set(c.id, c)
  })

  const ranked = [...all.values()].map(c => {
    const rel = relevance(query, `${c.name} ${c.description}`)
    const stars = c.stars ? Math.log10(c.stars + 1) * 6 : 0
    const fresh = c.updatedAt && Date.now() - Date.parse(c.updatedAt) < 180 * 86400_000 ? 5 : 0
    const official = c.source.type !== 'github' && c.homepage?.includes('modelcontextprotocol') ? 6 : 0
    const openSource = c.license ? 3 : 0
    return { ...c, score: Math.round(rel * 40 + stars + fresh + official + openSource + Math.min(c.score, 10) - (c.archived ? 25 : 0)) }
  }).filter(c => c.score > 5).sort((a, b) => b.score - a.score).slice(0, 40)

  cache.set(key, { at: Date.now(), data: ranked })
  return { candidates: markInstalled(ranked), errors }
}

function markInstalled(list: Candidate[]) {
  const ids = installedIds(listExtensions())
  return list.map(c => ({ ...c, installed: ids.has(c.id) }))
}

/** Newer version available for an installed extension, if any. */
export async function checkUpdate(ext: Extension): Promise<{ version: string; sha?: string } | null> {
  if (ext.source.type === 'github') {
    const sha = await githubHeadSha(ext.source.ref)
    return sha && sha !== ext.sha ? { version: sha.slice(0, 7), sha } : null
  }
  if (ext.source.type === 'npm') {
    const latest = await npmLatest(ext.source.ref)
    return latest.version && latest.version !== ext.version ? { version: latest.version } : null
  }
  return null
}
