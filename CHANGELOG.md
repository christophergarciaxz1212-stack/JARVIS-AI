# CHANGELOG — 3 modelos de vídeo, prospecção local, máximo dos modelos e áudio sem chiado (19/11/2026, 6ª rodada)

## Vídeos: só os modelos do usuário; cores e imagens corrigidas (20/11)
- O usuário recusou o vídeo "realista" (imagens de IA + movimento de câmera): "não quero nem com imagens fortes, eu não quero este modelo". `video/decide.ts` agora só escolhe **animado** (padrão, modelo dos vídeos do TikTok), **comercial** e **publicitário** (só com essa palavra). Pedidos "realista / 3D / anime / desenho" saem no modelo animado e a resposta avisa. Sem consulta à IA para escolher (mais rápido). "refaça como comercial/animado/publicitário" refaz o último vídeo.
- **Bug de cor** em `video/composition.ts`: um `hue-rotate` de 180–210° por "mood" invertia as cores (mar turquesa virava laranja, céu azul virava marrom). Removido; só um leve `saturate/contrast`.
- **Imagens**: novo provedor NVIDIA FLUX (`media/images.ts`, chave nvapi- do chat): FLUX.1-dev (~35 s) com queda para FLUX.1-schnell (~4 s); sem marca d'água, 1344×768/768×1344. Ordem automática: NVIDIA → Gemini → Pollinations. A API não aceita `seed` (422). Opção "NVIDIA FLUX" em Configurações › Imagens.

## Chat: memória, criação de prompts e precisão (20/11)
- **Memória** (`src/lib/chat/memoryIntent.ts` puro + `memory.ts`): "lembre que / anote que / não esqueça que / guarde isso" salva; "esqueça que / apague da memória" apaga só o que bate; "o que você lembra sobre mim?" lista. A mesma informação com valor novo substitui a antiga (sem duplicar). Toda conversa leva a memória no system prompt (relevantes + recentes, até ~3.000 caracteres) — antes só entravam 5 memórias com palavras em comum e não havia como salvar pelo chat. Não confunde "o que você sabe sobre buracos negros?", "lembra que te falei…?", "esqueça isso" nem "me lembre amanhã às 9h".
- **Prompts** (`src/lib/chat/promptCraft.ts`): "crie/melhore um prompt…" ativa o modo engenharia de prompt com guia por destino (texto, imagem/Midjourney, vídeo/Sora-Veo, código, system prompt) e entrega fixa: prompt pronto num bloco ```text, "Como usar" e, ao melhorar, "O que mudei". "Prompt de comando" do Windows não ativa.
- **Precisão**: seção nova no system prompt (resposta primeiro, não inventar, contas passo a passo conferidas, avisar dado que muda com o tempo, reler antes de enviar) e seção de memória ("você TEM memória").
- Teste real (servidor 3004): memória do cachorro salva → respondida numa conversa nova → esquecida; 17% de 2.350 e −10% = 399,50 → 359,55 (certo); prompt de Midjourney em 7 s no formato pedido; capital da Austrália em 0,9 s.

## Vídeo pelo chat: o JARVIS decide o tipo (20/11)
- Novo `src/lib/video/decide.ts`: escolhe entre **animado** (motion, modelo dos vídeos do TikTok), **comercial** (motion app-promo), **realista**, **3D** (estilo Pixar), **anime**, **desenho 2D** e **publicitário** (motor de imagens). Pedido explícito ("em 3D", "realista", "estilo anime", "motion"…) sempre vence; sem especificar, escolhe pelo tema e, quando o tema não é de tecnologia, confirma com uma IA rápida (`askVideoKind`, 8 s, opcional).
- Temas do modelo dos vídeos do TikTok (ferramentas, IA, listas, notícias, dados, tutoriais) ficam **travados** no motion (`locked`) — a IA não troca por outro tipo (pedido do usuário: manter os modelos das referências).
- `director.ts`: `LOOKS` com 5 visuais; o estilo é forçado no briefing para todas as cenas terem o mesmo visual. `VideoRequest.look`.
- Chat entende mais jeitos de pedir ("quero um vídeo", "crie um curta", "faça uma animação 3D", "preciso de um vídeo") e "refaça em 3D/realista/anime/desenho/animado" refaz o último vídeo noutro visual. A resposta diz o tipo escolhido e o motivo.
- Teste real (servidor 3004): robô em 3D (explícito) → 6 cenas 3D aprovadas; praias de Noronha → IA escolheu realista, 5 cenas aprovadas; 3 ferramentas de IA → animado (tech-passos), 13 MB. Limite: as imagens grátis (Pollinations) vêm com marca d'água e às vezes faixas nas bordas.

## Janela proporcional à tela (20/11)
- `electron/main.js`: a janela abria fixa em 1440×900. Agora `windowBoundsForScreen()` usa a área útil da tela principal (`screen.getPrimaryDisplay().workArea`): 88% da largura e da altura, centralizada; mínimos limitados a 60% da tela em telas pequenas. Medido no monitor 1920×1080: janela 1690×908 em (115, 62). Aplicado no app instalado e em Documents (ainda não está no instalador 1.2.1 do GitHub).

## Interface proporcional à janela (20/11, versão 1.2.1)
- A escala global (`src/app/page.tsx`, `--ui-scale` em `.ui-root`) olhava só a largura: em 1920×1080 com letra "grande" chegava a ~1.5 e sobravam ~660 px de altura úteis. Agora usa `min(largura/1500, altura/900)`, letra grande ×1.12, e um teto que garante pelo menos 1180×720 px de espaço útil. Medido: 1280×720 → 0.896; 1920×1000 → 1.244; 2560×1400 → 1.736 — área útil sempre ~1450–1550 × 800.

## Tela preta ao abrir (20/11)
- Causa: `findFreePort()` em `electron/main.js` testava a porta com `net.listen` (assíncrono, nunca lança na hora) e por isso sempre devolvia 3001. Um `next dev` antigo (de 18/11) ocupava a 3001; o servidor do app morria com a porta ocupada e a janela abria no servidor velho, cuja build não existia mais → tela preta.
- Correção: a porta livre agora é testada num processo filho síncrono (`spawnSync` + `ELECTRON_RUN_AS_NODE`), com o resultado no código de saída. Com 3001/3002 ocupadas ele escolhe 3003.
- Corrigido também o laço de EPIPE no log (`uncaughtException` escrevia no stderr fechado, que gerava outro EPIPE): milhares de linhas por segundo em `data/logs/electron-main.log`.
- Aplicado no app instalado (backup em `electron/main.js.bak-20261120`) e em `Documents\JARVIS`. O instalador 1.2.0 do GitHub ainda tem a versão antiga desse arquivo.

## Revisão do que o OpenCode fez + teste no app instalado (versão 1.2.0)
- Revisadas as integrações dele (WhatsApp Meta, OpenWA, ponte OpenCode, animações, instalador): `tsc`, `eslint` e os 487 testes passam; nenhum arquivo com texto corrompido.
- **Corrigido:** no app instalado, `data` é uma junção para `Documents\JARVIS\data`, e o `mkdir` recursivo do Node (24 e 26) falha com ENOENT através de junções — qualquer pasta nova de dados (ex.: cache da busca de empresas) quebrava. `dataDir()` agora usa o caminho real (`realpathSync.native`), e `social/caption.ts` e `social/agentTools.ts` passaram a usar `dataDir()`.
- **Corrigido:** "crie um vídeo … para estudar" caía no plano de estudos do Hub Escolar; pedidos de conteúdo (vídeo, imagem, post, site…) não acionam mais o Hub.
- Teste real no build do app instalado: busca de padarias perto da Praça da Liberdade (5 resultados + planilha) e vídeo de 15 s pelo chat (161 s).
- Observação: `src/components/whatsapp/WhatsAppCenter.tsx` e as rotas `whatsapp/oauth`, `automations`, `notifications`, `events` (de `lib/whatsapp/meta`) não são usados pela tela atual do WhatsApp — ficaram como estão, sem remoção.

## Estúdio de Vídeo: 3 modelos
- **Modelo dos vídeos** (explicadores estilo TikTok, animação por código, vertical 1080×1920) com 4 variações feitas a partir das referências: **Passos** (lista de ferramentas, terminais, diagramas), **Notícia** (manchete neon, apps em vidro, comando), **Dados** (minimalista preto e branco, contadores, curvas) e **Analogia** (telas neon, chips "1 de 8", cena de alerta). Cada variação tem um **kit visual** (`src/lib/motion/kit.ts`: fundo, legenda karaokê, pílulas, cards, ícones, terminal, código, chips, contador, curva, linha do tempo, mascote) e um **layout por faixas** — a IA só compõe, o visual sai consistente mesmo com modelos gratuitos.
- **Comercial** (produto/app à venda, animação 3D por código; site da marca opcional para cores e logo) e **Publicitário** (campanha de marca cinematográfica com imagens de IA — o motor antigo, agora só para isso).
- Retirados: estilos Cinema, Cena contínua, Tipografia cinética e os gêneros documentário/educativo/reels.
- Chat: "crie um vídeo…" escolhe o modelo pelo pedido (`videoModelFor`); a variação pelo tema (`guessKitStyle`).
- Narração com a voz escolhida no Estúdio (Edge com tempo exato por palavra para a legenda); produções animadas aparecem na mesma lista, com "Pedir um ajuste".
- Qualidade: uma cena por item narrado; erro de sintaxe é mostrado à IA com o trecho exato e, se repetir, outro modelo corrige; o teste agora pega **texto sobreposto/escondido** e **meio do quadro vazio**; efeitos padrão quando a IA não manda nenhum. Testado com IA real: 4 vídeos (o último sem nenhuma correção, 1 min 45 s).

## Áudio sem chiado
- Retirada a trilha/cama sintetizada (zumbido contínuo) dos dois motores: **só voz e efeitos**.
- Efeitos refeitos sem ruído branco: whoosh e rise viram varreduras tonais; o impacto perde o estalo de ruído.

## Prospecção local (empresas e comércios próximos)
- Equivalente legal do "Google Maps Scraper" (raspar o Google Maps viola os termos dele): **OpenStreetMap** via Nominatim + Overpass, sem chave, com cache e limites de uso respeitados.
- No chat: "quais padarias tem perto da Savassi, BH", "empresas sem site no centro de Campinas", "leads de academias em Moema num raio de 2 km". Traz nome, categoria, telefone, **WhatsApp**, site, e-mail, Instagram, endereço, horário, distância, link do mapa e **pontuação de lead** (sem site = oportunidade), mais a **planilha .xlsx** completa.
- Ferramenta `local_businesses` para os agentes (ex.: "ache dentistas sem site e escreva uma abordagem para cada um").

## Extrair o máximo dos modelos
- Pede a **saída máxima** de cada modelo (antes valia o padrão baixo do provedor), contida pela cota grátis.
- **Continua sozinho** respostas cortadas pelo limite (até 2 vezes) e junta tudo.
- Raciocínio do gpt-oss: médio no chat, alto nos agentes/JSON.
- **Memória da conversa sob medida**: até 80 mensagens nos modelos de janela grande, só o que cabe nos de cota pequena.

---

# CHANGELOG — infra de redes turbinada + animações em todos os botões (19/11/2026, 5ª rodada)

Backup antes das mudanças: `.tmp/backup-redes-botoes-20261119/`.

## Calculadora IP / VLSM (chat e painel) — `src/lib/netlab/subnet.ts`
- **Sub-rede**: rede, máscara, wildcard (ACL/OSPF), broadcast, faixa de hosts, quantidade, tipo (privado, CGNAT, APIPA, loopback, multicast…), classe e máscara em binário. Aceita `/26`, `255.255.255.192` e "máscara …"; /31 e /32 tratados certo.
- **Dividir** em N partes iguais (avisa quando N não é potência de 2) ou num novo prefixo (`/27`).
- **VLSM** com nomes ("vendas 50 hosts, rh 20, ti 10"): do maior para o menor, alinhado, mostra o espaço livre e explica quando não cabe.
- **Sumarização** de rotas, avisando quando a rota resumida cobre endereços que não são seus.
- No chat: "calcule a sub-rede 192.168.10.77/26", "quantos hosts tem um /27", "qual máscara para 120 hosts", "faça o vlsm de 10.10.0.0/24 para…", "divida 172.16.0.0/16 em 4 sub-redes", "sumarize 10.1.0.0/24 e 10.1.1.0/24". Resposta exata, sem IA e sem custo.

## Diagnóstico real pelo chat — `src/lib/netlab/tools.ts`
- "pinga 8.8.8.8", "traceroute até 1.1.1.1", "qual o ip de github.com", "teste a porta 443 de google.com", "o 10.0.0.5:22 está aberto?", "diagnostique https://meusite.com", "o site X caiu?", "quais portas estão abertas neste pc". Roda de verdade a partir deste PC (ping/tracert/DNS/TCP/HTTP+TLS) e explica o resultado.
- Pedidos de projeto ("crie uma topologia com a sub-rede…") continuam indo para o designer; o modo Agente manda essas perguntas para o chat em vez do agente.

## Validação de projetos mais profunda — `src/lib/netlab/model.ts`
- IP de interface **fora da sub-rede da sua VLAN**; gateway de VLAN inválido, fora da faixa ou ausente (só quando nenhum switch L3/firewall o cria — router-on-a-stick).
- **Sub-redes sobrepostas** entre VLANs, cabos e todas as interfaces (antes só entre VLANs).
- **Estação sem gateway** na própria sub-rede.
- **Laço de camada 2** entre switches sem STP/RSTP/LACP (vira só informação se o projeto cita STP).
- **Trunk com VLANs diferentes** nas duas pontas.
- **Borda sem firewall** e equipamento ligado direto à internet.
- **Pontos únicos de falha** (Tarjan) como sugestão de alta disponibilidade.
- Sugestões aparecem no chat (💡) e no diagrama com ícone/cor próprios, sem contar como "problemas". Conferido nas 6 topologias salvas: sem alarmes falsos; achou uma sobreposição real (/30 de cabo dentro da VLAN 30).

## Painel Infraestrutura › Rede
- Botões **Ping, DNS, Porta e Rota** além de Diagnosticar (rotas novas em `/api/infra`: `ping`, `dns`, `port`), com histórico dos últimos resultados em cartões coloridos.
- **Calculadora IP / VLSM** com abas Sub-rede · Dividir · VLSM · Sumarizar (roda no próprio app).
- Portas em escuta com filtro "só expostas na rede" e contagem.

## Animações em todos os botões — `src/app/motion.css`, `MotionLayer.tsx`
- **Links com cara de botão** (Baixar MP4, Pegar chave, PNG/SVG, Relatório QA…) ganharam hover, pressão e a onda de clique, como os botões.
- **Botão ocupado** (com ícone girando) respira com um brilho pulsante.
- **Abas, segmentos, toggles e escolhas** dão um "pop" ao ficar ativos.
- **Botões de acento** (cyan/fúcsia) brilham no hover; ícone de botões de apagar fica vermelho.
- **Anel de foco do teclado** encaixa com uma transição; caixas `<details>` abrem suaves.
- Tudo respeita Ajustes › Aparência › Movimento e o "reduzir movimento" do Windows.

---

# CHANGELOG — compatibilidade de APIs, novos provedores e contexto para a IA (19/11/2026, 4ª rodada)

Backup antes das mudanças: `.tmp/backup-provedores-contexto-20261119/`.

## Compatibilidade das APIs (`src/lib/ai/compat.ts`, `client.ts`)
- **Aprende as peculiaridades de cada provedor|modelo**: quando um servidor recusa um campo com 400/422 (`stream_options`, `reasoning_effort`, `response_format`, `tools`, `usage` ou qualquer campo que ele nomeie no erro), a chamada é refeita sem ele e as próximas já saem certas. Vale para o chat (streaming) e para os agentes (`completeOnce`). Erros de chave, cota e modelo inexistente continuam indo para a troca de modelo.
- **Modelos sem a função "system"** (Gemma e outros): as instruções vão dentro da mensagem do usuário automaticamente.
- **Servidores sem streaming**: usa a resposta completa, com o mesmo contrato do stream.
- **Raciocínio em `<think>…</think>`** (DeepSeek R1 e destilados, QwQ): vira o painel de raciocínio em vez de sujar a resposta, inclusive com a marca partida entre pedaços; os agentes recebem o JSON limpo.
- **`content` em lista de partes** (Mistral Magistral: thinking + text) é entendido.
- **Resposta vazia/bloqueada** (`content_filter`) vira erro claro e o chat passa para o próximo modelo, em vez de uma mensagem em branco.
- **Formato Anthropic corrigido**: o streaming juntava tudo, mandava só no fim e trocava **cada quebra de linha por espaço** (listas e código chegavam colados). Agora cada pedaço sai na hora, com raciocínio e uso de tokens, e funciona com qualquer gateway compatível (`/v1/messages`).
- **Servidores sem chave** (vLLM, LiteLLM, llama.cpp…) apareciam sempre como "sem chave" e nunca entravam no catálogo — corrigido.

## Adicionar provedores novos (Chaves de API › Outros provedores)
- Cadastra **qualquer API no formato OpenAI ou Anthropic**: nome, endereço (pode colar com `/chat/completions`), chave opcional.
- **Buscar modelos**: lê a lista da própria API (`/models`, `/v1/models` ou `/api/tags`, corrigindo a base sozinho) e entende os formatos OpenAI, OpenRouter, Ollama, Gemini e listas simples. Dá para marcar só alguns modelos ou digitá-los à mão quando a API não lista.
- **Só gratuitos**: modelos que a API marca com preço ficam ocultos (opção ligada por padrão).
- **Testar**: conversa de verdade com um modelo (precisa acertar 7+5); servidores locais ganham 3 min para carregar o modelo.
- Atalhos: Cerebras, Hugging Face, Z.ai (GLM Flash), Cohere, Cloudflare Workers AI, vLLM, LiteLLM, llama.cpp/LocalAI, Jan, text-generation-webui, "Compatível com Anthropic".
- Os modelos entram no seletor do chat, no modo automático e nos agentes. A definição fica em `data/custom-providers.json`; a **chave fica no cofre `data/keys.json`** e nunca volta para a tela (só os 4 últimos caracteres).
- Testado com o Ollama do PC cadastrado como provedor OpenAI: 5 modelos achados, `llama3.2:3b` e `deepseek-r1:8b` responderam certo.

## Jogar contexto para a IA (chat)
- **Clipe 📎** (vários arquivos), **colar texto** (botão ao lado) e **arrastar e soltar** no chat. Ctrl+V de arquivo também; um texto colado com mais de 8 mil caracteres vira contexto em vez de lotar a mensagem.
- Lê **texto e código** (dezenas de extensões, UTF-8/UTF-16/Windows-1252), **PDF** (texto embutido), **Word .docx**, **Excel .xlsx**, **PowerPoint .pptx**, **HTML** e **notebooks .ipynb**. PDF escaneado, binário ou formato antigo (.doc/.xls) é recusado com explicação — nada é inventado.
- O contexto **vale para a conversa inteira** (guardado em `data/context/<conversa>.json`, apagado junto com a conversa), não só na mensagem.
- **Cada modelo recebe o quanto cabe nele** (janela de contexto + cota gratuita do provedor); no modo automático, os modelos onde o material inteiro cabe vão primeiro. Se precisar cortar, corta de forma proporcional (começo + fim), avisa o modelo e mostra na tela quanto ele recebeu.
- Antes o clipe colava só 12 mil caracteres de **um** arquivo de texto dentro da mensagem.

---

# CHANGELOG — novo design do Estúdio de Vídeo + correções gerais (19/11/2026, 3ª rodada)

Backup antes das mudanças: `.tmp/backup-estudio-20261119/` (VideoStudio.tsx, shared.tsx, globals.css).

## Estúdio de Vídeo (`src/components/video/VideoStudio.tsx`)
- **Painel em 4 etapas numeradas** (Ideia · Formato e tempo · Narração e trilha · Direção), cada uma num cartão próprio. Duração e FPS viraram botões segmentados em vez de listas; exemplos de pedido como chips com ícone.
- **Rodapé fixo** com o resumo do que vai ser produzido (formato, duração, fps, voz, trilha) e o botão Produzir, sempre visível; **Ctrl+Enter** no campo da ideia também produz; o rodapé diz o que falta (ideia vazia, arquivo de áudio).
- **Estimativa da narração**: conta as palavras do texto escrito (≈150 palavras/min) e avisa quando a fala passa do tempo escolhido — a narração dita o tempo das cenas.
- **Lembra as últimas escolhas** (formato, duração, fps, narração, voz, trilha) neste computador; o pedido e os textos não são guardados.
- **Lista de produções**: abas Todas / Em produção / Prontas / Falhas com contagem, busca por título ou pedido, selo de status, tamanho do MP4, tempo que a produção levou, **barra de etapas reais do pipeline** (Roteiro → Narração → Imagens → Trilha → Montagem → QA → Render) e esqueleto enquanto carrega.
- **Reusar configurações**: copia o pedido e todas as escolhas de uma produção para o painel.
- **Roteiro**: cabeçalho fixo com "Salvar roteiro"; fechar o card com edições não salvas pede confirmação em vez de perder o texto; ao terminar uma produção com o card aberto, o roteiro aparece sozinho. Vídeos verticais ocupam menos largura e deixam mais espaço ao roteiro.
- Cancelar/apagar agora mostram erro se falharem (antes falhavam em silêncio).

## Correções no resto do app
- **Esc fechava duas janelas de uma vez**: num diálogo de confirmação aberto dentro de outra janela (ex.: "Apagar esta produção?" no Estúdio), Esc fechava o diálogo e a janela de trás. Agora só a de cima (`Modal` em `src/components/agents/shared.tsx`, pilha de modais).
- **Contornos brancos**: a classe `*/8` (ex.: `border-white/8`, usada em 10 lugares) não existe no Tailwind padrão e caía no cinza claro — cartões e chips ganhavam borda branca. `tailwind.config.ts` agora define a opacidade 8.
- **Downloads sem acento**: o MP4/legendas baixados perdiam letras acentuadas ("Produo do caf.mp4"). Agora `filename*` UTF-8 mantém o título ("Produção do café.mp4"), com nome ASCII de reserva (`src/lib/video/download.ts`, `tests/video-download.test.ts`).

---

# CHANGELOG — teste de voz no Estúdio + todos os modelos testados por função (19/11/2026, 2ª rodada)

## Estúdio de Vídeo
- **Teste de voz**: botão ▶ ao lado do seletor toca a voz escolhida com o **mesmo motor que narra o vídeo** (Edge, Gemini ou Windows), sem trocar de voz em silêncio se ela falhar — o erro aparece. Frase de teste editável (vazia = usa o texto da narração/pedido). Cache por voz+frase: ouvir de novo é instantâneo e não gasta cota do Gemini. Rota `POST /api/video {action:'voicePreview'}`; `previewVoice()` em `src/lib/video/produce.ts`. Medido: Edge 2,1 s, Gemini 3,9 s, Windows 0,8 s; cache 0,1 s.
- **Seletores visíveis**: a lista que abre num `<select>` é desenhada pelo sistema com fundo branco e herdava o texto branco do app. Agora todo seletor tem esquema escuro, opções com fundo `#0d1522` e texto claro, seta de acento e vozes agrupadas em "Vozes femininas/masculinas".

## Modelos — testados em todas as funções
- **Teste de modelo de verdade** (`testProviderModel(..., { full: true })`, `scripts/audit/all-models.mjs`): além de responder, cada modelo é testado em **streaming** (o chat) e **JSON** (agentes, roteiro de vídeo, Hub, topologias), e precisa **acertar uma conta** em cada prova — o antigo "responda ok" aprovava modelos que só ecoam ou traduzem. O resultado (`caps`) vai para `data/model-tests.json` e cada função só escolhe modelos aprovados no que ela precisa (`fallbackChain(..., 'json')`, agentes, padrão = aprovado nas duas).
- **Streaming quebrado (regressão do OpenCode em `client.ts`)**: nos provedores compatíveis com OpenAI (Groq, OpenRouter, NVIDIA…) e no Gemini, só o 1º pedaço da resposta saía na hora; o resto vinha de uma vez no fim e **o texto inteiro era reenviado** → sem streaming real e **primeira palavra duplicada em toda resposta** ("DNSDNS…", "``````typescript"), inclusive no histórico salvo. Corrigido + `tests/stream-chunks.test.ts` (servidor SSE local).
- **Modelo padrão era um tradutor**: `nvidia/riva-translate` "respondia" traduzindo a pergunta e virou o padrão por ser rápido. Modelos que não conversam (tradução, embeddings, rerank, guardas, reward, fala) saem do catálogo (`isConversational`); padrão voltou a `groq|openai/gpt-oss-120b`.
- **Topologias**: usavam um só modelo uma vez; agora percorrem a cadeia de modelos aptos a JSON até receber uma topologia válida.
- **Chat sem limite de espera**: um provedor que aceita a conexão e fica mudo (Gemini ficou 2 min assim) segurava a mensagem. Sem nenhum sinal em 45 s (120 s para modelos locais), o próximo modelo assume.
- **Cota do dia**: "free-models-per-day" (OpenRouter), "Free usage limit reached" (OpenCode), "Individual quota reached" (Antigravity) esfriam o **provedor inteiro** (chat e agentes), em vez de tentar cada modelo dele.
- **SambaNova 402 "exige forma de pagamento"** era tratado como falha passageira e deixava os modelos no seletor → classificado como sem cota grátis (oculto por 3 dias).
- **Modo automático**: não escolhe modelo local frio (o Ollama informa quais estão carregados) e não dá mais bônus fixo a local — a latência medida decide.
- **Agentes**: o relatório final não pode mais afirmar "criei o arquivo" quando nenhum arquivo foi gravado (caso real: README "criado" sem gravação) — vira aviso em PENDENTE (`guardFileClaims`).

## Resultado medido (19/11)
- 76 modelos testados (14 que estavam ocultos ganharam nova chance). Todos os que responderam passaram em streaming e JSON. Os que falham são limites reais da conta: Gemini Pro/Omni/4-x sem cota grátis (429 `limit: 0`), Gemini 2.5 aposentados (404), Antigravity sem cota (~139 h), SambaNova exige cartão, `inkling-2-small` só para "agentic harnesses", e sobrecarga momentânea do Google (503).
- Funções com modelos reais: conversa, automático, código, topologia, conselho e imagem **6/6**; bateria de 10 tarefas de agente **9/10** (a 10ª revelou a afirmação falsa corrigida acima).
- Aviso honesto: as baterias completas consumiram a cota **diária** grátis do OpenRouter (50/dia sem créditos) e do pool OpenCode hoje; elas voltam sozinhas.

---

# CHANGELOG — revisão do trabalho do OpenCode + sistema de animações (19/11/2026)

> Revisão de cada alteração feita por outra ferramenta (OpenCode) desde o checkpoint de 16/11 23:14 (110 arquivos novos, 43 modificados), com correção do que estava quebrado ou inseguro, e uma linguagem de movimento única para o app inteiro.

## Corrigido no trabalho do OpenCode

- **Ponte Antigravity (`src/lib/ai/antigravity.ts`)**: o `agy` é um agente com ferramentas e rodava **na pasta do JARVIS** (código e `data/keys.json` à vista dele) → agora roda numa pasta vazia própria. Ignorava o cancelamento (o "Parar" do chat e o limite de 10 s do melhorador de prompt de imagem não paravam o CLI, que seguia até 180 s) → `signal` ligado ao processo. Prompt maior que a linha de comando do Windows (~32 mil caracteres) quebrava sem explicação → erro de **contexto** claro, e o JARVIS troca de modelo. A cota esgotada ("Individual quota reached… Resets in 139h50m") virava erro genérico → `parseAgyError` lê o `AGY_ERROR` (HTTP 429) e o prazo real; o modelo esfria até o prazo (máx. 24 h) em vez de gastar uma chamada de ~5 s a cada 5 min (`agents/models.ts`).
- **Testes gastavam a cota grátis real**: a suíte chamava o `agy` e o `opencode-cli` de verdade (os 2 testes de imagem "oscilavam" por isso, com timeout de 20 s). `tests/setup.ts` aponta os dois CLIs para caminhos inexistentes; os testes que precisam deles definem o caminho de propósito.
- **Assistente de primeira execução (`src/lib/setup/system.ts`)**: a instalação via WinGet era **síncrona** e congelava o servidor inteiro (chat, streaming, tudo) por até 4 min → assíncrona, e com `--exact --id` (o id da lista permitida nunca casa por aproximação). O reparo do `.env.local` usava `__dirname`, que no bundle do Next aponta para dentro de `.next/server` → usa a raiz do app.
- **OAuth do WhatsApp (Meta)**: a página de retorno colocava `?error=` e mensagens do provedor **direto no HTML** (XSS refletido) e num `<script>` sem escapar `</script>` → texto escapado, JSON seguro e CSP `default-src 'none'`. A checagem de `state` **aceitava qualquer valor** quando não havia state gravado → state de uso único, com validade de 15 min e comparação em tempo constante. O `postMessage` usava o alvo `' *'` (com espaço — inválido, a janela principal nunca era avisada).
- **Webhook da Meta bloqueado**: o middleware recusa Host não local, e o túnel (`cloudflared`/ngrok) entrega com o Host público — o webhook nunca chegava. Só `/api/whatsapp/webhook` passa (ele se autentica sozinho: verify token no GET, HMAC do App Secret no POST, fail closed); o resto da API continua só local. As instruções mostravam a porta 3002 fixa → mostram a porta real deste JARVIS.
- **Portal do Hub (Playwright)**: abria o Chromium com o **isolamento de sites desligado** (`--disable-features=IsolateOrigins,site-per-process`) na janela em que você faz login no portal → removido (a captura só lê frames da mesma origem e não precisava disso).
- **Tela de boot travada**: a reescrita do `BootSequence` perdeu o temporizador de 2,3 s e o "qualquer tecla pula" — a camada ficava na frente do app até alguém clicar. Restaurado (e respeita Ajustes › Movimento).
- **`next.config.js` na raiz**: o Next carrega `.js` **antes** de `.ts`, então desde 18/11 o projeto ignorava o `next.config.ts` (sem pasta separada do `next dev`, sem `serverExternalPackages: ['baileys']`, sem `optimizePackageImports`). Movido para `scripts/dist/` (é a config do pacote distribuído) e o `prepare-dist.mjs` copia de lá.
- **Logo da tela inicial**: o "pulso" aplicado ao átomo animava `box-shadow` num elemento quadrado (brilho **quadrado** atrás do logo) e `transform`, que anulava o zoom do hover → flutuação em `translate/rotate` (`.mo-float`), que soma com o hover.
- **Painéis laterais com animação tripla**: framer-motion + `aside-in-*` + `jarvis-panel-in` brigavam pelo mesmo `transform` → fica só o framer (que também anima a saída).
- **`.modal-pop`** mantinha `filter: blur(0)` para sempre (fill `both`), o que transforma o modal em bloco de contenção e prende menus `position: fixed` → fill `backwards`.

## Animações — `src/app/motion.css` + `src/components/MotionLayer.tsx`

O OpenCode tinha escrito ~40 classes de animação (`jarvis-ripple`, `jarvis-card-hover`, `jarvis-msg-in`…) que **nenhum componente usava** (e o `jarvis-ripple` nascia no canto, não no clique). No lugar, uma linguagem de movimento que funciona sozinha em **todos os botões**:
- **Hover**: o botão sobe 1 px; o ícone reage pelo significado — engrenagem gira, + e × giram 90°, recarregar dá a volta, enviar/abrir-link decolam, setas avançam, lixeira balança, download quica, sino toca, microfone pulsa, chave gira, lupa e lápis inclinam, olho pisca.
- **Clique**: pressão proporcional ao tamanho (um ícone de 32 px afunda 6%, uma linha de 400 px 1,5% — a mesma distância em pixels) e uma **onda de luz** que nasce do ponto exato do clique, recortada no formato do botão.
- **Abas** (Conversas/Memória, Terminal/Memória/Arquivos) com pílula que **desliza** com mola; **modais** com fundo que esmaece e painel que surge (chaves, modelos, skills, ajustes, Hub, WhatsApp, OpenWA, primeira execução, topologia); **listas em cascata** (sessões, memórias, modelos, comandos `/`, primeiros passos); **brilho que segue o cursor** nos cartões; halo de foco nos campos; checkbox com "pop".
- Só `opacity/translate/scale/rotate` (60 fps). As propriedades individuais somam com o `transform` do Tailwind em vez de substituí-lo (botões centralizados com `-translate-y-1/2` não pulam). **Ajustes › Aparência › Movimento** "Reduzido" tira deslocamentos e ondas; "Desligado" desliga tudo; o "reduzir movimento" do Windows também é respeitado.

## Verificação

- `tsc --noEmit` limpo; ESLint 0 erros; **suíte: 43 arquivos, 413 testes passando** (+ novos: `whatsapp-oauth.test.ts` — state, XSS, middleware; `antigravity.test.ts` — cota, prazo, contexto, cancelamento).
- Teste com mouse de verdade (Chrome headless via CDP): botão sobe `0px -1px`, engrenagem `rotate 75deg`, brilho segue o cursor (`--mx 30%`/`--my 60%` no ponto exato), clique afunda `0.967` e cria a onda, que se remove sozinha; aba "Memória" com pílula; modal entra e termina com `filter: none`; modo "Reduzido" sem deslocamento e sem onda; nenhum erro no console.
- Ponte Antigravity validada com uma única chamada mínima ao tier grátis: a cota da conta está esgotada (zera em ~139 h) — por isso os modelos Antigravity aparecem indisponíveis até lá.

## Avisos honestos (não alterados, para decisão do dono)

- `electron/main.js` (OpenCode) liga `--no-sandbox` no app inteiro: contorna o crash de inicialização deste PC, mas desliga o sandbox do Chromium. O atalho já passava `--no-sandbox`.
- O instalador do OpenWA baixa o código da tag `v0.30.3` do GitHub sem verificar hash.
- `src/components/whatsapp/WhatsAppCenter.tsx` é um scaffold não usado (o OAuth da Meta só é acionado por ele); mantido.

---

# CHANGELOG — WhatsApp pessoal via OpenWA (18/11/2026)

> Integração do [OpenWA](https://github.com/rmyndharis/OpenWA) (MIT, `rmyndharis/OpenWA` v0.30.3 — "Free, Open Source, Self-Hosted WhatsApp API Gateway") ao JARVIS: o botão **OpenWA** no **JARVIS WhatsApp Center** gera o **QR code de vinculação** para o JARVIS ler e enviar no número pessoal do usuário.

## O que entrou

- **`src/lib/openwa/`** (novo): `config.ts` (URL/sessão/porta em `data/openwa/config.json`; webhook secret HMAC gerado na 1ª execução; API key **nunca** em `config.json`), `client.ts` (REST do OpenWA: health autenticado, sessões, QR data URL, `send-text`, webhooks), `manager.ts` (instalação gerenciada local: tarball da tag `v0.30.3` → `tar` → `npm ci`/`npm install` → `nest build` → `node dist/main` detached em `data/openwa`, job em background com progresso, `pid` file, tail de log), `events.ts` (NDJSON das últimas mensagens recebidas), `signature.ts` (HMAC `X-OpenWA-Signature` com comparação em tempo constante), `chatid.ts`.
- **Rotas `/api/openwa/*`** (novas): `status` (agregado: instalado/rodando/alcançável/versão/sessão/stats), `install` (job background; guard contra reinstalar por cima sem `force`), `start`, `stop`, `connect` (garante sessão `jarvis` → start → aguarda e devolve o QR; tolera engine já rodando), `qr` (polling), `disconnect` (stop ou logout nativo), `send` (texto; normaliza telefone → `@c.us`), `config` (URL/sessão/porta/`apiKey` — `apiKey` vai para `keys.json`), `webhook` (ingress HMAC; grava NDJSON), `webhook-register`, `events`, `logs`.
- **`OpenWALink.tsx`** (novo): modal do botão **OpenWA** no header do WhatsApp Center — instalar com 1 clique (ou OpenWA externo via URL+key), iniciar/parar, **Gerar QR Code** (PNG data URL do próprio OpenWA) com polling e detecção de `ready`, painel "Vinculado como <nome> · <número>", envio de teste, desvincular (logout com confirmação), últimas mensagens recebidas e logs do serviço.
- **Webhook**: ao vincular, o JARVIS registra no OpenWA `message.received` + `session.status` apontando para `<jarvis>/api/openwa/webhook` na porta real do JARVIS (3001 no `next dev`; no desktop, a PORT escolhida automaticamente, derivada de `process.env.PORT`) com HMAC-SHA256; pode ser desligado com `autoRegisterWebhook`.
- **`tests/openwa.test.ts`** (novo, 16 testes): assinatura, sanitização, config (segredo do webhook preservado), `normalizeChatId`, NDJSON de eventos, client com `fetch` mockado (incl. erro 401 acionável). Suíte completa OK (405 testes; os 2 testes de imagem oscilam com a quota do Pollinations e passam na repetição; `tsc --noEmit` limpo, ESLint nos arquivos tocados limpo).
- **Docs**: `GUIA-OPENWA.md` (novo), bullet no `README.md`, ponteiro no `GUIA-WHATSAPP-META.md`, `.env.local.example` documenta `OPENWA_API_KEY`/`OPENWA_WEBHOOK_URL`.

## Lição de campo (Windows + Node 26)

- **Node 26 e `better-sqlite3`:** a tag `v0.30.3` trava `better-sqlite3@13.0.3` (lock), **sem prebuild para Node 26** — a compilação com `node-gyp` falha sem Visual Studio. O instalador reajusta `dependencies.better-sqlite3` para `^13.2.0` (prebuild confirmado neste PC) **antes** de instalar, e só usa `npm ci` em Node < 26 (com fallback automático para o mesmo reajuste se o `npm ci` falhar nesse módulo). `PUPPETEER_SKIP_DOWNLOAD=1` (engine Baileys, sem Chromium).
- **Spawn do serviço a partir do `next dev` travava antes de escutar (CPU plana, bootstrap ok):** o filho herdava o ambiente inteiro — incluindo `NODE_ENV=development` — e qualquer segredo do ambiente. O manager agora spawna com um **ambiente mínimo** (PATH/sistema/TEMP + `NODE_ENV=production`), o que resolveu (o serviço sobe em ~5s) e, de quebra, não vaza as chaves de IA do JARVIS para o processo de terceiros.
- **Webhook do OpenWA para `127.0.0.1` era recusado na hora do registro ("Destination address is not allowed"):** a guarda SSRF do gateway bloqueia loopback por padrão; o `.env` gerado inclui `SSRF_ALLOWED_HOSTS=127.0.0.1,localhost` (loopback apenas — necessário para o ingress local funcionar).
- **`.next` estava corrompido** (o dev server deste PC levantou 500 com `Cannot find module '../webpack-runtime.js'`; havia `.next-broken-20261118-2` de hoje): a pasta foi movida para `.next-corrupt-20261118` (nada apagado) e o app recompilou do zero, funcionando.
- **Dois WhatsApp Centers existem**: `src/components/WhatsAppCenter.tsx` é o usado pelo trilho/página; `src/components/whatsapp/WhatsAppCenter.tsx` é um scaffold preservado e não usado. A integração OpenWA vive no real; o scaffold ficou intocado.

## Estado deste PC ao final da sessão

OpenWA v0.30.3 instalado em `data/openwa/app`, **rodando em 127.0.0.1:2785** (SQLite + Baileys), chave admin adotada para `data/keys.json` como `OPENWA_API_KEY`, sessão `jarvis` criada no OpenWA — aguardando o escaneamento do QR pelo dono do número.

## Avisos honestos

- OpenWA é **não-oficial**: risco real de restrição/banimento. Use um **número dedicado**; o JARVIS nunca envia sem comando explícito.
- Um "vincular" via QR esgota se ninguém escanear; passkey obrigatória pelo WhatsApp impede a vinculação por qualquer engine (ver `restriction: passkey_required`).
- O webhook para 127.0.0.1:3001 só funciona com o JARVIS Next na porta padrão (3001); em portas customizadas defina `OPENWA_WEBHOOK_URL`.

---

# CHANGELOG — upgrade de design e de modelos (16/11/2026)

> Nota: o trabalho correu em paralelo com uma segunda sessão de IA neste mesmo diretório (o mesmo modelo que o JARVIS já usou: duas ferramentas em paralelo por escolha do usuário). A versão 1.1.0, o design HUD no CSS, o boot, o models.dev e os testes são desta sessão; a barra superior/fluxo de streaming (`operations.css`, `TopBar.tsx`, `CommandPalette.tsx`, `status.ts`, `resilience.ts`, `capabilities.ts`, `TypingIndicator`, `ReasoningPanel`, `api/chat`) veio da outra sessão, de forma limpa. Onde houve sobreposição, a versão mais completa prevaleceu (ver notas abaixo).

## Design — HUD holográfico
- **`src/components/BootSequence.tsx` (novo).** Tela de inicialização: o reator se desenha em traço SVG, cinco subsistemas sobem em sequência ("Núcleo neural … online" etc.) e o app assume. Uma vez por sessão; clique/tecla pulam; `prefers-reduced-motion` desliga.
- **`globals.css` — nova seção "JARVIS HUD":** scanlines de CRT + vinheta sobre o app inteiro (`.hud-overlay`, abaixo de modais); linha viva sob a barra superior (`.topbar-hairline`); barra de progresso no topo durante o streaming (`.stream-bar`); chip "● ONLINE" pulsante e relógio digital ao vivo na barra superior; cantos de moldura HUD (`.hud-corners`, aplicados ao painel de dicas e ao editor de texto `.energy-inner`); títulos de seção com filete dissolvido (`.panel-title`); itens laterais com deslize + filete que acende; trilho com glow/halo no ativo; bolhas com gradiente e pontilhado de circuito (`.msg-user`, `.msg-assistant`); feixe cônico rotativo e respiração do núcleo no hero (`.hero-beam`, `.hero-logo-wrap`); sheen nos cards de ação; barras de equalizador no "Pensando…" (`.eq-bars`); scrollbar com gradiente de acento; foco visível acessível; toasts com borda de glow; todas as animações novas respeitam `prefers-reduced-motion`.
- **`page.tsx`:** boot + overlay renderizados; relógio `HH:MM:SS` e chip ONLINE na barra superior (agora via `TopBar`, que recebe `clock={clock}`); barra de atividade durante o streaming; `hud-corners` no painel de dicas e no editor `.energy-inner`.
- **Componentes:** `MessageBubble` entra deslizando do lado do remetente (mantido após o merge) e o rodapé marca a origem do modelo; `NavRail` com halo na logo; seletor de modelo mostra **⚡ latência medida** de cada modelo já testado nesta máquina (via `/api/models` → `tests`).
- **Reutilizado pela outra sessão:** `.nav-clock` e `.live-dot` passaram a ser usados pelo `TopBar` dela. `.chip-online` e `.eq-bars` ficaram sem uso após o redesign dela (indicador `.thinking-wave` com fase/tempo real) — mantidos, sem efeito.
- **`/api/models` agora devolve também `tests`** (latência medida persistida em `data/model-tests.json`) para o painel de modelos.

## Modelos de IA — dados reais do models.dev (GitHub)
- **`src/lib/ai/models-dev.ts` (novo).** Integração com o **models.dev** (https://github.com/anomalyco/models.dev · MIT · 7,7k ⭐), banco aberto de especificações de modelos mantido pelos autores do SST/opencode. `https://models.dev/api.json` é baixado no boot e a cada 24h para `data/models-dev.json` e lido em memória (a thread do chat nunca espera pela rede; sem rede vale o cache; sem cache nada quebra).
- **`getProviderModels()` enriquece cada modelo listado ao vivo** com: contexto real e saída máxima (substituem o chute 128k/8k), `tool_call`, `attachment`/multimodal, flag de raciocínio (modelo raciocinador deixa de ser `chat` genérico no ranking), descrição/data de lançamento quando o provedor não informa.
- Mapa: google→gemini · groq · cerebras · openrouter · mistral · sambanova · nvidia · huggingface. Provedores locais (Ollama/LM Studio) inalterados.
- **`instrumentation-node.ts`** aquece o cache no boot.
- **`tests/models-dev.test.ts` (novo, 5 testes).**
- **`docs/GITHUB-AGGREGATION.md` (novo).** Repositórios verificados no GitHub, o que foi agregado e o que foi deliberadamente deixado de fora (Vercel AI SDK, Open WebUI, orbs Three.js) e por quê.

- A outra sessão, em paralelo, entregou a resiliência do chat: eventos `connecting|retry|fallback|streaming` (`status.ts`), retry exponencial com jitter + decisão de troca de modelo (`resilience.ts`), capacidades por modelo (`capabilities.ts`) e raciocínio ao vivo (`ReasoningPanel`). As duas frentes não se sobrescrevem: models.dev melhora os **dados**; a resiliência melhora o **comportamento** nas falhas.

## Versão
- `package.json`/`package-lock.json`: 1.0.0 → **1.1.0**. `tsconfig.json` ganhou `.next-build/types/**/*.ts` (build desta sessão).

## Evolução profunda (continuação da mesma release)

### Provedores e comunicação com IAs
- **Anthropic (Claude) com adapter nativo de streaming** — `callAnthropic` em `client.ts` implementa a Messages API (`/v1/messages`) com SSE próprio (sem novo SDK/dependência): extrai `input_tokens` de `message_start`, `text_delta` por `content_block_delta`, `output_tokens` acumulado de `message_delta`, e traduz erros para mensagens claras (401 → chave inválida, 429 → taxa). `completeOnce` ganhou o mesmo caminho não-streaming. **Travado por padrão**: só aparece/opera com `ANTHROPIC_API_KEY` + `JARVIS_ALLOW_PAID=1` (política de provedores pagos do JARVIS preservada). Testes: `tests/anthropic-stream.test.ts` (3 testes: SSE+uso real, 401, trava de pago).
- **Provedor personalizado (`custom`)** — qualquer endpoint OpenAI-compatible (LiteLLM gateway, vLLM, LocalAI, text-generation-webui, proxy próprio) via `CUSTOM_AI_BASE_URL` (+`CUSTOM_AI_API_KEY` opcional, `CUSTOM_AI_MODEL` opcional para fixar modelo sem `/models`, `CUSTOM_AI_NAME` para o rótulo). Registrado como gratuito, aparece no catálogo e na cadeia de fallback, chave opcional (`mayBeKeyless`). Testes: `tests/custom-provider.test.ts` (5 testes: registro, keyless, modelo fixo, gate Anthropic).
- `icons` confirmados: `github models` descontinuado (30/07/2026); Brave/GitHub seguem em Ferramentas.
- `/api/settings` mostra provedor keyless como `CONECTADO (sem chave)`; link "Pegar chave" só aparece quando há URL.
- `models-dev` passa a cobrir também `anthropic` (contexto/saída/raciocínio reais no catálogo).

### Interface premium
- **`StatusBar.tsx` (novo)** — barra inferior com dados reais: pronto/trabalhando, modo (AGENTE/CHAT), modelo ativo, projeto, nº de provedores conectados e versão (`v{pkg.version}`).
- **`operations.css` — seção "Operations 2":** tokens `.statusbar*` (26px, mono), `.aside-in-left/right` (painéis laterais com entrada por `transform`), `.terminal-output > div` (linhas do terminal entram deslizando), `.row-hover`, `.msg-assistant:hover` (borda acende).
- **Skeleton loading** no catálogo de modelos (substitui o spinner central por 6 cards-shá de largura variável com `.skeleton-line` do design system).
- Verificação visual: **0 erros de console**; `next build` **373 kB** First Load JS (CSS 18.6 kB).

### Testes e docs
- **303 testes** verdes (eram 295; +8 novos). `tsc --noEmit` limpo, ESLint limpo nos arquivos tocados.
- `docs/GITHUB-DEEP-DIVE.md` — análise dos 12 projetos-referência com licenças conferidas via API (opencode/continue/aider/langgraph/pydantic-ai · MIT/Apache; OpenHands MIT; cline/roo Apache-2.0; vercel/ai Apache-2.0; litellm MIT core/enterprise custom) e decisão adotar/adaptar/rejeitar para cada um.
- `GUIA-CONFIGURACAO.md` — nova seção "Novos provedores (v1.1)"; `.env.local.example` documenta `CUSTOM_AI_*` e `ANTHROPIC_API_KEY`/`JARVIS_ALLOW_PAID`.
- Backup automático pré-mudança: `.tmp/backup-src-2026-11-16-2305.zip`.

Rollback: as mudanças visuais vivem em `globals.css` (seção "JARVIS HUD") e nos componentes citados; o models.dev pode ser desligado apagando `data/models-dev.json` — com o arquivo ausente e sem rede, o enriquecimento é simplesmente ignorado.

---

# CHANGELOG — auditoria e upgrade do JARVIS (16/11/2026)

A auditoria foi feita por duas ferramentas em paralelo, por escolha do usuário: **Claude** (esta sessão) e **OpenCode**.
Cada item diz quem fez. Não há git neste projeto: o rollback de cada item está descrito nele.

## Claude

### Modelos de IA
- **`src/lib/ai/modelTests.ts` (novo).** Grava em `data/model-tests.json` o resultado real de cada modelo: o botão *Testar* e as falhas vistas durante o chat. Classifica as falhas em `retired` (aposentado, 404), `no-free-quota` (429 com `limit: 0`), `blocked` (403) e `temporary`.
  *Por quê:* 11 dos 40 modelos gratuitos de nuvem falhavam de forma permanente e continuavam sendo oferecidos.
  *Rollback:* apagar `data/model-tests.json` (todos voltam ao catálogo).
- **`src/lib/ai/catalog.ts`**:
  - o catálogo oculta, por 3 dias, os modelos com falha permanente (`usable`, l. 106); depois eles voltam para serem testados de novo. Falhas temporárias (503, limite por minuto, tempo esgotado) não ocultam nada;
  - a latência medida sobrevive a reinícios (`latencyOf`, l. 63);
  - o modelo padrão passa a ser o mais rápido medido entre os preferidos de cada provedor (`defaultModelFrom`, l. 233).
  *Por quê:* o padrão anterior, `gemini|gemini-3.5-flash-lite`, levou 25,8 s para responder "ok"; o novo padrão, `groq|openai/gpt-oss-120b`, leva 0,4–0,9 s.
- **`src/lib/ai/catalog.ts` — modelos locais.** O Ollama e o LM Studio passam a ser consultados em `127.0.0.1`, com cache de 15 s e tolerância a uma resposta lenta (`probeLocalCached`, l. 32).
  *Por quê:* o Ollama escuta só em `127.0.0.1:11434`. O endereço `localhost` tentava `::1` primeiro, e a consulta, sem cache e com limite de 2,5 s, fazia o Ollama aparecer "desconectado" com 0 modelos, além de atrasar cada mensagem do chat.
- **`src/app/api/chat/route.ts:280`.** Um modelo que falha durante o chat é registrado como se tivesse falhado num teste.
- **Modelos locais baixados (Ollama):** `llama3.2:3b` (2,0 GB), `qwen3:4b` (2,5 GB), `gemma3:4b` (3,4 GB) e `qwen2.5-coder:7b` (4,7 GB). Cabem nos 6 GB da GTX 1660 SUPER.
  *Rollback:* `ollama rm <modelo>`.

### Roteamento agente × chat
- **`src/lib/agents/shouldRunAgent.ts:24`.** Mensagens com "neste/nesse/deste computador|pc|notebook" ou "instalado(a)" vão para o agente.
- **`src/lib/agents/shouldRunAgent.ts:29`.** "quanta/quantas" passam a ser reconhecidas como pergunta.
  *Por quê:* "Qual a versão do Node instalada neste computador?" ia para o chat, que não tem ferramentas, e o resultado era uma resposta inventada.
  *Rollback:* remover os dois trechos.

### Agentes
- **`src/lib/agents/orchestrator.ts` (`plan`).** Quando o planejador devolve um plano sem tarefas, o próprio pedido vira uma tarefa única, em vez de a execução falhar com "O plano não contém tarefas".
  *Por quê:* na bateria, "Qual a versão do Node instalada neste computador?" falhava em 3 s.
  *Rollback:* voltar ao `throw`.
- **`src/lib/agents/tools.ts` (`finish`) e `orchestrator.ts` (`writeReport`).** Quando o pedido é uma pergunta, o resumo e o relatório trazem a resposta com o valor obtido.
  *Por quê:* o agente rodava `node -v`, mas o relatório não dizia a versão.

### Testes e auditoria
- **`tests/model-tests.test.ts` (novo, 3 testes).** Classificação dos erros reais dos provedores e regra de ocultação.
- **`tests/routing.test.ts`:** +5 casos.
- **`scripts/audit/agent.battery.ts` + `battery.config.mts`.** Bateria de 10 tarefas reproduzível, fora do `npm test`. Resultados em `docs/auditoria/`.

### Interação com os modelos (2ª rodada)
- **Raciocínio ao vivo** (`client.ts`, `api/chat/route.ts`, `page.tsx`, `ReasoningPanel.tsx`, `MessageBubble.tsx`). O "pensamento" de modelos como qwen3, deepseek-r1 e gpt-oss chega por streaming num painel "Pensando…", que se recolhe ao fim. A fonte é o campo `thinking` do Ollama e o campo `reasoning` das APIs compatíveis com OpenAI.
  *Por quê:* o `qwen3:4b` local levava 135–158 s sem mostrar nada; agora o raciocínio aparece aos ~26 s (medido na interface).
  *Rollback:* remover o evento `reasoning`.
- **Tempo de cada resposta no rodapé:** até a primeira palavra e total, medidos no cliente.
- **Modelo local pré-carregado ao ser escolhido:** `/api/models` com `{warm}` chama o `/api/generate` do Ollama sem prompt, então a primeira mensagem não paga o carregamento na GPU.
- **Prompt do chat, lei 7.** Os blocos FEITO/VERIFICADO/PENDENTE ficam só para tarefa executada; pergunta e conversa recebem resposta direta.
  *Por quê:* o `qwen3:4b` respondia "FEITO\n391" a "quanto é 17 × 23"; agora responde "391".

### Design (2ª rodada)
- **Configurações › Aparência › Movimento.** `[data-motion="reduced" | "off"]` passa a valer também para as animações CSS; antes, só o framer-motion obedecia à preferência.
- **Painel de raciocínio** com feixe percorrendo a borda enquanto o modelo pensa (adaptado do BorderBeam do Magic UI, licença MIT).

### Pesquisa no GitHub (existência e licença conferidas pela API do GitHub)
| Repositório | Licença | Decisão |
|---|---|---|
| `magicuidesign/magicui` | MIT | Efeito de feixe adaptado no painel de raciocínio |
| `vercel/streamdown` | Apache-2.0 | Avaliado (markdown para streaming); não adotado, porque traz dependências novas e o `Markdown` próprio já cobre o uso |
| `vercel/ai` | Apache-2.0 | Avaliado (SDK unificado); não migrado, porque o cliente atual passou no teste com 28 modelos |
| `ollama/ollama-js` | MIT | Desnecessário: o JARVIS usa a API REST do Ollama diretamente |
| `ibelick/motion-primitives` | MIT | Referência de animação |
| `lobehub/lobehub`, `open-webui/open-webui` | Licenças próprias | Só referência de padrões, sem copiar código |

### Ambiente
- **`.claude/launch.json` — `jarvis-dev-isolated-3004`** (pasta `.next-claude`).
  *Por quê:* dois servidores de desenvolvimento na mesma `.next-dev` apagavam os manifestos um do outro e derrubavam as rotas com 500.

## OpenCode (em paralelo; conferido por Claude)
- **Catálogo só com gratuitos.** Os blocos de OpenAI, Anthropic, DeepSeek e xAI saíram de `providers.ts`, e o catálogo filtra os modelos pagos do OpenRouter. As chaves salvas em `data/keys.json` não foram apagadas. A reativação é descrita no cabeçalho de `catalog.ts`.
- **Teste de modelo via `completeOnce`.** Corrigiu o botão *Testar* do Gemini e do Ollama, que montava `…/chat/completions` errado.
- **Modelos locais pelo app:** `src/lib/ai/local.ts` (modelos recomendados por VRAM) e `/api/models/local`.
- **Ollama mais eficiente (`client.ts`):** `keep_alive` e `num_ctx` por modelo.
- **Geração de imagem paga (OpenAI) removida** de `images.ts`, `prefs.ts`, `ImageSettings.tsx` e `/api/media`.
- **Relatório final dos agentes no formato fixo** FEITO / VERIFICADO / PENDENTE (`orchestrator.ts:788`).
- **Roteamento:** perguntas sobre arquivos, projeto ou estado da máquina vão para o agente. Testes novos: `tests/routing.test.ts`, `tests/free-catalog.test.ts`.

## OpenCode — suplemento (16/11/2026, pós-revisão do relatório)
- **`AUDITORIA.md` (novo).** Defeitos ordenados por impacto, evidência (arquivo:linha ou saída de comando), rollback por item, e o que não foi testado (e por quê).
- **`.env.local.example`.** Seções das chaves pagas (OpenAI/Anthropic/DeepSeek) removidas; o cabeçalho agora diz que o JARVIS opera só com gratuitos.
- **`src/app/page.tsx`.** Ícones dos provedores pagos removidos do mapa de chaves.
- **`src/lib/ai/client.ts` / `catalog.ts` / `providers.ts`.** Limpeza de referências a ids de provedores pagos inexistentes (`USAGE_IN_STREAM`, `JSON_MODE`, `guessCategory`, `TASK_HINTS`) — sem efeito em runtime.
- **`scripts/model-battery.mjs` (novo) + `.tmp/battery-*.json`.** Bateria reproduzível do botão *Testar* + catálogo + 3 chats SSE. Antes: 8/16. Depois do build novo: **18/19** (a falha restante era 429 transitório do OpenRouter, aprovado na varredura completa).
- **Varredura completa "teste todos" (34 modelos):** 27/34 respondem; 7 falhas = 2×429 (gemma-4), 3×5xx/timeout transitórios do Gemini, 1 abort de 120 s (`gemini-3.8-flash`, modelo muito grande) e 1 timeout do `deepseek-r1:8b` local (lento por natureza). Ocultação permanente registrada em `data/model-tests.json` (retired 3, no-free-quota 8, blocked 1 — `inkling-2-small` só roda em harnesses de agente, 403).
- **Build:** `npm run build` falhava com `ENOENT … _buildManifest.js.tmp.*` enquanto um `next start` servia `.next` (3100). Parado o servidor, o build concluiu (4,8 min, filesystem lenta com antivírus; `BUILD_ID` escrito). Regra: pare o servidor antes de rebuildar.
- **Verificação final:** `vitest` 270/270 (22 arquivos), `tsc --noEmit` limpo, `eslint` limpo, build OK.

## OpenCode — Antigravity (CLI grátis do Google) entregue ao JARVIS (17/11/2026)
- **`src/lib/ai/antigravity.ts` (novo).** Ponte `agy --print` → catalog/client: compõe o prompt (sistema como contexto + turnos), spawna o `agy.exe` da conta do usuário (sem tocar em credenciais), timeout 180 s, `agyPath()` com override `AGY_PATH` para testes.
- **6 modelos grátis no catálogo** (`antigravity|…`): `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` (respondem OK medidos em 17/11, 5–9 s) e `gemini-3.8-flash-high/medium/low` (**quota do tier grátis estourada** nesta conta — "Individual quota reached", reset ~88h; retornam sozinhos via ocultação de 3 dias).
- `client.ts` (`streamAI`/`completeOnce`): caminho próprio `provider === 'antigravity'` (sem streaming, chunk único + usage estimado). `catalog.ts`: `probeAntigravity()` integrado ao slot de provedores locais com cache; `modelTests.ts`: "quota reached" → `no-free-quota` (oculta por 3 dias). `capabilities.ts`, `agents/models.ts` (score 22, `claude-sonnet/opus-4-6` em `strong`). `tests/antigravity.test.ts` (4 testes).
- **`eslint.config.mjs`**: ignora `.next*/**` (outros build dirs da sessão paralela faziam a lint varrer artefatos — 104 erros de lint removidos com essa correção).
- **Resultado medido** (3100, build de 08:53): catálogo `40 modelos, 40 gratuitos`, `antigravity connected models=6`, depois 3 (os Gemini ocultos por `no-free-quota`). Teste via `/api/models`: sonnet/opus/gpt-oss PASS. Chat SSE `antigravity|claude-sonnet-4-6` → "ok" em 8,4 s. Conversas de teste limpas do banco.
- **Fix aproveitado**: `scripts/model-battery.mjs` agora apaga conversas de teste com body JSON (antes falhava silenciosamente via query param).

## OpenCode — comunicação, operação e testes (16/11/2026, noite)

### Comunicação com a IA — o caminho deixa de ser "um fetch e reza"
- **`src/lib/ai/sse.ts` (novo).** Codificador e parser incremental de Server-Sent Events. Remonta eventos cortados entre pacotes TCP, aceita CRLF de proxies, junta `data:` multilinha, ignora comentários/heartbeats e processa um último evento sem a linha em branco final.
  *Por quê:* o parser anterior dividia por `\n` e descartava a linha incompleta; com heartbeat e retry, qualquer evento partido virava perda silenciosa de texto.
  *Rollback:* voltar ao parser local em `page.tsx`.
- **`src/lib/ai/capabilities.ts` (novo).** Capacidades reais por modelo (streaming, ferramentas, JSON nativo/prompt, visão, raciocínio, contexto, local, gratuito) com regras por provedor e família, mais `jsonInstruction()` e rótulos para a interface.
  *Por quê:* o cliente mandava `tools`/`response_format` para qualquer modelo; modelos locais e provedores sem JSON nativo respondiam erro ou lixo.
  *Rollback:* remover o módulo e as duas chamadas em `client.ts`.
- **`src/lib/ai/resilience.ts` (novo).** Política de retry: backoff exponencial com jitter (300 → 600 ms, teto 1,5 s), respeito ao `retry-after` curto, desistência de reset distante, e fallback só antes do primeiro token.
  *Por quê:* erro transitório derrubava a resposta inteira; e trocar de modelo depois de texto emitido emendaria duas respostas.
- **`src/lib/ai/status.ts` (novo).** Contrato dos eventos de andamento (`connecting`/`retry`/`fallback`/`streaming`) e nome curto do modelo.
- **`src/app/api/chat/route.ts`.** Heartbeat SSE de 15 s durante toda a geração; retry cancelável (timer limpo no abort) antes do primeiro token; eventos `status` com motivo, tentativa e espera; `fallback` explícito; `done` agora leva `usage` (tokens reais ou estimados) e `elapsedMs`; falha definitiva é registrada em `model-tests.json`.
  *Por quê:* modelo local pode levar >30 s carregando sem enviar byte; proxies e o app fechavam a conexão ociosa.
- **`src/lib/ai/client.ts`.** `resolveCapabilities()` decide se `tools` e `response_format` são enviados; provedores sem JSON nativo recebem instrução textual; Gemini só pede `application/json` quando suporta.
- **`src/app/page.tsx`.** Consumo via `SSEParser` + `apply()` único para eventos completos e para o resto do buffer; `StreamStatus` alimenta TopBar e indicador; tokens e tempo no rodapé da mensagem.

### Operação — central de comandos e barra viva
- **`src/components/layout/CommandPalette.tsx` (novo).** Ctrl+K pesquisa ações reais da tela e modelos do catálogo ao vivo; navegação por teclado, grupos, indicação de modelo atual, fecha com Esc.
- **`src/components/layout/TopBar.tsx` (novo).** Barra de operações: título, central de comandos, modo Agente/Chat, modelo com pílula de automático, estado real (`conectando`, `tentando de novo (n)`, `trocando de modelo`, `gerando`) com cronômetro, contagem de provedores conectados e relógio. Substitui a barra antiga em `page.tsx`.
- **`src/components/chat/TypingIndicator.tsx`.** Indicador honesto: mostra modelo, tempo decorrido, fase informada pelo servidor e aviso específico para modelo local. Não afirma "raciocinando" quando o provedor não expõe isso.
- **`src/components/chat/MessageBubble.tsx`.** Rodapé mostra modelo, primeira palavra, tempo total e tokens de entrada+saída quando disponíveis.
- **`src/app/operations.css` (novo, importado em `layout.tsx`).** Estilos isolados da central, barra, indicador e paleta; só `transform`/`opacity` animam; `prefers-reduced-motion` e `[data-motion="off"]` desligam animações.
- **Aparência padrão `mono`.** `data/prefs.json` passa a abrir em preto/branco/cinza (`"accent":"mono"`), com regras próprias para barra, streaming, bolhas e fundo; as demais paletas continuam disponíveis.
- **Atalhos globais:** Ctrl+K central de comandos, Ctrl+, configurações, Ctrl+N nova conversa, Esc interrompe a geração.

### Testes
- **`tests/ai-capabilities.test.ts`, `tests/ai-sse.test.ts`, `tests/ai-resilience.test.ts` (novos, 20 testes).** Capacidades por provedor/família, OpenRouter só `:free`, parser com CRLF/heartbeat/evento final, backoff com teto, retry-after curto x distante, fallback condicionado.
- **`tsc --noEmit`:** limpo após a integração.

### Verificação desta sessão
- Suíte completa: **295 testes** (27 arquivos); a única falha foi `engine-integration` por timeout de 20 s na instalação real de npm sob build concorrente (D13), não por regressão.
- Bateria de 10 tarefas: `docs/auditoria/bateria-depois-opencode.md` — **10/10** com artefato verificado.
- Build de produção: ver `AUDITORIA.md` (seção OpenCode) para o resultado e o `BUILD_ID`.
