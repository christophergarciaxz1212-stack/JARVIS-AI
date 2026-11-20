/**
 * Risk classification for infrastructure commands (local PowerShell or remote shell).
 *  - read:     only inspects state
 *  - change:   changes state but is reversible / routine (restart a service, install a package)
 *  - critical: destroys data, cuts access or exposes services — needs explicit user confirmation
 */
export type RiskLevel = 'read' | 'change' | 'critical'

export interface RiskAssessment {
  level: RiskLevel
  reasons: string[]
}

const CRITICAL: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)\b/i, 'exclusão recursiva de arquivos'],
  [/\b(mkfs(\.\w+)?|wipefs|fdisk|sfdisk|parted|gdisk)\b/i, 'formatação/particionamento de disco'],
  [/\bdd\b[^|;&]*\bof=\/dev\//i, 'escrita direta em dispositivo de bloco'],
  [/>\s*\/dev\/(sd|nvme|vd|xvd|hd)\w*/i, 'escrita direta em dispositivo de bloco'],
  [/\b(Format-Volume|Clear-Disk|Remove-Partition|Initialize-Disk)\b/i, 'formatação/particionamento de disco'],
  [/\bformat\s+[a-z]:/i, 'formatação de disco'],
  [/\b(diskpart)\b/i, 'particionamento de disco'],
  [/\bRemove-Item\b[^|;]*-Recurse/i, 'exclusão recursiva de arquivos'],
  [/\b(rd|rmdir)\s+\/s\b/i, 'exclusão recursiva de pastas'],
  [/\bdel\s+\/[a-z]*s/i, 'exclusão recursiva de arquivos'],
  [/\bdrop\s+(database|schema|table)\b/i, 'remoção de banco de dados/tabela'],
  [/\btruncate\s+table\b/i, 'apaga todos os registros de uma tabela'],
  [/\bdropdb\b/i, 'remoção de banco de dados'],
  [/\bFLUSHALL\b|\bFLUSHDB\b/, 'apaga dados do Redis'],
  [/\bdocker\s+(volume\s+(rm|prune)|system\s+prune|image\s+prune\s+-a|rm\s+-[a-z]*v)/i, 'remove volumes/dados do Docker'],
  [/\bdocker\s+compose\s+down\b[^|;]*(-v|--volumes)/i, 'remove volumes do Docker Compose'],
  [/\bkubectl\s+delete\b/i, 'remove recursos do Kubernetes'],
  [/\bhelm\s+(uninstall|delete)\b/i, 'remove release do Helm'],
  [/\b(terraform|tofu)\s+(destroy|apply\b[^|;]*-destroy)/i, 'destrói infraestrutura gerenciada por IaC'],
  [/\b(terraform|tofu)\s+apply\b[^|;]*-auto-approve/i, 'aplica IaC sem revisão do plano'],
  [/\biptables\s+(-F|--flush|-P\s+\w+\s+ACCEPT|-X)/i, 'remove regras de firewall'],
  [/\bnft\s+flush\b/i, 'remove regras de firewall'],
  [/\bufw\s+(disable|reset)\b/i, 'desativa o firewall'],
  [/\bsystemctl\s+(stop|disable|mask)\s+(firewalld|ufw|nftables|iptables|fail2ban|sshd?)\b/i, 'desativa proteção ou acesso remoto'],
  [/\bSet-NetFirewallProfile\b[^|;]*-Enabled\s+(\$?false|0)/i, 'desativa o firewall do Windows'],
  [/\bnetsh\s+(adv)?firewall\s+set\s+\w*\s*state\s+off/i, 'desativa o firewall do Windows'],
  [/\bufw\s+allow\b|\bfirewall-cmd\b[^|;]*--add-(port|service)|\bNew-NetFirewallRule\b[^|;]*Inbound|\biptables\s+-A\s+INPUT\b[^|;]*ACCEPT/i, 'abre porta/expõe serviço para a rede'],
  [/\b(shutdown|poweroff|halt|reboot|init\s+[06])\b|\b(Stop|Restart)-Computer\b/i, 'desliga ou reinicia a máquina'],
  [/\b(userdel|deluser)\b|\bRemove-LocalUser\b|\bnet\s+user\s+\S+\s+\/delete/i, 'remove usuário'],
  [/\bpasswd\b|\bchpasswd\b|\bSet-LocalUser\b[^|;]*-Password|\bnet\s+user\s+\S+\s+\S+/i, 'altera credenciais'],
  [/\bchmod\s+(-R\s+)?[0-7]*777\b|\bchmod\s+-R\b[^|;]*\s\/(\s|$)/i, 'permissões abertas/recursivas na raiz'],
  [/\bchown\s+-R\b[^|;]*\s\/(\s|$)/i, 'troca dono recursivamente na raiz'],
  [/\b(sshd_config|authorized_keys)\b[^|;]*(>|sed\s+-i|tee)/i, 'altera acesso SSH'],
  [/\bPermitRootLogin\s+yes\b|\bPasswordAuthentication\s+yes\b/i, 'enfraquece a segurança do SSH'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression)\b/i, 'executa script baixado da internet sem revisão'],
  [/\breg\s+(add|delete)\b|\bRemove-ItemProperty\b|\bSet-ItemProperty\b[^|;]*HK(LM|CU)/i, 'altera o registro do Windows'],
  [/\bbcdedit\b|\bvssadmin\s+delete\b|\bwbadmin\s+delete\b/i, 'altera boot ou apaga cópias de segurança'],
  [/\bcrontab\s+-r\b/i, 'apaga todas as tarefas agendadas'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
]

const CHANGE: Array<[RegExp, string]> = [
  [/\b(systemctl|service)\s+(start|stop|restart|reload|enable|disable)\b/i, 'altera serviço'],
  [/\b(Start|Stop|Restart|Set)-Service\b/i, 'altera serviço do Windows'],
  [/\b(apt(-get)?|dnf|yum|zypper|pacman|apk|brew|snap|choco|winget|scoop)\s+(install|remove|purge|upgrade|update|erase|-S|add|del|uninstall)\b/i, 'instala/remove/atualiza pacotes'],
  [/\b(pip3?|npm|pnpm|yarn)\s+(install|uninstall|remove|add|update|upgrade)\b/i, 'instala/remove dependências'],
  [/\bdocker\s+(run|start|stop|restart|rm|kill|pull|build|compose\s+(up|down|restart|pull))\b/i, 'altera containers'],
  [/\bkubectl\s+(apply|create|scale|rollout|patch|edit|set)\b/i, 'altera recursos do Kubernetes'],
  [/\b(terraform|tofu)\s+(apply|import|state)\b/i, 'altera infraestrutura gerenciada por IaC'],
  [/\bansible-playbook\b/i, 'executa playbook do Ansible'],
  [/\b(useradd|adduser|usermod|groupadd|New-LocalUser|Add-LocalGroupMember)\b/i, 'altera usuários/grupos'],
  [/\b(chmod|chown|icacls|takeown)\b/i, 'altera permissões'],
  [/\b(mv|cp|rm|Move-Item|Copy-Item|Remove-Item|Rename-Item|New-Item|Set-Content|Add-Content|Out-File|tee|sed\s+-i)\b/i, 'altera arquivos'],
  [/(^|[^2])>{1,2}\s*[^&\s]/, 'grava em arquivo'],
  [/\b(certbot|acme\.sh)\b/i, 'emite/renova certificados'],
  [/\b(nginx|apachectl|caddy)\s+(-s\s+\w+|reload|restart|graceful)\b/i, 'recarrega servidor web'],
  [/\bpm2\s+(start|stop|restart|reload|delete|save)\b/i, 'altera processos do PM2'],
  [/\b(kill|pkill|killall|taskkill|Stop-Process)\b/i, 'encerra processos'],
  [/\bcrontab\s+-e\b|\bschtasks\s+\/(create|delete|change)\b|\b(Register|Unregister)-ScheduledTask\b/i, 'altera tarefas agendadas'],
  [/\bgit\s+(push|reset|checkout|merge|rebase|pull|commit)\b/i, 'altera repositório git'],
  [/\b(mount|umount)\b|\bMount-DiskImage\b/i, 'monta/desmonta volumes'],
  [/\bsudo\b/i, 'executa como administrador'],
]

export function classifyCommand(command: string): RiskAssessment {
  const cmd = command.trim()
  const critical = CRITICAL.filter(([re]) => re.test(cmd)).map(([, why]) => why)
  if (critical.length) return { level: 'critical', reasons: [...new Set(critical)] }
  const change = CHANGE.filter(([re]) => re.test(cmd)).map(([, why]) => why)
  if (change.length) return { level: 'change', reasons: [...new Set(change)] }
  return { level: 'read', reasons: [] }
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  read: 'leitura',
  change: 'alteração',
  critical: 'crítica (destrutiva/expõe serviços)',
}
