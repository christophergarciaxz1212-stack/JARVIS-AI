---
name: infraestrutura
description: Runbooks de engenheiro sênior de infraestrutura — servidores Linux/Windows, redes, Docker, deploy com HTTPS, segurança, bancos, monitoramento, backup/DR e IA local — executados com as ferramentas infra_* do JARVIS.
tags: [infraestrutura, devops, servidores, redes, seguranca, docker, backup, monitoramento, cloud]
updated: 2026-11-15
---

# Infraestrutura — runbooks

Você executa, não só recomenda. Ferramentas: `infra_inventory`, `infra_diagnose`, `infra_ports`, `infra_servers`,
`infra_ssh`, `infra_server_inventory`, `infra_docker`, `infra_monitor`, `infra_backup`, `infra_selfcheck`, `infra_ai`,
`infra_install`, `infra_request`, além de `run_command` (PowerShell local).

## Regras invioláveis

1. **Olhe antes de mexer**: `infra_inventory` / `infra_server_inventory` primeiro. Nunca suponha SO, versão ou portas.
2. **Verifique depois de mexer**: toda mudança termina com um check real (`systemctl is-active`, `curl -fsS`, `infra_diagnose`).
   Não diga "está funcionando" sem a saída do check.
3. **Backup antes de operação crítica** (`infra_backup create` local; `pg_dump`/snapshot no servidor) e guarde a config antiga:
   `cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%F-%H%M)`.
4. **Destrutivo ou que expõe serviço = aprovação** (o JARVIS bloqueia e cria o pedido): apagar volumes/bancos, formatar,
   `ufw allow`, abrir porta no firewall/security group, desativar firewall, mexer em `sshd_config`, `terraform destroy`.
5. **Nunca** desative uma proteção para "fazer funcionar". Corrija a causa.
6. **Segredos**: nunca em comandos que vão para log. Use arquivos `.env` com `chmod 600`, `systemd` `EnvironmentFile=`,
   secrets do GitHub/Docker. Senhas não vão na linha de comando (`PGPASSWORD=...` aparece no `ps`): use `~/.pgpass` (600).
7. **Sem loops**: se uma correção falhou 2 vezes, pare, colete logs e mude de hipótese.

## 1. "Configure um servidor para hospedar meu sistema"

| # | Etapa | Como (Ubuntu/Debian; adapte para RHEL: `dnf`, `firewalld`) | Verificação |
|---|-------|------------------------------------------------------------|-------------|
| 1 | Requisitos | stack, portas, banco, domínio, tráfego esperado, RPO/RTO | escrito no relatório |
| 2 | Ambiente | `infra_server_inventory` (SO, RAM, disco, portas, firewall, SSH) | — |
| 3 | Arquitetura | 1 VPS + Docker Compose + Caddy (simples) ou Nginx + systemd; HA só se pedido | justificativa |
| 4 | Dependências | listar pacotes/imagens; preferir pacotes oficiais | — |
| 5 | Base | `sudo apt-get update && sudo apt-get -y upgrade`; `sudo timedatectl set-timezone America/Sao_Paulo` | `uptime` |
| 6 | Usuário | `sudo adduser --disabled-password deploy && sudo usermod -aG sudo deploy` (+ chave em `~deploy/.ssh/authorized_keys`) | `ssh deploy@host` |
| 7 | Segurança | seção 2 (SSH só chave, ufw, fail2ban, unattended-upgrades) | `sudo ufw status verbose` |
| 8 | Docker | repositório oficial (seção 4) — nunca `curl \| sh` sem revisar | `docker run --rm hello-world` |
| 9 | Banco | container com volume nomeado ou pacote; senha forte em `.env` 600; escutar só em rede interna | `pg_isready` |
| 10 | App | `docker compose up -d` / unit systemd com `Restart=on-failure` | `curl -fsS localhost:PORTA/health` |
| 11 | Domínio + HTTPS | DNS A/AAAA → IP; Caddy (HTTPS automático) ou Nginx + Certbot (seção 5) | `infra_diagnose https://dominio` (cert válido) |
| 12 | Monitoramento | `infra_monitor add` HTTP do domínio + ssh do servidor; node_exporter se houver Prometheus | monitor "up" |
| 13 | Backups | seção 8: dump diário + cópia fora do servidor; **teste de restauração** | restore em banco temporário |
| 14 | Entrega | relatório: o que foi feito, portas expostas, credenciais (onde estão, não quais), como fazer rollback | checklist abaixo |

Checklist de entrega: HTTPS válido · só 22/80/443 abertas · SSH sem senha · app reinicia sozinho após reboot
(`sudo reboot` e verificar) · backup testado · monitor ativo · rollback documentado.

## 2. Hardening Linux

```bash
# SSH: só chave, sem root por senha (antes: confirme que SUA chave entra em outra sessão!)
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%F)
printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\nKbdInteractiveAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/10-jarvis.conf
sudo sshd -t && sudo systemctl reload ssh   # sshd -t valida antes de recarregar

# Firewall (exige aprovação: abre portas)
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

# fail2ban + atualizações automáticas de segurança
sudo apt-get install -y fail2ban unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd
```
Auditoria rápida: `sudo ss -tlnp` (o que escuta em 0.0.0.0?), `sudo lastb | head`, `sudo journalctl -u ssh --since -1h`,
`find / -perm -4000 -type f 2>/dev/null` (SUID), contas com shell: `awk -F: '$7 ~ /sh$/ {print $1}' /etc/passwd`.

**Windows**: `Get-NetFirewallProfile | Select Name,Enabled` (todos True) · `Get-LocalUser | Where Enabled` ·
RDP nunca exposto à internet (use Tailscale/WireGuard) · `Get-HotFix | Sort InstalledOn -Desc | Select -First 5` ·
Defender: `Get-MpComputerStatus | Select AMServiceEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated`.

## 3. Diagnóstico por camadas (de baixo para cima)

1. **DNS**: `infra_diagnose dominio` → `Resolve-DnsName dominio` / `dig +short dominio @1.1.1.1` (compare resolvedores).
2. **Rota**: `ping`, `tracert -d` / `mtr -rwc 20 host` — perda no último salto = destino; no meio = provedor.
3. **Porta**: `Test-NetConnection host -Port 443` / `nc -vz host 443`. *Recusada* = nada escutando; *timeout* = firewall/SG/NAT.
4. **Serviço escutando onde?** no servidor: `sudo ss -tlnp | grep :PORTA` — `127.0.0.1:PORTA` não aceita conexão externa.
5. **TLS**: `openssl s_client -connect host:443 -servername host </dev/null | openssl x509 -noout -dates -issuer`.
6. **HTTP**: `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://host/health`.
7. **Logs**: `journalctl -u SERVICO -n 100 --no-pager`, `docker logs --tail 100 C`, `/var/log/nginx/error.log`.
Erros HTTP: 502 = upstream fora/porta errada · 504 = upstream lento (timeout) · 413 = `client_max_body_size` ·
403 = permissão/`root` errado · 301 em loop = proxy sem `X-Forwarded-Proto`.

## 4. Docker e Compose

Instalação (Ubuntu) pelo repositório oficial:
```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```
Dockerfile: multi-stage, imagem `-slim`/`alpine` fixada por versão, `USER` não-root, `HEALTHCHECK`, sem segredos no build.
Compose de produção:
```yaml
services:
  app:
    image: minha-app:1.4.2          # versão fixa = rollback é trocar a tag
    restart: unless-stopped
    env_file: .env                  # chmod 600
    depends_on: { db: { condition: service_healthy } }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"], interval: 30s, retries: 3 }
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }   # log não enche o disco
  db:
    image: postgres:17
    restart: unless-stopped
    environment: { POSTGRES_PASSWORD_FILE: /run/secrets/pg }
    volumes: [pgdata:/var/lib/postgresql/data]   # volume nomeado: sobrevive ao container
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 10s }
    # sem "ports:" → banco não fica exposto fora da rede do compose
volumes: { pgdata: {} }
```
Kubernetes: `requests/limits` sempre, `readinessProbe` + `livenessProbe`, `PodDisruptionBudget`, segredos em `Secret`
(idealmente externo: SOPS/External Secrets), deploy com `kubectl rollout status` e `kubectl rollout undo` para voltar.

## 5. Web: Caddy (mais simples) ou Nginx + Certbot

Caddyfile (HTTPS automático com Let's Encrypt):
```
app.exemplo.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```
Nginx:
```nginx
server {
  listen 80; server_name app.exemplo.com;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```
`sudo nginx -t && sudo systemctl reload nginx` → `sudo certbot --nginx -d app.exemplo.com --redirect` →
renovação: `sudo certbot renew --dry-run`. Node em produção: systemd (`Restart=on-failure`) ou PM2
(`pm2 start ecosystem.config.js && pm2 save && pm2 startup`). Python: Gunicorn/Uvicorn atrás do proxy.

## 6. Redes e acesso remoto entre redes diferentes

- **Preferência: Tailscale** (malha WireGuard, atravessa NAT, sem abrir portas): instale em PC, celular e servidores,
  `tailscale up`, use os IPs 100.x / MagicDNS. ACLs no painel. Nada fica exposto à internet.
- **WireGuard puro**: servidor com IP público, `wg genkey | tee priv | wg pubkey > pub`, `[Interface] Address=10.8.0.1/24
  ListenPort=51820`, um `[Peer]` por dispositivo com `AllowedIPs=10.8.0.X/32`; abrir **só** UDP 51820 (aprovação).
- Sub-redes: /24 = 254 hosts; /30 = link ponto a ponto; evite sobrepor a rede da VPN com a LAN de casa (192.168.0/1.x).
- Port forwarding no roteador = exposição direta: só com aprovação, só para o proxy (443), nunca banco/RDP/SSH.
- PowerShell Remoting: `Enable-PSRemoting` só dentro da VPN; prefira SSH (OpenSSH Server do Windows).

## 7. Bancos de dados

PostgreSQL: `max_connections` modesto + **PgBouncer**; `shared_buffers` ≈ 25% da RAM; `pg_stat_statements` para achar
consultas lentas; `EXPLAIN (ANALYZE, BUFFERS)` antes de criar índice; migrações com rollback e em transação.
Replicação: streaming replica (`pg_basebackup -R`) para leitura/failover. MySQL/MariaDB: `mysqldump --single-transaction`.
Redis: `requirepass`, `bind 127.0.0.1`, `appendonly yes` se for dado e não só cache. Nunca expor 5432/3306/6379/27017.

## 8. Backup e recuperação de desastres

- **3-2-1**: 3 cópias, 2 mídias, 1 fora do local (outro provedor/objeto S3 com versionamento).
- **RPO** (quanto dado posso perder) define a frequência; **RTO** (quanto tempo fora) define o método:
  RPO 24 h → dump diário · RPO minutos → WAL archiving/PITR (`pgBackRest`, `wal-g`) · RTO minutos → réplica pronta para promoção.
- Postgres diário via systemd timer: `pg_dump -Fc -f /backup/app-$(date +%F).dump app` + rotação (`find /backup -mtime +14 -delete`).
- Arquivos: `restic` (criptografado, deduplicado) para S3/B2/SFTP; snapshots do provedor/ZFS/Proxmox antes de upgrades.
- **Backup não testado não existe**: restaure em banco temporário (`pg_restore -d app_teste`) e confira contagens.
- Dados do JARVIS: `infra_backup create` / `verify` (SHA-256; opção criptografada AES-256-GCM no painel).

## 9. Monitoramento e alertas

Comece pelo JARVIS (`infra_monitor`): HTTP de cada site, TCP de cada banco (de dentro da rede), SSH de cada servidor,
RAM/disco/GPU locais. Em servidores: **node_exporter** + Prometheus + Grafana (dashboard 1860), Loki para logs,
Alertmanager com regras como `up == 0 for 2m`, `node_filesystem_avail_bytes/size < 0.10`,
`rate(http_requests_total{code=~"5.."}[5m]) > 0.05`. Alerta bom = acionável; evite alertar sobre CPU momentânea.
Netdata (`bash <(curl ...)` só após revisar) para um painel rápido por host; Zabbix em parques grandes.

## 10. CI/CD e IaC

GitHub Actions: `test → build imagem (tag = SHA) → push → deploy → health check → rollback automático se falhar`.
Deploy por SSH com chave de deploy dedicada (secret), nunca senha. Blue-green: duas stacks, troca no proxy após o health
check; canary: % do tráfego para a nova versão e observar erros. Terraform/OpenTofu: estado remoto com lock,
`plan` revisado antes de `apply`, nunca `-auto-approve` em produção. Ansible para configuração idempotente
(`--check --diff` antes).

## 11. Cloud — escolha rápida

Projeto pessoal/pequeno: Hetzner/DigitalOcean (VPS barato) ou Oracle Free Tier · Cloudflare na frente (DNS, proxy,
WAF, Tunnel para expor sem abrir portas) · Empresa: AWS/Azure/GCP com conta separada por ambiente, IAM de menor
privilégio, budgets/alertas de custo, banco gerenciado (RDS/Cloud SQL) com backups automáticos e Multi-AZ quando o RTO pedir.
Sempre apresente custo mensal estimado e alternativa mais barata.

## 12. Infraestrutura de IA local

`infra_ai` mostra VRAM e o que cabe. Regra: pesos Q4 ≈ 0,6 GB por bilhão de parâmetros + 1–2 GB de contexto.
Ollama: `OLLAMA_KEEP_ALIVE=10m` (descarrega depois), `OLLAMA_NUM_PARALLEL=2`, `OLLAMA_HOST=127.0.0.1:11434`
(nunca 0.0.0.0 sem VPN), `ollama ps` mostra quanto está na GPU (100% GPU = rápido; dividido CPU/GPU = lento).
vLLM (Linux/WSL + NVIDIA): `docker run --gpus all -p 127.0.0.1:8000:8000 vllm/vllm-openai --model <modelo>`.
Drivers: `nvidia-smi` funcionando é pré-requisito; no WSL o driver é o do Windows (não instale driver dentro do WSL).
GPU passthrough (Proxmox): IOMMU no BIOS + `intel_iommu=on`/`amd_iommu=on`, vfio, e a GPU dedicada à VM.
