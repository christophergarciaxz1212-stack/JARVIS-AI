# JARVIS ⇄ GitHub — deep dive (verificado em 2026-11-16, licenças conferidas via API do GitHub)

Repos abertos e analisados. Decisão sobre cada um: **adotar** (usar como biblioteca/padrão), **adaptar** (reimplementar o padrão na stack do JARVIS) ou **rejeitar** (com motivo). Nada foi copiado sem licença e atribuição.

| Repositório | Licença | ★ | Decisão | O que agregaria / por que não |
|---|---|---|---|---|
| anomalyco/opencode | MIT | 227k | **adaptar (padrão)** | Agente de código no terminal; arquitetura de "provider-agnostic catalog" — exatamente o que o `models.dev` + `catalog.ts` fazem no JARVIS. Acoplado ao ecossistema OpenCode; não portável como pacote. |
| OpenHands/OpenHands | MIT | 94k | **rejeitar (escopo)** | Plataforma completa de dev autônomo (Docker sandbox). O JARVIS já tem sandbox próprio (`lib/engine/sandbox.ts`) e execução de comandos com aprovação. Adotar traria 1M+ LOC de dependências e um segundo runtime. |
| continuedev/continue | Apache-2.0 | 36k | **adaptar (padrão)** | Autocomplete/edição no editor. O JARVIS é uma central de operações Electron, não um extension de VS Code; o padrão de "diff com aprovação" já existe no modo agente (edição + releitura + verificação). |
| cline/cline | Apache-2.0 | 72k | **analisar padrões** | Agente autônomo com permissões granulares e "yolo mode". O JARVIS tem `risk.ts`/`approvals.ts` próprios (nível maior de controle para infra). A separação plan/act do Cline é refletida no harness de agentes do JARVIS (planner + executor). |
| RooCodeInc/Roo-Code | Apache-2.0 | 24k | **adaptar (conceito)** | Times de agentes com papéis (arquiteto, debug, review). Inspira a pasta `lib/agents/roles.ts` do JARVIS. Código é VS Code-specific; padrão absorvido, não o código. |
| Aider-AI/aider | Apache-2.0 | 50k | **adaptar (conceito)** | Edição por "whole/diff" blocks e lint pós-edição. O JARVIS edita via ferramentas `write_file`/`replace` + verificação (reler + testar). Vale reforçar o ciclo de verificação no prompt do orquestrador, não trocar o motor. |
| vercel/ai | Apache-2.0 | 28k | **rejeitar (agora)** | AI SDK é excelente para apps greenfield com 1 provedor; o JARVIS tem motor SSE próprio com fallback multi-provedor, medição de latência, JSON mode, tool calling nativo e contagem de tokens real. Reavaliar apenas se o JARVIS adotar um único gateway (ex.: LiteLLM). |
| BerriAI/litellm | MIT (core) / enterprise custom | 63k | **opcional (gateway)** | Proxy OpenAI-compatible único para 100+ provedores. Valor real se o usuário quiser rodar um gateway local `litellm --model …`: o JARVIS consegue apontar para ele com o **provedor personalizado** (`CUSTOM_AI_BASE_URL`) implementado nesta versão — sem depender do LiteLLM como biblioteca (evita Python no lado do JARVIS). |
| langchain-ai/langgraph | MIT | 45k | **rejeitar (stack)** | Grafo de estados Python. O JARVIS tem scheduler/locks/orchestrator próprios em TS com o mesmo objetivo. Reescrever em Python quebraria o app Electron. Padrão de "graph with checkpoints" é observado. |
| pydantic/pydantic-ai | MIT | 21k | **rejeitar (stack)** | Idem: Python/Pydantic; valor conceitual (typed agent outputs, retries). O equivalente TS (schema + retry) já existe parcialmente em `client.ts` + `resilience.ts`. |
| **anomalyco/models.dev** | MIT | 7,7k | **ADOTADO (dados)** | `src/lib/ai/models-dev.ts` — catálogo aberto de especificações (contexto, saída, raciocínio, ferramentas, anexos, pesos abertos, lançamento). Enriquece o catálogo vivo a cada 24h. Ver `docs/GITHUB-AGGREGATION.md`. |
| **DavidHDev/react-bits** | MIT | ~30k | **ADOTADO (padrões)** | Efeitos holográficos reimplementados (boot, feixes, scanlines, halo, tilt com spring) na stack Tailwind + framer-motion. Nenhum código copiado. |
| **Dix01/JARVIS** | MIT | — | **ADOTADO (padrões)** | Boot sequence holográfica e arquitetura de "camadas HUD". |

## O que NÃO foi feito (e por quê — honestidade técnica)
- **Não instalamos Monaco/CodeMirror/xterm.js.** O JARVIS é Electron com rotas de texto; Monaco adiciona ~3 MB de bundle e um segundo modelo de edição para um caso de uso (pasta de arquivos) que já funciona. Editor profissional completo seria um projeto à parte. Dado o custo/benefício e a regra "não instalar tudo", mantido o visualizador atual com highlights melhorados.
- **Não adicionamos WebSocket de chat.** SSE cobre o fluxo (1 provider → token stream) com reconexão simples; WebSocket traria estado bidirecional desnecessário.
- **Visão/entrada de imagem ponta-a-ponta não foi implementada nesta rodada** (requer UI de upload + pipeline multimodal por provedor). Capacidade de visão já é **detectada** pelo catálogo (modelos.dev → `multimodal`), e o card de modelo exibe isso para a decisão do usuário.
- **Anthropic (Claude)**: adapter real adicionado nesta versão, porém atrás da flag paga (`JARVIS_ALLOW_PAID=1` + `ANTHROPIC_API_KEY`), coerente com a política "só gratuitos por padrão" escolhida anteriormente no JARVIS.
