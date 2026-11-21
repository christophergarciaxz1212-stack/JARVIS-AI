# Auditoria visual estática — 21/11/2026

Escopo: 66 arquivos `.tsx`/`.css` em `src/`. Método: contagem e localização por grep; nenhuma edição automática. É uma auditoria de código, não substitui inspeção visual em navegador (pendente).

## Achados

| # | Achado | Evidência | Impacto | Ação sugerida |
|---|---|---|---|---|
| V1 | **368 referências a ciano hardcoded** em 66 arquivos, contrariando a identidade preto/branco pedida | `cyan-\d\|text-cyan\|border-cyan\|bg-cyan`: 368 ocorrências. Concentração: `HubWorkspace.tsx` 34, `page.tsx` 29, `SkillEnginePanel.tsx` 24, `InfraPanel.tsx` 22, `AgentsWorkspace.tsx` 18 | Cores diferentes para ações semelhantes; tema inconsistente entre telas | Substituir por `--accent`/`--accent-dim` (tokens) e um único acento gelo. Começar pelos 5 arquivos acima (127 ocorrências = 35% do total) |
| V2 | **5 raios de borda convivendo** sem regra | `rounded-sm/md/lg/xl/2xl` todos presentes | Bordas inconsistentes | Definir escala: `sm`=inputs, `lg`=cards/botões, `2xl`=modais; eliminar `md`/`xl` por aliases |
| V3 | **400 combinações `px-N py-N`** em botões | padrão `px-\d+ py-` | Botões com tamanhos diferentes sem justificativa | Usar o primitivo `Button` (`src/components/ui/index.tsx`) com `size sm|md` |
| V4 | Texto truncado sem `title` | padrão `truncate` em ~20 arquivos (ex.: `transcript.tsx`, `SessionsPanel.tsx`, `DiagnosticsPanel.tsx`) | Informação importante inacessível | Sempre acompanhar `truncate` de `title={valor}` ou tooltip |
| V5 | Ícones de status por cor | `StatusBadge` em `DiagnosticsPanel.tsx` usa só bolinha colorida em alguns lugares | Viola "não dependa apenas de cor" | Usar `StatusDot` de `src/components/ui` que emite texto + símbolo + `aria-label` |

## Priorização

1. V1 + V5 — maior impacto visual e de clareza; ataca diretamente os itens 2 e 3 do briefing.
2. V3 + V2 — padronização de componentes, ataca o item 1.
3. V4 — acessibilidade.

## Nota de coordenação

A Fase B do plano concorrente (`JARVIS-TRANSFORM-PLAN.md`) prevê tokenização em `src/styles/tokens.css` e primitivos em `src/components/ui/`. Este relatório deve ser usado como entrada dessa fase para evitar dois sistemas visuais paralelos. Já existem `src/lib/ui/tokens.ts` e `src/components/ui/index.tsx` (commit `5ee791b`) — a tokenização deve uni-los a `globals.css` em uma única fonte de verdade.
