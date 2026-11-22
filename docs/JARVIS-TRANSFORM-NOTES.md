# JARVIS — Notas de Arquitetura (transformação 2026-11-21)

Este documento é o mapa para quem vai **modificar o JARVIS depois**. Ele explica onde cada
responsabilidade vive e adicionar uma funcionalidade sem espalhar mudanças por 20 arquivos.

## 1. Visão geral

Next.js 15 (App Router, SPA) + Electron 42. O Electron (`electron/main.js`) sobe o
servidor Next na porta livre a partir de 3001 e abre uma `BrowserWindow` apontando
para ele. Toda a interface roda em `src/app/page.tsx`; todo o backend em `src/app/api/**`
+ `src/lib/**`. Dados são JSON em `data/` (ver `src/lib/agents/fsutil.ts`).

## 2. Onde mexer — respondendo "por onde começo?"

| Quero mudar… | Arquivo / pasta |
|---|---|
| Navegação, painel lateral, barra superior/inferior, modais, atalhos, central de comandos | `src/components/shell/AppShell.tsx` (props em `shell/types.ts`) |
| Entrada de comandos, histórico, streaming e bolhas de mensagem | `src/components/chat/` + a zona `chatZone` em `src/app/page.tsx` |
| Exibição da equipe / canvas de tarefas / mensagens entre agentes | `src/components/agents/TeamCanvas.tsx`, `AgentsWorkspace.tsx`, `LiveTimeline.tsx` |
| Planejamento, paralelismo, mensageria, permissões e revisão dos agentes | `src/lib/agents/orchestrator.ts`, `scheduler.ts`, `messageBus.ts`, `leader.ts`, `roles.ts` |
| Papéis/especializações e equipes pré-definidas | `src/lib/agents/roles.ts` |
| Qual modelo é escolhido para cada papel | `src/lib/agents/models.ts` (saúde/cooldown/fallback) + `src/lib/ai/catalog.ts` |
| Um novo provedor de IA | `src/lib/ai/providers.ts`, `client.ts`, `src/app/api/settings/route.ts`, UI em `ApiKeysModal.tsx`/`CustomProviders.tsx` |
| Ferramenta nova para os agentes | `src/lib/agents/tools.ts` (`TOOL_SPECS`, `TOOL_DOCS`, `executeToolInner`) + risco em `permissions.ts` |
| Arquivos/terminal | `src/components/FilesPanel.tsx`, `src/components/chat/TerminalPanel.tsx`, `src/app/api/fs`, `src/lib/terminal.ts` |
| Configurações | `src/components/settings/SettingsPanel.tsx` + `usePrefs.ts` (persistência em `data/prefs.json`) |
| Tema/cores/botões/cards (design system) | `src/styles/tokens.css` e `src/styles/components.css` |
| Diagnóstico interno (saúde dos módulos) | `src/lib/infra/diagnostics.ts`, `src/lib/diagnostics/modules.ts`, `src/app/api/diagnostics/route.ts`, `src/components/DiagnosticsPanel.tsx` |

## 3. Shell de layout (Fase C)

`src/app/page.tsx` mantém **estado e lógica** e entrega o desenho para
`AppShell` via `ShellProps`. O shell é dono de: NavRail, sidebar de conversas,
TopBar, StatusBar, painel direito (Execução/Terminal/Memória/Arquivos),
Central de Comandos (Ctrl+K), overlays modais (chaves, modelos, skills, motion,
infra, social, configurações) e o tratamento de arrastar arquivos.

As zonas são nós React prontos: `chatZone`, `teamsZone`, `hubZone`, `whatsappZone`.
O shell escolhe qual mostrar. `showDiagnostics` e `overlay` são controlados pela página.

**Ao adicionar uma tela grande:** construa um `zone`/overlay novo e passe pelo
`ShellProps`, em vez de inserir JSX dentro do `page.tsx`.

## 4. Equipes multiagente (Fases E/F)

O motor é `RunController` (`orchestrator.ts`):

1. `plan()` — o líder/arquiteto classifica a complexidade e devolve um JSON com
   tarefas, papéis, dependências e arquivos autorizados.
2. `Scheduler` (`scheduler.ts`) — roda tarefas independentes em paralelo
   (respeitando `dependsOn`), sem dois agentes no mesmo arquivo
   (`locks.ts`) e com reatribuição quando um agente está ocupado.
3. Cada agente tem um `agentLoop` com passos, ferramentas e histórico de contexto
   recortado (`trimHistory`) — a cada passo há eventos `agent_step` e
   `task_progress`, e a cada 25s um `agent_heartbeat` (visível no painel).
4. `messageBus.ts` — barril de mensagens: `send`, `inbox`, `unseen`, `markRead`,
   `waitForReply`. As mensagens ficam em `run.messages` e são mostradas no canvas.
5. O papel `leader` (`roles.ts`) coordena, pode perguntar ao usuário
   (`pendingReply` + evento `leader_question`) e pedir revisão cruzada.
   A resposta do usuário chega pela ação `message` da rota
   `/api/agents/runs/[id]` e chama `userMessage()`, que libera a espera.
6. Revisão: tarefas `verify`/`review` geram `issues`; `createFixTasks` devolve
   o trabalho ao agente responsável e cria uma verificação da correção.
7. Controle ao vivo: pausar/retomar/cancelar execução, pausar/interromper/remover
   agente, cancelar tarefa isolada (`cancel-task`), aprovar ferramenta/plano/escopo.

A interface da equipe é o `TeamCanvas` (aba **Equipe** no workspace): mostra líder,
agentes com modelo/status/progresso, plano em níveis de dependência, mensagens e
o campo de resposta quando o líder pergunta.

**Ao adicionar uma especialização:** crie um `RoleTemplate` em `roles.ts` com
`scope` (globs de escrita) e `responsibilities`; se for revisor, marque
`reviewer: true`. Se for coordenador, marque `leader: true`. Para virar opção
automática, inclua o id em `AUTO_TEAM_ROLES`.

## 5. Diagnóstico interno (Fase A)

A tela **Diag.** da NavRail mostra, com texto + ícone + cor (nunca só cor):

- **Módulos do JARVIS** (`lib/diagnostics/modules.ts`): sondas reais por
  runtime, modelos, agentes, provedores, integrações, persistência e build,
  classificadas como `ok`, `error`, `attention` ou `unknown`;
- detalhes por subsistema (`lib/infra/diagnostics.ts`): provedores, saúde dos
  modelos (cooling/unavailable), equipes/runs, terminal, persistência
  (corrompidos/quarentena/tmp), backups, autodiagnóstico (`selfcheck.ts`),
  recursos da máquina e tail de logs;
- atualização automática via SSE em `GET /api/diagnostics?sse=1`;
- `POST /api/diagnostics` executa a auditoria N1–N5 de modelos.

## 6. Design system

`tokens.css` define cores, tipografia, espaçamento, raio, z-index e animações
com prefixo `--jv-*`. `components.css` fornece `.jv-card`, `.jv-btn*`,
`.jv-input`, `.jv-badge-*`, `.jv-status-*`, `.jv-grid-*`, `.jv-modal*`,
`.jv-skeleton`. As classes antigas (`glass-panel`, `input-jarvis`, `rail-btn`)
continuam válidas; telas novas devem usar as classes `jv-*`.

## 7. Segurança e dados

- Chaves em `data/keys.json` (nunca exibidas; `redact()` antes de logs/eventos).
- Escrita de agentes limitada por `scope` + arquivos autorizados no plano;
  `resolveInside()` bloqueia travessia de caminho e symlinks.
- Ações destrutivas/externas pedem aprovação do usuário (`permissions.ts`).
- `writeJsonAtomic()` (tmp + rename) e quarentena de JSON corrompido em `readJson()`.
- Backups em `data/backups` (`infra/backup.ts`).

## 8. Verificação

```powershell
node node_modules/typescript/lib/tsc.js --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/next/dist/bin/next build --turbopack
node node_modules/eslint/bin/eslint.js .
```
