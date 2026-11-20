import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { candidateId, checkUpdate, discover, enrichCandidate, resolveSource } from './discovery'
import {
  categorize, decide, discardPrepared, findConflicts, getPrepared, installPrepared, parseFrontmatter, prepare, prepareToolArgs, refreshUpdateFlags,
  removeExtension, repairExtension, restoreVersion, retest, updateExtension, type Prepared,
} from './installer'
import { mcp } from './mcp'
import { applySetup } from './setup'
import {
  extensionsDir, getExtension, getSettings, listApprovals, listExtensions, listOpportunities, logHistory, quarantineDir, readHistory, redact, saveApproval,
  saveExtension, saveOpportunity, saveSettings,
} from './registry'
import { removeDir } from '../agents/fsutil'
import { nodeBinary, runProcess, sandboxEnv } from './sandbox'
import type {
  Approval, Candidate, EngineJob, EngineSettings, EngineStats, Extension, OpportunitySuggestion, Permissions,
} from './types'

export interface InspectResult {
  token: string
  candidate: Candidate
  kind: string
  name: string
  version: string
  risk: Prepared['risk']
  decision: ReturnType<typeof decide>
  tools: number
  requires?: string
}

export type InstallOutcome =
  | { status: 'installed'; extension: Extension }
  | { status: 'pending'; approval: Approval }
  | { status: 'blocked'; reason: string }
  | { status: 'existing'; extension: Extension }

const STOP = new Set(['para', 'com', 'uma', 'que', 'dos', 'das', 'the', 'and', 'for', 'meu', 'minha', 'meus', 'minhas', 'skill', 'skills', 'plugin', 'ferramenta', 'jarvis', 'encontre', 'instale', 'crie'])

function terms(text: string) {
  return [...new Set(text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t)))]
}

export class SkillEngine {
  private initialized = false
  jobs = new Map<string, EngineJob>()
  private updateTimer?: ReturnType<typeof setInterval>
  private optimizeTimer?: ReturnType<typeof setInterval>

  /** Registers the skills that ship with JARVIS and starts the periodic update check. */
  init() {
    if (this.initialized) return this
    this.initialized = true
    try { this.registerBuiltins() } catch {}
    if (!process.env.VITEST) {
      try { this.cleanupOrphans() } catch {}
      this.updateTimer = setInterval(() => { void this.backgroundCheck() }, 6 * 3600_000)
      this.updateTimer.unref?.()
      setTimeout(() => { void this.backgroundCheck() }, 60_000).unref?.()
      // Opportunities are only researched and proposed: nothing installs without a policy decision
      this.optimizeTimer = setInterval(() => { void this.backgroundOptimize() }, 24 * 3600_000)
      this.optimizeTimer.unref?.()
      setTimeout(() => { void this.backgroundOptimize() }, 5 * 60_000).unref?.()
    }
    return this
  }

  /** Removes leftovers a crash or a locked file left behind: unregistered extension folders and old quarantine. */
  cleanupOrphans() {
    const removed: string[] = []
    const known = new Set(listExtensions().map(e => e.id))
    if (fs.existsSync(extensionsDir())) {
      for (const entry of fs.readdirSync(extensionsDir(), { withFileTypes: true })) {
        if (!entry.isDirectory() || known.has(entry.name)) continue
        try { removeDir(path.join(extensionsDir(), entry.name)); removed.push(entry.name) } catch {}
      }
    }
    if (fs.existsSync(quarantineDir())) {
      for (const entry of fs.readdirSync(quarantineDir(), { withFileTypes: true })) {
        const abs = path.join(quarantineDir(), entry.name)
        if (Date.now() - fs.statSync(abs).mtimeMs < 3600_000) continue
        try { removeDir(abs); removed.push(`quarentena/${entry.name}`) } catch {}
      }
    }
    if (removed.length) logHistory('remove', true, `Limpeza de sobras: ${removed.join(', ')}`)
    return removed
  }

  private registerBuiltins() {
    const root = path.join(process.cwd(), 'skills')
    if (!fs.existsSync(root)) return
    const known = new Set(listExtensions().map(e => candidateId(e.source)))
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = path.join(root, entry.name, 'SKILL.md')
      if (!fs.existsSync(file)) continue
      const source = { type: 'builtin' as const, ref: entry.name }
      if (known.has(candidateId(source))) continue
      const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf-8'))
      const name = meta.name || entry.name
      saveExtension({
        id: `builtin-${entry.name}`, name, kind: 'skill', description: meta.description || '', categories: categorize(`${name} ${meta.description}`),
        source, version: '1.0.0', dir: path.join(root, entry.name), versions: [], enabled: true, status: 'ok', instructions: 'SKILL.md', tools: [], dependencies: [],
        permissions: { network: false, shell: false, fsWrite: false, env: [], agents: ['*'] },
        risk: { level: 'low', findings: [], inferred: { network: false, shell: false, fsWrite: false, envVars: [] }, files: 1, bytes: 0, scannedAt: Date.now() },
        installedAt: Date.now(), updatedAt: Date.now(),
      })
    }
  }

  // ─── Catalogue ─────────────────────────────────────────────────────────────

  list() { return listExtensions() }
  get(id: string) { return getExtension(id) }
  history(limit?: number, extensionId?: string) { return readHistory(limit, extensionId) }
  approvals() { return listApprovals() }
  settings() { return getSettings() }
  setSettings(patch: Partial<EngineSettings>) { return saveSettings(patch) }
  conflicts() { return findConflicts() }
  opportunities() { return listOpportunities() }
  runningServers() { return mcp.running() }

  jobsList() {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30)
  }

  job(id: string) { return this.jobs.get(id) }

  stats(): EngineStats {
    const exts = listExtensions()
    const settings = getSettings()
    const risk: EngineStats['risk'] = { low: 0, medium: 0, high: 0, critical: 0 }
    const byKind: Record<string, number> = {}
    for (const e of exts) {
      risk[e.risk.level]++
      byKind[e.kind] = (byKind[e.kind] || 0) + 1
    }
    return {
      total: exts.length,
      enabled: exts.filter(e => e.enabled && e.status !== 'disabled').length,
      broken: exts.filter(e => e.status === 'broken').length,
      needsSetup: exts.filter(e => e.status === 'needs-setup').length,
      updates: exts.filter(e => e.updateAvailable).length,
      byKind,
      pendingApprovals: listApprovals().filter(a => a.status === 'pending').length,
      openOpportunities: listOpportunities().filter(o => o.status === 'open').length,
      risk,
      lastUpdateCheck: settings.lastUpdateCheck,
      lastSelfCheck: settings.lastSelfCheck,
    }
  }

  /** Installed, enabled extensions an agent role may use. */
  available(roleId = 'jarvis') {
    return listExtensions().filter(e => e.enabled && e.status !== 'disabled' && (roleId === 'jarvis' || e.permissions.agents.includes('*') || e.permissions.agents.includes(roleId)))
  }

  /** Ranks installed capabilities for a task (keywords + categories). */
  recommend(task: string, roleId = 'jarvis', limit = 6): Array<Extension & { score: number }> {
    const t = terms(task)
    const cats = new Set(categorize(task))
    return this.available(roleId)
      .map(e => {
        const hay = `${e.name} ${e.description} ${e.categories.join(' ')} ${e.tools.map(x => `${x.name} ${x.description}`).join(' ')} ${(e.skills || []).map(s => s.name).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        const kw = t.filter(x => hay.includes(x)).length
        const cat = e.categories.filter(c => cats.has(c)).length * 3
        const health = e.status === 'ok' ? 0 : -5
        return { ...e, score: kw * 2 + cat + health }
      })
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  // ─── Discovery & install ───────────────────────────────────────────────────

  async discover(query: string, kinds: Array<'skill' | 'mcp' | 'tool'> = ['skill', 'mcp', 'tool']) {
    const r = await discover(query, kinds)
    logHistory('discover', true, `Busca "${query}": ${r.candidates.length} resultado(s)${r.errors.length ? `; falhas: ${r.errors.join('; ')}` : ''}`)
    return r
  }

  async resolve(input: string): Promise<Candidate> {
    return enrichCandidate(resolveSource(input))
  }

  async inspect(candidate: Candidate): Promise<InspectResult> {
    const p = await prepare(candidate)
    return this.summary(p)
  }

  async inspectSource(input: string): Promise<InspectResult> {
    return this.inspect(await this.resolve(input))
  }

  inspectToken(token: string): InspectResult {
    const p = getPrepared(token)
    if (!p) throw new Error('Análise expirada; analise o pacote de novo')
    return this.summary(p)
  }

  private summary(p: Prepared): InspectResult {
    return { token: p.token, candidate: p.candidate, kind: p.analysis.kind, name: p.analysis.name, version: p.analysis.version, risk: p.risk, decision: decide(p), tools: p.analysis.tools.length, requires: p.analysis.requires }
  }

  /**
   * Installs following the policy: blocked when dangerous, asks the user when risky or when it
   * needs credentials (or in manual mode), installs straight away otherwise.
   */
  async install(input: { token?: string; candidate?: Candidate }, opts: { requestedBy: string; approved?: boolean; grantEnv?: string[] }): Promise<InstallOutcome> {
    const existing = input.candidate && listExtensions().find(e => candidateId(e.source) === input.candidate!.id)
    if (existing) return { status: 'existing', extension: existing }
    const p = (input.token && getPrepared(input.token)) || (input.candidate ? await prepare(input.candidate) : undefined)
    if (!p) throw new Error('Análise expirada; analise o pacote de novo')
    const d = decide(p)
    if (d.action === 'block') {
      discardPrepared(p.token)
      logHistory('install', false, `Bloqueada: ${p.analysis.name} — ${d.reason}`)
      return { status: 'blocked', reason: d.reason }
    }
    if (d.action === 'approve' && !opts.approved) {
      const approval: Approval = { id: uuidv4(), candidate: p.candidate, reason: d.reason, risk: p.risk, requestedBy: opts.requestedBy, status: 'pending', createdAt: Date.now() }
      saveApproval(approval)
      discardPrepared(p.token)
      logHistory('approval', true, `Aguardando aprovação: ${p.analysis.name} — ${d.reason}`)
      return { status: 'pending', approval }
    }
    const ext = await installPrepared(p, { requestedBy: opts.requestedBy, grantEnv: opts.grantEnv })
    return { status: 'installed', extension: ext }
  }

  async installSource(input: string, opts: { requestedBy: string; approved?: boolean; grantEnv?: string[] }): Promise<InstallOutcome> {
    const candidate = await this.resolve(input)
    return this.install({ candidate }, opts)
  }

  async decideApproval(id: string, approve: boolean, grantEnv: string[] = []): Promise<InstallOutcome | { status: 'denied' }> {
    const a = listApprovals().find(x => x.id === id)
    if (!a || a.status !== 'pending') throw new Error('Pedido não encontrado ou já decidido')
    a.status = approve ? 'approved' : 'denied'
    a.decidedAt = Date.now()
    saveApproval(a)
    logHistory('approval', true, `${approve ? 'Aprovado' : 'Recusado'} pelo usuário: ${a.candidate.name}`)
    if (!approve) return { status: 'denied' }
    // Only credentials the extension actually references can be granted
    const outcome = await this.install({ candidate: a.candidate }, { requestedBy: 'usuário', approved: true, grantEnv: grantEnv.filter(n => /^[A-Z][A-Z0-9_]+$/.test(n)) })
    if (outcome.status === 'installed') { a.result = outcome.extension.id; saveApproval(a) }
    return outcome
  }

  /**
   * Autonomous acquisition: an installed capability if one fits, otherwise search, compare the
   * best candidates and install the first that passes analysis (or ask the user). When no public
   * solution fits and autoCreate is on, JARVIS writes and tests its own Skill.
   */
  async acquire(
    need: string,
    requestedBy: string,
    onLog: (s: string) => void = () => {},
    opts: { create?: boolean } = {},
  ): Promise<InstallOutcome | { status: 'none'; tried: string[] } | { status: 'created'; outcome: InstallOutcome }> {
    const have = this.recommend(need, 'jarvis', 1)[0]
    if (have && have.score >= 4) {
      onLog(`Já instalada: ${have.name}`)
      return { status: 'existing', extension: getExtension(have.id)! }
    }
    onLog(`Pesquisando GitHub, registro oficial MCP e npm por "${need}"…`)
    let candidates: Candidate[] = []
    try { candidates = (await this.discover(need)).candidates } catch (e) { onLog(`Busca indisponível: ${(e as Error).message}`) }
    const tried: string[] = []
    for (const c of candidates.filter(x => !x.installed && !x.archived).slice(0, 4)) {
      onLog(`Analisando ${c.name} (${c.source.type})…`)
      try {
        const outcome = await this.install({ candidate: c }, { requestedBy })
        if (outcome.status === 'blocked') { tried.push(`${c.name}: ${outcome.reason}`); onLog(`Descartada: ${outcome.reason}`); continue }
        if (outcome.status === 'installed') onLog(`Instalada e testada: ${outcome.extension.name}`)
        if (outcome.status === 'pending') onLog(`${c.name} precisa da sua aprovação: ${outcome.approval.reason}`)
        return outcome
      } catch (e) {
        tried.push(`${c.name}: ${(e as Error).message}`)
        onLog(`Falhou: ${(e as Error).message}`)
      }
    }

    const opportunity = { id: uuidv4(), need, source: requestedBy, at: Date.now(), status: 'open' as const }
    const shouldCreate = opts.create ?? getSettings().autoCreate
    if (shouldCreate) {
      onLog('Nenhuma solução pública adequada. Criando uma Skill própria com a equipe de desenvolvimento…')
      try {
        const outcome = await this.create(need, requestedBy, onLog)
        if (outcome.status === 'installed') {
          for (const o of listOpportunities().filter(x => x.status === 'open' && x.need === need)) saveOpportunity({ ...o, status: 'resolved', resolution: 'Skill criada pelo JARVIS' })
          return { status: 'created', outcome }
        }
        saveOpportunity({ ...opportunity, resolution: outcome.status === 'pending' ? 'Skill criada; aguarda aprovação' : undefined })
        return { status: 'created', outcome }
      } catch (e) {
        onLog(`Não consegui criar a Skill: ${(e as Error).message}`)
      }
    }
    saveOpportunity(opportunity)
    return { status: 'none', tried }
  }

  // ─── Use ───────────────────────────────────────────────────────────────────

  private usable(extId: string, roleId: string) {
    const ext = getExtension(extId) || listExtensions().find(e => e.name.toLowerCase() === extId.toLowerCase())
    if (!ext) throw new Error(`Extensão "${extId}" não está instalada`)
    if (!ext.enabled) throw new Error(`${ext.name} está desativada`)
    if (roleId !== 'jarvis' && !ext.permissions.agents.includes('*') && !ext.permissions.agents.includes(roleId)) {
      throw new Error(`O papel "${roleId}" não tem permissão para usar ${ext.name}`)
    }
    return ext
  }

  readSkill(extId: string, roleId = 'jarvis', skillName?: string): string {
    const ext = this.usable(extId, roleId)
    if (ext.skills?.length && !skillName) {
      return `${ext.name} contém ${ext.skills.length} skills. Leia uma pelo nome:\n${ext.skills.slice(0, 120).map(s => `- ${s.name}: ${s.description.slice(0, 120)}`).join('\n')}`
    }
    const rel = skillName ? ext.skills?.find(s => s.name.toLowerCase() === skillName.toLowerCase())?.path : ext.instructions
    if (!rel) throw new Error(skillName ? `Skill "${skillName}" não encontrada em ${ext.name}` : `${ext.name} não tem instruções (use as ferramentas dela)`)
    // The path comes from an installed extension's metadata — never trust it to stay inside ext.dir
    const baseDir = path.resolve(ext.dir)
    const abs = path.resolve(baseDir, rel)
    const inside = path.relative(baseDir, abs)
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new Error(`Skill "${skillName ?? rel}" aponta para fora do diretório da extensão — recusado`)
    }
    const text = fs.readFileSync(abs, 'utf-8')
    const base = path.dirname(abs)
    return `${parseFrontmatter(text).body.slice(0, 30_000)}\n\n(Arquivos da skill em: ${base})`
  }

  async callTool(extId: string, toolName: string, args: Record<string, unknown>, roleId = 'jarvis'): Promise<string> {
    const ext = this.usable(extId, roleId)
    try {
      if (ext.kind === 'skill') throw new Error(`${ext.name} é uma skill de instruções: use skill_read`)
      const tool = ext.tools.find(t => t.name === toolName)
      if (!tool) throw new Error(`${ext.name} não tem a ferramenta "${toolName}". Disponíveis: ${ext.tools.map(t => t.name).join(', ')}`)
      const safeArgs = prepareToolArgs(tool, args || {})
      const out = ext.kind === 'mcp'
        ? await mcp.callTool(ext, toolName, safeArgs)
        : await this.runScript(ext, toolName, safeArgs)
      logHistory('use', true, `${toolName} executada por ${roleId}`, ext)
      return out
    } catch (e) {
      // Repeated failures become an improvement opportunity
      const recent = readHistory(20, ext.id).filter(h => h.action === 'error' && Date.now() - h.at < 3600_000).length
      logHistory('error', false, `${toolName}: ${(e as Error).message}`, ext)
      if (recent >= 2) saveOpportunity({ id: uuidv4(), need: `Alternativa para ${ext.name} (falhando: ${(e as Error).message.slice(0, 120)})`, source: roleId, at: Date.now(), status: 'open' })
      throw e
    }
  }

  private async runScript(ext: Extension, tool: string, args: Record<string, unknown>) {
    const node = nodeBinary()
    const r = await runProcess(node.command, [path.join(ext.dir, ext.script!.script)], {
      cwd: ext.dir,
      env: { ...sandboxEnv(ext.id, ext.permissions.env), ...node.env },
      timeoutMs: 120_000,
      input: JSON.stringify({ tool, args }),
    })
    if (r.timedOut) throw new Error('A ferramenta excedeu o tempo limite (120 s)')
    const lastJson = r.stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
    if (lastJson) {
      try {
        const parsed = JSON.parse(lastJson) as { result?: unknown; error?: string }
        if (parsed.error) throw new Error(parsed.error)
        return redact(typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result ?? parsed)).slice(0, 20_000)
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e
      }
    }
    if (r.code !== 0) throw new Error(redact(r.stderr || r.stdout).slice(0, 1000) || `Saiu com código ${r.code}`)
    return redact(r.stdout).slice(0, 20_000)
  }

  // ─── Management ────────────────────────────────────────────────────────────

  async update(id: string, requestedBy = 'usuário') {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    if (['builtin', 'created', 'local', 'remote-mcp'].includes(ext.source.type)) return { updated: false, message: 'Sem fonte remota para atualizar' }
    return updateExtension(ext, requestedBy)
  }

  async updateAll(requestedBy = 'usuário', onLog: (s: string) => void = () => {}) {
    const results: Array<{ id: string; name: string; updated: boolean; message: string }> = []
    for (const e of listExtensions().filter(x => ['github', 'npm'].includes(x.source.type))) {
      onLog(`Verificando ${e.name}…`)
      try { const r = await this.update(e.id, requestedBy); results.push({ id: e.id, name: e.name, ...r }); onLog(`${e.name}: ${r.message}`) }
      catch (err) { results.push({ id: e.id, name: e.name, updated: false, message: (err as Error).message }); onLog(`${e.name}: ${(err as Error).message}`) }
    }
    return results
  }

  async checkUpdates() {
    const found = await refreshUpdateFlags(listExtensions().filter(e => ['github', 'npm'].includes(e.source.type)), checkUpdate)
    saveSettings({ lastUpdateCheck: Date.now() })
    return found
  }

  private async backgroundCheck() {
    try {
      const found = await this.checkUpdates()
      if (found && getSettings().autoUpdate) await this.updateAll('atualização automática')
    } catch {}
  }

  /**
   * Researches open improvement opportunities and stores ranked suggestions. It never installs
   * on its own, so the catalog does not grow with tools nobody asked for.
   */
  async optimize(limit = 8, onLog: (s: string) => void = () => {}) {
    const open = listOpportunities().filter(o => o.status === 'open').slice(-limit)
    if (!open.length) {
      onLog('Nenhuma oportunidade aberta para pesquisar.')
      return { researched: 0, resolved: 0 }
    }
    let researched = 0
    let resolved = 0
    for (const o of open) {
      const have = this.recommend(o.need, 'jarvis', 1)[0]
      if (have && have.score >= 4) {
        saveOpportunity({ ...o, status: 'resolved', resolution: `Já disponível: ${have.name}`, optimizedAt: Date.now() })
        resolved++
        onLog(`Resolvida por ${have.name}: ${o.need.slice(0, 80)}`)
        continue
      }
      onLog(`Pesquisando alternativas para: ${o.need.slice(0, 100)}`)
      try {
        const { candidates } = await this.discover(o.need)
        const suggestions: OpportunitySuggestion[] = candidates
          .filter(c => !c.installed && !c.archived)
          .slice(0, 3)
          .map(c => ({ id: c.id, name: c.name, kind: c.kind, source: c.source, stars: c.stars, license: c.license, score: c.score }))
        saveOpportunity({ ...o, suggestions, optimizedAt: Date.now() })
        researched++
        onLog(suggestions.length ? `Sugestões: ${suggestions.map(s => s.name).join(', ')}` : 'Nenhuma alternativa encontrada.')
      } catch (e) {
        onLog(`Busca falhou: ${(e as Error).message}`)
      }
    }
    saveSettings({ lastOptimizeCheck: Date.now() })
    logHistory('optimize', true, `Otimização contínua: ${researched} oportunidade(s) pesquisada(s), ${resolved} resolvida(s)`)
    return { researched, resolved }
  }

  private async backgroundOptimize() {
    try {
      const settings = getSettings()
      if (!settings.autoOptimize || settings.autonomy === 'manual') return
      if (settings.lastOptimizeCheck && Date.now() - settings.lastOptimizeCheck < 20 * 3600_000) return
      await this.optimize(5)
    } catch {}
  }

  /** Full health check: updates, functional tests, conflicts and permissions review. */
  async selfCheck(onLog: (s: string) => void = () => {}) {
    onLog('Verificando atualizações…')
    let updates = 0
    try { updates = await this.checkUpdates() } catch (e) { onLog(`Falha ao verificar atualizações: ${(e as Error).message}`) }
    onLog('Testando todas as extensões…')
    const tests = await this.testAll(onLog)
    const broken = tests.filter(t => !t.ok)
    const conflicts = this.conflicts()
    const stats = this.stats()
    saveSettings({ lastSelfCheck: Date.now() })
    onLog(`Concluído: ${tests.length - broken.length}/${tests.length} funcionando, ${updates} atualização(ões), ${conflicts.length} conflito(s).`)
    return { tests, updates, conflicts, broken, stats }
  }

  async test(id: string) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    return retest(ext)
  }

  async testAll(onLog: (s: string) => void = () => {}) {
    const out: Array<{ id: string; name: string; ok: boolean; output: string }> = []
    for (const e of listExtensions()) {
      const t = await retest(e)
      out.push({ id: e.id, name: e.name, ok: t.ok, output: t.output })
      onLog(`${t.ok ? '✓' : '✗'} ${e.name}: ${t.output.slice(0, 120)}`)
    }
    return out
  }

  async remove(id: string) {
    if (id.startsWith('builtin-')) throw new Error('Skills nativas do JARVIS não podem ser removidas (desative-as)')
    await removeExtension(id)
  }

  setEnabled(id: string, enabled: boolean) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    ext.enabled = enabled
    ext.status = enabled ? (ext.lastTest?.ok === false ? 'broken' : 'ok') : 'disabled'
    if (!enabled) void mcp.close(id)
    saveExtension(ext)
    logHistory(enabled ? 'enable' : 'disable', true, enabled ? 'Ativada' : 'Desativada', ext)
    return ext
  }

  async restore(id: string, dir: string) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    return restoreVersion(ext, dir)
  }

  async repair(id: string) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    return repairExtension(ext)
  }

  /** Saves the launch settings the user typed (secrets → keys vault) and tests again right away. */
  async configure(id: string, values: Record<string, string>) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    applySetup(ext, values)
    await mcp.close(id)
    saveExtension(ext)
    logHistory('permissions', true, `Configuração salva: ${(ext.setup?.fields || []).map(f => f.name).join(', ')}`, ext)
    const t = await retest(ext)
    return { ext: getExtension(id), test: t }
  }

  setPermissions(id: string, patch: Partial<Permissions>) {
    const ext = getExtension(id)
    if (!ext) throw new Error('Extensão não encontrada')
    ext.permissions = {
      ...ext.permissions,
      ...patch,
      env: (patch.env ?? ext.permissions.env).filter(n => /^[A-Z][A-Z0-9_]+$/.test(n)),
      agents: patch.agents?.length ? patch.agents : ext.permissions.agents,
    }
    void mcp.close(id)
    saveExtension(ext)
    logHistory('permissions', true, `Permissões: agentes=${ext.permissions.agents.join(',')} credenciais=${ext.permissions.env.join(',') || 'nenhuma'}`, ext)
    return ext
  }

  /** JARVIS writes, tests, scans and registers a new Skill for a need nothing installed covers. */
  async create(need: string, requestedBy: string, onLog: (s: string) => void = () => {}, deps?: import('./builder').BuildDeps) {
    const { buildSkill } = await import('./builder')
    const result = await buildSkill(need, { requestedBy, onLog, deps })
    for (const o of listOpportunities().filter(x => x.status === 'open' && x.need === need)) saveOpportunity({ ...o, status: 'resolved', resolution: 'Skill criada' })
    return result
  }

  dismissOpportunity(id: string) {
    const o = listOpportunities().find(x => x.id === id)
    if (o) saveOpportunity({ ...o, status: 'dismissed' })
  }

  // ─── Background jobs (long operations visible in the UI) ───────────────────

  startJob(kind: string, title: string, work: (log: (s: string) => void) => Promise<unknown>): EngineJob {
    const job: EngineJob = { id: uuidv4(), kind, title, status: 'running', log: [], startedAt: Date.now() }
    this.jobs.set(job.id, job)
    const log = (s: string) => { job.log.push(`${new Date().toLocaleTimeString('pt-BR')} ${redact(s)}`); if (job.log.length > 400) job.log.shift() }
    work(log).then(r => { job.result = r; job.status = 'done' }, e => { job.error = (e as Error).message; job.status = 'failed'; log(`Erro: ${job.error}`) })
      .finally(() => { job.finishedAt = Date.now() })
    for (const [id, j] of this.jobs) if (j.finishedAt && Date.now() - j.finishedAt > 3600_000) this.jobs.delete(id)
    return job
  }
}

const g = globalThis as unknown as { __jarvisSkillEngine?: SkillEngine }

export function getEngine(): SkillEngine {
  if (!g.__jarvisSkillEngine) g.__jarvisSkillEngine = new SkillEngine()
  return g.__jarvisSkillEngine.init()
}
