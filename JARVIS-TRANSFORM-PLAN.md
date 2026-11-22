# Plano de Transformação do JARVIS — completo

Versão: 3.0 (final)
Data: 2026-11-21
Objetivo: transformação profunda do produto — interface, arquitetura, equipes multiagente, diagnóstico.

## Fase 0 — Inventário ✓
- [x] Mapeamento da árvore do código + 3 investigadores paralelos (UI, equipes, serviços/electron)

## Fase A — Tela de diagnóstico interno ✓
- [x] A1 `src/lib/infra/diagnostics.ts` + `src/app/api/diagnostics/route.ts` (unificado: módulos existentes + detalhes + SSE + auditoria N1–N5)
- [x] A2 `src/components/DiagnosticsPanel.tsx` (módulos: nucleo/ia/agentes/integracoes/dados/build com ok/erro/atenção)
- [x] A3 nav "Diag." + CommandPalette + integração no shell
- [x] A4 serviços detalhados (provedores, modelos, equipes, terminal, persistência, backups, auto-diagnóstico, máquina, logs)

## Fase B — Design system ✓
- [x] B1 `src/styles/tokens.css`
- [x] B2 `src/styles/components.css`
- [x] B3 importado no layout; MessageBubble/ReasoningPanel/TeamCanvas/Files/Terminal/TeamsManager migrados

## Fase C — Shell de layout ✓
- [x] C1 `src/components/shell/AppShell.tsx` + `types.ts` (zones, overlays, painéis, paleta)
- [x] C2 `src/app/page.tsx` slim (estado + lógica + zones)
- [x] C3 tsc limpo; macro-comportamentos preservados

## Fase D — Chat ✓
- [x] D1 MessageBubble v2 (jv-card, badge de estado por mensagem, avatar, estatísticas) + ReasoningPanel modernizado

## Fase E — Backend de equipes ✓
- [x] E1 `messageBus.ts`, `leader.ts`, papel `leader` em `roles.ts` (incluído em presets e auto-team)
- [x] E2 heartbeat 25s, `task_progress`, `cancel-task`, `userMessage` com liberação de pergunta do líder,
      cooldown por agente, rota `/api/agents/messages`

## Fase F — UI de equipes ✓
- [x] F1 `TeamCanvas.tsx`: líder, agentes (modelo/status/progresso/uso), plano DAG, comunicação, resposta ao líder
- [x] F2 integrado na aba "Equipe" do `AgentsWorkspace` + cancelar tarefa individual
- [x] F3 `TeamsManager`: presets com um clique (cópia editável)
- [x] F4 aba "Equipes de IA" nas configurações

## Fase G — Configurações ✓ (organização preservada + seção Equipes)

## Fase H — Files/Terminal ✓
- [x] H1 `FilesPanel.tsx` reescrito: árvore, abas, criar/renomear/copiar, dirty
- [x] H2 `TerminalPanel.tsx`: copiar saída, nova sessão CMD, botões jv-*

## Fase I — Quality gates ✓
- [x] I1 `tsc --noEmit` — 0 erros (rodado novamente após o último ajuste)
- [x] I2 vitest — 777/777 testes, 75 arquivos (3 execuções finais; um timeout isolado sob contenção de CPU confirmado como flaky — 17/17 no arquivo isolado)
- [x] I3 `eslint .` — limpo (apenas avisos de `<img>` do código pré-existente no build)
- [x] I4 `next build --turbopack` — aprovado (pré-renderização de 22 páginas)
- [x] I5 verificação visual com Playwright (1500×900): chat, diagnóstico, workspace de equipes, configurações e paleta — 0 erros de console; bug de navegação (diagnóstico não fechava ao trocar de tela) encontrado e corrigido
- [x] I6 relatório final — `docs/JARVIS-TRANSFORM-NOTES.md` + `CHANGELOG.md` + este plano
