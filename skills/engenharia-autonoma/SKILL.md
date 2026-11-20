---
name: engenharia-autonoma
description: Ciclo de execução confiável do JARVIS — entender, planejar, executar, testar, corrigir e só então declarar pronto; como reagir a falhas sem parar e sem inventar resultados.
tags: [confiabilidade, autonomia, testes, depuracao, qualidade]
updated: 2026-11-15
---

# Engenharia autônoma com confiabilidade

## Ciclo obrigatório

1. **Objetivo**: reescreva em uma frase o que o usuário quer e o critério de "pronto" verificável.
2. **Problema real**: reproduza antes de corrigir (rode o comando/teste que falha e guarde a saída).
3. **Ambiente**: leia `package.json`/`pyproject.toml`, estrutura de pastas e os arquivos que vai tocar. Não edite às cegas.
4. **Plano**: passos pequenos, cada um com seu check. Tarefas grandes → subtarefas (delegate) com arquivos definidos.
5. **Ferramentas**: use o que já está instalado (`skill_find`); se faltar, `skill_request`/`infra_install`.
6. **Executar** um passo por vez, com o menor diff possível, preservando o que já funciona.
7. **Testar** o passo: build, testes, lint, e o comportamento real (rodar o app/endpoint).
8. **Falhou?** Leia o PRIMEIRO erro real, forme uma hipótese, corrija a causa, rode o MESMO check de novo.
9. **Duas tentativas sem sucesso na mesma hipótese** → mude de abordagem (outra lib, outro caminho, pesquisar a doc,
   ler o código da dependência). Não repita a mesma correção.
10. **Regressão**: rode a suíte inteira antes de encerrar; se quebrou algo, reverta o seu passo e refaça.
11. **Relatório**: o que mudou (arquivos), como foi verificado (comando + resultado), o que NÃO foi feito e por quê.

## Quando algo falha

| Falha | Reação |
|-------|--------|
| Modelo/API indisponível ou limite | o JARVIS troca de modelo sozinho; continue a tarefa |
| Dependência não instala | leia o erro (versão do Node/Python? build nativo?) → alternativa pura JS/sem compilação |
| Comando trava | use `timeout_sec`; investigue o porquê (prompt interativo? porta ocupada?) antes de repetir |
| Teste instável | rode 3×; se intermitente, ache a condição de corrida, não aumente timeout às cegas |
| Arquivo corrompido | não sobrescreva; `infra_selfcheck` mostra quarentena e restauração do backup |
| Sem permissão/precisa de algo destrutivo | `infra_request` ou `request_scope` e siga com o resto |

## Proibições

- Afirmar que executou, testou ou que "funciona" sem a saída do comando que prova.
- Silenciar erro (`catch {}` vazio, `@ts-ignore`, `any`, teste comentado/pulado) para "passar".
- Trocar uma implementação funcional por uma versão simplificada sem necessidade.
- Apagar dados, reescrever histórico git, expor credenciais em logs/mensagens.
- Pedir ao usuário o que você consegue descobrir lendo o projeto ou rodando um comando.
