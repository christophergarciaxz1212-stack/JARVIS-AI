import os from 'os'
import path from 'path'
import { saveKey } from '../keys'
import type { Extension } from './types'

/** Something an extension needs before it can start: an env var, a command-line argument or an HTTP header. */
export interface SetupField {
  name: string
  kind: 'env' | 'arg' | 'header'
  label: string
  secret: boolean
  optional?: boolean
  placeholder?: string
  help?: string
  /** Suggested value shown in the form (never applied without the user saving it). */
  suggestion?: string
  /** One value per line → several arguments (e.g. allowed folders). */
  multiline?: boolean
}

export interface ExtensionSetup {
  fields: SetupField[]
  /** Non-secret values; secrets live in the keys vault (see secretEnvName). */
  values: Record<string, string>
  configuredAt?: number
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL/i

/** Vault entry for a secret field. The suffix keeps it masked by redact() in every log. */
export function secretEnvName(extId: string, field: string) {
  return `JVX_${extId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}__${field.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_SECRET`
}

const projectsDir = () => path.join(os.homedir(), 'Documents', 'JARVIS Projetos')

/** Official servers whose requirements are known, so the form is right on the first try. */
function knownFields(ext: Extension): SetupField[] | null {
  const ref = ext.source.type === 'npm' ? ext.source.ref : ''
  switch (ref) {
    case '@modelcontextprotocol/server-filesystem':
      return [{ name: 'ALLOWED_DIRS', kind: 'arg', label: 'Pastas que o servidor pode ler e alterar (uma por linha)', secret: false, multiline: true, suggestion: projectsDir(), help: 'Ele não enxerga nada fora dessas pastas. Evite liberar a pasta do usuário inteira.' }]
    case '@modelcontextprotocol/server-postgres':
      return [{ name: 'DATABASE_URL', kind: 'arg', label: 'String de conexão do PostgreSQL', secret: true, placeholder: 'postgresql://usuario:senha@localhost:5432/banco', help: 'Prefira um usuário só de leitura: este servidor executa consultas SQL.' }]
    case '@modelcontextprotocol/server-brave-search':
      return [{ name: 'BRAVE_API_KEY', kind: 'env', label: 'Chave da API do Brave Search', secret: true, help: 'Grátis em brave.com/search/api (plano Free).', suggestion: process.env.BRAVE_SEARCH_API_KEY ? 'usar a chave do Brave já salva no JARVIS' : undefined }]
    case '@modelcontextprotocol/server-gitlab':
      return [
        { name: 'GITLAB_PERSONAL_ACCESS_TOKEN', kind: 'env', label: 'Token de acesso pessoal do GitLab', secret: true, help: 'GitLab › Preferências › Access Tokens (escopo api ou read_api).' },
        { name: 'GITLAB_API_URL', kind: 'env', label: 'URL da API do GitLab', secret: false, optional: true, suggestion: 'https://gitlab.com/api/v4' },
      ]
  }
  return null
}

/**
 * Reads what an extension is missing from its failure output (stderr / HTTP error) plus the
 * known requirements of official servers. Empty when the failure isn't about configuration.
 */
export function detectSetup(ext: Extension, failure: string): SetupField[] {
  const known = knownFields(ext)
  if (known) return known
  const text = failure || ''
  const fields: SetupField[] = []
  if (ext.mcp?.transport === 'http' && /401|403|unauthori[sz]ed|authorization|api[ _-]?key|bearer/i.test(text)) {
    fields.push({ name: 'Authorization', kind: 'header', label: 'Chave/token da API (enviado como “Bearer …”)', secret: true })
  }
  // Env vars named in a "missing/required" message, e.g. "BRAVE_API_KEY environment variable is required"
  const names = new Set<string>()
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/g)) {
    const around = text.slice(Math.max(0, m.index! - 120), m.index! + m[0].length + 120)
    if (/required|missing|not set|must be set|environment|env var|provide|undefined|is not defined|não definid|obrigat/i.test(around)) names.add(m[1])
  }
  for (const name of [...names].filter(n => !/^(NODE_|PATH|HOME|APPDATA|USERPROFILE|TEMP|TMP)/.test(n)).slice(0, 6)) {
    fields.push({ name, kind: 'env', label: name, secret: SECRET_NAME.test(name) })
  }
  if (!fields.length && /\busage:|missing (required )?argument|requires? (an? )?(argument|path|directory|url)|no (allowed )?director/i.test(text)) {
    const usage = text.match(/usage:[^\n]*/i)?.[0]
    fields.push({ name: 'ARGS', kind: 'arg', label: 'Argumentos de inicialização (um por linha)', secret: false, multiline: true, help: usage ? `O servidor pediu: ${usage.slice(0, 200)}` : undefined })
  }
  return fields
}

const read = (ext: Extension, f: SetupField): string | undefined => {
  if (f.secret) return process.env[secretEnvName(ext.id, f.name)] || undefined
  return ext.setup?.values[f.name]
}

export function missingFields(ext: Extension): SetupField[] {
  return (ext.setup?.fields || []).filter(f => !f.optional && !read(ext, f)?.trim())
}

/** Saves what the user typed: secrets go to the keys vault, the rest to the extension record. */
export function applySetup(ext: Extension, input: Record<string, string>, fields = ext.setup?.fields || []): Extension {
  if (!fields.length) throw new Error('Esta extensão não precisa de configuração')
  const values = { ...(ext.setup?.values || {}) }
  for (const f of fields) {
    if (!(f.name in input)) continue
    let v = String(input[f.name] ?? '').trim()
    if (f.name === 'BRAVE_API_KEY' && /^usar a chave/i.test(v)) v = process.env.BRAVE_SEARCH_API_KEY || ''
    if (v.length > 4000) throw new Error(`${f.label}: valor longo demais`)
    if (f.kind === 'arg' && f.name === 'ALLOWED_DIRS') {
      for (const dir of v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        const abs = path.resolve(dir)
        if (abs === path.parse(abs).root) throw new Error(`Não libere o disco inteiro (${abs}): escolha pastas específicas`)
        if (abs.toLowerCase() === os.homedir().toLowerCase()) throw new Error('Não libere a pasta do usuário inteira: escolha pastas específicas')
      }
    }
    if (f.secret) saveKey(secretEnvName(ext.id, f.name), v)
    else if (v) values[f.name] = v
    else delete values[f.name]
  }
  ext.setup = { fields, values, configuredAt: Date.now() }
  return ext
}

/** What the launcher adds when starting the extension (values resolved from record + vault). */
export function launchConfig(ext: Extension): { args: string[]; env: Record<string, string>; headers: Record<string, string> } {
  const out = { args: [] as string[], env: {} as Record<string, string>, headers: {} as Record<string, string> }
  for (const f of ext.setup?.fields || []) {
    const v = read(ext, f)?.trim()
    if (!v) continue
    if (f.kind === 'env') out.env[f.name] = v
    else if (f.kind === 'header') out.headers[f.name] = f.name.toLowerCase() === 'authorization' && !/^(bearer|basic|token)\s/i.test(v) ? `Bearer ${v}` : v
    else out.args.push(...(f.multiline ? v.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [v]))
  }
  return out
}
