# 🎓 Hub Escolar do JARVIS

Central da faculdade dentro do aplicativo JARVIS: junta Portal do Aluno, Teams, WhatsApp, GitHub, ChatGPT, Gemini, calendários e materiais, organiza tudo por disciplina e mostra **de onde veio cada informação**.

Abra pelo botão **🎓 Hub Escolar** na barra de cima do JARVIS.

---

## 1. Conectar as fontes (aba **Conexões**)

| Fonte | Como conecta | O que traz |
|---|---|---|
| **Portal do Aluno (SERVERSO / Ser Educacional)** | **Playwright (recomendado)**: «Abrir portal (Playwright)» abre uma janela real; faça seu login com Matrícula + senha nela mesma; depois clique em «Capturar agora» — o JARVIS lê a página (todas as frames) e importa disciplinas, notas, faltas, atividades e avisos. Alternativamente, use a opção Electron («Abrir portal») e capture com «Capturar página». | Disciplinas, professores, notas, faltas, atividades, provas, materiais e avisos |
| **Microsoft Teams** | Cole o *ID do aplicativo* (passo a passo no próprio card), clique em **Entrar com Microsoft** e digite o código na página da Microsoft. | Equipes = disciplinas, tarefas (Assignments) com prazo, conversas, agenda e arquivos recentes |
| **WhatsApp** | **Recomendado:** no celular › conversa da turma › ⋮ › **Exportar conversa** → **Importar arquivo** (`.zip`/`.txt`). **Novo — Ao vivo (experimental):** botão **Conectar ao vivo** → escaneie o QR com o celular em *Aparelhos conectados*; o JARVIS lê os grupos que você marcar como acadêmicos, em tempo real, e organiza tudo sozinho. | Mensagens com data e autor, anexos, tarefas e provas identificadas automaticamente |

### ⚠️ WhatsApp ao vivo (experimental) — leia antes

- **Não é API oficial.** O JARVIS conecta como um aparelho WhatsApp Web faz, usando o protocolo do WhatsApp Web. A Meta não sanciona isso: **a conta pode ser limitada ou até banida**.
- **Só leia grupos da faculdade.** Mensagens de colegas em grupos são dados pessoais de terceiros (LGPD). Marque como acadêmicos apenas os grupos do curso.
- **Nada sai da sua máquina sem a sua aprovação.** O JARVIS só ingere, organiza e mostra. Responder qualquer um exige aprovação sua, como sempre.
- **Nada é alterado nem apagado no WhatsApp.** Desconectar não apaga a exportação importada; "Apagar dados" apaga só o que veio dele.
- **Se o WhatsApp recusar a sessão (código 401),** apague a sessão em Conexões › WhatsApp › Apagar dados e pareie de novo.
- **Se você não tiver segurança sobre isso, use a exportação oficial** — ela traz o histórico inteiro sem risco nenhum.
| **GitHub** | Usa o token salvo em 🔑 Chaves de API › GitHub. Clique em **Sincronizar**. | Repositórios, README, issues, pull requests e commits |
| **ChatGPT** | chatgpt.com › Configurações › Controles de dados › **Exportar dados**. Importe o `.zip` recebido por e-mail. | Seu histórico de conversas (exportado) |
| **Gemini** | takeout.google.com › marque **Minha atividade › Apps do Gemini** › exportar. Importe o `.zip`. | Seu histórico de perguntas ao Gemini (exportado) |
| **Calendários** | Cole o link iCal secreto (Google Agenda, Outlook…). | Provas e eventos da agenda |
| **Materiais (pasta)** | Escolha a pasta do computador onde você guarda os materiais. | Textos de PDFs, Word, PowerPoint e anotações para busca |

> O Hub usa só meios oficiais. Ele **nunca digita sua senha** e não acessa o WhatsApp pessoal em tempo real (o WhatsApp não oferece isso para contas pessoais). Para ChatGPT e Gemini, o Hub lê o **histórico exportado**, não as conversas ao vivo.

A cada 30 minutos, com o JARVIS aberto, o Hub sincroniza sozinho o Teams, o GitHub, os calendários e a pasta de materiais.

---

## 2. O que o Hub faz sozinho

- **Organiza por disciplina:** reconhece a matéria pelo nome do grupo, pelo canal do Teams, pelo professor ou por apelidos (ex.: "BD"). Você pode adicionar apelidos em **Disciplinas**.
- **Mensagem vira tarefa ou prova:** "a AV1 será dia 19/11 às 19h" vira uma prova com data e hora, e "entregar até sexta" vira uma tarefa com prazo, cada uma ligada à mensagem de origem.
- **Tarefas do Teams** entram direto com o prazo oficial.
- **Mensagens que pedem ação** aparecem no Painel ("responder a professora", "entregar o relatório").
- **Alertas:** prazo em menos de 72 h e de 24 h, atraso, prova em menos de 7 dias e de 48 h (também como notificação do Windows).
- **Contradições:** se o portal diz dia 25 e o grupo diz dia 27, o Hub **não escolhe sozinho**. Ele mostra as duas datas com as fontes e você clica na correta.
- **Sem IA disponível**, regras simples ainda encontram provas e entregas com data.

---

## 3. Perguntar (aba **Perguntar & Buscar** ou no chat normal)

Exemplos:
- *O que tenho para entregar esta semana?*
- *Quais provas tenho este mês?*
- *O que o professor falou sobre o trabalho de modelagem?*
- *Onde está a lista de normalização?*

A resposta cita as fontes com [F1], [F2]… e lista exatamente onde cada informação estava (grupo, autor, data, página do portal, canal do Teams). Para trabalhos, ela organiza em: o que foi pedido, objetivo, requisitos, prazo, arquivos, orientações do professor e onde encontrou.

No chat do JARVIS também funcionam:
- *marque o relatório de física como concluído*
- *sincronize o hub*

---

## 4. Equipe Acadêmica (agentes)

O botão **Equipe Acadêmica** abre uma sessão com 6 agentes: Acadêmico, Mensagens, Estudos, Programação, Prazos e Pesquisa. Eles podem buscar no Hub, montar o dossiê de uma disciplina, registrar tarefas, salvar resumos e exercícios no histórico de estudos e ler repositórios do GitHub. Antes de procurar fora, eles consultam os materiais que você já tem.

**Nada sai do seu computador sem você aprovar:** mensagens no Teams, issues e commits no GitHub ficam em **Aprovações** até você clicar em *Aprovar e executar*. Para o WhatsApp, o JARVIS abre a conversa com o texto pronto e **você** aperta enviar.

---

## 5. Privacidade

- Tudo fica no seu computador, em `data/hub/` dentro da pasta do JARVIS.
- Os logins (Teams) ficam em `data/hub/secrets.json` e nunca são enviados para a IA.
- **Desconectar** mantém os dados. **Apagar dados** remove tudo que veio daquela fonte: mensagens, anexos copiados, login e as tarefas e provas que só apareceram nela. Nada é apagado na plataforma original.
