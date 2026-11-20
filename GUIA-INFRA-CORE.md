# Jarvis Infrastructure Core — guia

Implementação do `INFRA.md` e da parte de confiabilidade do `GUIA-ZERO-ERROS.md`.
Tudo aqui funciona de verdade, com dados reais desta máquina e dos servidores que você cadastrar.

Abra pelo botão **Infra** na barra do topo (o número vermelho = incidentes abertos; amarelo = aprovações pendentes).

## O que existe

| Área | O que faz | Onde |
|------|-----------|------|
| Inventário | SO, CPU (uso real), RAM, discos, GPU NVIDIA (VRAM, temperatura, uso, potência, driver), rede, processos que mais usam RAM, serviços automáticos parados, 21 ferramentas detectadas com botão **Instalar** (winget) | aba *Visão geral*, `infra_inventory` |
| Watchdog / autorrecuperação | Monitores HTTP(S), TCP, DNS, processo, container, servidor SSH e recursos (RAM, disco, CPU, temperatura/VRAM da GPU). Abre incidente após N falhas, investiga (diagnóstico de rede, logs do container, Visualizador de Eventos), executa o comando de recuperação que **você** definiu, valida e fecha o incidente | abas *Monitores* e *Incidentes*, `infra_monitor` |
| Proteção contra loops | backoff exponencial entre tentativas e disjuntor: após N tentativas na janela, para e pede você. O estado sobrevive a reinicializações | `src/lib/infra/monitor.ts` |
| Servidores (SSH) | cadastro só com chave (senhas nunca são guardadas), teste de conexão, inventário remoto (SO, memória, disco, serviços com falha, portas, containers, firewall, config do SSH), terminal remoto com classificação de risco, chave `jarvis_ed25519` gerada pelo JARVIS | aba *Servidores*, `infra_ssh`, `infra_server_inventory` |
| Rede | diagnóstico em camadas DNS → ping → porta → HTTP → TLS com **causa provável**, rota (tracert), portas em escuta marcando o que está exposto | aba *Rede*, `infra_diagnose`, `infra_ports` |
| Docker | containers, CPU/RAM, logs, start/restart/stop (remoção de containers/volumes fica com você) | aba *Docker*, `infra_docker` |
| Backups | `tar.gz` + SHA-256, perfis *essencial*/*completo*, criptografia AES-256-GCM opcional (a senha não é guardada; só backups criptografados incluem `keys.json`), agendamento, rotação, verificação, restauração **em pasta separada** (`data/restores/…`, nunca sobrescreve) | aba *Backups*, `infra_backup` |
| IA local | GPU/VRAM, Ollama (versão, modelos instalados e carregados), quais modelos cabem nesta máquina | aba *IA local*, `infra_ai` |
| Saúde do JARVIS | integridade de todos os JSON de `data/`, arquivos em quarentena (com restauração a partir do backup), temporários órfãos, memória do processo e suspeita de vazamento, travamentos do event loop, dependências faltando, modelos com chave inválida, erros das últimas 24 h, idade do último backup, watchdog | aba *Saúde do JARVIS*, `infra_selfcheck` |
| Aprovações | o que um agente não pode fazer sozinho vira pedido: comandos críticos (locais ou via SSH), instalar software, parar container | aba *Aprovações* |
| Auditoria e logs | toda ação (sua, de agente ou do watchdog) registrada com risco e resultado; logs estruturados diários com rotação de 14 dias; segredos mascarados | aba *Auditoria*, `data/infra/audit.jsonl`, `data/logs/` |

### Agentes
Equipe **Infraestrutura** (preset) com 10 especialistas: Arquiteto de Infraestrutura (coordena), Administrador Linux,
Administrador Windows, Redes, DevOps, Cloud, Segurança de Infraestrutura, DBA, Monitoramento/SRE e Recuperação de
Desastres. O planejador também pode escalá-los automaticamente. Eles usam as ferramentas `infra_*` e seguem a skill
**infraestrutura** (runbooks: "configure um servidor" em 14 etapas, hardening, diagnóstico por camadas, Docker/Compose,
Caddy/Nginx + HTTPS, VPN entre redes diferentes, bancos, backup 3-2-1 com RPO/RTO, monitoramento, CI/CD, cloud, IA local).
A skill **engenharia-autonoma** define o ciclo planejar → executar → testar → corrigir → validar para todo agente.

## Regras de segurança (o que precisa de você)

Classificador em `src/lib/infra/risk.ts`:
- **leitura** (status, logs, df…): agentes executam.
- **alteração** (reiniciar serviço, instalar pacote via apt num servidor, docker restart…): agentes executam e fica auditado.
- **crítica** — apagar dados/volumes/bancos, formatar, desativar ou **abrir** firewall, expor serviço, mexer no SSH,
  `terraform destroy`, desligar máquina, `curl | sh`: **nunca** automática. Agente → pedido em *Aprovações*;
  você no terminal remoto → confirmação explícita.
- Comandos de autorrecuperação só podem ser definidos por você e nunca podem ser críticos.
- Instalar software no PC sempre passa por você (botão Instalar ou aprovação).

## Confiabilidade (ZERO-ERROS)

- **Erros do processo**: promessas rejeitadas são registradas sem derrubar o servidor; exceções fatais são registradas.
- **Vários JARVIS abertos ao mesmo tempo** (Electron + terminal, ou outro agente rodando o app): só um processo é o
  *líder* do monitoramento (lock com heartbeat em `data/infra/watchdog.lock`); os outros mostram os dados dele e
  assumem em até 15 s se o líder morrer. Sem watchdogs nem backups duplicados.
- **Encerramento inesperado**: backups interrompidos (`*.partial`) são limpos; estado de monitores, disjuntores e
  incidentes é persistido com escrita atômica; arquivos corrompidos vão para quarentena e podem ser restaurados do backup.
- **Inicialização rápida**: o primeiro backup agendado espera 3 min; o inventário é pré-aquecido aos 30 s e servido
  com cache (o painel abre na hora).

## Procedimentos de recuperação

| Situação | O que fazer |
|----------|-------------|
| Um arquivo de dados corrompeu | *Saúde do JARVIS* → "Restaurar <arquivo> do último backup" (só restaura se o original sumiu; nada é sobrescrito) |
| Perdi a pasta `data/` | *Backups* → Restaurar o mais recente → feche o JARVIS → copie o conteúdo de `data/restores/<id>-<data>/` para `data/` |
| Recuperação automática "suspensa" | veja o incidente (logs/diagnóstico), corrija a causa e clique ↻ no monitor para reativar |
| Servidor SSH recusa a chave | *Servidores* → "Chave SSH do JARVIS" → rode o comando mostrado no servidor |
| "REMOTE HOST IDENTIFICATION HAS CHANGED" | o servidor mudou de identidade: confirme com o provedor antes de limpar `known_hosts` |
| Dependências faltando | *Saúde do JARVIS* → "Rodar npm install" |
| Monitoramento parado | *Saúde do JARVIS* → "Iniciar watchdog" |

## Arquivos

- Código: `src/lib/infra/` (`core`, `monitor`, `backup`, `ssh`, `netdiag`, `inventory`, `docker`, `ai`, `selfcheck`,
  `risk`, `approvals`, `log`, `agentTools`, `exec`, `store`), API `src/app/api/infra/route.ts`,
  UI `src/components/infra/`, boot `src/instrumentation.ts`.
- Dados: `data/infra/` (monitores, estado, incidentes, servidores, aprovações, auditoria, configurações),
  `data/backups/`, `data/restores/`, `data/logs/`.
- Testes: `tests/infra-core.test.ts` (inclui simulação de API fora do ar, porta recusada, recuperação que falha,
  disjuntor após reinício, arquivo corrompido, backup adulterado, senha errada, dois processos simultâneos).

## Limites honestos

- Sem Docker, kubectl, Terraform, Git, Tailscale ou WireGuard instalados nesta máquina: as abas detectam e oferecem
  instalar; os runbooks cobrem o uso depois de instalados.
- Provedores de nuvem (AWS/Azure/GCP…) não têm integração por API: os agentes trabalham por SSH nas VMs, por IaC
  (Terraform/OpenTofu) e pelas CLIs oficiais depois que você instalar e autenticar.
- O inventário remoto é completo para Linux; para Windows Server é básico.
- Notificações aparecem no app (toast) e como notificação do sistema quando você permite.
