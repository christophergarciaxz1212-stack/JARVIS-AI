# Mapa de módulos do JARVIS

Guia rápido para entender onde cada coisa vive e **onde adicionar uma funcionalidade nova**.
Atualizado em 21/11/2026. Convenções completas em `docs/plans/2026-11-21-jarvis-transformacao-design.md`.

## Convenções (leia primeiro)

- Arquivos `kebab-case`; tipos `PascalCase`; funções `camelCase`; **exports nomeados** (sem `default` em libs).
- Libs em `src/lib/<area>/`, componentes em `src/components/<area>/`, rotas em `src/app/api/<nome>/route.ts`, testes espelhando em `tests/<nome>.test.ts`.
- Persistência: `dataDir()` + `readJson` + `writeJsonAtomic` de `src/lib/agents/fsutil.ts`. Nunca gravar fora da pasta de dados.
- Erros em PT-BR via `throw new Error(msg)`; classificar falha externa (cota/chave/rede) separado de falha do JARVIS (`classifyModelError`, `classifyModuleError`).
- Segredos: `redact`/`deepRedact` antes de gravar ou emitir. **Nunca** ler/imprimir valores de `data/keys.json`.
- Testes: Vitest, alias `@/` → `src/`, `JARVIS_DATA_DIR` isolado por arquivo. Componentes `.tsx` não são importados em testes (ambiente `node` sem transform JSX) — valide por `tsc`/build.
- Build isolado: `$env:JARVIS_DIST_DIR='.next-dist'; npm run build`. Nunca gravar no `.next` de outra sessão.
- npm no Windows: `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" ...` (PowerShell 5.1 bloqueia `npm.ps1`).

## Núcleo

| Módulo | Responsabilidade | Onde adicionar |
|---|---|---|
| `src/app/page.tsx` | Casca da aplicação: shell, overlays, estado da conversa | Preferir extrair para workspace/hook antes de crescer |
| `src/app/globals.css` | Design system (tokens CSS, animações, markdown) | Novos tokens visuais aqui + `src/lib/ui/tokens.ts` |
| `src/lib/ui/tokens.ts` | Mapas de estado/categoria (texto + símbolo + cor) | Novo status de diagnóstico |
| `src/components/ui/` | Primitivos: Button, Badge, StatusDot, Card, Tabs, Field, EmptyState, Skeleton | Novo controle reutilizável |
| `src/components/layout/` | NavRail, TopBar, StatusBar, CommandPalette, workspaces | Nova área de navegação |

## IA e modelos (`src/lib/ai/`)

| Módulo | Responsabilidade |
|---|---|
| `client.ts` / `compat.ts` | Cliente de chat, `completeOnce`/`streamAI`, compatibilidade de provedores |
| `catalog.ts` / `providers.ts` / `modelTests.ts` | Catálogo free-only, provedores, classificação de falha/latência |
| `capabilities.ts` / `sse.ts` / `resilience.ts` | Tools/JSON por modelo, parser incremental, retry/fallback |
| `audit.ts` | Auditoria real N1–N5 e persistência em `data/audit/models.json` |
| `council.ts` | Conselho de IAs (vários modelos + árbitro) |

Novo provedor: registrar em `providers.ts` (free-only) + adaptador em `client.ts` + teste de fumaça.

## Agentes e equipes (`src/lib/agents/`)

| Módulo | Responsabilidade |
|---|---|
| `orchestrator.ts` | Ciclo de vida da run: planejamento, scheduler, fix rounds, relatório |
| `scheduler.ts` / `locks.ts` | Paralelismo com dependências; lock de arquivo por agente |
| `roles.ts` / `models.ts` | Papéis/presets e seleção automática de modelo (penaliza reuso de provedor) |
| `permissions.ts` / `tools.ts` / `fsutil.ts` | Modo de permissão, ferramentas, sandbox de filesystem |
| `projectMemory.ts` / `store.ts` / `types.ts` | Memória do projeto, persistência, contratos |
| `teamStore.ts` (quando existir) | CRUD de equipes em `data/teams.json` |

Nova ferramenta: `TOOL_SPECS`/`TOOL_DOCS` em `tools.ts` + teste em `tests/agent-*.test.ts`.
Novo papel: `ROLES` em `roles.ts` (com `scope`, `modelHint`, `responsibilities`).

## Diagnóstico (`src/lib/diagnostics/`, `src/lib/infra/`)

| Módulo | Responsabilidade |
|---|---|
| `src/lib/diagnostics/modules.ts` | Mapa simples: módulo → `ok|error|attention|unknown`, evidência e ação |
| `src/lib/infra/diagnostics.ts` | Relatório rico: provedores, modelos, equipes, terminal, persistência, logs, selfcheck |
| `src/app/api/diagnostics/route.ts` | Contrato `DiagnosticsPayload` (GET + SSE + POST para forçar verificação) |
| `src/components/DiagnosticsPanel.tsx` / `src/app/diagnostics/page.tsx` | Painel no shell e tela dedicada |

Novo indicador: adicionar sonda em `PROBES` (`modules.ts`) ou campo em `Diagnostics` (`infra/diagnostics.ts`) e linha no painel.

## Integrações

`src/lib/wa/`, `src/lib/whatsapp/`, `src/lib/openwa/` (WhatsApp Meta/OpenWA); `src/lib/studio/`, `src/lib/motion/` (vídeo/animação); `src/lib/netlab/`, `src/lib/hub/`, `src/lib/social/`; `src/lib/infra/` (servidores, SSH, Docker, backup, watchdog). Cada uma com sua rota em `src/app/api/<nome>/`.

Novo fluxo "prompt → artefato": implementar no módulo da área + rota + teste, e expor no painel correspondente.

## Testes e qualidade

- `npm test` (Vitest) — suíte completa; `npx tsc --noEmit`; `npm run lint`; build isolado.
- `tests/setup.ts` desliga CLIs reais (agy/opencode) — nunca chamar cota grátis em teste.
- Antes de declarar pronto: reaplicar a bateria de 10 tarefas em `docs/auditoria/` (meta ≥ 10/10).
