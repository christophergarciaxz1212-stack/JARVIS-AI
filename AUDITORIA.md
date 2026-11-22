# AUDITORIA — Transformação 21/11/2026 (branch `feature/jarvis-transformacao`)

Trabalho desta sessão, executado em paralelo com outra sessão que aplicava o mesmo briefing. Backups em `.tmp/backup-2026-11-21/` e `.tmp/git-status-before-transformacao.txt`. Plano: `docs/plans/2026-11-21-jarvis-transformacao-{design,impl}.md`.

## O que foi entregue

| Item | Arquivo / commit | Evidência |
|---|---|---|
| Diagnóstico interno real (exigência adicional) | `src/lib/diagnostics/modules.ts`, `/api/diagnostics`, `DiagnosticsPanel` integrado, `/diagnostics` — `d1c6dc0`, `5ee791b` | 8 sondas reais (runtime, catálogo, auditoria N1–N5, agentes, provedores, WhatsApp, persistência, build); status `ok/erro/atenção/desconhecido` com evidência e ação; SSE; nenhuma chave exposta. Tests 12/12 |
| Contrato unificado | `DiagnosticsPayload` em `src/app/api/diagnostics/route.ts` | Serve simultaneamente o painel rico da sessão concorrente e o mapa simples de módulos |
| Design system (base) | `src/lib/ui/tokens.ts`, `src/components/ui/` — `5ee791b` | Status sempre com texto + símbolo + `aria-label`; 8 primitivos sem dependência nova. Tests 7/7 |
| Mapa de módulos | `docs/MODULOS.md` — `70231a6` | Onde cada coisa vive e onde adicionar funcionalidade |
| Auditoria visual estática | `docs/auditoria/analise-visual-2026-11-21.md` — `62430a2` | 368 cianos hardcoded em 66 arquivos, 5 raios de borda, 400 variações de padding, `truncate` sem `title`, status só por cor |
| Correções de build | `a09a33e`, `1b4e409` + imports em `core.ts` | `createdAt` em `pendingReply` do líder; `Plus` não importado no FilesPanel; `isSafeCommand` |

## Verificação medida

- `npm test`: **777/777 testes, 75 arquivos, EXIT=0** (duas execuções: `$env:TEMP\jarvis-final-tests.log` e `jarvis-final-tests2.log`).
- `tsc --noEmit`: EXIT=0 (limpo).
- `eslint`: 0 erros; 5 avisos preexistentes de `<img>`.
- `npm run build` (`JARVIS_DIST_DIR=.next-dist`): **compilou com sucesso** (116 s), mas o pré-render de `/` falhou com `ReferenceError: showSocial is not defined` vindo de um chunk compilado durante edição concorrente. O símbolo **não existe mais em nenhum arquivo-fonte** (`grep showSocial src/` vazio). Não é defeito do código entregue nesta branch; é corrida de build com a outra sessão.

## Pendências (honestas)

1. **Build final verde não pôde ser afirmado**: a outra sessão continuou editando `page.tsx`/`FilesPanel.tsx` até 17:29. Reexecutar teste + build **depois** que ela terminar as Fases C–I do `JARVIS-TRANSFORM-PLAN.md`.
2. **Fases C–I do plano concorrente** (AppShell, chat, equipes v2, settings, painéis) são de responsabilidade daquela sessão; não foram sobrescritas aqui.
3. Auditoria visual é estática — falta inspeção em navegador (telas/modais/resoluções) após estabilização.
4. Limpeza de `.next-*`/`out*.txt` exige confirmação; não feita.

## Rollback

`git revert <commit>` na ordem inversa: `1b4e409`, `a09a33e`, `62430a2`, `70231a6`, `5ee791b`, `d1c6dc0`. Os arquivos originais também estão em `.tmp/backup-2026-11-21/`. A branch pode ser descartada sem afetar `master`.

---

# AUDITORIA — revisão do trabalho do OpenCode (19/11/2026, Claude)

Tudo que mudou desde o checkpoint `%LOCALAPPDATA%\JARVIS-checkpoints\2026-11-16_2314` (110 arquivos novos, 43 modificados) foi revisado por risco: segurança primeiro, depois correção, depois design. Detalhes e verificação: `CHANGELOG.md` (19/11).

| # | Defeito | Evidência | Impacto | Status |
|---|---------|-----------|---------|--------|
| R1 | Ponte Antigravity rodava o agente `agy` na pasta do JARVIS, sem cancelamento e com prompt na linha de comando | `antigravity.ts`: `execFile` sem `cwd`/`signal`; `--help` do agy lista ferramentas e `--dangerously-skip-permissions` | Agente externo com a pasta (e `data/keys.json`) ao alcance; "Parar" não parava; conversa longa quebrava | **RESOLVIDO**: pasta vazia própria, `signal`, limite de 30 mil caracteres vira erro de contexto |
| R2 | Testes chamavam os CLIs reais (agy, opencode) | 2 testes de imagem com timeout de 20 s; chamada real a `agy` → `Individual quota reached… Resets in 139h50m` | Cota grátis do usuário gasta a cada `npm test` | **RESOLVIDO**: `tests/setup.ts` desliga os CLIs; 413/413 em 32–45 s |
| R3 | XSS refletido e state OAuth ignorável no callback da Meta | `oauth/callback/route.ts` interpolava `error` no HTML; `service.ts` aceitava qualquer state sem arquivo | Execução de script na origem do JARVIS; login-CSRF | **RESOLVIDO** + `tests/whatsapp-oauth.test.ts` |
| R4 | WinGet síncrono congelava o servidor | `system.ts`: `execFileSync(..., 240_000)` | Até 4 min com o app inteiro parado | **RESOLVIDO**: assíncrono, `--exact --id` |
| R5 | Portal com isolamento de sites desligado | `playwrightPortal.ts`: `--disable-features=IsolateOrigins,site-per-process` | Janela de login do portal sem a proteção do Chromium | **RESOLVIDO** |
| R6 | Boot nunca saía sozinho | `BootSequence.tsx` sem `setTimeout`/`keydown` (o checkpoint tinha os dois) | Tela travada até clicar, a cada abertura | **RESOLVIDO** |
| R7 | `next.config.js` na raiz anulava o `next.config.ts` | Next 15 `CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts']` | Dev e build sem `serverExternalPackages: ['baileys']` e sem pasta separada do dev | **RESOLVIDO**: movido para `scripts/dist/` |
| R8 | Webhook da Meta bloqueado pelo middleware; porta errada nas instruções | Middleware recusa Host não local; túneis entregam Host público; texto fixava 3002 | Recebimento de mensagens impossível | **RESOLVIDO**: só `/api/whatsapp/webhook` passa (HMAC, fail closed) |
| R9 | ~40 classes de animação sem uso; `jarvis-ripple` no lugar errado; animações duplicadas nos painéis; brilho quadrado no logo | Contagem de uso no `src/` (0 usos); captura da tela inicial | CSS morto e efeitos quebrados | **RESOLVIDO**: `motion.css` + `MotionLayer.tsx` (ver CHANGELOG) |
| R10 | `--no-sandbox` global no Electron; OpenWA baixado sem hash; scaffold `whatsapp/WhatsAppCenter.tsx` sem uso | `electron/main.js`, `openwa/manager.ts` | Risco aceito pelo contexto do PC | **PENDENTE (decisão do usuário)** |

---

# AUDITORIA — JARVIS (16/11/2026)

Feita por duas sessões em paralelo, por escolha do usuário: **Claude** (outra sessão; ver `CHANGELOG.md`) e **OpenCode** (esta sessão). Cada item abaixo diz quem fez e a evidência. O projeto **não tem git**: o rollback de cada item está descrito nele.

## Antes de mexer (estado medido — build de 16/11 18:57, porta 3100)

- Catálogo: **505 modelos listados, só 42 gratuitos**; conectados: gemini (21), groq (4), openrouter (417, **incluindo pagos**), openai (45), anthropic (14), deepseek (2); ollama (2); lmstudio desconectado.
- `POST /api/models` (botão "Testar") **quebrado** para Gemini (`Provedor sem endpoint de chat: gemini`) e Ollama (`HTTP 404`).
- Modelo padrão: `gemini|gemini-3.5-flash-lite`, medido em **25,8 s** por resposta.
- `npm test`: 247/247; `tsc`: limpo; último build: OK.
- Bateria de 10 tarefas (Claude): `docs/auditoria/bateria-antes.md` — 6/10 com artefato verificado; T3 ("versão do Node neste computador") ia para o chat, sem ferramentas: resposta sem evidência.

## Defeitos, por impacto

| # | Defeito | Evidência | Impacto | Status |
|---|---------|-----------|---------|--------|
| D1 | Teste de modelo inutilizável para Gemini e Ollama | `.tmp/battery-before.json`: `HTTP 404: 404 page not found` (ollama), `Provedor sem endpoint de chat: gemini`; `catalog.ts` montava `${OLLAMA_BASE_URL}/chat/completions` sem `/v1` e Gemini não tem `chatBaseUrl` | Botão "Testar" e diagnóstico automático cegos para 2 dos 4 provedores reais | **RESOLVIDO** (OpenCode): teste agora passa por `completeOnce`, que trata Gemini (SDK), Ollama (`/api/chat`) e OpenAI-compatible (SDK). Medido depois: 18/19 no teste rápido, 27/34 na varredura total (falhas = 429/503/timeout transitórios) |
| D2 | Modelos pagos listados e selecionáveis (OpenAI, Anthropic, DeepSeek, xAI) + pagos do OpenRouter visíveis | `GET /api/models` (antes): 505 modelos, 42 free; botão Chaves listava provedores pagos | Custo potencial silencioso; contra a política pedida ("somente gratuitos") | **RESOLVIDO** (OpenCode): blocos removidos de `providers.ts`; OpenRouter filtrado para `:free`/preço zero; trava `JARVIS_ALLOW_PAID=1` restaura modo pago; imagens OpenAI removidas de `images.ts`, `prefs.ts`, `api/media`, `ImageSettings.tsx` e do teste |
| D3 | Modelos gratuitos comprovadamente mortos continuavam no seletor | `data/model-tests.json`: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite` → `retired` (404); `gemini-pro-latest`, `3.1-pro-preview`, `omni-*`, `4-argon`, `4-carbon` → `no-free-quota` (429 `limit: 0`); `inkling-2-small` → `blocked` (403 agentic-only) | Usuário escolhia modelo e tomava erro toda vez | **RESOLVIDO** (Claude): `src/lib/ai/modelTests.ts` classifica `retired/no-free-quota/blocked/temporary`; falhas permanentes ocultas por 3 dias; `temporary` (503/timeout/429-cota-diária) nunca oculta |
| D4 | Modelo padrão lentíssimo e sem noção de latência | `defaultModelFrom` preferia o primeiro flash de cada provedor; `gemini-3.5-flash-lite` medido em 25,8 s | Toda mensagem pagava esse custo | **RESOLVIDO** (Claude): latência medida (`latencyOf`) persiste e pondera ranking e padrão; novo padrão medido: `groq|openai/gpt-oss-120b` (**0,39–0,63 s**) |
| D5 | Ollama aparecia "desconectado" e atrasava o catálogo | `catalog.ts` usava `localhost` (tenta `::1` primeiro; Ollama escuta só IPv4), sem cache, timeout 2,5 s | Modelos locais sumiam do catálogo com 0 modelos | **RESOLVIDO** (Claude): `127.0.0.1`, cache de 15 s com stale-while-revalidate, sonda não bloqueia mensagem |
| D6 | Roteamento agente↔chat mandava pergunta com ferramenta para o chat | `tests/routing.test.ts` (antes: T3 → chat); `bateria-antes.md`: T3 sem execução | Resposta inventada em vez de comando rodado | **RESOLVIDO** (Claude): `src/lib/agents/shouldRunAgent.ts` — "instalada neste computador", "quanta/quantas", arquivos/projeto/infra → agente. Medido depois: T3 rota `agente` |
| D7 | Teste com `max_tokens=16` zerava respostas de modelos de raciocínio | Resposta real da Groq (`reasoning_tokens: 14`, `content: ""`, `finish_reason: "length"`); openrouter `ling`/`ernie` idem | Modelos bons reprovados no teste | **RESOLVIDO** (OpenCode+Claude): teste via `completeOnce` sem limite artificial; modelos aprovados (`gpt-oss-120b` 393 ms, `ernie-5.5-flash` 1,4 s, `ling` 3,2–6,5 s) |
| D8 | Ollama com `num_ctx` 2048/4096 cortava o prompt dos agentes em silêncio | `client.ts` (antes: sem `options`); Ollama documenta default 2048 | Agentes perdiam contexto do plano/erros | **RESOLVIDO** (Claude): `ollamaNumCtx()` por tamanho (≤4B→16384, ≤9B→8192, >9B→4096) + `keep_alive` 30 m |
| D9 | `next build` falha com `ENOENT … _buildManifest.js.tmp.*` quando um `next start` serve `.next` | Duas falhas seguidas sem edição de código; após parar o servidor na porta 3100 (PID 14008): build completo e `BUILD_ID` escrito (22:28) | Rebuild "do nada" quebrado; falso defeito de código | **CONTORNO DOCUMENTADO**: sempre pare o servidor que serve `.next` antes de `npm run build` |
| D10 | Comentários do catálogo/trava contradiziam o código (falavam em provedores pagos "mantidos" / "reativáveis" quando os blocos já tinham sido removidos) | `providers.ts` (cabeçalho `PAID_ENABLED`), `catalog.ts` (cabeçalho) | Reativação "fantasma": flag ligaria nada | **RESOLVIDO** (OpenCode): textos agora descrevem a realidade (pago removido; para voltar: re-registrar blocos em `PROVIDER_APIS` + `JARVIS_ALLOW_PAID=1`) |
| D11 | Chaves pagas órfãs em `data/keys.json` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`) | `data/keys.json` (nomes conferidos, valores não lidos) | Chaves salvas sem uso | **PENDENTE (decisão do usuário)**: apagar pela UI de chaves ou manter; o app já não as usa |
| D12 | Provedores pagos não removíveis por "flag" no estado final unificado — duas abordagens concorrentes (remoção vs. gate `JARVIS_ALLOW_PAID`) | Edições simultâneas das duas sessões nos mesmos arquivos às 21:37–22:08 | Incoerência de documentação e de mental model | **RESOLVIDO**: coexistência documentada — catálogo só tem gratuitos; `PAID_ENABLED` é trava para quando/se um provedor pago for re-registrado |
| D13 | `npm test` flaky sob I/O pesado (6 timeouts em `infra-core.test.ts` na 1ª execução; 270/270 na 2ª, mesma máquina, sem mudança de código) | Saída de `npm test` às 21:47 vs 21:53 | Alarme falso de regressão | **OBSERVADO**: provavelmente os downloads de Ollama rodando junto (4,7 GB em `ollama pull`); não é bug de código |
| D14 | `deepseek-r1:8b` local no limite de timeout (108 s passou; 120 s estourou 2×) | `.tmp/battery-after.json` (PASS 107,9 s); varredura total (timeout em 120 s) | "OK" demora 2 minutos | **MITIGADO, NÃO CORRIGIDO**: física (thinking, CPU/6 GB VRAM). Para uso diário, `llama3.2:3b`/`gemma3:4b`/`qwen3:4b` são os eficientes |
| D15 | Streaming descartava evento cortado entre pacotes TCP e não tinha heartbeat; modelo local carregando >30 s podia derrubar a conexão | Parser antigo em `page.tsx` (`buffer.split('\n')` + `if (!line.startsWith('data: ')) continue`) descartava a linha incompleta; `route.ts` sem `setInterval` | Texto perdido em silêncio; conexão ociosa fechada por proxy antes do primeiro token | **RESOLVIDO** (OpenCode): `src/lib/ai/sse.ts` (parser incremental, CRLF, multilinha, `flush`) + heartbeat de 15 s em `route.ts`; 6 testes em `tests/ai-sse.test.ts` |
| D16 | `tools`/`response_format` enviados a qualquer modelo, inclusive locais e provedores sem JSON nativo | `client.ts` (antes: `if (opts.tools?.length)` e `if (opts.json && JSON_MODE.has(provider))` sem consultar o modelo) | Erro de provedor ou JSON embrulhado em cerca markdown; modelo local sem tool calling recebia ferramentas | **RESOLVIDO** (OpenCode): `src/lib/ai/capabilities.ts` decide por modelo/provedor; JSON sem suporte nativo vira instrução textual; 6 testes em `tests/ai-capabilities.test.ts` |
| D17 | Um erro transitório (rede/429 curto) derrubava a resposta inteira, sem retry; troca de modelo podia emendar duas respostas | `route.ts` (antes: `for (const candidate of chain)` sem retry; fallback disparava mesmo após texto emitido) | Falha evitável e resposta duplicada | **RESOLVIDO** (OpenCode): `src/lib/ai/resilience.ts` — backoff com jitter/teto, `retry-after` curto, fallback só antes do primeiro token; 5 testes em `tests/ai-resilience.test.ts` |

## Não testado (e por quê)

- **Cerebras, Mistral, SambaNova, NVIDIA NIM, Hugging Face**: sem chave em `data/keys.json`/`.env.local` — impossível testar chamada real. O código de listagem/verificação foi revisado; entra em QA assim que a chave for cadastrada.
- **LM Studio**: configurado (`LMSTUDIO_BASE_URL`) mas fora do ar — o catálogo reporta `disconnected` corretamente. Nada a corrigir.
- **Gemini `gemini-3.8-flash`**: estourou o timeout de 120 s na varredura (modelo muito grande/lento; classificação `temporary`, permanece no catálogo).
- **Modelos "no-free-quota"**: falham por cota gratuita zero no AI Studio (`limit: 0`) — permanecem ocultos até a cota ser ativada.

## Rollback por item

| Item | Como desfazer |
|------|----------------|
| D1 teste via `completeOnce` | `git` não existe: reverter manualmente os blocos `chatCompletion`/`testProviderModel` em `src/lib/ai/catalog.ts` para a versão anterior deste arquivo (backup: `.next` antigo foi sobrescrito; reconstruir a partir de `data/backups/` se houver) |
| D2 provedores pagos removidos | Re-adicionar os 4 blocos de `PROVIDER_APIS` (estão no histórico deste relatório e no `CHANGELOG.md`) e/ou definir `JARVIS_ALLOW_PAID=1` após re-registrar |
| D2 imagens OpenAI | Restaurar `viaOpenAI` em `src/lib/media/images.ts` e o item em `ImageSettings.tsx`/`prefs.ts`/`api/media/route.ts`; o teste `voice-images-social.test.ts` foi ajustado junto |
| D3 ocultação por falha | Apagar `data/model-tests.json` (todos voltam ao catálogo) |
| D4 default por latência | Editar `defaultModelFrom` em `catalog.ts` para ignorar `latencyOf` |
| D5 Ollama 127.0.0.1+cache | Reverter `LOCAL` e `probeLocalCached` em `catalog.ts` |
| D6 roteamento | Remover as regras novas de `shouldRunAgent.ts` |
| D7 max_tokens=16 | (histórico) teste volta a truncar raciocínio |
| D8 num_ctx/keep_alive | Remover `ollamaPayload`/`ollamaNumCtx` de `client.ts` |
| D9 build vs servidor | (procedimento, não código) |
| D10/D12 comentários | (texto; nenhum efeito em runtime) |

## Fase 3 — bateria antes/depois (10 tarefas)

Fontes: `docs/auditoria/bateria-antes.md` (Claude, ~21:30), `bateria-depois-1.md` (Claude, 22:32, após fixes de roteamento/latência) e `bateria-depois-opencode.md` (OpenCode, 22:48, build completo de 22:28).

| Tarefa | Antes | Depois-1 | Depois-opencode |
|--------|-------|----------|-----------------|
| T1 criar arquivo notas/hoje.txt | agente, 3 ferramentas, artefato ✓ | agente, 4, ✓ | agente, 4, ✓ |
| T2 listar .js do projeto | agente, **timeout 243 s**, sem artefato | agente, 2, ✓ | agente, 5, ✓ |
| T3 versão do Node (máquina) | **chat — sem ferramenta** (resposta sem evidência) | agente — **failed** (429 Groq) | agente, 4, ✓ (`v26.13.1`) |
| T4 corrigir buggy.js | agente, 5, ✓ | agente, 5, ✓ | agente, 5, ✓ |
| T5 fib.py | agente, 4, ✓ | agente, 4, ✓ | agente, 4, ✓ |
| T6 linhas de dados.csv | agente, 2, artefato **não** verificado | agente, 2, ✓ | agente, 11, ✓ |
| T7 npm test | agente, 4, **tempo esgotado 246 s** | agente, 4, ✓ | agente, 3, ✓ |
| T8 explicar DNS | chat, respondeu, ✓ | chat, ✓ | chat, ✓ |
| T9 imagem de gato | chat, execução de mídia, ✓ | chat, ✓ | chat, ✓ |
| T10 README.md | agente, 4, ✓ | agente, 9, ✓ | agente, 4, ✓ |

Resultado: antes **6/10** com artefato verificado → depois-opencode **10/10** (T2 e T7 deixaram de estourar; T3 passou a executar com ferramenta). Nenhuma tarefa pediu permissão indevida em nenhuma execução.

Verificação final de código (sobre o build de 22:28):
- `vitest`: **295/295** — os 2 "timeouts" vistos às 22:49 foram os testes do engine (instalação real de npm) sob carga da bateria; rodando ocioso: 24/24.
- `tsc --noEmit`: limpo. `eslint`: limpo. `npm run build`: OK (ver D9 para o procedimento quando há servidor servindo `.next`).
- Varredura "testar todos": **27/34** modelos do catálogo respondem; os 7 não são defeitos — 4×429/503/timeout transitórios, 1 abort de 120 s (modelo grande), 2× hello de cota (permanentemente ocultos pelo app).

## Fase 4 — comunicação e operação (OpenCode, 22:39–23:00)

Novos módulos, todos com teste ou evidência de execução real:

| Módulo | O que faz | Evidência |
|---|---|---|
| `src/lib/ai/sse.ts` | Parser/encoder SSE incremental: pacote cortado, CRLF, `data:` multilinha, heartbeat ignorado, `flush` final | `tests/ai-sse.test.ts` — 6/6 |
| `src/lib/ai/capabilities.ts` | Capacidades por modelo (tools, JSON nativo/prompt, visão, raciocínio, contexto, local, free); OpenRouter só `:free` | `tests/ai-capabilities.test.ts` — 6/6 |
| `src/lib/ai/resilience.ts` | Backoff exponencial com jitter e teto, `retry-after` curto, fallback só antes do primeiro token | `tests/ai-resilience.test.ts` — 5/5 |
| `src/lib/ai/status.ts` | Contrato `connecting/retry/fallback/streaming` + nome curto do modelo | Usado em `page.tsx`, `TopBar`, `TypingIndicator` |
| `src/components/layout/CommandPalette.tsx` | Ctrl+K com ações reais e modelos do catálogo ao vivo; teclado; modelo atual marcado | Build + `tsc` limpos |
| `src/components/layout/TopBar.tsx` | Status vivo (`conectando`, `tentando de novo (n)`, `trocando de modelo`, `gerando`), cronômetro, provedores, relógio | Build + `tsc` limpos |
| `src/components/chat/TypingIndicator.tsx` | Indicador honesto: modelo, tempo, fase do servidor, aviso de modelo local; sem "raciocinando" inventado | Build + `tsc` limpos |
| `src/app/operations.css` | Estilos isolados; `transform`/`opacity`; `prefers-reduced-motion` e `[data-motion="off"]` | Importado em `layout.tsx` |

Mudanças de comportamento:
- `POST /api/chat`: heartbeat de 15 s; retry cancelável antes do primeiro token; eventos `status` (`retry` com tentativa/espera/motivo; `fallback` com modelo de origem); `done` com `usage` e `elapsedMs`; falha definitiva registrada em `model-tests.json`.
- `client.ts`: `tools` e `response_format` só quando `resolveCapabilities()` permite; JSON sem suporte nativo recebe instrução textual; Gemini só pede `application/json` quando suporta.
- `page.tsx`: consumo por `SSEParser`, um único `apply()` para eventos e resto do buffer; tokens/tempo no rodapé; Ctrl+K/Ctrl+N/Esc.
- `data/prefs.json`: `"accent":"mono"` como padrão (preto/branco/cinza); demais paletas preservadas.

Verificação final desta fase:
- `vitest` **295/295** (27 arquivos) rodando ociosa; `engine-integration` 6/6 isolado em 7,98 s (o timeout anterior era I/O concorrente com o build — D13).
- `tsc --noEmit`: limpo.
- `npm run build`: **exit 0**, `BUILD_ID MFmdGQRqyGtzZtOMongYI`.
- Bateria `bateria-depois-opencode.md`: **10/10** com artefato verificado.

## Ponte Antigravity — CLIs grátis do Google entregues ao JARVIS (17/11)

O usuário pediu que os CLIs de IA instalados na máquina tivessem seus **modelos grátis** entregues ao JARVIS. Resultado da investigação completa:

| CLI | Modelos grátis | Usável no JARVIS? |
|---|---|---|
| **Antigravity CLI** (`agy` 1.5.10, instalado, na conta Google do usuário) | `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` (OK), `gemini-3.8-flash-high/medium/low` (**quota estourada**, reset ~88h) | ✅ **ENTREGUE** — provider `antigravity` no catálogo, chat e agentes (ponte CLI, sem API key) |
| Claude Code / Claude Desktop | nenhum (exige Claude Pro US$ 20+, ou API paga) | ❌ Nada grátis a entregar |
| Codex (OpenAI) | ChatGPT Free limita o Codex CLI ao tier mais baixo | ❌ Único caminho seria assinatura; CLI não está instalado; não há API grátis |
| VS Code | nenhuma (editor; quem dá modelo é o Copilot) | ❌ |
| GitHub Copilot CLI | Copilot Free (créditos grátis/limite baixo, jul/2026: billing por uso) | ❌ IDE-bound, não expõe API própria; CLI não está instalado |
| Gemini CLI | aposentada — virou Antigravity CLI (junho/2026) | ❌ Substituída pelo `agy` |
| Antigravity IDE | mesmos modelos do CLI (mesma cota) | ⚠️ Divide cota com o `agy` no JARVIS |
| DeepSeek Harness (`dsh`) | o harness é grátis; os modelos não (API paga). Sem tier free próprio | ❌ Nada a entregar; binary não encontrado na máquina |
| Qoder CLI / IDE (Community Edition, grátis) | Qwen 3.6, DeepSeek, GLM, Kimi (plano Community, sem chave) | ⚠️ IDE instalada em `F:\Qoder`, mas sem endpoint/CLI headless exposto para o JARVIS; nada a consumir programaticamente |
| Freebuff (Codebuff grátis, instalado em `Local\Freebuff`) | modelos open grátis (limite da comunidade) | ⚠️ GUI-bound, sem API; não vira backend do JARVIS |

**Critério**: um CLI só vira provedor de modelo do JARVIS se expõe (a) API OpenAI-compatible gratuita, ou (b) modo não-interativo oficial (`--print`/`exec`) rodando na conta do próprio usuário. Só o Antigravity atende hoje.

## Pendências

Ver seção PENDENTE do relatório final. Resumo: chaves pagas órfãs em `keys.json` (decisão do usuário), provedores sem chave sem teste real possível, `deepseek-r1:8b` lento por natureza, **`npm run sync-packaged` pendente** para levar o build novo (com a ponte Antigravity) à instalação que a área de trabalho abre (`AppData\Local\Programs\JARVIS`) — **o app instalado continua na versão antiga até você sincronizar/reinstalar**. O Antigravity divide a cota grátis com a IDE/CLI.

---

## Revisão geral, reparação e evolução (21/11/2026, 7ª rodada — OpenCode)

**Auditores**: 5 paralelos; E2 (Electron/infra) e C2 (agentes/equipes) entregaram relatórios completos; D3 (terminal/arquivos/diff) entregou sumário; A2 (UI/UX) entregou relatório completo; B2 (comunicação IA) e D2 esgotaram o limite de uso. Verificação própria cobriu os trechos pendentes (chat/SSE, diff/editor, UI).

**Evidências finais (verificado às 17:50 em diante)**: `tsc --noEmit --incremental false` limpo; `eslint` 0 erros (4 warnings `<img>` locais); **`vitest run`: 777/777 testes, 75/75 arquivos, exit 0** (numa rodada anterior sob I/O concorrente do build, 2 flakes apareceram e passaram isolados 58/58 — não eram regressões); **`npm run build`: exit 0**, build de produção gerado; teste real de UI no browser: app abriu sem erros de console, 9 áreas navegadas com zero exceções e zero overflow horizontal; servidor de teste encerrado (porta 3001 livre).

### Correções (problema → arquivo → rollback)

| # | Correção | Arquivo(s) | Rollback |
|---|---|---|---|
| R7-1 | `interrupt()` espera o kill e confirma os filhos | `src/lib/terminal.ts`, `src/lib/shell.ts` | voltar `killTree` a `void spawn` e `interrupt` ao laço simples |
| R7-2 | `readModifyWrite` no store.json (lost update) + Map em `listConversations` | `src/lib/db.ts` | restaurar `readStore/writeStore` diretos em cada mutador |
| R7-3 | Filtro do `/api/execute` e `requestLocalExec` → `isSafeAgentCommand`; padrões destrutivos ampliados | `src/app/api/execute/route.ts`, `src/lib/infra/core.ts`, `src/lib/shell.ts` | voltar a `isSafeCommand` e aos 5 regex originais |
| R7-4 | SSRF: redirects revalidados, IPv4-mapped e CGNAT bloqueados | `src/lib/agents/web.ts` | voltar `redirect: 'follow'` e remover as duas checagens |
| R7-5 | Aprovações de ferramenta visíveis no workspace + RunPanel | `src/components/agents/AgentsWorkspace.tsx`, `RunPanel.tsx` | remover os dois mapas de pendências e os botões approve/deny |
| R7-6 | Aprovação por mensagem do usuário; status honesto (failed/cancelled); retomar não apaga controller; listeners de abort limpos | `src/lib/agents/orchestrator.ts`, `runtime.ts`, `types.ts` | reverter os blocos citados no CHANGELOG |
| R7-7 | Lock por arquivo, timeout do servidor com handler, splash não preso | `electron/main.js` | restaurar `app.on('second-instance')` e `req.setTimeout(60000)` sem handler |
| R7-8 | `detectSystem` assíncrono; composition sem base64; netlab cacheado | `src/lib/setup/system.ts`, `studio/producer.ts`, `netlab/store.ts` | voltar `safeExec` e `data:` URIs |
| R7-9 | WhatsApp: `flushPending` não perde mensagens e sem auto-connect | `src/lib/whatsapp/bridge.ts` | restaurar `bag.length = 0` e o auto-`waStart` |
| R7-10 | Foco visível, ações de mensagem em foco, menu `@` por teclado | `src/app/operations.css`, `components/chat/MessageBubble.tsx`, `FileMentionMenu.tsx` | remover as regras/clauses adicionadas |

### Pendências remanescentes
- Política de modelos gratuitos inalterada; chaves pagas órfãs em `data/keys.json` continuam para decisão do usuário.
- `deepseek-r1:8b` lento por natureza; `npm run sync-packaged` ainda pendente para a instalação em `AppData\Local\Programs\JARVIS`.
- Avisos `<img>` do ESLint em imagens locais (não afetam runtime).
- Testes `agent-permissions`/`terminal-sessions` falharam uma vez sob I/O concorrente do build e passaram isolados (58/58) — flake de ambiente, não regressão.

