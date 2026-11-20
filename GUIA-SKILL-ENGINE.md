# 🧩 JARVIS Skill Engine — Guia Completo

O Skill Engine é o núcleo único do JARVIS para **descobrir, instalar, analisar, testar, versionar, permissionar e executar** Skills, servidores MCP, plugins e ferramentas. O mesmo catálogo é usado pela interface, pelo chat, pela API REST e por todos os agentes internos — não existe mais um sistema separado de “skills”.

---

## 1. Visão geral

| Capacidade | Como funciona |
|---|---|
| Catálogo único | Toda extensão instalada fica em `data/engine/registry.json` e aparece para qualquer agente autorizado. |
| Descoberta | Busca no GitHub (tópicos de Skills/MCP/tools), no registro oficial do MCP e no npm. |
| Instalação | Preparação em quarentena (download, `npm pack` ou cópia local) → análise estática → política de risco → instalação versionada → teste funcional. |
| Criação | Quando nada pronto resolve, o JARVIS pode escrever uma Skill própria com a equipe de agentes (construtor + QA). |
| Uso | `skill_read` lê as instruções; `skill_use` executa ferramentas de MCP/scripts; comandos naturais executam pelo chat. |
| Segurança | Regras estáticas, quarentena, dependências auditadas, ambiente isolado, credenciais por nome, logs redigidos e rollback. |
| Autonomia | Modos `manual`, `assisted` e `autonomous`, com aprovação humana para risco, credenciais e MCP remoto. |

### Onde acessar

- **Interface:** barra lateral → **⚡ Skills** → aba **Skill Engine** (catálogo, descoberta, segurança, atividade e criação).
- **Chat:** comandos em português, sem custo de modelo (ver seção 6).
- **API REST:** `http://localhost:3001/api/engine` (ver seção 8).
- **Agentes internos:** ferramentas `skill_find`, `skill_use`, `skill_read` e `skill_request` (ver seção 9).
- **Compatibilidade:** `GET/POST /api/skills` continua funcionando como *shim* da rota antiga.

### Arquivos do núcleo

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/engine/engine.ts` | Fachada do motor: catálogo, descoberta, instalação, aprovação, uso, jobs, otimização e autodiagnóstico. |
| `src/lib/engine/discovery.ts` | Busca no GitHub/MCP/npm e resolução de origens explícitas (URL, pacote, pasta). |
| `src/lib/engine/scanner.ts` | Regras de análise estática e sinais de metadados (reputação, licença, arquivamento). |
| `src/lib/engine/installer.ts` | Quarentena, análise, política de risco, instalação, testes, atualização e rollback. |
| `src/lib/engine/mcp.ts` | Conexões MCP via stdio ou HTTP, compartilhadas entre agentes. |
| `src/lib/engine/sandbox.ts` | Ambiente mínimo, execução com timeout e download/npm controlados. |
| `src/lib/engine/registry.ts` | Persistência de catálogo, histórico, aprovações, configurações e oportunidades. |
| `src/lib/engine/builder.ts` | Criação de Skills pela equipe de agentes. |
| `src/lib/engine/chat.ts` | Parser determinístico e execução dos comandos naturais. |
| `src/components/engine/SkillEnginePanel.tsx` | Painel funcional da interface. |
| `src/app/api/engine/route.ts` | API REST completa do motor. |

---

## 2. Conceitos

### Tipos de extensão

| Tipo | O que é | Como é usado |
|---|---|---|
| `skill` | Instruções no formato Anthropic/Agent Skill (`SKILL.md`, opcionalmente scripts). | Lido por `skill_read` ou pelo modo Agentes; pode ser seguido pelo modelo. |
| `mcp` | Servidor Model Context Protocol local (stdio) ou remoto (HTTP). | Ferramentas são listadas e executadas por `skill_use` / `POST /api/engine` com `action: "call"`. |
| `tool` | Manifesto compatível com OpenAI Tools + script Node (`jarvis-tool.json`). | Executado pelo JARVIS com validação de argumentos e ambiente isolado. |

### Origens aceitas

| Origem | Exemplo |
|---|---|
| GitHub (URL ou `owner/repo`) | `https://github.com/dono/repo` · `dono/repo` · URL de subpasta `.../tree/main/skills/minha-skill` |
| npm (pacote ou URL) | `@modelcontextprotocol/server-filesystem` · `https://www.npmjs.com/package/pacote` |
| Comando `npx` | `npx -y @modelcontextprotocol/server-memory` |
| MCP remoto | `https://meu-servidor.example.com/mcp` |
| Pasta local | `C:\Users\voce\minha-skill` (relativa ou absoluta) |
| Built-in | Skill em `skills/<nome>/SKILL.md` registrada automaticamente ao iniciar |
| Criada pelo JARVIS | Gerada pelo construtor e instalada pelo mesmo pipeline de segurança |

> **Formato do `id`:** `tipo:referência` (por exemplo, `github:dono/repo`, `npm:pacote`, `local:C:\...`, `builtin:pesquisa-tecnica`). O `id` é o identificador estável usado pela API, pelos agentes e pelo painel.

---

## 3. Descoberta

A busca combina três fontes em paralelo:

1. **GitHub** — repositórios por tópico (`agent-skills`/`claude-skills`, `mcp-server`/`model-context-protocol`, `agent-tools`/`openai-tools`), ordenados por estrelas.
2. **Registro oficial MCP** — `registry.modelcontextprotocol.io`, priorizando pacotes npm e servidores remotos.
3. **npm** — pacotes que declaram metadados de MCP/ferramenta.

Cada candidato recebe uma pontuação de relevância. O painel mostra estrelas, licença, última atualização e se já está instalado.

```bash
# Descobrir Skills, MCPs e ferramentas
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"discover\",\"query\":\"editar videos\",\"kinds\":[\"skill\",\"tool\"]}"
```

> A busca usa `GITHUB_TOKEN` quando configurado (aumenta o limite de requisições do GitHub). Sem token, a descoberta continua funcionando com o limite anônimo.

---

## 4. Instalação e política de risco

### Fluxo completo

1. **Resolver a origem** (URL, pacote, pasta ou candidato da busca).
2. **Baixar para a quarentena** (`data/engine/quarantine/<token>`); nada é executado nessa etapa.
3. **Analisar** o conteúdo com o scanner estático e os metadados do repositório/pacote.
4. **Auditar dependências** npm (quando aplicável).
5. **Decidir** pela política: instalar, pedir aprovação ou bloquear.
6. **Materializar** uma versão em `data/engine/extensions/<id>/<versao>-<timestamp>` (npm com `--ignore-scripts`).
7. **Testar** de verdade: instruções e sintaxe (Skill), ferramentas respondendo (MCP) ou script/testes (tool).
8. **Registrar** no catálogo, liberar para os agentes e gravar o histórico.

### Política de decisão

| Situação | Ação |
|---|---|
| Risco **baixo**, sem credenciais, modo `assisted` ou `autonomous` | Instala automaticamente. |
| Risco **médio** ou **alto** | Aguarda aprovação do usuário. |
| Risco **crítico** | Bloqueado — não há como aprovar. |
| Precisa de **credenciais** (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*AUTH*`) | Aguarda aprovação e concessão explícita dos nomes das variáveis. |
| **MCP remoto** | Sempre aguarda aprovação (os dados saem do computador). |
| Modo **manual** | Toda instalação aguarda aprovação. |
| Extensão **incompatível** (ex.: MCP em Python sem Python, comando não suportado) | Bloqueada com motivo. |

### Níveis de autonomia

| Modo | Comportamento |
|---|---|
| `manual` | Nada instala ou atualiza sem aprovação. O `autoOptimize` noturno também é desativado. |
| `assisted` (padrão) | Risco baixo e sem credenciais instala direto; o resto pede aprovação. Atualizações automáticas são opcionais. |
| `autonomous` | Igual ao `assisted`, podendo atualizar automaticamente quando `autoUpdate` estiver ligado. Risco, credenciais e MCP remoto **continuam** pedindo aprovação. |

### Aprovar ou recusar

- **Interface:** aba **Segurança** → aprovações pendentes.
- **Chat:** “mostre as aprovações”.
- **API:**

```bash
# Aprovar (com as credenciais autorizadas)
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"approve\",\"id\":\"ID_DA_APROVACAO\",\"grantEnv\":[\"NOTION_TOKEN\"]}"

# Recusar
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"deny\",\"id\":\"ID_DA_APROVACAO\"}"
```

> Ao aprovar, o motor baixa e analisa a origem novamente antes de instalar. Bloqueios críticos continuam valendo; se a análise falhar, nada é instalado.

---

## 5. Segurança

### Análise antes da instalação

O scanner (`scanner.ts`) procura, entre outros:

- download seguido de execução no shell (`curl | sh`, `iwr | iex`);
- PowerShell codificado/ofuscado e `eval` de conteúdo decodificado;
- mineradores de criptomoeda;
- acesso a credenciais, cookies, chaves SSH/AWS e carteiras;
- persistência no Windows e desativação de antivírus;
- comandos destrutivos;
- envio de dados para webhooks/serviços de coleta;
- chaves privadas ou credenciais reais embutidas;
- coleta e envio de variáveis de ambiente;
- binários, links simbólicos, scripts de instalação npm e ofuscação suspeita.

Metadados também entram no risco: repositório arquivado, pouca reputação, criado há menos de 14 dias e ausência de licença.

### Isolamento de execução

- Terceiros **não herdam** o ambiente do JARVIS: recebem `HOME`, `TEMP`, `APPDATA` e `PATH` mínimos dentro de `data/engine/home/<id>`.
- Só recebem as variáveis de credencial **explicitamente concedidas por nome**; valores nunca são gravados no catálogo.
- Processos têm tempo limite (120 s para ferramentas e testes; 180–420 s para operações npm) e árvore de processos encerrada ao estourar.
- MCPs remotos recebem a primeira credencial concedida como `Authorization: Bearer`.
- Ferramentas só executam com argumentos validados contra o `inputSchema` (tipos, obrigatórios e coerção de strings).
- Logs, histórico e saídas de ferramentas passam por **redação** de chaves e tokens.

### Permissões por agente

Cada extensão tem:

```json
{
  "network": true,
  "shell": false,
  "fsWrite": false,
  "env": ["GITHUB_TOKEN"],
  "agents": ["*"]
}
```

- `agents`: papéis autorizados (`architect`, `backend`, `frontend`, `uiux`, `ai`, `database`, `qa`, `reviewer`, `fullstack`, `devops`, `writer`) ou `["*"]` para todos. O papel `jarvis` sempre pode usar.
- `env`: nomes de variáveis que a extensão pode receber.
- `network`, `shell` e `fsWrite`: capacidades inferidas/declaradas, exibidas no painel e consideradas na análise. Elas documentam o comportamento esperado; o isolamento efetivo é feito por ambiente mínimo, diretório de trabalho, timeouts, análise estática e permissão por papel (o Windows não oferece sandbox de SO sem privilégios administrativos).

### Versões, atualização e rollback

- Cada instalação/atualização cria um diretório versionado; as versões anteriores são mantidas.
- A atualização só substitui a versão ativa **depois** de passar no teste funcional. Se falhar, a anterior continua ativa e a nova é descartada (rollback automático).
- Uma nova versão mais arriscada que a aceita anteriormente é recusada; a versão atual continua ativa.
- `restore` volta para qualquer versão guardada; `remove` apaga arquivos, versões e registro.

### Backup

O estado completo fica em `data/engine/` (ou em `JARVIS_DATA_DIR/engine`). Para backup consistente:

1. pare o JARVIS;
2. copie a pasta `data/engine` (catálogo, configurações, aprovações, histórico, oportunidades, versões instaladas e workspaces);
3. reinicie.

O histórico é *append-only* em `data/engine/history.jsonl` e não guarda segredos.

### Limitações conhecidas

- Não há sandbox de kernel no Windows; código aprovado roda com os privilégios do usuário.
- As flags `network`/`shell`/`fsWrite` não bloqueiam chamadas de sistema em tempo real.
- A API é local por padrão: o middleware só aceita `Host` local e bloqueia origens externas/CSRF. Não exponha a porta na internet.
- Não há WebSocket; integração externa usa REST e SSE (`/api/chat`).
- A criação automática de Skills depende de pelo menos um provedor de IA configurado.

---

## 6. Comandos no chat

Os comandos são interpretados de forma **determinística** (sem chamar modelo) e funcionam mesmo sem provedor de IA. Perguntas normais sobre Skills continuam indo para o modelo.

| Intenção | Exemplos |
|---|---|
| Ajuda | “ajuda do skill engine” · “como gerenciar skills” |
| Listar | “liste as skills instaladas” · “o que está instalado?” |
| Descobrir | “encontre uma skill para editar vídeos” · “procure ferramentas de pesquisa” |
| Instalar/adquirir | “instale as melhores ferramentas gratuitas para desenvolvimento” · “instale dono/repo” |
| Criar | “crie uma skill para automatizar minhas atividades acadêmicas” |
| Atualizar | “atualize todas as skills” · “atualize a skill X” · “verifique atualizações” |
| Testar/reparar | “teste a skill X” · “teste todas” · “repare X” |
| Ligar/desligar | “desative X” · “ative X” |
| Remover | “remova X” |
| Versões | “restaure a versão anterior de X” |
| Aprovações | “mostre as aprovações” |
| Histórico/oportunidades | “histórico” · “oportunidades” · “conflitos” |
| Autodiagnóstico | “verificação completa” · “otimize” |
| Executar ferramenta | `use X ferramenta Y com {"arg": "valor"}` |

Regras do parser:

- Para descobrir/instalar, a frase precisa citar **skill, habilidade, plugin, extensão, ferramenta, MCP ou integração**, ou trazer uma origem explícita (URL, `owner/repo`, pacote, `npx`, caminho local).
- Comandos de gerenciamento sem o substantivo (“desative X”) só são aceitos se `X` corresponder a uma extensão realmente instalada.
- Frases iniciadas por “como”, “o que”, “qual”, “por que”, “quando”, “onde” e “quem” vão para o modelo, salvo intenção clara de listagem.
- A resposta do chat é entregue por SSE com o modelo `jarvis-engine`; o comando não consome tokens do provedor.

---

## 7. Criação automática de Skills

Quando nenhuma capacidade instalada ou pacote público resolve uma necessidade:

1. `acquire` procura uma extensão instalada com pontuação suficiente e a reutiliza.
2. Caso contrário, pesquisa GitHub/MCP/npm e tenta instalar até 4 candidatos não arquivados.
3. Se nada passar, e `autoCreate` estiver ligado (padrão), o construtor cria uma Skill própria.
4. A Skill gerada passa pelo **mesmo** pipeline: análise, política, instalação e testes.
5. Se os testes falharem, a equipe corrige e tenta novamente; se continuar falhando, o resultado é registrado.
6. Se a criação não for possível, a necessidade fica como **oportunidade aberta** para pesquisa posterior.

A equipe de criação é formada por um construtor `fullstack` e um QA, trabalhando em `data/engine/workspace/`. A Skill produzida contém:

- `jarvis-tool.json` — nome, descrição, versão, categorias, script, variáveis de ambiente e definição das ferramentas;
- `index.mjs` — lê `{ "tool": "...", "args": {...} }` do stdin e imprime uma linha JSON;
- `SKILL.md` — instruções de uso com frontmatter;
- `tests/test.mjs` — testes locais sem internet nem credenciais.

> `autoCreate` liga/desliga a criação automática, mas **não** ignora análise, aprovação ou testes.
> `autoOptimize` apenas pesquisa alternativas e grava sugestões; **nunca instala sozinho**.

---

## 8. API REST

Base: `http://localhost:3001/api/engine`. Todas as requisições POST usam JSON. A API é local (middleware bloqueia hosts e origens externas).

### GET

| Ação | Parâmetros | Retorno |
|---|---|---|
| `catalog` (padrão) | — | `extensions`, `settings`, `approvals`, `opportunities`, `conflicts`, `running`, `jobs`, `stats` |
| `history` | `limit`, `id` (opcional) | `history` (mais recente primeiro) |
| `job` | `id` | `job` com status, log e resultado |
| `recommend` | `q`, `role`, `limit` | extensões pontuadas para a necessidade |
| `read` | `id`, `skill` (opcional) | conteúdo das instruções da Skill |

```bash
curl.exe "http://localhost:3001/api/engine"
curl.exe "http://localhost:3001/api/engine?action=recommend&q=video&role=writer"
curl.exe "http://localhost:3001/api/engine?action=job&id=UUID_DO_JOB"
```

### POST — descoberta e instalação

| Ação | Corpo | Retorno |
|---|---|---|
| `discover` | `query`, `kinds?` (`skill`/`mcp`/`tool`) | `candidates`, `errors` |
| `resolve` | `source` | candidato normalizado |
| `inspect` | `source` ou `candidate` ou `token` | `token`, risco, decisão da política, ferramentas |
| `install` | `source` ou `token`/`candidate`, `requestedBy?`, `approved?`, `grantEnv?` | `installed`, `pending`, `blocked` ou `existing` |
| `approve` / `deny` | `id`, `grantEnv?` | resultado da instalação ou `denied` |

```bash
# Analisar uma origem
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"inspect\",\"source\":\"dono/repo\"}"

# Instalar a versão analisada
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"install\",\"token\":\"TOKEN_DA_ANALISE\",\"approved\":true}"
```

### POST — gerenciamento

| Ação | Corpo | Observação |
|---|---|---|
| `update` | `id` | Atualiza uma extensão com rollback automático. |
| `update-all` | — | Retorna um `job`. |
| `check-updates` | — | Retorna quantas atualizações existem. |
| `test` | `id` | Teste funcional imediato. |
| `test-all` | — | Retorna um `job`. |
| `enable` / `disable` | `id` | Liga/desliga no catálogo. |
| `remove` | `id` | Apaga arquivos, versões e registro. |
| `restore` | `id`, `dir` | Volta para uma versão guardada. |
| `repair` | `id` | Reinstala dependências (quando houver) e testa novamente. |
| `permissions` | `id`, `patch` | `network`, `shell`, `fsWrite`, `env`, `agents`. |
| `settings` | `settings` | `autonomy`, `autoUpdate`, `autoCreate`, `autoOptimize`. |
| `dismiss-opportunity` | `id` | Descarta uma oportunidade. |

### POST — autonomia e criação (retornam `job`)

| Ação | Corpo |
|---|---|
| `create` | `need` |
| `acquire` | `need` |
| `optimize` | — |
| `self-check` | — |

Acompanhe com `GET ?action=job&id=...`.

### POST — uso

| Ação | Corpo | Retorno |
|---|---|---|
| `read-skill` | `id`, `skill?` | instruções |
| `call` | `id`, `tool`, `args` | saída da ferramenta |

```bash
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"call\",\"id\":\"meu-mcp\",\"tool\":\"search\",\"args\":{\"query\":\"noticias\"}}"
```

### Configuração

```bash
curl.exe -X POST http://localhost:3001/api/engine ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"settings\",\"settings\":{\"autonomy\":\"assisted\",\"autoUpdate\":false,\"autoCreate\":true,\"autoOptimize\":true}}"
```

### Shim legado `/api/skills`

| Método/ação | Equivalência |
|---|---|
| `GET ?action=list` | catálogo + estatísticas no formato antigo |
| `GET ?action=marketplace&q=&kind=` | descoberta |
| `GET ?action=stats` | estatísticas |
| `POST action=install-from-url` | instalação por origem |
| `POST action=create` | criação de Skill |
| `POST action=enable/disable/toggle` | ligar/desligar |

---

## 9. Integração com agentes

### Agentes internos

Toda equipe recebe as ferramentas abaixo, filtradas pelo papel:

| Ferramenta | Uso |
|---|---|
| `skill_find` | Lista extensões úteis para uma necessidade, respeitando as permissões do papel. |
| `skill_use` | Executa uma ferramenta de MCP ou script. |
| `skill_read` | Lê o `SKILL.md` (ou uma Skill dentro de uma coleção). |
| `skill_request` | Pede ao motor para encontrar/instalar/criar uma capacidade; pode aguardar aprovação. |

Fluxo típico de um agente:

```text
skill_find {"query": "gerar relatório em PDF"}
→ se nada servir: skill_request {"need": "gerar relatório em PDF"}
→ se instalada: skill_use {"extension": "id", "tool": "nome", "args": {...}}
→ se for Skill: skill_read {"extension": "id"}
```

As permissões `agents` de cada extensão são aplicadas em `skill_find`, `skill_use` e `skill_read`. O papel `jarvis` sempre pode usar.

### Agentes externos (VS Code, CLI, automações)

Não há WebSocket. Use REST para o catálogo/execução e SSE para conversas:

1. `GET /api/engine` para descobrir ferramentas e IDs.
2. `POST /api/engine` com `action: "call"` para executar.
3. `POST /api/chat` para conversar; a resposta é SSE.
4. `POST /api/agents/runs` para iniciar uma equipe de agentes; acompanhe por `GET /api/agents/runs?id=...` ou `GET /api/agents/runs/[id]/events`.

Exemplo mínimo em Node.js:

```js
const base = 'http://localhost:3001'

const catalog = await fetch(`${base}/api/engine`).then(r => r.json())
const ext = catalog.extensions.find(e => e.tools.some(t => t.name === 'search'))

const res = await fetch(`${base}/api/engine`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'call', id: ext.id, tool: 'search', args: { query: 'Next.js' } }),
})
console.log(await res.json())
```

> O middleware exige `Host` local (`localhost`, `127.0.0.1`, `[::1]`) e, quando há `Origin`, o mesmo host. Para integrações em outra máquina, use um proxy autenticado — não abra a porta diretamente.

---

## 10. Formatos de pacote suportados

### Skill Anthropic/Agent Skills

```text
minha-skill/
├── SKILL.md            # frontmatter: name, description
├── scripts/            # opcional (analisado, nunca executado na instalação)
└── referencias/        # opcional
```

Coleções com vários `SKILL.md` viram uma extensão com várias Skills legíveis por `skill_read`.

### Ferramenta JARVIS / OpenAI-compatible

```json
{
  "name": "minha-ferramenta",
  "description": "O que ela faz",
  "version": "1.0.0",
  "categories": ["pesquisa"],
  "script": "index.mjs",
  "env": ["MINHA_API_KEY"],
  "tools": [
    {
      "name": "buscar",
      "description": "Busca algo",
      "inputSchema": {
        "type": "object",
        "properties": { "query": { "type": "string" } },
        "required": ["query"]
      }
    }
  ]
}
```

O script lê `{"tool":"...","args":{...}}` do stdin e imprime `{"result": ...}` ou `{"error": "..."}`.

### Plugin Anthropic/Claude

Lê `.claude-plugin/plugin.json` ou `plugin.json` e transforma `commands/`, `skills/` e `agents/` em instruções legíveis.

### Servidor MCP

- **stdio:** `package.json` com dependência MCP e entrada executável, ou `.mcp.json` / `mcp.json` / `claude_desktop_config.json` com `command: "node"`.
- **HTTP:** URL remota (sempre com aprovação) ou configuração `url` no arquivo MCP.
- Comandos `npx`, `uvx` e Python são recusados quando baixariam código na execução; prefira a versão publicada no npm.

### Skill embutida

Crie `skills/<nome>/SKILL.md` com frontmatter `name` e `description`. Na inicialização, o motor registra automaticamente cada pasta de primeiro nível que contenha `SKILL.md`. O projeto já vem com `pesquisa-tecnica`, `producao-de-video` e `revisao-de-codigo`; novas pastas são registradas no próximo início do servidor.

---

## 11. Persistência e configuração

### Estrutura em disco

```text
data/engine/
├── registry.json          # catálogo e permissões
├── history.jsonl          # histórico append-only (redigido)
├── approvals.json         # aprovações pendentes/decididas
├── settings.json          # autonomia e preferências
├── opportunities.json     # necessidades e sugestões
├── extensions/<id>/...    # versões instaladas
├── quarantine/<token>/    # análise temporária
├── home/<id>/             # HOME/TEMP isolados
├── npm-cache/             # cache npm
├── workspace/             # criação de Skills
└── builds/                # runs da equipe de criação
```

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `GITHUB_TOKEN` | Aumenta o limite da API do GitHub na descoberta e nos downloads. |
| `JARVIS_DATA_DIR` | Muda a pasta de dados (útil para testes e instalações portáteis). |
| Credenciais concedidas | Entregues apenas às extensões autorizadas, por nome. |

### Configurações do motor

| Campo | Padrão | Função |
|---|---|---|
| `autonomy` | `assisted` | Política de instalação/atualização. |
| `autoUpdate` | `false` | Atualiza automaticamente quando há versão nova (respeitando a política). |
| `autoCreate` | `true` | Cria uma Skill própria quando nada pronto resolve. |
| `autoOptimize` | `true` | Pesquisa alternativas para oportunidades abertas (nunca instala). |

### Rotinas em segundo plano

- Verificação de atualizações a cada **6 horas** (e após 60 s da inicialização).
- Pesquisa de oportunidades a cada **24 horas** (e após 5 min), se `autoOptimize` estiver ligado e o modo não for `manual`.
- Verificações não rodam durante os testes automatizados (`VITEST`).

---

## 12. Testes e diagnóstico

```bash
# Tipos
node node_modules/typescript/bin/tsc --noEmit

# Testes do motor e do parser
node node_modules/vitest/vitest.mjs run

# Build de produção
node node_modules/next/dist/bin/next build
```

Casos cobertos por `tests/engine.test.ts`:

- scanner e classificação de risco;
- validação/coerção de argumentos de ferramentas;
- resolução de origens (GitHub, npm, pasta, MCP remoto);
- parser de comandos naturais;
- bloqueio de risco crítico;
- aprovação e negação;
- instalação local de Skill e de tool;
- execução de ferramenta;
- conflitos de nome;
- modo manual;
- redação de segredos.

### Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| “Precisa de aprovação” | Risco médio/alto, credencial ou MCP remoto. Aprove na aba Segurança ou via API. |
| “Bloqueada por segurança” | Regra crítica no código ou formato incompatível. Analise o relatório de risco. |
| “Sem fonte remota para atualizar” | Built-in, pasta local, MCP remoto e Skills criadas não têm atualização automática. |
| MCP não inicia | Veja o teste na aba Catálogo; confirme Node/entrada publicada. `npx`/Python são recusados. |
| Skill criada não passa nos testes | Veja o job em Atividade; a equipe tenta corrigir uma vez e registra a falha. |
| Criação falha sem provedor | Configure ao menos uma chave de IA; comandos de gerenciamento continuam funcionando sem modelo. |
| API retorna 403 | Acesso não é local ou a origem não confere. Use `localhost`/`127.0.0.1`. |

---

## 13. Compatibilidade

| Ecossistema | Suporte |
|---|---|
| Anthropic/Agent Skills (`SKILL.md`) | ✅ Instruções e coleções. |
| Plugins Anthropic/Claude | ✅ Manifesto + comandos/skills/agents em Markdown. |
| MCP local (stdio) | ✅ Node publicado/auditável. |
| MCP remoto (HTTP) | ✅ Com aprovação obrigatória. |
| Registro oficial MCP | ✅ Descoberta. |
| npm | ✅ Pacotes e descoberta. |
| GitHub | ✅ Repositórios, subpastas e descoberta. |
| OpenAI-compatible Tools | ✅ `openai-tool.json` / `openai-tools.json`. |
| VS Code / CLI / automações | ✅ REST + SSE (sem WebSocket). |
| Permissões por agente | ✅ Papéis internos; `jarvis` sempre autorizado. |
