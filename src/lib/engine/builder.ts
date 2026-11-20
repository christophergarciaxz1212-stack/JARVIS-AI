import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { FileLockManager } from '../agents/locks'
import { defaultComplete, liveProviders, type CompleteFn } from '../agents/models'
import { newAgentState, RunController } from '../agents/orchestrator'
import { agentFromRole } from '../agents/roles'
import { writeJsonAtomic } from '../agents/fsutil'
import type { Provider as LiveProvider } from '@/types'
import type { Run, RunEvent } from '../agents/types'
import { DEFAULT_RUN_OPTIONS } from '../agents/types'
import { getEngine, type InstallOutcome } from './engine'
import { slug } from './installer'
import { engineDir, logHistory } from './registry'
import { removeExtension } from './installer'

export interface BuildDeps {
  complete: CompleteFn
  providers: () => Promise<LiveProvider[]>
}

const SPEC = (need: string, name: string) => `Crie uma Skill do JARVIS (ferramenta reutilizável) chamada "${name}" para: ${need}

Estrutura OBRIGATÓRIA na raiz desta pasta:
1. jarvis-tool.json — {"name": "${name}", "description": "...", "version": "1.0.0", "categories": ["..."], "script": "index.mjs", "env": [], "tools": [{"name": "nome_em_snake_case", "description": "o que faz", "inputSchema": {"type": "object", "properties": {...}, "required": [...]}}]}
   Em "env" liste SOMENTE nomes de variáveis de credenciais realmente necessárias (ex.: "NOTION_TOKEN"); deixe vazio se não precisar.
2. index.mjs — Node.js ESM, SEM dependências externas (só módulos nativos e fetch). Lê todo o stdin como JSON {"tool": "...", "args": {...}}, executa a ferramenta e imprime UMA linha JSON: {"result": ...} ou {"error": "mensagem"}. Os nomes tratados no index.mjs devem ser EXATAMENTE os mesmos de "tools[].name" no manifesto (o JARVIS chama cada um para conferir). Nunca imprima credenciais. Não apague arquivos nem rode comandos destrutivos.
3. SKILL.md — com frontmatter (name, description) e instruções de quando e como usar cada ferramenta, com exemplos.
4. tests/test.mjs — executa index.mjs com child_process (process.execPath) para CADA ferramenta com entradas de exemplo, valida as saídas com node:assert e termina com código 0 se tudo passar. Os testes NÃO podem depender de internet nem de credenciais (teste a validação de entradas e a lógica local).

Ao final rode: node tests/test.mjs — e corrija até passar.`

/**
 * JARVIS writes a new Skill with a small agent team in an isolated workspace, then installs it
 * through the same analysis/test pipeline as third-party extensions.
 */
export async function buildSkill(need: string, opts: { requestedBy: string; name?: string; onLog?: (s: string) => void; deps?: BuildDeps }): Promise<InstallOutcome & { workspace: string }> {
  const log = opts.onLog || (() => {})
  const deps: BuildDeps = opts.deps || { complete: defaultComplete, providers: liveProviders }
  const name = slug(opts.name || need).slice(0, 40)
  const workspace = path.join(engineDir(), 'workspace', `${name}-${Date.now()}`)
  fs.mkdirSync(path.join(workspace, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'README.md'), `# ${name}\n\nSkill criada pelo JARVIS para: ${need}\n`, 'utf-8')

  const runOnce = async (request: string) => {
    const buildId = uuidv4()
    const dir = path.join(engineDir(), 'builds', buildId)
    const run: Run = {
      id: buildId, sessionId: 'engine', projectId: 'engine', projectPath: workspace, request, status: 'queued', autoTeam: false,
      agents: [
        newAgentState({ ...agentFromRole('fullstack', 'construtor'), name: 'Construtor de Skills', scope: ['**'] }, 18),
        newAgentState({ ...agentFromRole('qa', 'qa'), name: 'QA de Skills' }, 12),
      ],
      tasks: [], messages: [], changes: [], scopeRequests: [], decisions: [],
      options: { ...DEFAULT_RUN_OPTIONS, maxParallel: 2, maxSteps: 18, fixRounds: 1 },
      usage: { inputTokens: 0, outputTokens: 0 }, createdAt: Date.now(), eventCount: 0,
    }
    const ctrl = new RunController(run, {
      complete: deps.complete,
      providers: deps.providers,
      locks: new FileLockManager(),
      snapshotDir: path.join(dir, 'snapshots'),
      persist: r => writeJsonAtomic(path.join(dir, 'run.json'), r),
      appendEvent: (e: RunEvent) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(e) + '\n') },
    })
    ctrl.subscribe(e => {
      if (['plan', 'task_started', 'file_change', 'command_result', 'task_done', 'task_failed', 'model_switched'].includes(e.type)) log(e.message)
    })
    await ctrl.start()
    return ctrl.run
  }

  log(`Criando a skill "${name}" com uma equipe (construtor + QA)…`)
  const first = await runOnce(SPEC(need, name))
  if (first.status === 'failed' || first.status === 'cancelled') throw new Error(`A equipe não conseguiu criar a skill: ${first.error || first.status}`)
  if (!fs.existsSync(path.join(workspace, 'jarvis-tool.json'))) throw new Error('A equipe não gerou o jarvis-tool.json')

  const engine = getEngine()
  const candidate = { id: `created:${workspace}`, name, description: need, kind: 'tool' as const, source: { type: 'created' as const, ref: workspace }, installed: false, score: 0 }

  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`Analisando segurança e instalando (tentativa ${attempt})…`)
    const outcome = await engine.install({ candidate }, { requestedBy: opts.requestedBy })
    if (outcome.status !== 'installed') {
      logHistory('create', outcome.status !== 'blocked', `Skill criada para "${need}": ${outcome.status}`)
      return { ...outcome, workspace }
    }
    const ext = outcome.extension
    if (ext.lastTest?.ok) {
      logHistory('create', true, `Skill criada e testada para "${need}"`, ext)
      log(`Pronta: ${ext.name} com ${ext.tools.length} ferramenta(s), testes passando.`)
      return { ...outcome, workspace }
    }
    if (attempt === 2) {
      logHistory('create', false, `Skill criada mas os testes falham: ${ext.lastTest?.output.slice(0, 300)}`, ext)
      return { ...outcome, workspace }
    }
    log('Os testes falharam; a equipe vai corrigir…')
    await removeExtension(ext.id)
    await runOnce(`Os testes da skill nesta pasta falharam. Saída:\n${ext.lastTest?.output.slice(0, 3000)}\n\nCorrija index.mjs e/ou tests/test.mjs mantendo a estrutura obrigatória e rode node tests/test.mjs até passar.`)
  }
  throw new Error('Falha inesperada ao criar a skill')
}
