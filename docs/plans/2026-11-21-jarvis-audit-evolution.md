# Auditoria, reparação e evolução do JARVIS — Plano de execução

> Execução em modo **inline** (decisão delegada pelo usuário em 21/11/2026).
> Nenhuma funcionalidade é considerada pronta sem evidência de execução real.

**Goal:** transformar os subsistemas já existentes (modelos, provedores, equipes, netlab, studio) em um caminho verificável de "prompt → site/software/rede/vídeo", sem integrações falsas e sem quebrar o que já funciona.

**Stack verificado em 21/11/2026:** Node v26.13.1, Next 15.5.29, Vitest 4.1.12, TypeScript 5.7.x, Electron 42.11.18. Comandos npm via `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"`.

## Global Constraints (decisões fixas)

1. **Não apagar nada.** Backups antes de alterações estruturais. Preservar as alterações não commitadas de outra sessão em `src/lib/ai/{client,compat,customProviders}.ts`, `src/lib/agents/{orchestrator,parse,tools}.ts`, `src/app/api/providers/route.ts`, `src/components/chat/CustomProviders.tsx`, `CHANGELOG.md` e os arquivos novos `connectProvider.ts`, `tests/agent-fixes.test.ts`, `tests/connect-provider.test.ts`.
2. **Free-only por padrão.** `JARVIS_ALLOW_PAID` não está setado; OpenAI/Anthropic/DeepSeek presentes em `data/keys.json` NÃO serão ativados nem enviados a outros modelos. Nenhuma chave será impressa em log ou UI.
3. **Build isolado:** usar `JARVIS_DIST_DIR='.next-dist'`; nunca gravar no `.next` (sessão concorrente).
4. **Evidência obrigatória:** toda correção passa por teste que falha antes e passa depois; saída real salva em `data/audit/` (gitignored).
5. **Sem UI demonstrativa:** se o painel não refletir estado real, não é entrega.

## Review Focus (entradas que podem quebrar e não são exercitadas hoje)

- Modelo que responde 200 mas devolve texto com formato inválido → deve ser marcado com capacidade `json=false`, não silenciado.
- Provedor com cota diária esgotada → deve entrar em cooldown por provedor, não gerar nova chamada por modelo.
- Equipe com modelo indisponível → substituto deve preservar contexto e tarefa, sem reiniciar a missão.
- Dois agentes escrevendo o mesmo arquivo → bloqueio real (já testado em `tests/team.test.ts`, manter).
- Wake de modelo local (Ollama) ausente → decomposed fallback, nunca erro fatal.

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `docs/plans/2026-11-21-jarvis-audit-evolution.md` | criar | este plano |
| `src/lib/ai/audit.ts` | criar | avaliação real N1–N5, gravação em `data/audit/models.json` |
| `src/app/api/audit/route.ts` | criar | GET resultados / POST execução limitada da auditoria |
| `scripts/audit-models.mjs` | criar | executa auditoria via HTTP e salva evidência |
| `scripts/audit-team.mjs` | criar | missão multiagente real com modelos gratuitos e verificação de arquivos |
| `src/components/settings/AuditPanel.tsx` | criar | painel real de status de modelos/provedores/equipes |
| `tests/audit.test.ts` | criar | testes dos classificadores e do registro de auditoria |
| arquivos com falha na suíte | modificar | apenas após root cause reproduzido |

## Tasks

### Task 1 — Reproduzir e corrigir as falhas da suíte ✅ CONCLUÍDO
- [x] Falha de fallback de imagem: root cause = asserção obsoleta (ordem NVIDIA → Gemini → Pollinations). Teste corrigido sem enfraquecer garantias (busca posição-independente). Isolado 17/17.
- [x] Flake de terminal sob carga: root cause = `sleep(2500)` fixo; trocado por `esperaErro()` condicional, seguindo o helper já existente no próprio arquivo. Isolado 17/17.
- [x] Evidência: `Test Files 72 passed (72)`, `Tests 761 passed (761)`, `EXIT=0` (`$env:TEMP\jarvis-tests-after-fix.log`).

### Task 2 — Sistema interno de avaliação de modelos ✅ CONCLUÍDO
- [x] Criar `src/lib/ai/audit.ts` com:
  - `type AuditLevel = 1|2|3|4|5`
  - `interface AuditResult { provider, model, ok, ms, level, capability: {stream:boolean|null,json:boolean|null,reasoning:boolean|null,code:boolean|null,tools:boolean|null}, error?, sample? }`
  - `runModelAudit(modelId, level): Promise<AuditResult>` usando `completeOnce` real (o mesmo cliente do chat), com prompt progressivamente complexo por nível.
  - `readAudit(): AuditResult[]` / `saveAudit(results)` em `data/audit/models.json` via `writeJsonAtomic`.
- [x] Criar `src/app/api/audit/route.ts`: `GET` devolve resultados; `POST { models?: string[], level?: 1|2|3|4|5, limit?: number }` executa com limite padrão de 20 modelos e 60 s por modelo, nunca expondo chaves.
- [x] Teste `tests/audit.test.ts`: RED observado (módulo/rota ausentes → `ERR_MODULE_NOT_FOUND`; 5 asserções falhando no stub) → GREEN 7/7. Lint 0, tsc filtrado 0.
- [x] Critério parcial: unidade e contrato verdes; auditoria real depende do build (Task 3).

**Nota de test-first:** o stub temporário foi criado só para observar as 5 asserções falharem e substituído pela implementação real em seguida — padrão idêntico ao de `setCouncilLlm` (`src/lib/ai/council.ts`).

### Task 3 — Auditoria real e reparação de adaptadores
- [x] `scripts/audit-models.mjs`: inicia servidor isolado (`JARVIS_DIST_DIR=.next-dist`, porta 3011), busca `GET /api/models`, executa `POST /api/audit` em lotes de 3, salva log em `data/audit/run.log` e relatório em `data/audit/report.md`.
- [x] Robustez acrescentada após o crash `EXIT=-1`: resultados em array de módulo, retomada lendo `data/audit/models.json`, `writeReport()` após cada lote e no `catch`, handlers `SIGINT`/`SIGTERM`, remoção da duplicação de código do relatório. `node --check`=0, eslint=0.
- [x] Classificação por `classifyModelError`: 429/503/timeout/auth ficam com capacidade `null` (não provam nada); formato/capacidade inválida vira `false`. Bug real corrigido: `unavailable`/`auth` passaram a ser externos, com teste de regressão.
- [x] Evidência: execução N3/limite 20 → `EXIT=0`, 20 modelos em `report.md`; execução ampliada para os 72 do catálogo em andamento.
- [ ] Critério final: tabela com provedor, modelo, nível alcançado, latência, capacidades e erro real para toda a amostra.

### Task 4b — Mais IAs gratuitas na equipe (pedido do usuário)
- [x] Diagnóstico: `assignAutoModels` já via 72 modelos gratuitos conectados, mas a penalização por reuso (-18) era fraca demais: uma equipe de 4 agentes caía toda no mesmo modelo/provedor.
- [x] Correção: penalização explícita também por **provedor** já usado (-30 por agente anterior), somada à de modelo. Precedente: a própria função `assignAutoModels` em `src/lib/agents/models.ts` (sem novo módulo).
- [x] Test-first: teste alterado em `tests/team-auto.test.ts` falhou (`1` provedor) → GREEN 10/10. Verificação pontual com o catálogo real de 72 modelos: 4 agentes → 3 provedores distintos (`opencode`, `ollama`, `gemini`); arquivo temporário removido.
- [x] Lint 0, tsc filtrado 0; suíte completa **73 arquivos / 769 testes, EXIT=0** (`$env:TEMP\jarvis-tests-diversity.log`).
- [x] Evidência real em `data/audit/team.json`: equipe de 4 agentes com `nvidia|nvidia/nemotron-3.5-super-vl-120b-a12b`, `gemini|gemini-3.5-flash-lite`, `gemini|gemini-3.1-flash-lite` (2 provedores, 3 modelos reais), 7 tarefas, 15 mensagens, QA com ciclo de revisão/correção e relatório de 1129 chars. Todos os 6 checks=true.

### Task 4 — Missão multiagente real ✅ CONCLUÍDO
- [x] `scripts/audit-team.mjs`: cria projeto temporário, dispara `POST /api/agents/runs` com pedido "crie um site de soma com API e teste", acompanha a run até o fim, valida arquivos gravados, mensagens entre agentes, revisão do QA e relatório.
- [x] Execução real: run `5ff8dbb4-6a42-46c3-aff4-4860f76489eb` → `completed` em ~69 s; 4 agentes com modelos reais, 7 tarefas (work/verify/review/fix), 3 arquivos (`index.html`, `server.js`, `README.md`), 15 mensagens, ciclo QA de revisão e correção, relatório de 1129 chars. Todos os 6 checks=true (`data/audit/team.json`, `$env:TEMP\jarvis-audit-team.log`).
- [x] Critério atendido sem correção em `src/lib/agents/` — nenhuma falha real observada nesta missão.

### Task 5 — Fluxo prompt → site / software / rede / vídeo / animação
- [ ] Verificar com chamadas reais: `POST /api/chat` (site/software via equipe), `POST /api/netlab` (topologia), `POST /api/studio` (vídeo/animação).
- [ ] Corrigir apenas o que falhar, com teste de regressão.
- [ ] Critério: cada fluxo produz artefato real (arquivo, JSON de topologia, job de vídeo) e aparece no painel.

### Task 6 — Persistência e painel
- [x] `src/components/settings/AuditPanel.tsx`: lê `GET /api/audit`; mostra status real, nível alcançado, latência, capacidades N1–N5 e erros sem expor segredos. Estados de carregando, vazio e erro implementados; controles são elementos nativos navegáveis por teclado.
- [x] Conectado em `SettingsPanel.tsx` como seção “Diagnóstico de IAs” (ícone `Activity`), seguindo o padrão visual de `ImageSettings.tsx`.
- [x] Critério de build: `npm run build` com `JARVIS_DIST_DIR=.next-dist` → `Compiled successfully`, `/api/audit` na lista de rotas, `EXIT=0`.
- [x] Critério de suíte: `Test Files 73 passed (73)`, `Tests 769 passed (769)`, `EXIT=0` (`$env:TEMP\jarvis-tests-final.log`).

### Task 7 — Relatório final
- [ ] Preencher os 12 itens pedidos com números reais e caminhos de log.

## Incidentes e decisões (registro de evidência)

| # | Sintoma | Root cause | Ação | Evidência |
|---|---|---|---|---|
| 1 | `tests/voice-images-social.test.ts:141` falhava | Asserção fixava `fallbacks[0]` como Gemini; a cadeia real tenta NVIDIA FLUX primeiro quando há chave | Teste passou a buscar o aviso por posição-independente, mantendo todas as garantias | 17/17 isolado; 761/761 suíte |
| 2 | `tests/terminal-sessions.test.ts` falhava só sob carga | `sleep(2500)` fixo não espera a condição | Trocado por `esperaErro()` condicional (helper já existia no arquivo) | 17/17 isolado |
| 3 | `audit.ts` marcaria cota/chave inválida como `capability=false` | `classifyModelError` devolve `unavailable`/`auth`, ausentes na lista de erros externos | Incluídos `unavailable` e `auth`, com teste de regressão | 8/8 em `tests/audit.test.ts` |
| 4 | `next build` falhava em `.next/types/validator.ts:449` | Artefato gerado às 04:30 referencia `src/app/api/video/route.js`; rota foi removida de propósito no commit `c0e718f`, mas `tsconfig.json` inclui `.next/types/**/*.ts` | Removido **apenas** esse include obsoleto do `tsconfig.json`. Nada foi gravado em `.next` (sessão concorrente) | `Compiled successfully`, rota `/api/audit` listada, `EXIT=0` (`$env:TEMP\jarvis-build-audit2.log`) |

**Nota sobre o incidente 4:** o diretório `.next` pertence a outra sessão e não foi tocado. O include removido é um artefato de build, não código-fonte; o Next.js readiciona o padrão correspondente ao `distDir` ativo quando necessário.

## Sources (verificado em 21/11/2026, arquivos locais)

- `package.json` — versões e scripts.
- `src/lib/ai/providers.ts` — provedores, chaves, `chatProviders()`, `PAID_ENABLED`, cache.
- `src/lib/ai/modelTests.ts` — persistência de resultados, `classifyFailure`, `lacksCapability`.
- `src/lib/agents/orchestrator.ts` — planejamento, scheduler, comunicação, fix rounds, fallback.
- `src/lib/agents/models.ts` — `assignAutoModels`, `replacementsFor`, `ModelHealth`.
- `tests/team.test.ts` — contrato atual da equipe.
- `data/keys.json` — somente presença de chaves (valores nunca lidos/expostos).

## Convention Catalogue (catalogado em 21/11/2026, antes de escrever código)

Precedentes lidos por completo: `src/lib/ai/modelTests.ts`, `src/lib/ai/catalog.ts` (`testProviderModel`, `probeStream`, `probeJson`), `src/lib/ai/council.ts`, `src/app/api/models/route.ts`, `tests/model-tests.test.ts`, `tests/setup.ts`.

| Dimensão | Convenção adotada | Precedente |
|---|---|---|
| Placement | libs em `src/lib/ai/<feature>.ts`; rotas em `src/app/api/<nome>/route.ts`; testes em `tests/<nome>.test.ts`; scripts em `scripts/<nome>.mjs` | `modelTests.ts`, `models/route.ts` |
| Naming | arquivos `kebab-case`, tipos `PascalCase`, funções `camelCase`, exports nomeados (sem default) | todos |
| Function shape | funções assíncronas com argumentos posicionais + objeto de opções; retorno `Promise<objeto simples>` | `testProviderModel(providerId, modelId, opts)` |
| Errors | `throw new Error(msg)` em português; classificação externa com `classifyModelError` / `classifyFailure`; nunca engolir erro externo | `modelTests.ts`, `council.ts` |
| Validation | checagem simples no limite HTTP; `400` para entrada inválida | `models/route.ts` |
| Logging/persistência | `dataDir()` + `readJson` + `writeJsonAtomic` de `src/lib/agents/fsutil.ts` | `modelTests.ts` |
| Secrets | `redact` de `src/lib/redact.ts` antes de gravar erro amostra; nenhuma chave em log/UI/prompt | `redact.ts`, `tests/setup.ts` |
| Config | `process.env` lido no módulo; free-only por `PAID_ENABLED` | `client.ts`, `providers.ts` |
| Testability | injeção do cliente real via setter (`setCouncilLlm`) em vez de `vi.mock` de módulo | `council.ts:54-60` |
| Tests | vitest, `tests/*.test.ts`, alias `@/`, `JARVIS_DATA_DIR` isolado por arquivo | `vitest.config.mts`, `tests/setup.ts` |
| Comentários | docstring curta em cima de funções públicas; português para comportamento do produto, inglês para notas técnicas | `modelTests.ts`, `catalog.ts` |
| Commits | nenhum commit automático sem revisão; convenção existente não identificada como Conventional Commits | `git log` local |

Nenhuma dependência nova será adicionada. Nenhuma convenção nova está sendo introduzida: o módulo de auditoria soma-se aos precedentes acima.

## Handoff

Modo escolhido: **inline** (o usuário delegou decisões; as tarefas são sequenciais e dependentes de evidência da etapa anterior). Nenhuma decisão adicional será solicitada.
