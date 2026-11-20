# WhatsApp pessoal no JARVIS — via OpenWA (QR code, não-oficial)

> Guia do canal **não-oficial** do JARVIS: [OpenWA](https://github.com/rmyndharis/OpenWA)
> (MIT), um gateway auto-hospedado que fala o protocolo do WhatsApp Web —
> o mesmo que o site usa. É o que permite ao JARVIS **ler e enviar** mensagens
> no **seu número pessoal**, sem API da Meta.
>
> Nada aqui é simulado: sem o OpenWA rodando e sem o QR escaneado, o JARVIS
> simplesmente não fala com o seu WhatsApp — e diz isso com todas as letras.

## O que é, e os riscos (leia antes)

| | **Meta Cloud API (oficial)** | **OpenWA (este guia)** | **Baileys direto (Hub)** |
|---|---|---|---|
| Natureza | API oficial da Meta | WhatsApp Web (não sancionado) | WhatsApp Web (não sancionado) |
| Número | WhatsApp **Business** (número de API) | **Pessoal** (o seu) | Pessoal |
| Risco de ban | Nenhum por uso normal | **Real** — use número dedicado | Real |
| Conta no celular | Número da API | O seu WhatsApp normal | O seu WhatsApp normal |
| Para que serve no JARVIS | Clientes/atendimento | Ler e responder o **seu** zap | Ler grupos da faculdade |
| Instalação | Painel Meta + webhook HTTPS | 1 clique no JARVIS (ou Docker/VPS) | Já embutido |

**Regras de ouro** (o OpenWA também documenta):
1. **Número dedicado.** Não vincule o seu número principal a automação.
2. **Nada de disparo em massa** para contatos que nunca falaram com você.
3. O JARVIS **nunca envia** nada por conta própria — enviar exige o seu comando.
4. Quem tem o JARVIS acessível na rede tem acesso ao seu WhatsApp. Rode em `127.0.0.1`.

## Estado deste PC (já feito)

- OpenWA **v0.30.3** instalado em `data/openwa/app` (tarball da tag no GitHub).
- Rodando em **http://127.0.0.1:2785** (engine **Baileys**, SQLite, sem Chromium).
- A admin key gerada no primeiro boot foi adotada para `data/keys.json` como `OPENWA_API_KEY` (o JARVIS a usa; nunca sai para o frontend).
- Sessão `jarvis` criada e aguardando vinculação (o QR é gerado no painel).

## Baixar/rodar em 1 clique (recomendado)

1. Abra o **JARVIS WhatsApp Center** (trilho lateral) → botão verde **“OpenWA”** no topo.
2. Se o OpenWA não estiver instalado, clique **Instalar OpenWA neste PC**.
   - O JARVIS baixa o tarball `v0.30.3` do GitHub (~8 MB), extrai com o `tar` do Windows,
     instala as dependências (`npm`, engine Baileys — **sem baixar Chromium**), compila
     (`nest build`), grava `data/openwa/app/.env` e inicia em `data/openwa/openwa.log`.
   - **Node ≥ 22.19 é obrigatório** (o JARVIS avisa se o seu Node for antigo).
   - **Node 26+:** o lock da tag fixa `better-sqlite3@13.0.3`, que não tem prebuild para
     Node 26 e compilaria com `node-gyp` (exige Visual Studio). O instalador reajusta para
     `better-sqlite3 ^13.2.0` (tem prebuild) antes de instalar — automático, sem você ver.
3. Clique **Gerar QR Code de vinculação**.
4. No celular: **WhatsApp → Aparelhos conectados → Conectar um aparelho** e escaneie o QR.
5. Pronto: o JARVIS vê o seu WhatsApp (sessão `jarvis`), e o modal mostra
   **Vinculado como <seu nome> · <número>**. Envie uma mensagem de teste ali mesmo.

## Usar um OpenWA externo (servidor, VPS ou Docker)

Melhor quando você tem uma máquina sempre ligada (o QR não expira enquanto o
servidor existir). Exemplo com Docker:

```bash
git clone https://github.com/rmyndharis/OpenWA.git
cd OpenWA
docker compose -f docker-compose.dev.yml up -d
docker exec openwa-api cat /app/data/.api-key   # admin key (sem newline final)
```

No JARVIS: botão **OpenWA** → **OpenWA externo** → cole a **URL**
(`http://seu-servidor:2785`) e a **API key** → **Salvar configuração** → **Gerar QR Code**.

## Vincular, desvincular, reconectar

| Ação | O que faz |
|---|---|
| **Gerar QR Code** | Garante a sessão `jarvis` no OpenWA, inicia o engine e mostra o QR (PNG) |
| **Já escaneei — verificar** | Consulta de novo o status/QR (ou espere o polling automático) |
| **Testar envio** | Manda uma mensagem real para o número que você digitar (DDI+DDD, ex.: `5511998877665`) |
| **Desvincular aparelho** | Logout nativo: avisa o WhatsApp e apaga as credenciais (exige QR novo depois) |
| **Parar** | Para o processo local do OpenWA (credenciais ficam salvas; não pede QR de novo) |

A sessão fica salva em `data/openwa/app/data/sessions`. Enquanto ela existir,
**Iniciar OpenWA** + **Gerar QR Code** reconecta sem escanear de novo.

## Recebendo mensagens no JARVIS

Ao vincular, o JARVIS registra um **webhook** no OpenWA apontando para o próprio
`<jarvis>/api/openwa/webhook` na porta em que o JARVIS está (3001 no `npm run dev`;
no desktop, a primeira porta livre a partir de 3001 — a URL acompanha sozinha;
para forçar outra, defina `OPENWA_WEBHOOK_URL`) com os eventos
`message.received` e `session.status` (HMAC-SHA256, header `X-OpenWA-Signature`).
As últimas mensagens recebidas aparecem dentro do modal **OpenWA** — é a prova
viva de que o JARVIS “viu” o seu zap. Se o registro falhar (ex.: JARVIS atrás de
outra porta), o botão **OpenWA externo** + o log mostram o motivo; enviar continua
funcionando.

## Solução de problemas

| Sintoma | Causa | Correção |
|---|---|---|
| “Node antigo demais” | Node < 22.19 | Atualize o Node e clique em Instalar de novo |
| Porta 2785 ocupada | Outro programa/serviço na porta | Descubra com `Get-NetTCPConnection -LocalPort 2785 -State Listen`; ou mude **porta** em OpenWA externo |
| QR não aparece | Engine ainda subindo | Espere ~5–10s e clique “Já escaneei — verificar” |
| “passkey_required” / QR esgota | WhatsApp pediu passkey para vincular (política dele) | Nada a fazer no JARVIS/OpenWA; vincule outro número ou aguarde |
| Sessão cai e volta sozinha | Queda de rede | O Baileys reconecta com backoff; se ficar `failed`, desvincule e vincule de novo |
| Instalação falhou no meio | Queda de rede / disco | Clique em Instalar de novo (usa `force`) |
| Logs | — | Botão **Terminal** no modal, ou `data/openwa/openwa.log` |

## Segurança

- A **API key do OpenWA** fica em `data/keys.json` (como `OPENWA_API_KEY`) — nunca no frontend,
  nunca em `config.json`, nunca no repositório.
- O OpenWA local escuta só em `127.0.0.1`. **Não exponha a porta 2785 na rede** sem um
  proxy com autenticação na frente.
- A assinatura HMAC do webhook é verificada com comparação de tempo constante; segredo em
  `data/openwa/config.json` (gerado na primeira execução).
- O `.env` gerado pelo instalador inclui `SSRF_ALLOWED_HOSTS=127.0.0.1,localhost` — abre só o
  **loopback** na guarda anti-SSRF do OpenWA, necessário para o webhook local. Não adicione
  outras redes ali.
- O processo do OpenWA é iniciado com um ambiente mínimo (sem as chaves do JARVIS/IA) e
  `NODE_ENV=production` — nada do que está no seu `.env.local` vaza para ele.
- `keys.json` está no `.gitignore`; o diretório `data/` inteiro não é versionado.
