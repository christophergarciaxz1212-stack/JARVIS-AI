# JARVIS AI — Guia de Configuração Completo

## 🛠️ Desenvolvimento e manutenção

Comandos (use `npm.cmd` no PowerShell se o script `.ps1` estiver bloqueado):

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento na porta 3001 (pasta `.next-dev`) |
| `npm run build` | Build de produção (pasta `.next`) — roda lint + checagem de tipos |
| `npm run start` | Sobe o build de produção em http://127.0.0.1:3001 |
| `npm test` | Suíte de testes (vitest 4, **97 testes** em 7 arquivos) |
| `npm run lint` | ESLint 9 (flat config em `eslint.config.mjs`) — 0 erros/warnings esperado |

- O build de produção fica em `.next` e o dev em `.next-dev` — um não sobrescreve o outro.
- O app Electron (`npm run app`) roda o build de produção; se o código mudar, o build fica obsoleto e o `electron/main.js` reconstrói automaticamente.
- Dependências auditadas (`npm audit` = **0 vulnerabilidades**); `next` fixado em 15.5.29 e `zod`/`postcss` forçados via `overrides` no `package.json`. Não remova os `overrides` sem rodar `npm audit` depois.
- Git **não** está instalado nesta máquina — instale para versionar o projeto (o `.gitignore` já cobre `data/`, `.next/`, `node_modules/` e `.env.local`).
- Variáveis de ambiente documentadas em `.env.local.example`; `JARVIS_SECRET_KEY` foi removida por não ser usada em nenhuma parte do código.

### Imagens e multimodal no chat

- **Anexar imagem:** no chat, clique no botão de imagem (ao lado do clipe). A imagem é redimensionada para no máximo 1280 px e vai direto na mensagem — o JARVIS analisa o conteúdo com o **melhor Gemini flash conectado** (troca automática se um estiver em alta-demanda ou com quota esgotada) e responde ao seu pedido. Suporta até 2 imagens (JPEG/PNG/WebP, 2 MB cada) por mensagem.
- **Editar por linguagem natural:** anexe uma imagem (ou use a última gerada) e peça: “remova o fundo”, “deixe em preto e branco”, “troque a roupa do personagem”, “transforme em estilo cinematográfico”. A edição usa os modelos de imagem do Gemini (Nano Banana etc.) e **preserva o que você não mencionou**. Detalhe honesto: a sua chave Gemini está sem quota de imagens (429), então a edição só funciona depois de ativar o faturamento no Google AI Studio — até lá, o erro é informado com clareza, nunca simulado.
- **“Agora transforme essa imagem em vídeo”:** funciona se a imagem estiver anexada ou for a última da galeria — o Estúdio cria o vídeo com **a sua imagem como primeira cena** e o diretor de IA completa roteiro, narração, trilha, legendas e corte.
- **Variações:** “gere variações da última imagem” ou “outra versão” regenera do mesmo prompt com nova semente.
- **Vídeos por IA (o que existe e o que não existe grátis hoje):** não há gerador de vídeo por IA gratuito e anonimamente acessível — os modelos reais (Veo, Kling, Wan, Seedance, Grok… via Pollinations) são todos de créditos pagos. Por isso o JARVIS produz vídeos **cinematográficos de verdade** com composição local (Ken Burns, partículas, lower thirds, transições, render quadro a quadro) e cenas baseadas em imagens geradas. Quando existir um provedor gratuito de verdade, ele entra como fonte de cenas com o mesmo fallback automático.

### Vídeos na conversa e no Estúdio de Vídeo

No chat, basta pedir: **“crie um vídeo sobre…”** (ou `/video <tema>`). Há dois motores, escolhidos automaticamente pelo pedido:

- **Produção cinematográfica** (quando o pedido pede narração, documentário, história, imagens realistas, trilha, legenda ou anúncio completo): o JARVIS assume papel de equipe — **Diretor Criativo → Roteirista → Designer → Diretor de Áudio → Editor → Revisor** — e monta **briefing criativo → roteiro cena a cena (PT-BR) → imagens por cena → narração Edge TTS (grátis) ou Gemini → trilha com ducking real → legendas karaokê → render no Chrome → QA automático** e o card `[[video:<id>]]` acompanha ao vivo na conversa; ao terminar, player com o MP4, **Baixar MP4**, **.srt** e QA. No chat: **“troque a imagem da segunda cena”** regera a imagem da cena (o restante é reutilizado); **“mova a cena 3 para o início”**, **“exclua a cena 2”**, **“duplique a cena 1”** reorganizam o roteiro (as imagens acompanham as cenas) e regeradam o vídeo; **“regenere o vídeo”** refaz a partir do roteiro salvo. No Estúdio: edição do roteiro por cena (↑/↓ para reordenar, ⧉ duplicar, 🗑 excluir), regeneração individual e o log do que cada especialista faz. Renderiza em até 90 s de vídeo.
- **Imagens — a parte que mais falha e como o JARVIS lida com ela:** sua chave Gemini está sem quota de imagens (429), então as cenas saem do **Pollinations** (grátis, sem chave, ~1 imagem por IP a cada 45 s). O Estúdio **serializa** a geração com uma fila espaçada de 45 s (chat e vídeo dividem a mesma cota), faz **segunda passada com nova semente** nas cenas que falharam e **interrompe a produção antes do render se NENHUMA imagem sair** — você nunca recebe um vídeo "sem cenas". Se uma ou mais cenas ficarem sem imagem, o vídeo é entregue com o aviso explícito (QA reprovado no total de falhas; aviso parcial caso contrário). Para imagens ilimitadas, ative o faturamento da API Gemini no Google AI Studio — os modelos Nano Banana já estão cadastrados e o JARVIS passa a preferi-los sozinho.
- **Motion inline** (anúncios curtos, kinetic typography): roteiro de motion design quadro a quadro (1080×1920 60 fps), card igual com progresso e player na conversa.

A versão final do vídeo cinematográfico fica em `data/video/<id>/` (`video.mp4`, `narracao.wav`, `audio.wav`, `legendas.srt|vtt`, `script.json`, `qa.json`, `previa_*.jpg`); a do motion fica em `data/motion/<id>/`.

### Conselho de IA (`/council`)

No chat, digite **`/council <sua pergunta>`** (ou `/conselho`): vários modelos respondem a mesma pergunta **em paralelo** (fornecedores distintos para evitar o mesmo viés) e o JARVIS aponta um **árbitro** que consolida a melhor resposta — com latência e tokens reais de cada especialista, e as respostas individuais recolhidas em um bloco Recolhível. Nenhum modelo novo é cobrado: usa os provedores gratuitos conectados nas Chaves de API. Ideal para decisões de arquitetura, diagnóstico difícil e perguntas em que um modelo só pode errar. Nota: custa mais tokens do que uma resposta única (3–4 chamadas + o árbitro); use para perguntas que merecem.

### JARVIS Self-Improvement (`/self-improve`)

No chat, digite **`/self-improve`** (ou `/self-improvement`): o JARVIS varre o próprio repositório com métricas reais (arquivos por tamanho, TODOs/FIXMEs, `any`s, console.logs, número de testes) e um modelo sênior entrega as **5 melhorias de maior impacto**, ranqueadas — tudo sem alterar nada. A leitura é 100% local e a única chamada de IA é o passo de revisão; se ela falhar, você ainda recebe o relatório determinístico. Nada é modificado sem você pedir.


### Relatórios, planilhas e infraestrutura

No chat (modo AGENTE), o JARVIS gera **arquivos de verdade**, não texto simulado:

- **“crie uma planilha com …”** → `create_spreadsheet` monta um `.xlsx` real (abas, colunas com largura automática, autofiltro, linha de totais com `=SUM`) e entrega no chat com botão de download.
- **“crie um relatório sobre …”** → `create_report` monta um **PDF profissional**: capa (opcionalmente com imagem gerada por IA a partir da descrição em `cover`), seções com subtítulos e bullets, rodapé com paginação.
- **“gere o relatório de infraestrutura”** → `infra_report` coleta dados reais da sua máquina (CPU, RAM, disco, uptime, Node, provedores de IA configurados, engine de skills, vídeos, memória) e entrega PDF + resumo na conversa.
- Arquivos ficam em `data/documents/` e podem ser baixados pelo chat (`/api/documents`). Para colocá-los em outra pasta, peça ao JARVIS (“mova esse PDF para a pasta X”) e ele copia — o original continua no histórico. A capa por IA vem da descrição em `cover`.

### Agente inline na conversa

No modo AGENTE, uma ordem de trabalho **não troca mais de tela**: o que o agente faz aparece ao vivo dentro da própria conversa, como no opencode — comandos com saída (`$ npm test`, exit code, duração), arquivos criados/alterados (+/- linhas), buscas, plano, mensagens entre agentes, avisos e pedidos de aprovação. O card é o componente `src/components/agents/RunInlineCard.tsx`; o transcript compartilhado com o workspace fica em `src/components/agents/transcript.tsx` e o stream SSE em `src/components/agents/useRunStream.ts`. O botão **Workspace** no card abre a visão completa (tarefas, arquivos, aprovações, relatório).

### Estrutura do front-end

`src/app/page.tsx` caiu de ~1700 para ~1120 linhas. Os componentes foram extraídos para `src/components/chat/`: `JarvisLogo`, `TypingIndicator`, `Welcome` (HeroTitle/TypedTagline/TiltCard), `MessageBubble`, `ModelManagerModal`, `ApiKeysModal`. Lógica pura testável saiu da UI: `src/lib/agents/shouldRunAgent.ts` (decidir ordem de trabalho), `src/lib/redact.ts` (mascarar segredos), `src/lib/net.ts` (proteção SSRF: HTTPS only, bloqueio de IPs privados/metadata, redirects verificados, corpo com limite).

### Segurança — correções aplicadas

- Filhos de processos (shell do agente, `/api/execute`) **não herdam mais as chaves de API** do servidor — o ambiente é filtrado em `src/lib/shell.ts` (`scrubbedEnv`).
- `/api/execute`: modo stream mata a árvore de processos no disconnect/timeout; sem interpolação de string para o PowerShell.
- Lojas JSON corrompidas **nunca mais são sobrescritas com estado vazio**: o arquivo é movido para `*.corrupt-<ts>` e a leitura lança erro (`fsutil.readJson`, `db.readStore`, `keys.ts`).
- Escritas de arquivos do agente e do painel são atômicas (temp + rename).
- Eventos do agente passam por `redact()` antes de persistir/enviar ao navegador (command lines e stdout podem conter credenciais).
- `/api/fs`: confere symlinks, bloqueia `.env*`, `data/` e `.git/`, escrita limitada a 1 MB.
- SSRF no calendário do Hub (`fetchIcs`) coberto por guarda HTTPS + IPs privados.
- Paths de extensões do Skill Engine validados (`subPath`, `readSkill`); IDs de repositórios GitHub validados.
- `/api/chat` valida a mensagem (string, não vazia, ≤ 32k) e aborta a stream de tokens se o cliente desconectar.
- Ver a lista completa de achados e o que **não** foi alterado no histórico do chat / commits.
- O scanner estático do Skill Engine agora entende **halo defensivo**: os padrões críticos `pipe-to-shell` e `credential-theft` não bloqueiam mais quando o texto diz claramente “NÃO faça isso” (comentários/docs do tipo “Never run its curl … | sh”) — eles viram achados `medium` (aprovação sua), nunca liberados como baixo. Um ataque escondido fora de comentário continua `critical`. Coberto por 4 testes em `tests/safety.test.ts`.


---

## 🚀 Início Rápido

### 0. Atalho na área de trabalho

Existe um atalho **“JARVIS AI”** na área de trabalho (ícone ⚛) que abre o app desktop — o mesmo que `npm run app`. Se o atalho for apagado, o app **recria automaticamente** a cada abertura (via `ensureDesktopShortcut()` em `electron/main.js`, com fallback para PowerShell `WScript.Shell`). Para desativar essa recriação: `setx JARVIS_NO_SHORTCUT 1`.

### 0b. Interface proporcional à tela

Todo o conteúdo do JARVIS escala automaticamente com o tamanho da janela — fontes, painéis, ícones, modais e o background neural. O app é desenhado em tamanho de referência (janela de 1500 px) e o navegador aplica um `zoom` global (`--ui-scale`), limitado entre 0.72 (telas pequenas) e 1.55 (telas grandes). Se a preferência “Fonte grande” (⚙️ Configurações › Aparência) estiver ativa, a escala é multiplicada por 1.18. Para telas muito grandes, o limite de 1.55 continua ganhando em conforto visual; não há ajuste manual — a interface só acompanha o redimensionar da janela.

### 0c. Painel Infraestrutura (diagnóstico real da máquina)

Novo botão no topo (ícone de infra). Abre um painel com:

- **Visão geral**: inventário REAL do PC — CPU, RAM, discos, uptime, hostname, IP, e as ferramentas detectadas (ssh-keygen, winget, Node, Ollama, NVIDIA SMI, tar, Docker, Tailscale, Caddy, FFmpeg…) com **“Instalar”** para as ausentes. Lista processos por RAM e serviços com inicialização automática que estão parados.
- **Monitores**: watchdog em tempo real (RAM, CPU, disco, GPU-temperatura) com limites configuráveis, histórico de incidentes e botão de “Reparar” (limpar temp / restaurar do backup / iniciar watchdog) — nada aplica sem seu clique.
- **Backups**: agendados ou sob demanda. Semsegredos (keys.json/.env nunca), com **verificação SHA-256**, criptografia opcional AES-256-GCM e restauração **em pasta à parte** (nunca sobrescreve os dados ativos).
- **Auto-recuperação**: JARVIS retoma sessões/tarefas interrompidas automaticamente após queda, desconexão ou desligamento forçado.
- **Recovery**: o JARVIS retoma automaticamente sessões/tarefas interrompidas após queda, desconexão ou fechamento forçado.
- **Notas**: Docker/K8s (via WSL2) ficam a um clique de “Instalar” no painel quando você quiser — nada é instalado sem seu clique. O agendamento e a retenção de backups ficam dentro do próprio painel de Infraestrutura → aba **Backups**.

### 1. Configurar Chaves de API

Edite o arquivo `.env.local` com suas chaves:

```env
# OBRIGATÓRIO (escolha ao menos uma):
GEMINI_API_KEY=sua_chave_aqui        # Recomendado — gratuito
GROQ_API_KEY=sua_chave_aqui          # Rápido — gratuito
OPENROUTER_API_KEY=sua_chave_aqui    # 100+ modelos — tem gratuitos

# OPCIONAIS:
CEREBRAS_API_KEY=sua_chave_aqui      # Ultra-rápido — gratuito
SAMBANOVA_API_KEY=sua_chave_aqui     # Rápido — gratuito
NVIDIA_API_KEY=sua_chave_aqui        # NIM — gratuito
GITHUB_TOKEN=seu_token_aqui          # Busca de skills no GitHub (o GitHub Models foi desativado em 30/07/2026)
```

### 2. Onde obter as chaves (TODAS GRATUITAS)

| Provedor | URL | Gratuito |
|----------|-----|----------|
| **Google Gemini** | https://aistudio.google.com/app/apikey | ✅ |
| **Groq** | https://console.groq.com/keys | ✅ |
| **OpenRouter** | https://openrouter.ai/keys | ✅ (modelos free) |
| **Cerebras** | https://cloud.cerebras.ai | ✅ |
| **SambaNova** | https://cloud.sambanova.ai | ✅ |
| **NVIDIA NIM** | https://build.nvidia.com | ✅ (créditos) |
| **Ollama** | https://ollama.com/download | ✅ (local) |

### 3. Iniciar o JARVIS

```bash
# Windows — duplo clique em:
start.bat

# Ou manualmente:
npm run dev

# Acesse: http://localhost:3001
```

---

## 🧩 Jarvis Skill Engine

O JARVIS tem um núcleo único para **Skills, plugins, ferramentas e servidores MCP**: descoberta, análise, instalação, permissões, testes, atualização e rollback. Ele é usado pela interface, pelo chat, pela API REST e por todos os agentes.

- **Interface:** barra lateral → **⚡ Skills** → **Skill Engine**.
- **Chat (sem custo de modelo):** “encontre uma skill para editar vídeos”, “instale as melhores ferramentas gratuitas para desenvolvimento”, “crie uma skill para automatizar minhas atividades acadêmicas”, “liste as skills instaladas”, “atualize todas as skills”, “teste a skill X”, “desative X”.
- **Segurança:** risco baixo instala direto; risco médio/alto, credenciais e MCP remoto pedem aprovação; risco crítico é bloqueado. Tudo roda antes em quarentena, com análise estática, ambiente isolado, testes funcionais e logs sem segredos.
- **API:** `http://localhost:3001/api/engine` (REST local). A rota antiga `/api/skills` continua como compatibilidade.
- **Autonomia:** `manual`, `assisted` (padrão) ou `autonomous`; `autoCreate` pode criar uma Skill própria quando nada pronto resolve.

📘 **Guia completo (comandos, API, política de risco, permissões e integração):** [GUIA-SKILL-ENGINE.md](GUIA-SKILL-ENGINE.md)

> A criação automática de Skills usa a equipe de agentes e precisa de pelo menos um provedor de IA configurado. Os comandos de gerenciamento (listar, encontrar, instalar, atualizar, testar, remover) funcionam sem modelo.

---

## 🤖 Modo Agente (comportamento padrão)

O JARVIS é um **agente**, não um assistente: ele executa a tarefa (lê e edita arquivos, roda comandos, usa Git e Skills) e mostra cada passo ao vivo **inline na própria conversa** (comandos com saída, arquivos alterados, buscas — como no opencode).

- **Padrão ligado:** o botão **AGENTE/CHAT** no topo da tela alterna o modo; a escolha fica salva em ⚙️ Configurações → “Começar com o modo agente ligado”.
- **O que vai para o agente:** ordens de trabalho — criar, corrigir, instalar, investigar, refatorar, analisar dados.
- **O que continua no chat rápido:** perguntas de conhecimento, saudações, comandos de mídia (“gere uma imagem de…”, “crie um vídeo sobre…”) e comandos do Hub Escolar.
- **Regras do agente:** executa primeiro, não pede permissão para o óbvio, nunca afirma ter feito algo sem resultado real e reporta o que mudou. Operações destrutivas, credenciais e MCP remoto seguem a política de aprovação.
- **Sem projeto aberto:** o agente trabalha em `Documentos\JARVIS Projetos`.

---

## ⚙️ Configurações e atalhos

- **Abrir:** botão **Configurações** na barra superior, botão **CONFIGURAÇÕES** no rodapé da barra lateral ou `Ctrl+,`.
- **Seções:** Geral, Inteligência artificial, Modo agente, Aparência, Hub Escolar, Estúdio Motion, Dados e privacidade e **Ajuda e atalhos**.
- **Aba Ajuda:** primeiros passos e exemplos de ordens — clique em um exemplo para colocá-lo na caixa de mensagem.
- **Atalhos:** `Ctrl+,` abre Configurações · `Ctrl+K` foca a caixa de mensagem · `Esc` fecha janelas.
- **Primeiros passos na tela inicial:** conecte uma IA, configure e dê a primeira ordem. Para ocultar, use o × no cartão; para voltar, Configurações → Geral → “Mostrar dicas na tela inicial”.

---

## 📦 Repositórios dos Criadores TikTok

Estes repositórios foram mencionados/recomendados pelos criadores nos vídeos:

### 🥇 Top Skills para Claude Code

```bash
# 1. Claude Code Best Practice (69k ⭐)
# https://github.com/shanraisshan/claude-code-best-practice
# Baixar skills:
npx skills install shanraisshan/claude-code-best-practice

# 2. Agentic Awesome Skills (49k ⭐)  
# https://github.com/sickn33/agentic-awesome-skills
# 2955+ skills para Claude Code, Codex, Cursor

# 3. Nuwa Skill (38k ⭐)
# https://github.com/alchaincyf/nuwa-skill
# Destila como qualquer pessoa pensa

# 4. Awesome Agent Skills (37k ⭐)
# https://github.com/VoltAgent/awesome-agent-skills
# 1000+ skills da comunidade

# 5. Claude Skills Collection (29k ⭐)
# https://github.com/alirezarezvani/claude-skills
# 410 skills profissionais

# 6. Huashu Design (29k ⭐)
# https://github.com/alchaincyf/huashu-design
# Design, UI, prototipagem, PPTX

# 7. Planning with Files (28k ⭐)
# https://github.com/OthmanAdi/planning-with-files
# Planejamento persistente para agentes

# 8. Video ShotCraft (19k ⭐)
# https://github.com/Vincentwei1021/video-shotcraft
# AI video — cinematic product promos com Remotion
```

### 🎬 Ferramentas de Vídeo (Usadas pelos Criadores)

```bash
# CapCut para Desktop (gratuito — mais usado)
# https://www.capcut.com/

# DaVinci Resolve (profissional — gratuito)
# https://www.blackmagicdesign.com/products/davinciresolve

# Remotion (vídeo com React/código)
npm install remotion @remotion/cli

# FFmpeg (edição via linha de comando)
winget install FFmpeg.FFmpeg

# ElevenLabs (narração realista)
# https://elevenlabs.io — freemium
pip install elevenlabs
```

### 🤖 Ferramentas de IA (Citadas nos Vídeos)

```bash
# Gemini CLI (Google)
npm install -g @google/gemini-cli

# Claude Code (você já tem!)
# Mas para instalar skills:
npm install -g @anthropic-ai/skill-manager  

# LangChain (Python)
pip install langchain langchain-google-genai langchain-groq

# CrewAI (agentes multi-step)
pip install crewai crewai-tools

# LiteLLM (roteamento de modelos)
pip install litellm

# n8n (automação visual — self-hosted)
npx n8n

# ComfyUI (imagens locais)
# https://github.com/comfyanonymous/ComfyUI

# Ollama (modelos locais)
winget install Ollama.Ollama
```

### 🔧 MCPs para Claude Code

Adicione ao seu `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\SEU_USUARIO\\Documents"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "SEU_TOKEN" }
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "SUA_CHAVE" }
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

---

## 🎥 Como Fazer Vídeos como os Criadores TikTok

### Fluxo Completo no JARVIS

1. **Peça ao JARVIS:** "Crie um roteiro para TikTok sobre [tema de IA]"
2. **JARVIS cria:** Roteiro completo com hook, desenvolvimento e CTA
3. **Gere narração:** Use ElevenLabs ou Edge TTS
4. **Gere B-roll:** Grave a tela (screen recording) mostrando as ferramentas
5. **Edite:** CapCut (adicione texto animado, música, transições)
6. **Publique:** Diretamente pelo JARVIS (quando APIs configuradas)

### Tipos de Vídeos que Viralizam (Baseado nos Criadores)

| Tipo | Exemplo | Ferramentas |
|------|---------|-------------|
| Tutorial ferramenta | "Como usar o Claude Code" | Screen recording + CapCut |
| Comparativo | "Claude vs GPT vs Gemini" | Demonstração lado a lado |
| Resultado | "Criei um app em 10 minutos" | Time-lapse do terminal |
| Lista | "5 MCPs que mudam tudo" | Carrossel ou lista animada |
| Bastidores | "Como uso IA no meu trabalho" | Câmera + screen |

---

## 🧠 Configurar Memória Persistente

O JARVIS já salva automaticamente:
- Histórico de todas as conversas (SQLite local)
- Memórias que você pedir para salvar

Para salvar uma memória permanente, diga:
> "JARVIS, lembre que eu prefiro Python para backend"
> "JARVIS, salve que meu projeto principal é em Next.js"

---

## 🔐 Segurança

- Chaves de API ficam em `.env.local` (nunca commitado no git)
- O banco de dados fica em `data/jarvis.db` (local, privado)
- Comandos destrutivos são bloqueados automaticamente
- Confirmação explícita para operações sensíveis

---

## 📱 Acesso

- **Local:** http://localhost:3001
- **Rede local:** http://SEU_IP:3001 (para acessar de outro dispositivo na rede)

---

## Novos provedores (v1.1)

### Provedor personalizado (OpenAI-compatible — LiteLLM, vLLM, LocalAI)

Aponte o JARVIS para **qualquer** endpoint compativel com a API da OpenAI:

    CUSTOM_AI_BASE_URL=http://localhost:4000/v1     # ex.: gateway do LiteLLM
    CUSTOM_AI_API_KEY=sk-...                        # opcional (pule se o endpoint dispensa chave)
    CUSTOM_AI_MODEL=gpt-4o-mini                     # opcional — forca este modelo (funciona sem /models)
    CUSTOM_AI_NAME=LiteLLM Gateway                  # opcional — nome exibido na interface

Sem `CUSTOM_AI_BASE_URL`, o provedor nem aparece. Com ele, o catalogo sonda `/models` ao vivo (ou usa
`CUSTOM_AI_MODEL` fixo) e entra na cadeia de fallback como qualquer outro provedor gratuito.
Detalhe: o LiteLLM (`litellm --model ...`) e a forma recomendada de agregar 100+ provedores em uma rota.

### Pontes gratuitas na mesma máquina (Antigravity e OpenCode)

Se você tem o **Antigravity** (`agy`) ou o **OpenCode Desktop** instalado e logado, o JARVIS
usa os modelos gratuitos deles sem nenhuma chave de API extra — a autenticação é a do próprio
app, e o JARVIS nunca toca nas credenciais.

**Antigravity:** Claude Sonnet 4.6, Claude Opus 4.6 (Thinking) e GPT-OSS 120B (Medium).
O roteador prefere o Sonnet 4.6 para trabalho pesado e o GPT-OSS 120B para código.

**OpenCode:** o pool `opencode/*-free` fica disponível como provedor `opencode`
(`big-pickle`, `beam-free`, `iceman-free`, `longcat-2.5-free`, `flint-40b-free`,
`hy4-flash-free`, `inkling-2-small-free`, `glm-5.3-flash-free`, `mimo-v2.6-flash-free`,
`deepseek-v4.1-flash-free`, `nemotron-3.5-lightning-free`, `nemotron-3.5-super-vl-free`).
Internamente, cada chamada spawna `opencode run` com o agente **plan** (somente leitura)
num diretório neutro vazio — o pool grátis não lê nem escreve nos seus arquivos; quem executa
as ações é o JARVIS. O prompt vai por **stdin** (prompts de agentes grandes estouram a linha de
comando do Windows). A quota diária compartilhada é detectada pelo erro "Free usage limit
reached" (HTTP 429) e o agente troca de modelo sozinho, como já faz com qualquer rate limit.

Override do caminho do binário (se ele não estiver num local padrão):

    AGY_PATH=C:\caminho\para\agy.exe
    OPENCODE_CLI=C:\caminho\para\opencode-cli.exe

O catálogo marca o provedor como `connected` só depois de confirmar execução real; se o pool
mudar (modelo removido/renomeado), ele simplesmente sai da lista — nada quebra.

### Anthropic (Claude — pago, desativado por padrao)

O JARVIS opera gratuito por padrao. Para reativar o Claude:

    ANTHROPIC_API_KEY=sk-ant-...
    JARVIS_ALLOW_PAID=1

Streaming SSE nativo (`/v1/messages`), sem SDK extra; o modelo aparece no catalogo e na cadeia de
fallback como os demais. Testes: `tests/anthropic-stream.test.ts`, `tests/custom-provider.test.ts`.

### Catalogo de modelos enriquecido (models.dev)

O contexto real, a saida maxima, o suporte a ferramentas/raciocinio/anexos e a data de lancamento de cada
modelo vem do banco aberto **models.dev** (MIT), atualizado a cada 24h para `data/models-dev.json`.
Sem rede, vale o cache. Desligue apagando o arquivo — nada quebra.
