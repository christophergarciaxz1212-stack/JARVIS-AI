# Repositórios GitHub agregados ao JARVIS — verificados em 2026-11-16

> Análise completa, licenças e decisões de adotar/adaptar/rejeitar para os 12 projetos-referência
> (opencode, OpenHands, Continue, Cline, Roo-Code, Aider, Vercel AI SDK, LiteLLM, LangGraph, PydanticAI,
> models.dev, react-bits): **`docs/GITHUB-DEEP-DIVE.md`**.

Pedido: checar repositórios públicos que pudessem melhorar os modelos e a interação do JARVIS,
e incorporar o que fizer sentido. Todos os projetos abaixo foram abertos e verificados no GitHub.

## ✅ Integrado de verdade

### 1. anomalyco/models.dev — banco aberto de modelos de IA
- Repo: https://github.com/anomalyco/models.dev · MIT · 7,7k ⭐ · mantido pelos mantenedores do SST/opencode
- Dados: https://models.dev/api.json (6,7 MB — contextos, saída máxima, raciocínio, ferramentas, anexos, pesos abertos, data de lançamento, custo)
- **Como foi agregado:** novo módulo `src/lib/ai/models-dev.ts`. O catálogo é baixado no boot (e 1x/dia) para `data/models-dev.json` e lido em memória; `getProviderModels()` passa a enriquecer cada modelo listado ao vivo:
  - `contextWindow`/`maxTokens` reais (substituem o chute de 128k/8k)
  - `toolSupport`, `multimodal` e flag de raciocínio (modelo raciocinador deixa de ser `chat` genérico no ranking)
  - descrição/lançamento quando o provedor não informa
- Zero custo, zero chave. Offline: vale o cache; sem cache: nada quebra, vale a heurística antiga.
- Testado: `tests/models-dev.test.ts`.
- Mapa de provedores: google→gemini · groq · cerebras · openrouter · mistral · sambanova · nvidia · huggingface. Provedores locais (Ollama/LM Studio) não têm entrada e seguem como estavam.

### 2. DavidHDev/react-bits — coleção de componentes animados (React)
- Repo: https://github.com/DavidHDev/react-bits · MIT · ~30k ⭐
- **O que foi agregado:** os padrões de efeito (gradient text animado, spotlight que segue o mouse, aurora, scanline, tilt com spring, "typing" animado) reimplementados na stack do JARVIS (framer-motion + CSS), sem copiar código nem adicionar dependência — o JARVIS já usa Tailwind + framer-motion. Ver `globals.css` (seção "JARVIS HUD"), `Welcome.tsx`, `NavRail.tsx`, `BootSequence.tsx`.
- Nota: o `TypingIndicator` "Pensando…" final é do redesign paralelo (indicador honesto com fase/tempo da resposta); os padrões de barra/onda animada de lá usam o mesmo princípio.

### 3. Dix01/JARVIS — HUD holográfico (arc reactor, boot sequence)
- Repo: https://github.com/Dix01/JARVIS · MIT
- **O que foi agregado:** os padrões visuais — sequência de boot "sistemas inicializando", anéis holográficos girando e linhas de telemetria — reimplementados como `src/components/BootSequence.tsx` e as classes `.boot-*` / `.hero-beam` no CSS. Nenhum código Three.js foi portado: o JARVIS já tem fundo neural interativo em canvas e o custo/benefício de WebGL no Electron não se justifica hoje.

## 📚 Avaliados e não incorporados (com motivo)

### vercel/ai (Vercel AI SDK) — https://github.com/vercel/ai · Apache-2.0 · ~20k ⭐
O JARVIS já tem um motor SSE próprio superior ao uso básico do SDK neste contexto: cadeia de fallback entre provedores com troca automática antes do primeiro token, medição real de latência por modelo, classificação de erro (`classifyModelError`), JSON mode e chamadas de ferramenta nativas normalizadas para o protocolo de agentes. Trocar agora implicaria reescrever o runtime de agentes (orquestrador, scheduler, telemetria) sem ganho de recurso. **Revisitar se** o JARVIS passar a consumir um único provedor (ex.: 100% OpenAI-compatible).

### bertrandmbanwi/Jarvis — https://github.com/bertrandmbanwi/Jarvis · MIT
UI cinematográfica com orb Three.js + 2.400 partículas. Boa referência visual (estados idle/listen/think/speak). Os efeitos equivalentes já existem no JARVIS (NeuralBackground com intensidade 2,4x durante o streaming, hero-atom com anéis e shockwaves). Não portado para evitar duplicidade e +600 kB de bundle.

### krishcodes07/JARVIS — https://github.com/krishcodes07/Jarvis · MIT
O ponto alto é o `models.dev` como catálogo de 200+ provedores — **esse é exatamente o mecanismo do item 1**. O resto (TUI, Windows UIA) é outra plataforma.

### harsh-raj00/my-jarvis — https://github.com/harsh-raj00/my-jarvis · MIT
Referência para as "tipped" corners/HUD frames. As molduras HUD do JARVIS (`.hud-corners`) seguem a mesma ideia reimplementadas em CSS puro.

### Open WebUI — https://github.com/open-webui/open-webui
Excelente UI para chat multi-modelo, mas é uma aplicação Python/SvelteKit inteira, não uma biblioteca de componentes. Não se "agrega"; só se reimplementaria — o JARVIS tem funções que ele não tem (Modo Agente, agentes, Hub escolar, Infra). Apenas inspiração de organização de painel.

### GitHub Models — descontinuado
O comentário em `src/lib/ai/providers.ts` está correto: o GitHub Models foi aposentado pelo GitHub em 2026-07-30. O token `GITHUB_TOKEN` segue útil apenas para a busca de Skills no GitHub.

## O que mudou no produto (resumo)
- Modelos exibem contexto e saída reais do models.dev no seletor de modelos.
- Ranking de "Melhor IA automática" passa a considerar modelos raciocinadores corretamente.
- Boot holográfico, scanlines/CRT, feixes de energia, relógio HUD ao vivo, barra de atividade no topo durante o streaming, glows e animações em trilho, bolhas, cards e painéis — tudo com `transform`/`opacity` (sem repintura pesada) e respeitando `prefers-reduced-motion`.
