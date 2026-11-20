# WhatsApp no JARVIS — integração oficial (Meta WhatsApp Cloud API)

> Guia honesto do que funciona hoje, do que depende de você criar na Meta e como
> testar de verdade. Nada aqui é simulado: sem as credenciais da Meta, o JARVIS
> simplesmente não fala com o WhatsApp — e diz isso com todas as letras.

## O que este modo é — e o que ele não é

| | **Cloud API (oficial, este guia)** | **Baileys (QR, já existente)** |
|---|---|---|
| Natureza | API oficial da Meta para empresas | Protocolo do WhatsApp Web (não sancionado) |
| Conta | WhatsApp **Business** com número da API (começa com número de teste fornecido pela Meta) | WhatsApp pessoal do usuário |
| Risco | Nenhum ban por uso normal | Pode limitar/banir a conta |
| Uso típico | Clientes, leads, atendimento | Ler grupos da faculdade |
| Chamada | Grátis dentro da janela de 24h; fora dela só **template aprovado** | Grátis |
| Instalação | App Meta + World Wide Webhook HTTPS | Só QR |

Os três coexistem no JARVIS (este oficial, o **OpenWA por QR** para número pessoal — ver
[GUIA-OPENWA.md](GUIA-OPENWA.md) — e a ponte Baileys do Hub Escolar para ler grupos da faculdade).
Este documento cobre **só o canal oficial**.

## 0) O que você precisa ter antes de começar

1. Conta pessoal do Facebook (para o painel de desenvolvedor).
2. Conta no **Meta Business** (business.facebook.com) — gratuita; necessária para WABA e System User.
3. Um telefone que possa receber SMS/ligação para verificar o número da API
   (ou use o **número de teste** que a Meta já dá — ideal para começar).
4. Este guia em mãos.

## 1) Criar o app na Meta

1. Acesse <https://developers.facebook.com/apps> → **Criar app** → tipo **Empresa** → nome (ex.: "JARVIS WhatsApp").
2. No painel do app → **Adicionar produtos** → **WhatsApp** → **Configurar**.
3. Você cai em **WhatsApp → Configuração da API**. Anote:
   - **Identificação do telefone (Phone number ID)** ← copie esse número
   - **WABA ID** (conta do WhatsApp Business) — opcional no JARVIS
   - O **token temporário** (dura 24h — NÃO use em produção)

## 2) Token permanente (o passo que todo mundo erra)

O token da tela expira em 24h. Para o JARVIS funcionar sempre:

1. <https://business.facebook.com> → **Configurações** → **Usuários** → **Usuários do sistema** → **Adicionar** → nome "JARVIS" (função: Funcionário ou Admin).
2. **Adicionar ativos** → seu app → permissões: `whatsapp_business_management` e `whatsapp_business_messaging`.
3. **Gerar token** com as mesmas duas permissões. Escolha validade **"Nunca"** (System User token) — é o único token permanente recomendado.
4. **Copie e guarde** — a Meta mostra uma vez só.

## 3) Colar as credenciais no JARVIS

### 3.1 Chaves de API (⚙ ou "Chaves de API")
Em **Ferramentas** você verá duas chaves novas:
- **WhatsApp (token de acesso)** ← cole o System User token (começa com `EAA…`).
  O botão "Testar" faz uma chamada real à Graph API (`/me`) e mostra o erro real se o token estiver expirado.
- **WhatsApp (App Secret)** ← no app → **Configurações → Básico → App Secret** (é o que valida o `X-Hub-Signature-256` de cada webhook).

### 3.2 Centro do WhatsApp → aba **Diagnóstico**
- Cole **Phone Number ID** (obrigatório) e, se quiser, **WABA ID** e **App ID**.
- Botão **Verificar agora** → o JARVIS chama a Meta de verdade e reporta item a item:
  token (validade real via `debug_token`), número (nome verificado, qualidade), webhook, diretórios.

## 4) Webhook público (obrigatório para RECEBER mensagens)

A Meta **não aceita** `http://localhost`. O webhook do JARVIS está pronto em `/api/whatsapp/webhook`,
mas a Meta precisa de uma URL **HTTPS pública**. Em desenvolvimento, use um túnel gratuito:

```powershell
winget install Cloudflare.cloudflared        # uma vez
cloudflared tunnel --url http://127.0.0.1:3002
# saída: https://<algo>.trycloudflare.com
```

(Ou ngrok: `ngrok http 3002`.) Qualquer URL pública serve — inclusive o domínio de um servidor seu.

Depois, no painel do app → **WhatsApp → Configuração → Webhook → Editar**:

1. **URL de callback**: `https://<seu-tunel>/api/whatsapp/webhook`
2. **Verify token**: o que o JARVIS gerou — abra o **Centro do WhatsApp → Diagnóstico → VERIFY TOKEN** e copie.
3. **Verificar e salvar** — a Meta chama `GET /api/whatsapp/webhook?hub.challenge=…` e o JARVIS devolve o desafio (testado).
4. **Assinar o campo `messages`** no webhook (é ele que traz mensagens e status de entrega).

Sem o túnel no ar, o painel acusa "não foi possível validar a URL" — o prefixo HTTPS é obrigatório.

## 5) Teste de verdade (5 minutos)

1. No painel Meta, **Configuração da API**, o número de teste vem com **5 números autorizados** — adicione o SEU celular (exige SMS de verificação).
2. No JARVIS → **Centro do WhatsApp → Conversas**: deve aparecer "Online" (se o token estiver ok).
3. Do seu celular, mande "teste" para o número de teste da Meta.
4. A mensagem aparece no Centro em **tempo real** (SSE — sem F5). Resposta pendente → botão de IA.
5. Responda pelo JARVIS: clique na conversa → digite → **Enter**. Você deve receber no celular e ver ✓✓ entregue/lido no thread.
6. Peça ao chat: **"JARVIS, responda para <nome cadastrado no Contatos> dizendo que cheguei às 15h"** — o JARVIS prepara e só envia após você digitar **CONFIRMAR ENVIO** (a confirmação pode ser desligada em Preferências — não recomendado).

## 6) Limites oficiais da Meta (o JARVIS os respeita, nunca contorna)

- **Janela de 24h**: livre resposta só nas 24h após a ÚLTIMA mensagem **do cliente**. Fora dela, o envio exige **template aprovado** (crie no painel: Modelos de mensagens → Criar template, ex. `hello_world` de utilidade). O JARVIS detecta a janela fechada e avisa; ele não "dá um jeito" — a Meta bloquearia mesmo.
- **Número de teste**: só conversa com até 5 números autorizados; qualidade limitada; marca d'água "test number".
- **Produção**: para conversar com qualquer cliente, o app precisa de **verificação da empresa** (business verification) e o número registrado.
- **Rate limits**: a Cloud API limita por número; erros 131048 aparecem no JARVIS como "limite de envio" — aguarde.
- **Consentimento (LGPD)**: envie só para quem pediu. Log de operações fica em `data/whatsapp-meta/operations.jsonl` (sem tokens).
- **Baileys continua sendo o canal pessoal/acadêmico** — o Centro é exclusivamente o canal oficial de negócios.

## 7) Comandos no chat (com o Centro configurado)

| Você diz | O JARVIS faz |
|---|---|
| "JARVIS, responda o João dizendo que vou chegar às 15h" | Resolve "João" (contatos/conversas), prepara o texto, pede **CONFIRMAR ENVIO** e envia pela API ao confirmar |
| "CONFIRMAR ENVIO" | Executa o pendente (ou informa que não há/expirou) |
| "cancelar envio" | Descarta o pendente |
| "quem está aguardando resposta" | Lista quem escreveu por último sem sua resposta |
| "procure a última mensagem de Pedro" / "o que a Maria me disse" | Mostra a última inbound do contato |
| "resuma a conversa com Maria" | Resumo via IA (assuntos, decisões, pendências) |
| "avise meus clientes que a loja abriu" | **Recusa educadamente** — envio em massa exige template aprovado + lista; mostra o caminho oficial |

Ao usar apelidos (Contatos → "João da obra" ↔ `55119…`), os comandos passam a funcionar com o apelido.

## 8) Automações (aba Automações — cada uma liga/desliga)

| Automação | O que faz |
|---|---|
| Detectar urgência | Palavras-chave (editáveis) → conversa destacada + notificação |
| Detectar compromissos | "amanhã", "prazo", "amanhã às 14h", "cobrança"… → **lembrete criado** automaticamente (aba Lembretes) |
| Documento recebido | Avisa com o nome do arquivo |
| Perguntas sem resposta | Destaca que há pergunta aguardando |
| Contato estrelado | Trata estrela como importante |
| Auto-resposta fora do horário | **Só ativa se você ligar** + escrever o texto + estar fora do horário configurado; respeita a janela de 24h (sem janela, não envia — avisa que precisa de template) |

## 9) Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Webhook dá "não foi possível validar" no painel | URL não-HTTPS ou túnel desligado | Rode `cloudflared tunnel --url http://127.0.0.1:3002` de novo e cole a nova URL |
| 401 no webhook | App Secret errado/ausente | Configurações → Básico → App Secret → salve em 🔑 Chaves de API |
| 403 na verificação do webhook | Verify Token diferente | O do painel DEVE ser o do JARVIS (Diagnóstico → VERIFY TOKEN) |
| Mensagens não chegam | Campo `messages` não assinado | Assinar em Webhooks → campos |
| Mensagem enviada mas não entregue | Número sem WhatsApp | Erro 131026; envie só para números com WhatsApp |
| "Janela de 24h fechada" (409) | >24h desde a última mensagem **dele** | Use template aprovado (Modelos de mensagens no painel) |
| Token "expirado" | Usou o token temporário de 24h | System User token permanente (passo 2) |
| "Unsupported post request" ao enviar | Telefone fora dos 5 autorizados (modo teste) | Adicione o número em **Configuração da API → Para** |
| Enviados aparecem mas não atualizam ✓✓ | O `statuses` do webhook não foi processado | Confira se o campo `messages` está assinado; veja `data/whatsapp-meta/operations.jsonl` |

## 10) O que foi implementado de verdade (e o que depende de você)

**Implementado e testado localmente (11 testes):** assinatura `X-Hub-Signature-256` (HMAC real, rejeita adulteradas), verificação do desafio (`hub.challenge`), parsing de mensagens (texto, imagem, áudio, vídeo, documento, localização, reação, interactive), dedup por `wamid`, persistência (histórico, conversas, contatos), status de entrega/leitura, janela de 24h, IA de conversas, comandos em linguagem natural, automações, notificações SSE, health-check com `debug_token` real.

**Depende de você (não dá para o JARVIS inventar):** criar o app na Meta, gerar o token permanente, expor a URL HTTPS pública, assinar o campo `messages`. Sem esses quatro, nenhum app — de nenhuma empresa — consegue receber mensagens do WhatsApp.

**Limitação conhecida:** o JARVIS não usa Embedded Signup por padrão (exige configuração de Facebook Login for Business no app). O caminho suportado é o manual acima (funciona com número de teste, zero aprovação necessária).
