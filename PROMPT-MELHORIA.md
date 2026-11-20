# PROMPT — Melhorar o JARVIS (pontos fracos e fortes)

Você é um engenheiro de software sênior assumindo o projeto **JARVIS AI** (agente pessoal de tecnologia, Next.js 15 + Electron + TypeScript) que mora em `C:\Users\kitoxz_\Documents\JARVIS`. Seu trabalho: **fortalecer os pontos fortes, corrigir os pontos fracos e entregar mudanças verificadas** — não uma lista de sugestões.

## 1. Antes de escrever qualquer código
Leia, nesta ordem, e só depois proponha o plano:
1. `README.md`, `AUDITORIA.md`, `CHANGELOG.md`
2. `docs/auditoria/bateria-antes.md`, `bateria-depois-opencode.md` e `modelos-teste.md`
3. `INFRA.md`, `GUIA-*.md` e `docs/GITHUB-DEEP-DIVE.md`
4. `package.json` (scripts reais: `dev`, `build`, `start`, `test`, `lint`, `sync-packaged`)

O projeto **NÃO tem git**. Cada mudança precisa de rollback descrito manualmente (quais arquivos, como reverter) ou cópia de segurança em `.tmp/` antes de editar.

## 2. Pontos FORTES — preserve e amplie (não regrida nada disto)
- **Suíte de testes verde**: ~295–303 testes (vitest); `tsc --noEmit` limpo; `eslint` limpo; `npm run build` com `next build --turbopack` OK.
- **Política "somente modelos gratuitos"**: provedores pagos removidos do catálogo; OpenRouter filtrado para `:free`/preço zero; trava `JARVIS_ALLOW_PAID=1` como única porta para pago. **Não reintroduza provedores pagos nem modelos pagos.**
- **Resiliência do chat**: `src/lib/ai/resilience.ts` (backoff exponencial com jitter e teto, `retry-after` curto, fallback só antes do primeiro token), `sse.ts` (parser incremental, CRLF, heartbeat de 15 s), `capabilities.ts` (tools/JSON só quando o modelo suporta).
- **Catálogo honesto**: `modelTests.ts` classifica `retired/no-free-quota/blocked/temporary`; falha permanente oculta por 3 dias; latência medida (`latencyOf`) pondera o modelo padrão (`groq|openai/gpt-oss-120b`, ~0,4–0,9 s).
- **Roteamento agente×chat** (`shouldRunAgent.ts`): perguntas sobre a máquina/arquivos/projeto vão para o agente com ferramentas; bateria medida foi de **6/10 → 10/10** com artefato verificado.
- **Sandbox de skills**: quarentena + análise estática antes de instalar; comandos de IA nunca executados sem confirmação; operações destrutivas bloqueadas por heurística e aprovadas no painel Aprovações.
- **UX HUD/operations**: TopBar com status vivo, `CommandPalette` (Ctrl+K), `TypingIndicator` honesto (fase/tempo reais, sem "raciocinando" inventado), boot cinematográfico, `prefers-reduced-motion` respeitado.
- **models.dev**: enriquecimento do catálogo com dados reais (contexto, saída máxima, tool_call, raciocínio) com cache em `data/models-dev.json`; thread do chat nunca espera rede.

## 3. Pontos FRACOS — ataque por impacto (confirme cada um antes de mexer)
1. **Instalação empacotada desatualizada**: `npm run sync-packaged` ainda não foi rodado — o atalho da área de trabalho abre a versão ANTIGA (`AppData\Local\Programs\JARVIS`) enquanto o build novo fica só no diretório de trabalho. Documente/valide o fluxo de sincronização e o que pode quebrar (ver D9: pare o servidor que serve `.next` antes de `npm run build`, senão `ENOENT … _buildManifest.js.tmp.*`).
2. **Chaves pagas órfãs** em `data/keys.json` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`): proponha decisão (remover via UI de chaves ou documentar) — sem apagar valores às cegas.
3. **Provedores sem chave não testados de verdade**: Cerebras, Mistral, SambaNova, NVIDIA NIM, Hugging Face (e Anthropic, travado). O código foi revisado mas nunca chamado de fato. Proponha QA reproduzível para quando a chave for cadastrada (teste de fumaça automatizado por provedor).
4. **`deepseek-r1:8b` local lento por natureza** (108–120 s no limite de timeout): documente orientação de uso (preferir `llama3.2:3b`/`gemma3:4b`/`qwen3:4b`) e avalie timeouts/config do agente para modelos em thinking — sem "consertar" a física.
5. **Flakiness sob I/O pesado**: `npm test` já apresentou 6 timeouts em `infra-core.test.ts` sob carga (ollama pull concorrente). Investigue isolamento de testes que fazem I/O/npm real (`engine-integration`) e marque/limite concorrência ou timeouts de forma determinística.
6. **Sem git/versionamento**: rollback é manual; proponha um mínimo viável de segurança (ex.: script de snapshot/restauração em `.tmp/` ou git init + `.gitignore` já existente) — discutindo com o usuário antes de inicializar repositório.
7. **Divergência de build**: múltiplas pastas `.next-*` e `out*.txt` na raiz sugerem experimentos acumulados; proponha limpeza segura (só com confirmação do usuário) do que é lixo de build vs. o que é artefato necessário.
8. **O que mais você encontrar**: o audit só cobriu o caminho crítico do chat/agente. Audite também segurança (leitura/escrita fora da pasta do projeto, command injection nas rotas `/api/*`, segredos em logs), robustez do Modo Agente (locks/scheduler do orquestrador multi-agente) e consistência docs↔código (comentários/flags `PAID_ENABLED`).
9. **Cobertura de testes**: identifique os módulos críticos sem teste (ex.: rotas API, orquestrador, infra/SSH/Docker) e adicione testes; não infle cobertura cosmética.

## 4. Restrições (não negociáveis)
- Só provedores e modelos **gratuitos** no catálogo e na cadeia de fallback; pago só com `JARVIS_ALLOW_PAID=1` + re-registro explícito (e nesse caso documente).
- **Nunca** execute comandos destrutivos, apague `data/` sem backup, nem faça push/deploy. Pare o `next start`/`dev` que serve `.next` antes de `npm run build`.
- TypeScript estrito; sem `@ts-ignore` novo sem justificativa; siga os padrões do código (módulos em `src/lib/...`, componentes em `src/components/...`, testes espelhando em `tests/`).
- Toda mudança de comportamento precisa de teste ou evidência de execução real; toda correção precisa de linha de rollback no estilo do `AUDITORIA.md`.
- Respeite `prefers-reduced-motion`, acessibilidade (foco visível) e o design HUD preto/branco/cinza (`accent: mono` é o padrão).

## 5. Forma de trabalho
1. **Fase A — Diagnóstico (não edite nada)**: confirme os itens da seção 3 medindo (rode `npm test`, `tsc`, `eslint`, `npm run build`; cheque `data/keys.json` só pelos NOMES das chaves; nunca leia/imprima valores). Entregue tabela: item | evidência | impacto | esforço | risco.
2. **Fase B — Plano priorizado** (quick wins primeiro, ordenado por impacto×risco). **Pare e peça aprovação do plano antes de editar.**
3. **Fase C — Implementação**: um item por vez; após cada item rode `npx vitest run <arquivo>` + `tsc --noEmit`; commits lógicos via checklist manual (sem git).
4. **Fase D — Verificação final**: `npm test` completo, `tsc --noEmit`, `npm run lint`, `npm run build`, e a bateria de 10 tarefas do `docs/auditoria/` (antes: 6/10 → meta: manter ≥10/10). Reporte tabela antes/depois.
5. **Fase E — Relatório**: atualize `AUDITORIA.md` com uma nova seção (o que foi feito, evidências, rollback por item, pendências remanescentes). Não reescreva o histórico existente.

## 6. Critérios de aceite
- Nenhuma regressão: testes ≥ estado atual, `tsc`/`eslint`/`build` limpos, bateria ≥ 10/10.
- Zero vazamento de segredo (valores de `data/keys.json` jamais impressos, logados ou commitados).
- Cada mudança tem rollback documentado; cada claim tem evidência medida (saída de comando, não "deve funcionar").
- Política de gratuidade intacta.

Comece pela Fase A. Trabalhe em PT-BR com o usuário; código e identificadores em inglês.
