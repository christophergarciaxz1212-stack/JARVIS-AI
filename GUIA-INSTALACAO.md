# Instalação do JARVIS — do zero ao uso

> Este guia é para quem recebeu o JARVIS e quer usá-lo sem virar programador.
> A maior parte da preparação é feita **pelo próprio JARVIS no primeiro uso** —
> este documento explica o que esperar e o que fazer se algo precisar de
> intervenção manual.

## O que é o JARVIS

JARVIS é um aplicativo de IA pessoal para Windows (10/11): chat com dezenas de
modelos gratuitos, agente de código, estúdio de vídeo com narração, integração
com IA na nuvem (Gemini, Groq, OpenRouter, NVIDIA…) e modelos locais (Ollama).

## Requisitos mínimos

| Componente | Mínimo | Recomendado |
|---|---|---|
| Windows | 10 64 bits (build 1903+) | Windows 11 |
| RAM | 4 GB | 8 GB+ |
| Disco | 2 GB livres | 5 GB+ |
| Internet | necessária p/ IA na nuvem | banda larga |
| Navegador | Chrome ou Edge (motor de vídeo WebCodecs) | Chrome atualizado |
| Node.js | **incluído no app** (não precisa instalar) | — |
| FFmpeg | **não é necessário** | — |
| GPU | não obrigatória | NVIDIA com 4+ GB VRAM p/ modelos locais |

O render de vídeos usa **WebCodecs H.264 + AAC dentro do Chrome/Edge**, não FFmpeg.
Se você viu alguma instrução para instalar FFmpeg, ela é de versões antigas do projeto.

## Primeira execução — o Assistente de Primeira Configuração

Na primeira vez que abrir o JARVIS, aparece o **Assistente de Primeira Configuração**.
Ele faz, de verdade, tudo isto:

1. **Identifica o sistema**: versão do Windows, build, arquitetura (x64/ARM64).
2. **Mede o hardware**: modelo e núcleos do CPU, RAM total e livre, espaço em disco, GPU (NVIDIA via `nvidia-smi`; AMD/Intel via WMI/CIM), VRAM quando disponível.
3. **Testa a internet** com latência real (e um fallback para o GitHub).
4. **Verifica ferramentas**: Chrome/Edge, Git, WinGet, Node (o que roda o app), Ollama.
5. **Verifica chaves de IA** configuradas (só a presença — nunca mostra valores) e se há ao menos uma.
6. **Prepara os diretórios**: cria e *testa a escrita* em `data/images`, `data/video`, `data/logs`, `data/temp`, `data/cache`, `data/models`.

Você verá cada item com o valor real medido. O que estiver faltando tem
botões **"Instalar (WinGet)"** — a instalação **só acontece se você clicar**.
Nada é instalado em silêncio, e nenhum antivírus/firewall é desativado.

O que o assistente **não faz**:

- Não instala nada sem o seu clique.
- Não pede senha de conta pessoal. Chaves de API são coladas na tela
  **🔑 Chaves de API** dentro do app, nunca em terminal, nunca em lugar
  que registra em log.
- Não inventa que algo funciona: se a detecção falha, o item aparece como falha.

**"Pular por agora"** adia o assistente para a próxima abertura (fica salvo
localmente nesta máquina). **"Concluir"** registra que a configuração foi feita
(`data/logs/.first-run-done`).

## O que você precisa configurar (2 minutos)

1. **Chaves de IA** — clique no botão **🔑 Chaves de API** (ícone de chave) na
   barra do chat e cole a(s) chave(s) gratuita(s) que você quiser:
   - **Google Gemini** (aistudio.google.com/apikey) — grátis, com imagens e texto.
   - **Groq** (console.groq.com/keys) — grátis, extremamente rápido.
   - **OpenRouter** (openrouter.ai/keys) — grátis, centenas de modelos.
   - **NVIDIA NIM** (build.nvidia.com) — grátis, modelos grandes.
   - **SambaNova** (cloud.sambanova.ai) — grátis.
   Sem nenhuma chave, o chat não tem com quem conversar — esse é o único passo
   obrigatório. Todas as chaves aqui têm tier gratuito.

2. **Opcional — Ollama** (modelos locais, grátis, sem internet): instale em
   ollama.com, depois rode `ollama pull llama3.2:3b`. O JARVIS detecta o serviço
   sozinho (botão "Verificar novamente" no assistente).

3. **Vídeos com narração/legendas**: basta pedir **"crie um vídeo sobre…"** no
   chat. As imagens são geradas pelo Pollinations (grátis, ~1 imagem a cada
   45s) ou pelo Gemini (se a cota de imagens estiver ativa no seu plano).

## Como distribuir (gerar o instalador ou a versão portátil)

No PC do desenvolvedor:

```powershell
$env:JARVIS_DIST_DIR='.next-dist'   # ou omita (usa o .next atual)
node scripts/prepare-dist.mjs       # monta release-staging/ com a build atual
node "<node_modules>\electron-builder\out\cli\cli.js" --project release-staging --dir   # app empacotado
makensis scripts\installer.nsi                                                    # instalador
```

O que vai para `release/` (ignorado pelo git):

| Caminho | Tamanho | O que é |
|---|---|---|
| `release/JARVIS-Setup-1.1.0.exe` | ~219 MB | **Instalador NSIS completo** (per-user, sem admin; atalhos; menu Iniciar; desinstalador em "Aplicativos instalados"; dados do usuário preservados) |
| `release/JARVIS-Portable/` | ~1,05 GB | Versão portátil idêntica ao conteúdo do instalador: extraia, rode `JARVIS AI.exe`, nada é instalado |
| `release/JARVIS-Portable.zip` | ~305 MB | O mesmo, já compactado (tar/zip): caminho de envio |

**Verificação honesta (nesta máquina de desenvolvimento):**

- O instalador **compila completo** (makensis, CRC válido, instalador Unicode x86).
  Porém **esta máquina bloqueia qualquer executável recém-compilado sem assinatura** —
  até um "hello world" de 38 KB é encerrado já na inicialização. Portanto a execução
  do instalador **não pôde ser verificada aqui**; em um PC consumidor (ou com um
  certificado de assinatura EV/OV) ele deve funcionar normalmente — é o mesmo stack
  do NSIS usado por milhões de apps.
- A versão **portátil foi verificada nesta máquina de ponta a ponta**: abre, sobe o
  Next (3001), renderiza a interface, health-check verde (Ollama 5 modelos, 7 chaves,
  Chrome) e o Assistente de Primeira Configuração aparece na primeira execução.

**Para distribuir para outras pessoas sem certificado:**

1. **Opção A (segura em qualquer máquina):** envie `release/JARVIS-Portable.zip`.
   O destinatário extrai e executa `JARVIS AI.exe` — funciona mesmo em máquinas
   que bloqueiam instaladores.
2. **Opção B (experiência profissional):** envie `release/JARVIS-Setup-1.1.0.exe`.
   Duplo clique → Avançar → Instalar → Concluir. Se a máquina de destino exibir
   "O Windows protegeu seu PC", **Mais informações → Executar assim mesmo** (aviso
   normal para app não assinado; o usuário aceita uma vez).
3. **Com certificado EV/OV** (~US$ 200–500/ano): resolveria o aviso do SmartScreen em
   todas as máquinas.

**Dados e chaves:** nenhum dado pessoal, chave ou `.env.local` vai no pacote —
`release-staging` não contém chaves nem dados do usuário; os dados de cada usuário
ficam em `%USERPROFILE%\Documents\JARVIS\data` (criados no primeiro uso).
   (Esta máquina não conseguiu terminar o instalador — ver nota acima.)
2. **Opção B:** compre um certificado de assinatura de código EV/OV (~US$ 200–500/ano)
   e assine o instalador — o SmartScreen confia instantaneamente e o pipeline
   `--win nsis` conclui normalmente.
3. Em uma máquina de terceiros, mesmo sem assinar, o Windows mostra
   **"O Windows protegeu seu PC"** → "Mais informações" → **Executar assim mesmo**
   (comportamento normal para apps não assinados; o usuário aceita uma vez).

## Instalação rápida (testada neste PC)

Extraia `release/JARVIS-Portable.zip` (~292 MB) em uma pasta e execute `JARVIS AI.exe`
— ou use `release/JARVIS-Portable/` diretamente. Na primeira execução, o assistente
faz o diagnóstico real do computador. Dados do usuário ficam em
`%USERPROFILE%\Documents\JARVIS\data` (o app portátil e o dev app compartilham essa pasta).

## JARVIS SYSTEM HEALTH (verificação permanente)

O assistente pode ser reaberto a qualquer momento — ele é também o módulo de
sáude do sistema. Os mesmos itens são re-medidos e resultados vão para
`data/logs/health.log`:

- Diretórios e permissão de escrita
- Chrome/Edge (necessário para exportar vídeos)
- Chaves configuradas
- Internet e latência
- Espaço em disco
- Ollama (informativo)

Reparos oferecidos (nunca automáticos): recriar diretórios, criar `keys.json`,
`prefs.json` ou `.env.local` a partir do exemplo — **sem sobrescrever os seus
arquivos existentes**.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Nenhuma IA conectada" | Configure ao menos uma chave (passo 1 acima). |
| Vídeo não gera imagem | Pollinations limita 1 imagem/45s por IP — aguarde; ou ative o faturamento do Google AI Studio para Nano Banana. |
| Edição de imagem falha com 429 | A cota grátis de imagens do Gemini não está ativa; ative o faturamento ou use só geração. |
| "Chrome ou Edge não encontrado" | Instale o Chrome (o assistente oferece o botão WinGet) e abra de novo. |
| Porta 3001/3002 ocupada | O app escolhe a próxima porta livre automaticamente. |
| Chave errada/expirada | Use as janelas de provedores dos **🔑 Chaves de API**; erros aparecem no chat com o diagnóstico. |

## Onde ficam os dados

Tudo fica dentro de `data/` na pasta do JARVIS:

- `data/keys.json` — suas chaves (local, nunca enviadas a terceiros além dos provedores de IA escolhidos)
- `data/prefs.json` — suas preferências
- `data/video/<id>/` — produções (MP4, legendas .srt/.vtt, roteiro, QA)
- `data/images/` — imagens geradas
- `data/logs/` — logs (health.log, setup.log, electron-main.log)
- `data/logs/.first-run-done` — marcador da primeira execução

## Verificação real (nesta máquina de desenvolvimento)

A detecção foi executada de verdade contra este PC e os resultados confirmados:

| Item | Resultado medido |
|---|---|
| Sistema | Windows 11 (build 26300), x64 |
| CPU | Intel Core i3-10100F · 8 núcleos |
| RAM | 31,8 GB (16,5 GB livres) |
| Disco | 194 GB livres |
| GPU | NVIDIA GeForce GTX 1660 SUPER · 6.144 MB VRAM (via `nvidia-smi`) |
| Internet | online, latência 72–383 ms |
| Chrome | encontrado (`C:\Program Files\Google\Chrome\Application\chrome.exe`) |
| Ollama | ativo em `127.0.0.1:11434` — 5 modelos instalados |
| Diretórios | `images`, `video`, `logs`, `temp`, `cache`, `models` criados com sonda de escrita |

Emite também: `data/logs/health.log` a cada verificação, com o resultado item a item.

## Desinstalação

O JARVIS é portátil: feche o app e apague a pasta. Para remover só os dados,
apague apenas `data/`. Não há nada no registro do Windows.
