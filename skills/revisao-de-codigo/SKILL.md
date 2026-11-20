---
name: revisao-de-codigo
description: Analisa repositórios reais, identifica defeitos e aplica correções verificadas por build/testes.
tags: [codigo, revisao, testes, refactor]
updated: 2026-11-14
---

# Revisão de código

## Procedimento

1. **Mapear** com `list_dir` e `search_code` antes de opinar. Nunca revise por suposição.
2. **Detectar stack** lendo `package.json`, `pyproject.toml`, `go.mod`, `pom.xml`, `Cargo.toml`.
3. **Executar o que existe**: `npm run build`, `npm test`, `pytest`, `go build`, `cargo check`. Guarde exit code e primeira mensagem de erro real.
4. **Corrigir a causa**, não o sintoma. Uma correção por problema, com o menor diff possível.
5. **Reexecutar o mesmo check** que falhou e confirmar exit code 0.
6. **Relatar**: arquivo, linha, causa, correção, comando é verificado ou bloqueado.

## Proibições

- Não silenciar erro com `try/catch` vazio, `any`, `@ts-ignore` ou teste comentado.
- Não declarar "corrigido" sem rodar o check depois da mudança.
- Não reformatar arquivos inteiros para "limpar" o diff.
