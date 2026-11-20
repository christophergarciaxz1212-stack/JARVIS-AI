// Jarvis Skill Engine — shared types (server and UI). No Node-only imports here.

/**
 * - skill: Anthropic/Agent Skill (SKILL.md instructions, optional scripts)
 * - mcp:   Model Context Protocol server (stdio command or remote HTTP URL)
 * - tool:  OpenAI-compatible function tool run by JARVIS (manifest + script)
 */
export type ExtensionKind = 'skill' | 'mcp' | 'tool'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type SourceType = 'github' | 'npm' | 'mcp-registry' | 'remote-mcp' | 'local' | 'created' | 'builtin'

export interface ExtensionSource {
  type: SourceType
  /** owner/repo for github, package name for npm, URL for remote-mcp, folder for local. */
  ref: string
  url?: string
  /** Sub-folder inside a repository (a skill inside a skills collection). */
  subPath?: string
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface Permissions {
  network: boolean
  shell: boolean
  fsWrite: boolean
  /** Names of environment variables (credentials) the extension may receive. Values never stored here. */
  env: string[]
  /** Role ids allowed to use it, or ['*'] for every agent. */
  agents: string[]
}

export interface Finding {
  severity: 'info' | 'medium' | 'high' | 'critical'
  rule: string
  message: string
  file?: string
  line?: number
}

export interface ScanReport {
  level: RiskLevel
  findings: Finding[]
  inferred: { network: boolean; shell: boolean; fsWrite: boolean; envVars: string[] }
  files: number
  bytes: number
  scannedAt: number
}

export interface McpEntry {
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
}

export interface ScriptEntry {
  runtime: 'node'
  /** Script path relative to the extension folder; receives {tool, args} as JSON on stdin, prints JSON. */
  script: string
}

export interface ExtensionVersion {
  version: string
  sha?: string
  dir: string
  installedAt: number
}

export type ExtensionStatus = 'ok' | 'broken' | 'disabled' | 'needs-setup'

export interface Extension {
  id: string
  name: string
  kind: ExtensionKind
  description: string
  categories: string[]
  source: ExtensionSource
  version: string
  sha?: string
  /** Folder of the active version. */
  dir: string
  versions: ExtensionVersion[]
  enabled: boolean
  status: ExtensionStatus
  statusReason?: string
  mcp?: McpEntry
  script?: ScriptEntry
  /** Path of SKILL.md (relative to dir) for instruction skills. */
  instructions?: string
  /** Skill collections: every SKILL.md found, readable one by one. */
  skills?: Array<{ name: string; description: string; path: string }>
  /** Something the user must provide before it works (e.g. "Python 3"). */
  requires?: string
  /** Launch settings the user filled in (args/env/headers); secret values live in the keys vault. */
  setup?: import('./setup').ExtensionSetup
  tools: ToolDef[]
  dependencies: string[]
  permissions: Permissions
  risk: ScanReport
  lastTest?: { ok: boolean; at: number; output: string }
  updateAvailable?: { version: string; sha?: string; checkedAt: number }
  installedAt: number
  updatedAt: number
}

export interface Candidate {
  /** Stable id: "<sourceType>:<ref>[#subPath]" */
  id: string
  name: string
  description: string
  kind: ExtensionKind | 'unknown'
  source: ExtensionSource
  stars?: number
  license?: string
  updatedAt?: string
  archived?: boolean
  homepage?: string
  installed: boolean
  score: number
}

export type HistoryAction = 'discover' | 'scan' | 'install' | 'update' | 'rollback' | 'restore' | 'remove' | 'disable' | 'enable' | 'test' | 'repair' | 'create' | 'approval' | 'permissions' | 'use' | 'optimize' | 'error'

export interface HistoryEntry {
  at: number
  action: HistoryAction
  extensionId?: string
  name?: string
  ok: boolean
  message: string
}

export interface Approval {
  id: string
  candidate: Candidate
  reason: string
  risk?: ScanReport
  requestedBy: string
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  decidedAt?: number
  /** Extension id once installed after approval. */
  result?: string
}

export type Autonomy = 'manual' | 'assisted' | 'autonomous'

export interface EngineSettings {
  /**
   * manual: nothing installs without approval.
   * assisted (default): low-risk, credential-free installs happen automatically; the rest asks.
   * autonomous: also updates automatically; anything risky or needing credentials still asks.
   */
  autonomy: Autonomy
  autoUpdate: boolean
  /** When no installed capability or public package solves a need, JARVIS writes a new Skill. */
  autoCreate: boolean
  /** Periodically search alternatives for open improvement opportunities (never installs by itself). */
  autoOptimize: boolean
  lastUpdateCheck?: number
  lastSelfCheck?: number
  lastOptimizeCheck?: number
}

export interface OpportunitySuggestion {
  id: string
  name: string
  kind: ExtensionKind | 'unknown'
  source: ExtensionSource
  stars?: number
  license?: string
  score: number
}

export interface Opportunity {
  id: string
  need: string
  source: string
  at: number
  status: 'open' | 'resolved' | 'dismissed'
  resolution?: string
  suggestions?: OpportunitySuggestion[]
  optimizedAt?: number
}

export interface EngineJob {
  id: string
  kind: string
  title: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  result?: unknown
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface EngineStats {
  total: number
  enabled: number
  broken: number
  needsSetup: number
  updates: number
  byKind: Record<string, number>
  pendingApprovals: number
  openOpportunities: number
  risk: Record<RiskLevel, number>
  lastUpdateCheck?: number
  lastSelfCheck?: number
}
