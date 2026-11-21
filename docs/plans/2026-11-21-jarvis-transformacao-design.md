# Transformação do JARVIS — Design (21/11/2026)

> Modo: **inline**, com autonomia delegada pelo usuário ("skip the questions").
> Este documento registra as escolhas feitas e serve de contrato para `godmode:task-planning`.
> Status: aprovado pelo mandato do usuário em 21/11/2026 (brief de 12 seções + 3 prioridades + diagnóstico).

## Intent

Transformar o JARVIS em um produto profissional, **fácil de usar, fácil de modificar e verdadeiramente multiagente**, sem destruir o que já funciona. O usuário prioriza três coisas, nesta ordem:

1. **Interface** — tudo visível, organizado e intuitivo, sem excesso de menus.
2. **Equipes de IA** — central de trabalho colaborativo com líder, especialistas, comunicação, tarefas paralelas e revisão.
3. **Código** — arquitetura organizada para evoluir sem quebrar partes antigas.

Exigência adicional explícita: **tela de diagnóstico interno** mostrando quais módulos funcionam, quais têm erros e quais precisam de atenção.

Público: o próprio usuário (operador do PC) e futuros agentes/versões do JARVIS que precisem entender e estender o sistema.

## Survey — o que existe hoje (medido em 21/11/2026)

| Fato | Evidência |
|---|---|
| Stack: Next 15.5.29, React 19, Electron 42.11.18, TypeScript 5.7, Tailwind 3, framer-motion, lucide-react, Vitest 4.1.12 | `package.json` |
| Repositório git **existe** (docs antigos dizem o contrário — stale) | `git log`: 12+ commits, `git status`: 17 modificados, vários novos |
| ~300 arquivos-fonte, 75 arquivos de teste, suíte verde (~769 testes) | contagem por diretório; `docs/plans/2026-11-21-jarvis-audit-evolution.md` |
| Orquestrador multiagente **já sofisticado**: planejamento, scheduler, prioridades/dependências, locks de arquivo, fix rounds, Plan Mode, permissões, memória de projeto, fallback de modelo, honestidade de relatório | `src/lib/agents/orchestrator.ts` (1154 linhas), `scheduler.ts`, `locks.ts`, `permissions.ts`, `projectMemory.ts` |
| 20+ papéis de agente (architect, frontend, backend, uiux, ai, database, qa, reviewer, devops, infra-*, security, dba, sre, dr …) | `src/lib/agents/roles.ts` |
| Seleção automática de modelos já penaliza reuso de modelo **e provedor** (fix de hoje) | `src/lib/agents/models.ts`, `tests/team-auto.test.ts` |
| Design system com tokens CSS (`--bg-primary:#000`, `--accent-cyan`, temas `data-accent`/`data-font`) | `src/app/globals.css` |
| Navegação já centralizada em `NavRail` (7 áreas) + `TopBar` + `CommandPalette` (Ctrl+K) + `StatusBar` | `src/components/layout/` |
| Diagnóstico **em andamento** (trabalho não commitado de outra sessão): `src/lib/ai/audit.ts`, `/api/audit`, `AuditPanel.tsx`, conectado em `SettingsPanel.tsx` | `git status`; `docs/plans/2026-11-21-jarvis-audit-evolution.md` |
| `page.tsx` é um monólito de **1554 linhas** — principal obstáculo para "fácil de mexer" | medição |
| Auditorias prévias cobrem chat/agente/terminal/diff/paths (24 achados em 10 arquivos) e modelos/provedores (D1–D17) | `audit-report.md`, `AUDITORIA.md` |
| Resiliência de IA já implementada (SSE incremental, retry com jitter, capabilities por modelo) | `src/lib/ai/{sse,resilience,capabilities}.ts` |
| Política **free-only** é requisito não negociável | `PROMPT-MELHORIA.md`, `AUDITORIA.md` |

**Conclusão do survey:** o JARVIS não é um sistema primitivo. O que falta não é "criar" o motor multiagente, e sim **torná-lo visível, compreensível, consistente e governado**, além de concluir o diagnóstico já iniciado e desmontar o monólito da UI.

## Goals, non-goals, anti-goals

**Goals**
- G1 — Navegação e informações com hierarquia clara; cada função em um lugar lógico; tooltips/descrições onde úteis.
- G2 — Design system preto/branco/cinza consistente em **todas** as telas, com indicadores de estado por texto + ícone (não só cor).
- G3 — Painel de equipes em tempo real: agente, modelo, especialização, status, tarefa, progresso, última atividade, resultados, erros, tempo; comunicação visualizada; histórico.
- G4 — Criação de equipe simples (nome, objetivo, agentes, líder) com ajustes avançados opcionais; duplicar/editar/excluir.
- G5 — Revisão cruzada com critérios objetivos e retorno para correção (já existe `fixRounds`/reviewer — tornar explícito e configurável).
- G6 — Diagnóstico interno completo: módulos com estado `ok | erro | atenção`, evidência e ação sugerida.
- G7 — `page.tsx` decomposto em componentes pequenos; fronteiras claras; erros centralizados; documentação de módulos.
- G8 — Nenhuma regressão: suíte ≥ 769, tsc/eslint/build limpos, política free-only intacta, dados e configs preservados.

**Non-goals**
- Reescrever o motor de IA, o catálogo de modelos ou as integrações (WhatsApp, studio, netlab, infra) do zero.
- Introduzir modelos/provedores pagos.
- Migrar framework (Next/Electron/React ficam).
- Buscar 100% de cobertura de testes cosmética.

**Anti-goals** (o que tornaria a entrega um fracasso mesmo compilando)
- Painel de diagnóstico que mostre status falso ou "simulado".
- Botão sem função; indicador que não reflita estado real.
- "Design system" novo convivendo com o antigo (duas fontes de verdade).
- Refatoração que apague trabalho não commitado de outra sessão.

## Constraints

- Windows 11 Pro, PowerShell 5.1 (sem `&&`/`||`); npm via lockfile `package-lock.json`.
- Build isolado em `.next-dist` (`JARVIS_DIST_DIR`); nunca gravar no `.next` (sessão concorrente).
- Parar servidor que serve `.next` antes de build (D9).
- Free-only por padrão; `JARVIS_ALLOW_PAID` desligado; nenhuma chave impressa.
- `prefers-reduced-motion`, foco visível, acessibilidade.
- Preservar integralmente as mudanças não commitadas listadas no plano de auditoria de hoje.
- Todo comportamento novo precisa de teste ou evidência de execução real.

## Abordagens (registro; usuário já escolheu A no brief)

- **A) Consolidar, refatorar e estender (recomendada, escolhida)** — manter o núcleo (orquestrador, IA, integrações), reconstruir a camada de apresentação em componentes, elevar o motor multiagente a um painel observável e concluir o diagnóstico. Risco concentrado e verificável. Custo: médio-alto, entregas incrementais.
- **B) Reescrita total da UI e do orquestrador** — "limpo", porém descarta anos de correções documentadas (D1–D17, R1–R10) e cria risco alto de regressão. Rejeitada.
- **C) Terceirizar em biblioteca de UI/agentes** — quebra a identidade e a política free-only, adiciona lock-in. Rejeitada.

**Escolha registrada:** A, com as decisões de arquitetura abaixo.

## Design

### W1 — Fundação visual (Design System)
- Consolidar tokens em `src/app/globals.css` + `src/lib/ui/tokens.ts` (uma fonte de verdade).
- Paleta preto/branco/cinza: superfícies neutras, acento único (branco/gelo), estados semânticos por forma + texto + ícone.
- Componentes primitivos reutilizáveis em `src/components/ui/` (Button, Badge, StatusDot, Card, Tabs, Field, EmptyState, Skeleton).
- ícones lucide padronizados, tamanhos 16/18/20, peso consistente.
- **Não** criar um segundo sistema: adaptar os componentes existentes aos tokens.

### W2 — Navegação e arquitetura de telas
- `NavRail` permanece como âncora, mas com agrupamento lógico e separadores: **Trabalho** (Chat, Equipe, Projetos/Arquivos, Terminal), **Criação** (Estúdio, Skills, Faculdade, Social), **Sistema** (Diagnóstico, Chaves, Ajustes).
- `page.tsx` decomposto: `useJarvisShell` (estado), `WorkspaceRouter`, `ChatWorkspace`, `TeamWorkspace`, `FilesWorkspace`, `TerminalWorkspace`, `SettingsWorkspace`, `DiagnosticsWorkspace`. Cada um < ~250 linhas.
- `RailItem` ganha `'files' | 'terminal' | 'diagnostics'`; projetos/arquivos e terminal deixam de estar escondidos dentro do chat.
- Tooltips (já há `title`) + `aria-label` + descrição curta no primeiro uso.

### W3 — Chat (reconstrução da experiência, não do transporte)
- Extrair de `page.tsx` para `src/components/chat/` (já existe esse diretório): `Composer`, `MessageList`, `MessageBubble`, `MarkdownView`, `ToolCallCard`, `ActivityStrip`, `AttachmentRow`.
- `ActivityStrip` torna explícitos os estados: pensando / planejando / executando / ferramenta / arquivo / aprovação / validando / finalizando (dados vêm dos eventos reais do agente — nunca texto inventado).
- Streaming, SSE, retry, render de código, uploads e cancelamento permanecem com os módulos atuais.

### W4 — Central de equipes multiagente (prioridade 2)
- **Criação assistida**: wizard em 2 passos — (1) nome, objetivo, líder, agentes sugeridos; (2) avançado: modelo por agente (manual/automático), ferramentas, permissões. Presets existentes em `roles.ts` (`preset()`) viram pontos de partida. Duplicar/editar/excluir.
- **Modelo inteligente**: manter `assignAutoModels` (já penaliza reuso de provedor); expor na UI as capacidades reais do modelo via `capabilities.ts`/`models.dev` — **nunca** atribuir capacidade inexistente.
- **Comunicação**: `LiveTimeline` + `transcript.tsx` evoluem para um grafo/listagem de mensagens entre agentes com filtro por agente e por tipo, mostrando apenas o contexto relevante por agente (o orquestrador já faz isso; tornar visível).
- **Painel de acompanhamento**: cards por agente com nome, modelo, especialização, status, tarefa atual, progresso, última atividade, tempo, erros; clique abre detalhe/transcript. `RunInlineCard`/`RunPanel`/`SessionsPanel` são unificados sob um único padrão visual.
- **Revisão cruzada**: `fixRounds` + papel `reviewer` existentes; expor critérios de conclusão (tarefa só vira `done` após verificação) e botão "revisar/solicitar correção" na UI, ligado ao evento de fix round.
- **Concorrência**: `FileLockManager` existente continua como autoridade; nenhum agente edita o mesmo arquivo sem lock.

### W5 — Diagnóstico interno (exigência adicional)
- Concluir e generalizar o trabalho em andamento: `/api/audit` passa a devolver um **mapa de módulos**, não só modelos.
- Cada módulo: `{ id, name, category, status: 'ok'|'error'|'attention'|'unknown', evidence, detail, checkedAt, action }`.
- Fontes reais: presença/health de rotas, `GET /api/agents/health`, `/api/models`, `/api/providers`, `/api/audit` (modelos N1–N5), locks/scheduler do orquestrador, integrações (WhatsApp/OpenWA, studio, netlab, infra), persistência (`data/` gravável), build (versão/commit).
- Tela `DiagnosticsWorkspace`: lista agrupada por categoria, filtro por status, contadores no topo, botão "rodar verificação" com progresso, detalhe expansível com evidência e ação sugerida. Nunca expõe valores de chaves.
- Separar claramente **falha do JARVIS** (corrigível) de **falha externa** (cota/chave/rede) — padrão já usado em `audit.ts`.

### W6 — Arquitetura, qualidade e documentação
- Serviços organizados: `src/lib/ui/` (tokens), `src/lib/diagnostics/` (mapa de módulos), orquestração permanece em `src/lib/agents/`.
- Erros centralizados: um `AppError`/`toApiError` para rotas, com mensagem em PT-BR e sem segredos.
- `docs/MODULOS.md`: o que cada módulo faz, onde nova funcionalidade deve ser adicionada, convenções.
- Testes: componentes de UI (render/estado), diagnóstico (classificadores/rotas), equipe (criação/duplicação/revisão), regressão das suítes existentes.
- Limpeza segura de lixo de build (`.next-*`, `out*.txt`) **somente após confirmação** — fora do escopo automático.

## Specification

### Inputs
| Input | Type | Required | Constraints | Default |
|---|---|---|---|---|
| Nome da equipe | string | sim | 1–60 caracteres | — |
| Objetivo da equipe | string | não | até 500 caracteres | '' |
| Agentes | array | sim | ≥1, papéis válidos de `roles.ts` | preset 'software' |
| Líder | string (agentId) | sim | pertence aos agentes | primeiro agente |
| Modelo por agente | string \| 'auto' | não | id do catálogo free ou auto | 'auto' |
| Filtro de diagnóstico | enum | não | `all\|ok\|error\|attention` | 'all' |
| Rodar verificação | ação | não | no máx. 1 execução concorrente | — |

### Outputs
| Case | Result | Shape |
|---|---|---|
| Equipe criada | persisted | `Team` em `data/teams.json`, visível na lista |
| Equipe duplicada | persisted | novo id, configs copiadas, nome sufixado |
| Diagnóstico carregado | json | `{ modules: ModuleStatus[], summary, checkedAt }` |
| Módulo com erro | json | status `error` + `evidence` + `action`, sem segredos |
| Falha externa | json | status `attention`, classificada como externa |
| Entrada inválida | HTTP 400 | mensagem PT-BR |

### Edge cases
| Case | Expected behaviour |
|---|---|
| Nenhum modelo gratuito conectado | equipe criada, mas agentes mostram "sem modelo" e diagnóstico marca `attention` |
| Dois agentes no mesmo arquivo | lock existente bloqueia; UI mostra "aguardando lock" |
| Modelo tocado fora do catálogo free | rejeitado; nunca cai em pago |
| Verificação de diagnóstico em andamento | segundo clique desabilitado com estado visível |
| Chave presente mas inválida | classificada como externa, valor nunca exibido |
| `prefers-reduced-motion` | animações desligadas, estados ainda visíveis |

### Acceptance criteria
- [ ] `NavRail` expõe Chat, Equipe, Arquivos, Terminal e Diagnóstico; cada rota abre o workspace correto.
- [ ] `page.tsx` ≤ 250 linhas; cada workspace extraído com responsabilidade única.
- [ ] Tela de diagnóstico lista módulos reais com status `ok|erro|atenção` e evidência, sem valores de chaves.
- [ ] Criar → duplicar → editar → excluir equipe funciona e persiste; teste cobre o ciclo.
- [ ] Painel da equipe mostra os 9 campos pedidos (nome, modelo, especialização, status, tarefa, progresso, última atividade, resultados, erros/tempo) com dados dos eventos reais.
- [ ] Revisão cruzada: tarefa com falha em revisão volta para correção (fix round) e o evento aparece no painel.
- [ ] Indicadores de atividade do chat usam fases reais do agente; nenhum texto de fase inventado.
- [ ] Design system: zero classes de cor "avulsas" em componentes novos; tokens ou primitivos.
- [ ] `npm test` ≥ 769, `tsc --noEmit` limpo, `eslint` limpo, `npm run build` (`.next-dist`) OK.
- [ ] Nenhuma chave de `data/keys.json` impressa em log/UI/teste; política free-only intacta.
- [ ] Mudanças não commitadas de outra sessão permanecem presentes e funcionais.

### Out of scope
- Limpeza de `.next-*`/`out*.txt` (requer confirmação do usuário).
- Testes reais de provedores sem chave (Cerebras, Mistral etc.) — apenas QA reproduzível documentado.
- Correção da física de modelos locais lentos (`deepseek-r1:8b`).
- Reintrodução de provedores pagos.
- Push/deploy/reinstalação do atalho empacotado sem pedir.

## Decisions

**Do usuário (mandato):** A (build completo), autonomia técnica total, 3 prioridades na ordem dada, tela de diagnóstico obrigatória, backups antes de mudanças destrutivas, preservar dados/configs/integrações, não esconder falhas, não declarar testes sem executar.

**Agente's calls (registradas para reversão):**
1. Evolução em 6 workstreams incrementais, não big-bang — para manter a suíte verde a cada passo.
2. `NavRail` ganha 3 itens (Arquivos, Terminal, Diagnóstico); Chaves/Ajustes ficam no grupo Sistema, não no meio da navegação principal.
3. Acento visual único (branco/gelo) substituindo ciano como cor primária; estados semânticos mantidos com forma+texto+ícone.
4. Diagnóstico reusa `/api/audit` (não cria novo backend do zero) e o estende com `/api/diagnostics`.
5. Prioridade de execução: W5 (concluir diagnóstico) → W1/W2 (base visual + navegação) → W4 (equipes) → W3 (chat) → W6 (qualidade/docs).
6. Nenhuma dependência nova de UI; primitivos feitos em cima do que já existe (Tailwind + lucide).
7. Builder-check feito inline neste documento em vez de subagent, por autonomia delegada e para evitar rodada extra de perguntas.

## Sources (verificado em 21/11/2026, arquivos locais)

- `package.json`, `tsconfig.json`, `next.config.ts`
- `src/app/globals.css`, `src/app/page.tsx`, `src/components/layout/*`
- `src/lib/agents/{orchestrator,roles,models,scheduler,locks,permissions,projectMemory}.ts`
- `src/lib/ai/{audit,capabilities,sse,resilience,providers,modelTests}.ts`
- `src/components/settings/{SettingsPanel,AuditPanel}.tsx`
- `docs/plans/2026-11-21-jarvis-audit-evolution.md`
- `audit-report.md`, `AUDITORIA.md`, `PROMPT-MELHORIA.md`
- `git status`, `git log`
