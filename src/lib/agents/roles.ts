import type { AgentConfig, RoleTemplate, Team } from './types'

// "!" patterns exclude: each side keeps out of the other's folders unless the plan authorizes a file
const SERVER_DIRS = ['!**/server/**', '!**/api/**', '!**/backend/**', '!**/migrations/**', '!**/prisma/**']
const CLIENT_DIRS = ['!**/components/**', '!**/pages/**', '!**/views/**', '!**/public/**', '!**/*.css', '!**/*.scss', '!**/*.html']
const CODE_FRONT = ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.html', '**/*.htm', '**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/components/**', '**/pages/**', '**/views/**', '**/public/**', '**/assets/**', '**/static/**', '**/templates/**', '**/*.js', '**/*.mjs', ...SERVER_DIRS]
const CODE_BACK = ['**/api/**', '**/server/**', '**/backend/**', '**/routes/**', '**/controllers/**', '**/services/**', '**/middleware*', '**/lib/**', '**/utils/**', '**/auth/**', '**/*.py', '**/*.go', '**/*.java', '**/*.cs', '**/*.php', '**/*.rb', '**/*.rs', '**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs', '**/.env.example', ...CLIENT_DIRS]
const CODE_DB = ['**/*.sql', '**/migrations/**', '**/migration/**', '**/prisma/**', '**/db/**', '**/database/**', '**/models/**', '**/schema*', '**/seeds/**', '**/drizzle/**']
const CODE_TEST = ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**', '**/vitest.config.*', '**/jest.config.*', '**/playwright.config.*', '**/pytest.ini', '**/conftest.py']
const CODE_UI = ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/styles/**', '**/theme/**', '**/tailwind.config.*', '**/postcss.config.*', '**/components/**', '**/*.tsx', '**/*.jsx', '**/*.html', '**/*.svg']
const CODE_AI = ['**/ai/**', '**/agents/**', '**/llm/**', '**/prompts/**', '**/chains/**', '**/tools/**', '**/*.py', '**/*.ts', '**/*.js']
const DOCS = ['**/*.md', '**/docs/**', '**/*.txt']

export const ROLES: RoleTemplate[] = [
  {
    id: 'architect',
    name: 'Arquiteto de Software',
    icon: '🏛️',
    color: '#00d4ff',
    modelHint: 'strong',
    responsibilities: [
      'Analisa toda a estrutura do projeto',
      'Define a arquitetura e as decisões técnicas',
      'Identifica problemas estruturais',
      'Distribui tarefas entre os demais agentes',
      'Supervisiona o desenvolvimento e integra os resultados',
    ],
    scope: [...DOCS, '**/package.json', '**/tsconfig*.json', '**/*.config.*', '**/README*'],
  },
  {
    id: 'backend',
    name: 'Desenvolvedor Backend',
    icon: '⚙️',
    color: '#22c55e',
    modelHint: 'code',
    responsibilities: [
      'Trabalha exclusivamente no backend',
      'Desenvolve APIs e regras de negócio',
      'Implementa autenticação e autorização',
      'Integra o banco de dados',
      'Corrige erros relacionados ao servidor',
    ],
    scope: CODE_BACK,
  },
  {
    id: 'frontend',
    name: 'Desenvolvedor Frontend',
    icon: '🖥️',
    color: '#38bdf8',
    modelHint: 'code',
    responsibilities: [
      'Desenvolve interfaces e componentes',
      'Implementa telas, estados e interações',
      'Melhora a experiência do usuário',
      'Trabalha com HTML, CSS, JavaScript e frameworks',
    ],
    scope: CODE_FRONT,
  },
  {
    id: 'uiux',
    name: 'Especialista em UI/UX',
    icon: '🎨',
    color: '#f472b6',
    modelHint: 'strong',
    responsibilities: [
      'Analisa e melhora o design das interfaces',
      'Define padrões visuais (cores, tipografia, espaçamento)',
      'Garante consistência entre telas',
      'Cria experiências modernas, acessíveis e profissionais',
    ],
    scope: CODE_UI,
  },
  {
    id: 'ai',
    name: 'Engenheiro de IA',
    icon: '🧠',
    color: '#a78bfa',
    modelHint: 'strong',
    responsibilities: [
      'Desenvolve integrações com modelos de IA',
      'Implementa sistemas de agentes e ferramentas',
      'Otimiza prompts e fluxos',
      'Cria automações com APIs de inteligência artificial',
    ],
    scope: CODE_AI,
  },
  {
    id: 'database',
    name: 'Especialista em Banco de Dados',
    icon: '🗄️',
    color: '#f59e0b',
    modelHint: 'code',
    responsibilities: [
      'Analisa a estrutura do banco de dados',
      'Cria e otimiza consultas',
      'Identifica problemas de desempenho',
      'Cuida de migrações e da integridade dos dados',
    ],
    scope: CODE_DB,
  },
  {
    id: 'qa',
    name: 'QA / Tester',
    icon: '🧪',
    color: '#10b981',
    modelHint: 'fast',
    reviewer: true,
    responsibilities: [
      'Testa as funcionalidades entregues',
      'Escreve e executa testes automatizados',
      'Identifica bugs e regressões',
      'Valida as entregas dos outros agentes',
    ],
    scope: CODE_TEST,
  },
  {
    id: 'reviewer',
    name: 'Revisor e Segurança',
    icon: '🛡️',
    color: '#ef4444',
    modelHint: 'strong',
    reviewer: true,
    responsibilities: [
      'Revisa o código produzido pelos outros agentes',
      'Identifica vulnerabilidades e más práticas',
      'Avalia qualidade e desempenho',
      'Aprova ou pede correções antes da integração',
    ],
    scope: [],
  },
  {
    id: 'fullstack',
    name: 'Engenheiro Full-stack',
    icon: '🛠️',
    color: '#06b6d4',
    modelHint: 'code',
    responsibilities: [
      'Resolve tarefas pequenas de ponta a ponta',
      'Faz correções rápidas em qualquer parte do projeto',
    ],
    scope: ['**'],
  },
  {
    id: 'devops',
    name: 'DevOps / Automação',
    icon: '🚀',
    color: '#eab308',
    modelHint: 'code',
    responsibilities: [
      'Cria scripts e automações',
      'Configura build, deploy e CI',
      'Cuida de dependências e ambiente',
    ],
    scope: ['**/scripts/**', '**/*.ps1', '**/*.sh', '**/*.bat', '**/Dockerfile*', '**/docker-compose*', '**/.github/**', '**/package.json', '**/*.yml', '**/*.yaml', '**/*.config.*'],
  },
  {
    id: 'writer',
    name: 'Redator Técnico',
    icon: '📝',
    color: '#94a3b8',
    modelHint: 'fast',
    responsibilities: ['Escreve documentação, READMEs e guias', 'Explica o que foi feito em linguagem clara'],
    scope: DOCS,
  },
]

// Hub Escolar: academic specialists. They work with hub_* tools and write study notes as Markdown.
const STUDY_NOTES = ['**/*.md', '**/*.txt']
ROLES.push(
  { id: 'academic', name: 'Agente Acadêmico', icon: '🎓', color: '#22d3ee', modelHint: 'strong', scope: STUDY_NOTES, responsibilities: ['Supervisiona a vida acadêmica do estudante', 'Acompanha disciplinas, notas e frequência', 'Organiza atividades e identifica pendências', 'Coordena os outros agentes acadêmicos'] },
  { id: 'messages', name: 'Agente de Mensagens', icon: '💬', color: '#34d399', modelHint: 'fast', scope: STUDY_NOTES, responsibilities: ['Analisa mensagens do WhatsApp e do Teams', 'Localiza comunicados e mensagens de professores', 'Extrai tarefas, provas e prazos das conversas'] },
  { id: 'studies', name: 'Agente de Estudos', icon: '📚', color: '#a78bfa', modelHint: 'strong', scope: STUDY_NOTES, responsibilities: ['Organiza materiais por disciplina', 'Produz resumos e explica conteúdos', 'Cria exercícios e revisões para provas'] },
  { id: 'programming', name: 'Agente de Programação', icon: '💻', color: '#60a5fa', modelHint: 'code', scope: STUDY_NOTES, responsibilities: ['Trabalha com os repositórios do GitHub', 'Analisa e explica códigos', 'Ajuda a desenvolver projetos e corrigir erros', 'Propõe issues e alterações (sempre com aprovação)'] },
  { id: 'deadlines', name: 'Agente de Prazos', icon: '⏰', color: '#f59e0b', modelHint: 'fast', scope: STUDY_NOTES, responsibilities: ['Monitora datas de provas e entregas', 'Detecta atividades atrasadas', 'Organiza compromissos da semana'] },
  { id: 'research', name: 'Agente de Pesquisa', icon: '🔎', color: '#f472b6', modelHint: 'strong', scope: STUDY_NOTES, responsibilities: ['Pesquisa conteúdos e analisa documentos', 'Compara informações e aponta contradições', 'Reúne fontes confiáveis'] },
)

// Infrastructure specialists: they act through the infra_* tools (real machine/servers) and
// write only infrastructure-as-code, configs, scripts and runbooks in the project.
const INFRA_FILES = [
  ...DOCS, '**/Dockerfile*', '**/docker-compose*', '**/compose*.yml', '**/compose*.yaml', '**/*.yml', '**/*.yaml', '**/*.tf', '**/*.tfvars', '**/*.hcl',
  '**/*.conf', '**/nginx/**', '**/Caddyfile', '**/*.service', '**/*.timer', '**/*.sh', '**/*.ps1', '**/*.toml', '**/*.ini', '**/.github/**',
  '**/ansible/**', '**/k8s/**', '**/helm/**', '**/charts/**', '**/infra/**', '**/deploy/**', '**/scripts/**', '**/.env.example', '**/ecosystem.config.*',
]
const RUNBOOK = 'Segue os runbooks da skill "infraestrutura" (skill_read) e verifica cada mudança com um check real'
ROLES.push(
  { id: 'infra-lead', name: 'Arquiteto de Infraestrutura', icon: '🏗️', color: '#0ea5e9', modelHint: 'strong', scope: INFRA_FILES, responsibilities: ['Analisa requisitos e o ambiente real (infra_inventory, infra_servers) antes de decidir', 'Escolhe a arquitetura (VPS, containers, cloud, alta disponibilidade) considerando custo, RPO e RTO', 'Distribui o trabalho entre os especialistas e consolida o resultado', 'Só declara pronto depois de verificar disponibilidade com infra_diagnose', RUNBOOK] },
  { id: 'linux-admin', name: 'Administrador Linux', icon: '🐧', color: '#facc15', modelHint: 'code', scope: INFRA_FILES, responsibilities: ['Administra Ubuntu, Debian, Rocky/Alma/RHEL, Proxmox e TrueNAS via infra_ssh', 'Usuários, permissões, systemd, discos, logs (journalctl) e atualizações', 'Diagnostica e recupera serviços indisponíveis', RUNBOOK] },
  { id: 'windows-admin', name: 'Administrador Windows', icon: '🪟', color: '#38bdf8', modelHint: 'code', scope: INFRA_FILES, responsibilities: ['Administra Windows e Windows Server com PowerShell', 'Serviços, tarefas agendadas, IIS, compartilhamentos, Visualizador de Eventos', 'Otimiza recursos desta máquina (infra_inventory)', RUNBOOK] },
  { id: 'network', name: 'Especialista em Redes', icon: '🌐', color: '#22d3ee', modelHint: 'strong', scope: INFRA_FILES, responsibilities: ['TCP/IP, DNS, DHCP, NAT, VLAN, VPN (WireGuard/Tailscale), proxy reverso e balanceamento', 'Diagnostica conectividade camada a camada (infra_diagnose, infra_ports)', 'Projeta acesso remoto seguro entre PC, celular e servidores em redes diferentes', RUNBOOK] },
  { id: 'cloud', name: 'Engenheiro Cloud', icon: '☁️', color: '#818cf8', modelHint: 'strong', scope: INFRA_FILES, responsibilities: ['AWS, Azure, Google Cloud, Cloudflare, Oracle, DigitalOcean e Hetzner', 'Dimensiona VMs, storage e bancos gerenciados e compara custos', 'Escreve IaC (Terraform/OpenTofu) e nunca aplica sem revisão do plano', RUNBOOK] },
  { id: 'infra-security', name: 'Segurança de Infraestrutura', icon: '🔐', color: '#ef4444', modelHint: 'strong', reviewer: true, scope: INFRA_FILES, responsibilities: ['Hardening, firewall, fail2ban, SSH só com chave, menor privilégio', 'Certificados, criptografia, gestão de credenciais (nunca em texto ou logs)', 'Audita portas expostas e configurações inseguras e propõe correções', 'Nunca desativa uma proteção para "facilitar" uma configuração', RUNBOOK] },
  { id: 'dba', name: 'Administrador de Banco de Dados', icon: '🛢️', color: '#f59e0b', modelHint: 'code', scope: INFRA_FILES, responsibilities: ['PostgreSQL, MySQL/MariaDB, MongoDB, Redis, SQLite e Supabase', 'Backups automáticos, replicação, PITR, migrações e otimização de consultas', 'Controle de conexões e alta disponibilidade', RUNBOOK] },
  { id: 'sre', name: 'Monitoramento e SRE', icon: '📈', color: '#10b981', modelHint: 'fast', reviewer: true, scope: INFRA_FILES, responsibilities: ['Cria monitores e alertas (infra_monitor) para CPU, RAM, disco, GPU, serviços e containers', 'Prometheus, Grafana, Loki, Zabbix, Netdata, OpenTelemetry e Alertmanager', 'Valida health checks e investiga incidentes pelos logs', RUNBOOK] },
  { id: 'dr', name: 'Recuperação de Desastres', icon: '🛟', color: '#a78bfa', modelHint: 'strong', scope: INFRA_FILES, responsibilities: ['Planos de backup e continuidade com RPO/RTO explícitos', 'Snapshots, backup incremental, restauração testada (infra_backup verify)', 'Failover, replicação e testes de recuperação', RUNBOOK] },
)

export const ROLE_MAP = new Map(ROLES.map(r => [r.id, r]))

export function getRole(id: string): RoleTemplate {
  return ROLE_MAP.get(id) || {
    id,
    name: id,
    icon: '🤖',
    color: '#94a3b8',
    modelHint: 'code',
    responsibilities: [],
    scope: ['**'],
  }
}

export function agentFromRole(roleId: string, id = roleId, model = 'auto'): AgentConfig {
  const role = getRole(roleId)
  return { id, name: role.name, roleId: role.id, model, scope: [...role.scope], enabled: true, color: role.color }
}

function preset(id: string, name: string, description: string, roles: string[]): Team {
  return { id, name, description, agents: roles.map(r => agentFromRole(r, `${id}-${r}`)), preset: true, createdAt: 0, updatedAt: 0 }
}

export const PRESET_TEAMS: Team[] = [
  preset('preset-solo', 'JARVIS Agente', 'Um agente só, direto ao ponto: lê, edita arquivos e roda comandos (modo agente do chat)', ['fullstack']),
  preset('preset-dev', 'Equipe de Desenvolvimento', 'Equipe completa de engenharia de software', ['architect', 'backend', 'frontend', 'uiux', 'ai', 'database', 'qa', 'reviewer']),
  preset('preset-sites', 'Equipe de Criação de Sites', 'Sites e landing pages modernos', ['architect', 'frontend', 'uiux', 'qa', 'reviewer']),
  preset('preset-apps', 'Equipe de Aplicativos', 'Aplicativos web/mobile com backend e banco', ['architect', 'backend', 'frontend', 'uiux', 'database', 'qa']),
  preset('preset-ai', 'Equipe de Engenharia de IA', 'Agentes, integrações com modelos e prompts', ['architect', 'ai', 'backend', 'qa', 'reviewer']),
  preset('preset-automation', 'Equipe de Automação', 'Scripts, automações e integrações', ['architect', 'devops', 'backend', 'qa']),
  preset('preset-fix', 'Equipe de Análise e Correção', 'Encontrar e corrigir problemas no código', ['architect', 'fullstack', 'qa', 'reviewer']),
  preset('preset-academic', 'Equipe Acadêmica', 'Hub Escolar: disciplinas, mensagens, estudos, GitHub, prazos e pesquisa', ['academic', 'messages', 'studies', 'programming', 'deadlines', 'research']),
  preset('preset-infra', 'Equipe de Infraestrutura', 'Servidores, redes, cloud, containers, segurança, bancos, monitoramento e recuperação de desastres', ['infra-lead', 'linux-admin', 'windows-admin', 'network', 'devops', 'cloud', 'infra-security', 'dba', 'sre', 'dr']),
]

/** Roles the planner may use when the team is chosen automatically. */
export const AUTO_TEAM_ROLES = ['architect', 'backend', 'frontend', 'uiux', 'ai', 'database', 'qa', 'reviewer', 'fullstack', 'devops', 'writer', 'infra-lead', 'linux-admin', 'windows-admin', 'network', 'cloud', 'infra-security', 'dba', 'sre', 'dr']
