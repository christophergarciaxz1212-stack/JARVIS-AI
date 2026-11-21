# Transformação do JARVIS — Implementation Plan

> For the executing agent: use `godmode:inline-execution` to run this plan task by task.
> Steps use checkboxes for tracking.

**Goal:** tornar o JARVIS visível, organizado e verdadeiramente multiagente, com diagnóstico interno, sem regressões.
**Design:** `docs/plans/2026-11-21-jarvis-transformacao-design.md`
**Architecture:** evolução incremental do atual — orquestrador (`src/lib/agents/`), cliente de IA (`src/lib/ai/`) e integrações ficam; a camada de apresentação é extraída de `page.tsx` para workspaces e primitivos; o diagnóstico reusa `/api/audit` e ganha `/api/diagnostics`.
**Stack:** Node 26.13.1, Next 15.5.29, React 19, TypeScript 5.7, Tailwind 3, Vitest 4.1.12, Electron 42.11.18, npm (`package-lock.json`).

## Global Constraints

- Windows 11 Pro, **PowerShell 5.1** (sem `&&`/`||`). Use `;` ou chamadas separadas.
- npm via lockfile; nunca outro gerenciador.
- Build isolado: `$env:JARVIS_DIST_DIR='.next-dist'; npm run build`. Nunca gravar no `.next`.
- Parar servidor que serve `.next` antes do build.
- **Preservar** mudanças não commitadas de outra sessão (ver design, seção Survey). Fazer backup antes de editar arquivos com mudanças.
- Free-only. Nenhuma chave impressa em log/UI/teste.
- `prefers-reduced-motion`, foco visível, ARIA.
- Todo comportamento novo: teste que falha antes e passa depois, ou evidência de execução real.
- Nomes: arquivos `kebab-case`, tipos `PascalCase`, funções `camelCase`, exports nomeados.
- Mensagens de erro em PT-BR.

## Review Focus

1. **Sem modelo gratuito conectado** → criar equipe deve funcionar e marcar `attention`, não travar (Task 4).
2. **Dois agentes no mesmo arquivo** → lock existente continua autoridade; UI mostra "aguardando lock" (Task 4).
3. **Chave inválida/presente** → diagnóstico classifica como externa, nunca exibe valor (Task 1).
4. **Verificação dupla de diagnóstico** → segundo clique desabilitado enquanto executa (Task 1).
5. **Tela pequena/redimensionamento** → navegação e painéis não sobrepõem; foco visível (Tasks 2 e 3).

## Sources

- `package.json`, `tsconfig.json`, `docs/plans/2026-11-21-jarvis-transformacao-design.md`
- `src/lib/ai/audit.ts`, `src/app/api/audit/route.ts` (verificado 21/11/2026)
- `src/app/page.tsx` (verificado 21/11/2026), `src/components/layout/NavRail.tsx`
- `src/lib/agents/{orchestrator,roles,models}.ts`, `src/components/agents/*`

## File Map

| File | Action | Responsibility |
|---|---|---|
| `docs/plans/2026-11-21-jarvis-transformacao-{design,impl}.md` | create | design e plano |
| `src/lib/diagnostics/modules.ts` | create | mapa de módulos com status real |
| `src/app/api/diagnostics/route.ts` | create | GET mapa / POST rodar verificação |
| `src/components/diagnostics/DiagnosticsWorkspace.tsx` | create | tela de diagnóstico interno |
| `tests/diagnostics.test.ts` | create | classificadores e rota |
| `src/lib/ui/tokens.ts` | create | tokens visuais (uma fonte de verdade) |
| `src/components/ui/*` | create | primitivos (Button, Badge, StatusDot, Card, Tabs, Field, EmptyState, Skeleton) |
| `src/components/layout/NavRail.tsx` | modify | novos itens + agrupamento |
| `src/components/layout/WorkspaceRouter.tsx` | create | roteamento de workspaces |
| `src/app/page.tsx` | modify | reduzir a casca; delegar para workspaces |
| `src/components/workspaces/ChatWorkspace.tsx` | create | chat extraído |
| `src/components/workspaces/TeamWorkspace.tsx` | create | equipe extraída |
| `src/components/workspaces/SystemWorkspace.tsx` | create | arquivos/terminal/config |
| `src/components/teams/TeamWizard.tsx` | create | criação assistida de equipe |
| `src/components/teams/TeamDashboard.tsx` | create | painel de acompanhamento |
| `tests/ui-workspaces.test.ts`, `tests/teams-ui.test.ts` | create | testes de render/estado |
| `docs/MODULOS.md` | create | mapa de módulos para futuras evoluções |

---

## Task 0 — Backup e linha de base (antes de qualquer edição)

**Files:** `.tmp/backup-2026-11-21/` (novo; gitignored)

- [ ] **Step 1: registrar estado e fazer backup dos arquivos que serão editados**

Run:
```powershell
git status --short | Out-File -Encoding utf8 .tmp/git-status-before-transformacao.txt
$files = @('src/app/page.tsx','src/components/layout/NavRail.tsx','src/components/settings/SettingsPanel.tsx','src/app/api/audit/route.ts','src/lib/ai/audit.ts','src/app/globals.css')
New-Item -ItemType Directory -Force .tmp/backup-2026-11-21 | Out-Null
foreach ($f in $files) { $d = Split-Path ".tmp/backup-2026-11-21/$f" -Parent; New-Item -ItemType Directory -Force $d | Out-Null; Copy-Item $f ".tmp/backup-2026-11-21/$f" -Force }
Get-ChildItem -Recurse -File .tmp/backup-2026-11-21 | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: `6` (arquivos copiados). Nenhum arquivo de origem alterado.

- [ ] **Step 2: medir linha de base**

Run:
```powershell
npm test -- --reporter=dot 2>&1 | Select-Object -Last 12
```
Expected: `Test Files 73 passed`, `Tests 769 passed` (ou superior), `EXIT=0`.

---

## Task 1 — Diagnóstico interno (W5, prioridade da exigência adicional)

**Files:**
- Create: `src/lib/diagnostics/modules.ts`
- Create: `src/app/api/diagnostics/route.ts`
- Create: `src/components/diagnostics/DiagnosticsWorkspace.tsx`
- Create: `tests/diagnostics.test.ts`
- Modify: `src/components/layout/NavRail.tsx:7-17` (adicionar `'diagnostics'`)
- Modify: `src/app/page.tsx:1046-1055` (ligar item ao workspace)

**Covers:** critérios "tela de diagnóstico", "sem segredos", "falha externa classificada".

**Interfaces:**
- Consumes: `readAudit(): AuditResult[]` de `src/lib/ai/audit.ts`; `GET /api/agents/health`, `/api/models`, `/api/providers`.
- Produces: `collectModuleStatus(opts?: { now?: number }): Promise<DiagnosticReport>`; `classifyModuleError(error: unknown): 'error' | 'attention'`.

```ts
export type ModuleStatus = 'ok' | 'error' | 'attention' | 'unknown'
export interface ModuleDiagnostic {
  id: string
  name: string
  category: 'nucleo' | 'ia' | 'agentes' | 'integracoes' | 'dados' | 'build'
  status: ModuleStatus
  evidence: string
  detail?: string
  checkedAt: number
  action?: string
  external?: boolean
}
export interface DiagnosticReport { modules: ModuleDiagnostic[]; summary: Record<ModuleStatus, number>; checkedAt: number }
```

- [ ] **Step 1: escrever teste que falha**

```ts
import { classifyModuleError, summarize } from '../src/lib/diagnostics/modules'
test('classifica erro externo como atenção', () => {
  expect(classifyModuleError({ kind: 'rate_limit' })).toBe('attention')
  expect(classifyModuleError(new Error('arquivo não gravado'))).toBe('error')
})
test('resumo conta status', () => {
  expect(summarize([{ status: 'ok' }, { status: 'error' }] as never)).toEqual({ ok: 1, error: 1, attention: 0, unknown: 0 })
})
```

- [ ] **Step 2: rodar e confirmar falha**

Run: `npx vitest run tests/diagnostics.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/diagnostics/modules'`.

- [ ] **Step 3: implementar `src/lib/diagnostics/modules.ts`**

`classifyModuleError` mapeia `kind` externo (`rate_limit|overloaded|unavailable|auth|network|cancelled|context`, mesmo conjunto de `audit.ts`) → `'attention'`; todo o resto → `'error'`. `summarize` zera os 4 status e conta. `collectModuleStatus` consulta, com `Promise.allSettled` e timeout de 3 s por sonda: `/api/models` (catálogo/provedores), `/api/agents/health`, `readAudit()` (modelos N1–N5), escrita em `data/` (`dataDir()`), presença de `data/teams.json`, `build` (`process.env.npm_package_version`, `git rev-parse --short HEAD`). Cada módulo recebe `evidence` curta e `action` quando `error`/`attention`. Nunca ler valores de chaves.

- [ ] **Step 4: rodar e confirmar passe**

Run: `npx vitest run tests/diagnostics.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 5: rota `GET/POST /api/diagnostics`**

`GET` devolve `collectModuleStatus()`. `POST` força nova coleta com `runModelAudit` nos 3 melhores modelos gratuitos (`level=1`) e mescla em `readAudit()`, respondendo com o relatório + `ran`. Rejeitar segunda execução concorrente com `409` usando um módulo-level `let running = false`.

- [ ] **Step 6: teste da rota**

```ts
test('GET /api/diagnostics devolve módulos e resumo', async () => {
  const { GET } = await import('../src/app/api/diagnostics/route')
  const res = await GET()
  const body = await res.json()
  expect(Array.isArray(body.modules)).toBe(true)
  expect(body.summary).toHaveProperty('ok')
})
```
Run: `npx vitest run tests/diagnostics.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 7: tela `DiagnosticsWorkspace.tsx`**

Lista agrupada por `category`, contadores no topo (ok/erro/atenção), filtro via `Tabs` (`all|ok|error|attention`), botão "Rodar verificação" com `disabled` durante execução, detalhe expansível por módulo com `evidence`, `detail` e `action`. Usar primitivos de `src/components/ui/` (Task 2) — se ainda não existirem, usar classes Tailwind com tokens até lá. Sem valores de chaves.

- [ ] **Step 8: ligar na navegação**

`NavRail`: adicionar `{ id: 'diagnostics', label: 'Diagnóstico', hint: 'Saúde interna do JARVIS', icon: Activity }` ao grupo Sistema. `page.tsx`: `railActive` considera `showDiagnostics`; `onRail` troca o workspace.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: commit**

```powershell
git add src/lib/diagnostics src/app/api/diagnostics src/components/diagnostics tests/diagnostics.test.ts src/components/layout/NavRail.tsx src/app/page.tsx
git commit -m "feat(diagnostics): tela de diagnóstico interno com status real de módulos"
```

---

## Task 2 — Fundação visual: tokens e primitivos (W1)

**Files:**
- Create: `src/lib/ui/tokens.ts`
- Create: `src/components/ui/{Button,Badge,StatusDot,Card,Tabs,Field,EmptyState,Skeleton}.tsx`
- Modify: `src/app/globals.css:45-60` (alinhar tokens à paleta preto/branco)

**Covers:** critério "design system sem classes avulsas", "indicadores por texto+ícone".

**Interfaces:**
- Produces: `STATUS_META: Record<ModuleStatus, { label: string; icon: string; className: string }>` em `src/lib/ui/tokens.ts`; `<StatusDot status={ModuleStatus} label?: string />`.

- [ ] **Step 1: teste dos tokens**

```ts
import { STATUS_META } from '../src/lib/ui/tokens'
test('todo status tem texto e ícone, não só cor', () => {
  for (const s of ['ok','error','attention','unknown'] as const) {
    expect(STATUS_META[s].label.length).toBeGreaterThan(0)
    expect(STATUS_META[s].icon.length).toBeGreaterThan(0)
  }
})
```
Run: `npx vitest run tests/ui-tokens.test.ts` → FAIL (módulo ausente). Implementar `tokens.ts` com `{ ok: {label:'Funcionando',icon:'●',className:'text-white'}, error:{label:'Erro',icon:'✕',className:'text-red-400'}, attention:{label:'Atenção',icon:'!',className:'text-amber-400'}, unknown:{label:'Desconhecido',icon:'?',className:'text-white/40'} }`. Run → PASS.

- [ ] **Step 2: primitivos**

Cada primitivo: exports nomeados, tipagem explícita, `aria-*` quando aplicável, sem lógica de negócio. `Button` (variantes `primary|ghost|danger`, `size sm|md`), `Badge`, `StatusDot` (usa `STATUS_META`), `Card`, `Tabs` (`value`, `onChange`, `items`), `Field` (`label`, `hint`, erro), `EmptyState`, `Skeleton`.

- [ ] **Step 3: alinhar CSS**

Em `globals.css`, manter `--bg-primary:#000`, trocar `--accent-cyan` por `--accent: #f5f7fa` (gelo) e `--accent-dim` correspondente; manter `--accent-green/red/orange` para estados. Adicionar `.focus-ring` com `:focus-visible`. Não remover classes usadas por componentes antigos — adicionar aliases se necessário.

Run: `npx tsc --noEmit` → limpo. `npm run lint` → 0 erros.

- [ ] **Step 4: migrar `DiagnosticsWorkspace` para os primitivos**

Run: `npx vitest run tests/diagnostics.test.ts tests/ui-tokens.test.ts` → PASS.

- [ ] **Step 5: commit**

```powershell
git add src/lib/ui src/components/ui src/app/globals.css
git commit -m "feat(ui): tokens e primitivos preto/branco com estados por texto e ícone"
```

---

## Task 3 — Navegação e workspaces (W2)

**Files:**
- Create: `src/components/layout/WorkspaceRouter.tsx`
- Create: `src/components/workspaces/{ChatWorkspace,TeamWorkspace,SystemWorkspace}.tsx`
- Modify: `src/components/layout/NavRail.tsx` (agrupamento + itens `files`, `terminal`, `diagnostics`)
- Modify: `src/app/page.tsx` (casca: estado + router)

**Covers:** critérios "page.tsx ≤ 250 linhas", "cada rota abre workspace correto".

**Interfaces:**
- Consumes: `WorkspaceId = 'chat'|'team'|'files'|'terminal'|'hub'|'social'|'motion'|'skills'|'whatsapp'|'diagnostics'|'settings'`.
- Produces: `<WorkspaceRouter id={WorkspaceId} .../>` que renderiza o workspace correspondente.

- [ ] **Step 1: teste do roteador**

```ts
test('cada id de navegação renderiza seu workspace', () => {
  const ids = ['chat','team','files','terminal','diagnostics'] as const
  for (const id of ids) expect(render(WorkspaceRouter, { id })).toBeTruthy()
})
```
Usar Vitest + React testing (ver `tests/setup.ts` para o padrão disponível; se não houver `@testing-library`, testar com `react-dom/server` `renderToString`). Run → FAIL.

- [ ] **Step 2: criar `WorkspaceRouter` e workspaces**

`WorkspaceRouter` recebe um `id` e props compartilhadas (`session`, `projectId`, callbacks). Cada workspace é um componente fino que delega para os componentes já existentes (`AgentsWorkspace`, `FilesPanel`, `TerminalPanel`, `DiagnosticsWorkspace`). **Não mover lógica de negócio ainda** — apenas reorganizar a árvore de renderização.

- [ ] **Step 3: reduzir `page.tsx`**

Extrair para `useJarvisShell` (`src/components/layout/useJarvisShell.ts`) os hooks de estado (mensagens, overlays, projetos, sessões, prefs) mantendo as assinaturas atuais. `page.tsx` deve ficar com: imports, `useJarvisShell()`, `MotionConfig`, `NavRail`, `WorkspaceRouter`, overlays existentes. Meta: ≤ 250 linhas.

Run: `npx tsc --noEmit` → limpo. Run: `npm test -- --reporter=dot 2>&1 | Select-Object -Last 8` → suíte verde.

- [ ] **Step 4: commit**

```powershell
git add src/components/layout src/components/workspaces src/app/page.tsx
git commit -m "refactor(ui): page.tsx decomposta em workspaces e shell hook"
```

---

## Task 4 — Central de equipes (W4, prioridade 2)

**Files:**
- Create: `src/components/teams/TeamWizard.tsx`
- Create: `src/components/teams/TeamDashboard.tsx`
- Create: `tests/teams-ui.test.ts`
- Modify: `src/components/agents/TeamsManager.tsx` (usar wizard), `src/components/agents/RunPanel.tsx` (usar dashboard)

**Covers:** critérios "criar/duplicar/editar/excluir", "9 campos do painel", "revisão cruzada".

**Interfaces:**
- Consumes: `Team`, `preset()`, `ROLE_MAP` de `src/lib/agents/roles.ts`; `assignAutoModels` de `src/lib/agents/models.ts`; `Run`, `RunEvent` de `src/lib/agents/types.ts`.
- Produces: `saveTeam(team: Team): void`, `duplicateTeam(id: string): Team` em `src/lib/agents/teamStore.ts` — se já existir implementação equivalente, reexportar em vez de duplicar.

- [ ] **Step 1: teste do ciclo de equipe**

```ts
test('duplicar equipe preserva agentes e gera novo id', () => {
  const base = { id: 't1', name: 'Alpha', agents: [/* ... */] } as never
  const copy = duplicateTeam('t1')
  expect(copy.id).not.toBe('t1')
  expect(copy.name).toContain('Alpha')
  expect(copy.agents).toHaveLength(base.agents.length)
})
```
Run → FAIL. Implementar `teamStore` sobre o persistente existente (`data/teams.json` via `dataDir()/writeJsonAtomic`). Run → PASS.

- [ ] **Step 2: wizard em 2 passos**

Passo 1: nome (1–60), objetivo (≤500), líder (select dos agentes), preset (`software|infra|academico`) → `preset(id, name, desc, roles)`. Passo 2 (avançado, recolhido por padrão): modelo por agente (`auto` ou id do catálogo free), ferramentas, permissões. Usar `Field`/`Tabs` de `src/components/ui`. Botões: Criar, Duplicar (quando editando), Excluir com confirmação.

- [ ] **Step 3: dashboard**

Card por agente com 9 campos: nome, modelo (`a.model`), especialização (`getRole(a.roleId).name`), status (`a.status`), tarefa atual (`run.tasks.find(t => t.agentId === a.id && t.status === 'running')?.title`), progresso (`a.step/a.maxSteps`), última atividade (último `RunEvent` com `agentId`), resultados (contagem de tarefas `done`), erros (`a.errors.length`) e tempo (`a.activeMs`). Clique abre transcript filtrado (`transcript.tsx`). Revisão: botão "Solicitar revisão" dispara evento de fix round já existente no orquestrador.

- [ ] **Step 4: verificar**

Run: `npx vitest run tests/teams-ui.test.ts tests/team.test.ts tests/team-auto.test.ts` → PASS.
Run: `npx tsc --noEmit` → limpo.

- [ ] **Step 5: commit**

```powershell
git add src/components/teams src/lib/agents/teamStore.ts tests/teams-ui.test.ts
git commit -m "feat(teams): wizard de criação e painel de acompanhamento multiagente"
```

---

## Task 5 — Chat (W3)

**Files:**
- Create: `src/components/chat/{Composer,MessageList,MessageBubble,ToolCallCard,ActivityStrip,AttachmentRow}.tsx`
- Modify: `src/components/workspaces/ChatWorkspace.tsx` (compor as peças)
- Create: `tests/chat-ui.test.ts`

**Covers:** critério "indicadores de atividade usam fases reais".

**Interfaces:**
- Consumes: `StreamStatus` de `page.tsx` (fases reais já emitidas pelo `/api/chat`); `Message`, `imageAtts`.
- Produces: `<ActivityStrip status={StreamStatus | null} />`.

- [ ] **Step 1: teste do ActivityStrip**

```ts
test('mostra fase real e não inventa raciocínio', () => {
  const html = renderToStaticMarkup(ActivityStrip({ status: { phase: 'tool', tool: 'write_file' } } as never))
  expect(html).toContain('write_file')
  expect(html).not.toMatch(/raciocinando/i)
})
```
Run → FAIL. Implementar mapeando `phase` → rótulo/ícone de `STATUS_META`/tokens; fases: `thinking|planning|tool|streaming|file|approval|validating|done`. Run → PASS.

- [ ] **Step 2: extrair componentes**

Mover o JSX correspondente de `page.tsx`/`ChatWorkspace` para os novos arquivos, mantendo props explícitas. Sem mudança de comportamento de streaming/SSE.

- [ ] **Step 3: verificar**

Run: `npx vitest run tests/chat-ui.test.ts tests/ai-sse.test.ts tests/ai-resilience.test.ts` → PASS.

- [ ] **Step 4: commit**

```powershell
git add src/components/chat src/components/workspaces/ChatWorkspace.tsx tests/chat-ui.test.ts
git commit -m "refactor(chat): componentes extraídos e indicadores de fase reais"
```

---

## Task 6 — Qualidade, docs e verificação final (W6)

**Files:**
- Create: `docs/MODULOS.md`
- Modify: `AUDITORIA.md` (nova seção no topo, sem reescrever histórico)
- Modify: `README.md` (navegação atualizada)

- [ ] **Step 1: documentar módulos**

`docs/MODULOS.md`: para cada diretório de `src/lib/` e `src/components/`, uma linha com responsabilidade e "onde adicionar nova funcionalidade". Incluir convenções (naming, erros, persistência, secrets, testes).

- [ ] **Step 2: bateria completa**

Run (sequencial, Linux-style separado por `;`):
```powershell
npm test -- --reporter=dot 2>&1 | Select-Object -Last 12
npx tsc --noEmit
npm run lint
$env:JARVIS_DIST_DIR='.next-dist'; npm run build 2>&1 | Select-Object -Last 20
```
Expected: testes ≥ 769/769; `tsc` limpo; `lint` 0 erros; build `Compiled successfully` com `/api/diagnostics` na lista de rotas.

- [ ] **Step 3: relatório**

Atualizar `AUDITORIA.md` com: o que mudou, evidências (números e caminhos de log), rollback por item, pendências. Registrar que o diagnóstico é real (sondas executadas), não simulado.

- [ ] **Step 4: commit final**

```powershell
git add docs/MODULOS.md AUDITORIA.md README.md
git commit -m "docs: mapa de módulos e relatório da transformação"
```

---

## Execution mode recommendation

**Inline** — as tarefas são sequenciais (cada uma consome interfaces da anterior), o contexto aguenta e o custo é o menor. Alternativa `delegated-execution` se o usuário quiser uma revisão independente entre tarefas. Nenhuma dependência nova; nenhum worktree necessário (backups em `.tmp/` cobrem o risco).
