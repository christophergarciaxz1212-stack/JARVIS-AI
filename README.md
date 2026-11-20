# JARVIS AI — Agente Pessoal de Tecnologia

Workspace de engenharia com inteligência artificial — para profissionais de infraestrutura, redes, desenvolvimento, suporte e toda área de tecnologia.

## O que é

- **Chat natural** — fale o resultado que você quer e o JARVIS entrega (código, análises, infra, relatórios, design).
- **Modo Agente** — o JARVIS lê e edita arquivos, roda comandos e testa o que criou, com cada passo ao vivo na conversa.
- **Multi-agente** — equipes de IA especializadas colaboram em paralelo (backend, frontend, DevOps, QA).
- **Lab de redes (Topologia EVE-NG)** — digite "crie uma rede para uma empresa com três departamentos" e veja o diagrama completo com interfaces, sub-redes, portas e validação.
- **Infraestrutura real** — inventário, diagnósticos, portas, Docker, backups e monitoramento do seu PC e de servidores registados (via SSH).
- **Conselho de IA (`/council`)** — vários modelos respondem a mesma pergunta em paralelo e o árbitro consolida a melhor resposta, com latência e tokens reais por especialista.
- **Self-Improvement (`/self-improve`)** — varredura determinística do próprio código + as 5 melhorias de maior impacto, medidas, nada alterado sem aprovação.
- **Social (Instagram/TikTok)** — vídeos produzidos pelo JARVIS sobem para o Metricool como rascunho com legenda gerada por IA; com `SOCIAL_AUTOPOST=1` no `.env.local` e instrução explícita, a publicação é agendada. Nada vai para o ar sem seu clique.
- **Skills & Extensões** — instala e usa centenas de skills prontas (Anisble, Terraform, Vue, React, Kubernetes, etc).
- **Relatórios e documentos** — gera PDFs, planilhas e gráficos prontos para entrega.
- **HUD holográfico** — boot cinematográfico, scanlines CRT, cantos de moldura, reator pulsante, clock ao vivo (v1.1).
- **Modelos com dados reais** — catálogo enriquecido pelo [models.dev](https://github.com/anomalyco/models.dev) (MIT): contexto, saída máxima, raciocínio, ferramentas e data de lançamento de cada modelo (v1.1).
- **Multimodal no chat** — anexe uma imagem (botão de imagem ou do anexo 📎): o JARVIS analisa o que está nela com o melhor Gemini flash conectado (fallback automático entre modelos quando um está em alta-demanda). Peça edição em linguagem natural: “remova o fundo”, “deixe em preto e branco”, “transforme essa imagem em vídeo” — o JARVIS executa a edição com os modelos de imagem do Gemini (preserva o que não foi mencionado) ou cria o vídeo no Estúdio usando a sua imagem como primeira cena. Variações/regeração do último resultado direto pela conversa.
- **Antigravity (grátis, na mesma máquina)** — Claude Sonnet 4.6, Claude Opus 4.6 e GPT-OSS 120B Medium são servidos pelo Antigravity CLI (`agy`) em tier gratuito; JARVIS prefere Claude Sonnet 4.6 para trabalho pesado e GPT-OSS 120B para código (verificado em execução real).
- **OpenCode (grátis, na mesma máquina)** — o pool grátis do OpenCode Desktop (`big-pickle`, Beam, Iceman, LongCat 2.5, Flint 40B, Hy4/MiMo/GLM/DeepSeek/Inkling Flash, Nemotron 3.5 Lightning e Super VL) fica disponível como provedor `opencode|*`. O JARVIS spawna o CLI com o agente `plan` (somente leitura) num diretório neutro — as ações continuam sendo executadas pelo JARVIS, nunca pelo OpenCode; a quota diária esgotada é detectada ("Free usage limit reached", 429) e o agente troca de modelo automaticamente.
- **Nano Banana (imagens)** — `gemini-2.5-flash-image`, `gemini-3-pro-image(-preview)` e `gemini-3.1-flash-image(-preview/lite)` (os modelos conhecidos comunitariamente como "Nano Banana" e "Nano Banana Pro") estão cadastrados. Sua chave Gemini atual retorna 429 (free image quota não ativada); até ativar o billing, o JARVIS usa Pollinations como generator gratuito (1 imagem a cada 45s por IP).
- **Assistente de Primeira Configuração** — na primeira abertura, o JARVIS mede o computador de verdade (SO/build, CPU, RAM, disco, GPU e VRAM, internet com latência, Chrome/Edge, Ollama, chaves de IA), prepara os diretórios testando a escrita e mostra o que falta com botões de instalação explícita via WinGet — nada instala sem o seu clique. Vira também o módulo permanente **JARVIS SYSTEM HEALTH** (`data/logs/health.log`): verifica de novo qualquer hora e repara diretórios/arquivos de configuração sem tocar nos seus dados.
- **WhatsApp oficial (Meta Cloud API)** — **JARVIS WHATSAPP CENTER** (trilho lateral): receber, responder e gerenciar o número da WhatsApp Business Cloud API — webhooks com assinatura `X-Hub-Signature-256`, janela de 24h, templates, status de entrega, contatos com apelido/tags/notas, automações (urgência, compromissos→lembretes, fora do horário), notificações em tempo real (SSE) e comandos no chat ("JARVIS, responda o João dizendo que vou chegar às 15h"). Credenciais só em `keys.json`. Passo a passo em [GUIA-WHATSAPP-META.md](GUIA-WHATSAPP-META.md).
- **WhatsApp pessoal via OpenWA (QR)** — no mesmo **JARVIS WHATSAPP CENTER**, o botão verde **"OpenWA"**: instala o [OpenWA](https://github.com/rmyndharis/OpenWA) (MIT, auto-hospedado) com 1 clique neste PC (Node ≥ 22.19, engine Baileys, SQLite — sem Chromium) ou conecta num OpenWA externo/Docker, e gera o **QR code de vinculação** para o JARVIS ler e enviar no **seu número pessoal** — sessão `jarvis`, webhook com HMAC (`X-OpenWA-Signature`), últimas mensagens no painel e envio de teste. Credenciais só em `keys.json`; o serviço local escuta só em `127.0.0.1`. Passo a passo em [GUIA-OPENWA.md](GUIA-OPENWA.md).

## Instalar

### Pré-requisitos
- **Node.js ≥ 18.18** ([download](https://nodejs.org))
- Windows 10/11 x64 ou macOS
- (Para o modo Agente): uma chave de API de qualquer provedor gratuito listado em `.env.local.example`

### Primeira execução

```bash
git clone <url-do-repo> JARVIS
cd JARVIS
npm install
cp .env.local.example .env.local
npm run app            # Electron desktop
# ou
npm run dev            # navegador em http://127.0.0.1:3001
```

### Atalho no Desktop

```bash
npm run atalho         # cria "JARVIS AI.lnk" na Área de Trabalho e no Menu Iniciar
```

O atalho abre o JARVIS como **um programa de verdade**, independente de node_modules ou do npm.

## Estúdio de Vídeo (produção audiovisual com IA)

Complete pedido em linguagem natural → o JARVIS produz o vídeo inteiro com papel de equipe de cinema:
Diretor Criativo (briefing, identidade visual) → Roteirista (roteiro cena a cena) → Designer (imagens cinematográficas por cena) → Diretor de Áudio (narração em português do Brasil + trilha com ducking real sob a voz) → Editor (montagem, Ken Burns, transições, partículas, lower thirds, barra de progresso, render quadro a quadro no Chrome) → Revisor (QA de quadros e áudio antes de entregar).

- **Imagens por cena garantidas ou a produção avisa** — as imagens são o coração do vídeo; o JARVIS gera com seed fixa e estilo coerente, espera a janela do tier grátis (Pollinations, ~1 imagem/45s por IP, fila serializada) e faz segunda passada com nova semente nas cenas que falharam. Se NENHUMA imagem sair do provedor, o vídeo não é renderizado — você recebe o motivo, nunca um vídeo "sem nada".
- **Narração** (Edge TTS grátis; Gemini e voz do Windows como alternativas) com tempos palavra por palavra, ducking sob a música e legendas karaokê animadas no vídeo + `.srt`/`.vtt` para download.
- **Edição sem recomeçar**: roteiro editável cena a cena no estúdio; qualquer cena pode ser regerada individualmente. No chat: “troque a imagem da cena 2”, “regenere o vídeo”, **“mova a cena 3 para o início”**, **“exclua a cena 2”** e **“duplique a cena 1”** — o vídeo é reorganizado e regerado automaticamente. No Estúdio, cada cena tem botões de subir/descer/duplicar/excluir com as imagens reindexadas junto.
- **QA antes de entregar**: quadros pretos/vazios, silêncio na narração, duração real vs. planejada e cobertura de imagens; falha total de imagens reprova o QA.

Formatos: YouTube (16:9, 1920×1080 e **4K 3840×2160**), Shorts/Reels/TikTok (9:16, 1080×1920 e **4K 2160×3840**), feed 1:1 e 4:5, apresentação. FPS: 24, 25, 30 (padrão), 50 e 60.

**Consistência visual entre cenas**: direção de arte, paleta e linguagem de câmera do briefing são injetadas deterministicamente em toda cena; o mood aplica a mesma grade de cor em todas as imagens; o roteiro repete os mesmos termos de continuidade.

**Animações cinematográficas**: Ken Burns, transições reais — **wipe**, **iris**, **zoom** e **fade** — rack focus na abertura da cena (abre desfocada e trava nítida), grão de filme, letterbox anamórfico na abertura, partículas, lower thirds, varredura de luz, barra de progresso e drift sutil da legenda (paralaxe).
Requer o Chrome ou o Edge instalado (usa o depurador nativo); chave do Gemini/Groq melhora roteiro e transcrição; a voz Edge e as imagens Pollinations não precisam de chave.

## Desenvolvimento

```bash
npm run build          # compila o app para produção
npm run start          # serve o app em 127.0.0.1:3001
npm test               # testes (vitest)
npm run lint           # lint (eslint)
```

## Arquitetura

```
src/
├── app/             # rotas da API (Next.js App Router)
├── components/      # UI React (chat, agents, hub, infra, net, motion…)
├── lib/             # lógica
│   ├── ai/          # catálogo de modelos, roteamento, fallbacks e models.dev (dados abertos de modelos)
│   ├── agents/      # orquestrador multi-agente (tasks, locks, scheduler)
│   ├── engine/      # Skill Engine (descoberta, instalação, sandbox)
│   ├── infra/       # inventário, rede, SSH, Docker, backups
│   ├── openwa/      # OpenWA (gateway WhatsApp QR): install gerenciado, cliente REST, webhook HMAC
│   ├── netlab/      # topologia de redes (criar, validar, exportar)
│   └── hub/         # Hub Escolar (Faculdade: tarefas, provas, notas)
├── data/            # dados persistentes (Prisma/SQLite + JSON atomic) — gitignored
└── tests/           # vitest
```

## Segurança

- **Nunca committe chaves**: `.env.local` está no `.gitignore`; as chaves ficam noCofre `data/keys.json` que também ignora versionamento.
- **Sandboxes**: skills potencialmente perigosas são baixadas em quarentena, analisadas estaticamente e só entram se "aptas para instalar" — com aprovação sua quando necessário.
- **Comandos de IA (chat)**: nunca executados sem a sua confirmação; operações destrutivas ficam bloqueadas por heurísticas de risco e precisam ser aprovadas no painel Aprovações.

## Solução de problemas

| Sintoma | Causa | Solução |
|---------|-------|---------|
| Janela abre e fecha | Electron crash neste Windows build | Use `npm run dev` (serve no `http://127.0.0.1:3001`) e abra no navegador; ou clique no atalho que aponta para o `.exe` empacotado |
| `npm install` não baixa electron | npm desta máquina bloqueia postinstall | `node node_modules\electron\install.js` deve ser executado manualmente (ou use o script `scripts/setup-electron.ps1`) |
| Chat não responde | Nenhuma chave de API configurada | Abra **Chaves de API** (pílula azul no topo da tela) e cole uma chave grátis do Gemini, Groq ou Cerebras |
| Sessão de excluí desaparece e re-aparece | Modo Agente roda em background | Em **Configurações → Modo agente** desligue "iniciar com o modo agente ligado" (recomendado) ou remova a tarefa pendente |

## Licença

App privado de usuário. Distribuição não autorizada.
