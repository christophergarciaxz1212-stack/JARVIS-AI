/**
 * Níveis de autonomia do agente (seção "Permissões e autonomia").
 *
 * O agente precisa de liberdade para trabalhar de verdade, mas nem toda ação tem o
 * mesmo peso: ler um arquivo não é apagar uma pasta, e rodar `npm test` não é publicar
 * uma mensagem para outra pessoa. Este módulo classifica cada chamada de ferramenta em
 * um nível de risco e diz, para o modo escolhido, se ela pode seguir direto, se precisa
 * da aprovação do usuário na conversa, ou se está fora do modo.
 *
 * Puro de propósito (sem imports de Node): roda no servidor, no cliente e nos testes.
 *
 * Uma aprovação vale para UMA chamada. Autorizar uma exclusão agora não autoriza a
 * próxima — quem decide o escopo é o usuário, a cada vez.
 */

/** Modos de autonomia, do mais contido ao mais livre. */
export type PermissionMode = 'restrito' | 'supervisionado' | 'autonomo'

export const PERMISSION_MODES: PermissionMode[] = ['restrito', 'supervisionado', 'autonomo']

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'supervisionado'

export const PERMISSION_LABELS: Record<PermissionMode, { name: string; hint: string }> = {
  restrito: { name: 'Restrito', hint: 'Só lê e analisa. Não escreve arquivos nem roda comandos.' },
  supervisionado: { name: 'Supervisionado', hint: 'Pede sua aprovação antes de escrever arquivos, rodar comandos e agir fora do PC.' },
  autonomo: { name: 'Autônomo', hint: 'Escreve e roda comandos sozinho. Só pede aprovação para o que é destrutivo ou sai do PC.' },
}

/**
 * Peso de uma chamada de ferramenta.
 * - `leitura`: observa o projeto, não muda nada.
 * - `coordenacao`: fala com outro agente ou com o usuário, encerra a tarefa.
 * - `escrita`: cria ou altera arquivo do projeto.
 * - `comando`: executa processo no PC (build, teste, instalação).
 * - `destrutivo`: apaga, sobrescreve fora do pedido ou reescreve histórico do Git.
 * - `externo`: sai do computador — envia mensagem, publica, cria issue/commit, MCP remoto.
 */
export type ToolRisk = 'leitura' | 'coordenacao' | 'escrita' | 'comando' | 'destrutivo' | 'externo'

export const RISK_LABELS: Record<ToolRisk, string> = {
  leitura: 'leitura',
  coordenacao: 'coordenação',
  escrita: 'escrita de arquivo',
  comando: 'comando no PC',
  destrutivo: 'operação destrutiva',
  externo: 'ação fora do computador',
}

/** O que o modo permite fazer sem perguntar. */
const FREE_BY_MODE: Record<PermissionMode, ToolRisk[]> = {
  restrito: ['leitura', 'coordenacao'],
  supervisionado: ['leitura', 'coordenacao'],
  autonomo: ['leitura', 'coordenacao', 'escrita', 'comando'],
}

/** O que o modo não faz nem com aprovação (o modo inteiro é de consulta). */
const BLOCKED_BY_MODE: Record<PermissionMode, ToolRisk[]> = {
  restrito: ['escrita', 'comando', 'destrutivo', 'externo'],
  supervisionado: [],
  autonomo: [],
}

// ─── Classificação por ferramenta ────────────────────────────────────────────

const READ_TOOLS = new Set([
  'list_dir', 'read_file', 'search',
  'skill_find', 'skill_read',
  'hub_search', 'hub_course', 'hub_tasks',
  'github_read', 'local_businesses', 'infra_report',
  'git_status', 'git_diff', 'git_log',
])

const COORDINATION_TOOLS = new Set([
  'send_message', 'delegate', 'request_scope', 'finish', 'skill_request',
])

const WRITE_TOOLS = new Set([
  'write_file', 'edit_file',
  'create_spreadsheet', 'create_report',
  'hub_add_task', 'hub_complete_task', 'hub_save_study',
])

/** Sai do computador: mensagem para terceiros, publicação, escrita em repositório remoto. */
const EXTERNAL_TOOLS = new Set([
  'hub_request_action', 'git_push',
])

/**
 * Comandos que apagam, sobrescrevem ou reescrevem histórico. Não são proibidos:
 * passam a exigir aprovação explícita do usuário na conversa.
 */
const DESTRUCTIVE_COMMAND = [
  /\bRemove-Item\b/i,
  /\brm\s+\S/i,
  /\brmdir\b/i,
  /\brd\s+\/s/i,
  /\bdel\s+\S/i,
  /\berase\s+\S/i,
  /\bgit\s+(push|rm|reset\s+--hard|clean|checkout\s+--|rebase)\b/i,
  /\breg\s+(add|delete)\b/i,
  /\bSet-ItemProperty\b.*HK(LM|CU)/i,
  /\bnpm\s+(uninstall|remove|prune)\b/i,
  /\b(Stop-Process|taskkill)\b/i,
  /\bDrop\s+(table|database)\b/i,
]

/** Instala software ou baixa e executa código: sai do computador e muda o ambiente. */
const EXTERNAL_COMMAND = [
  /\bInvoke-WebRequest\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bwinget\b/i,
  /\bchoco\b/i,
  /\bnpm\s+(i|install|publish)\b/i,
  /\b(pip|pip3|uv)\s+install\b/i,
]

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND.some(p => p.test(command))
}

export function isExternalCommand(command: string): boolean {
  return EXTERNAL_COMMAND.some(p => p.test(command))
}

/**
 * Classifica uma chamada de ferramenta. `args` importa: `run_command` pode ser um
 * `npm test` inofensivo ou um `Remove-Item -Recurse`, e `skill_use` pode ser um script
 * local ou um MCP remoto.
 */
export function classifyTool(tool: string, args: Record<string, unknown> = {}): ToolRisk {
  if (tool === 'run_command') {
    const command = String(args.command ?? '')
    if (isDestructiveCommand(command)) return 'destrutivo'
    if (isExternalCommand(command)) return 'externo'
    return 'comando'
  }
  // Uma skill/MCP remota age fora do PC; uma local é só um comando.
  if (tool === 'skill_use') return args.remote === true ? 'externo' : 'comando'

  if (EXTERNAL_TOOLS.has(tool)) return 'externo'
  if (WRITE_TOOLS.has(tool)) return 'escrita'
  if (COORDINATION_TOOLS.has(tool)) return 'coordenacao'
  if (READ_TOOLS.has(tool)) return 'leitura'

  // Ferramenta desconhecida (instalada depois, vinda de plugin): trate como escrita,
  // o que no modo supervisionado passa pela aprovação do usuário.
  return 'escrita'
}

export type Decision =
  /** Pode executar agora. */
  | { allow: true; risk: ToolRisk }
  /** Precisa da aprovação do usuário nesta conversa. */
  | { allow: false; needsApproval: true; risk: ToolRisk; reason: string }
  /** O modo atual não faz isso, nem com aprovação. */
  | { allow: false; needsApproval: false; risk: ToolRisk; reason: string }

/** Decide o destino de uma chamada no modo escolhido. */
export function decide(tool: string, args: Record<string, unknown>, mode: PermissionMode): Decision {
  const risk = classifyTool(tool, args)
  if (FREE_BY_MODE[mode].includes(risk)) return { allow: true, risk }
  if (BLOCKED_BY_MODE[mode].includes(risk)) {
    return {
      allow: false,
      needsApproval: false,
      risk,
      reason: `O modo Restrito só permite leitura e análise — ${RISK_LABELS[risk]} não é executada. Peça ao usuário para mudar para Supervisionado ou Autônomo.`,
    }
  }
  return {
    allow: false,
    needsApproval: true,
    risk,
    reason: `${RISK_LABELS[risk]} precisa da aprovação do usuário no modo ${PERMISSION_LABELS[mode].name}.`,
  }
}

/** Frase curta, em português, do que está sendo pedido — é o que o usuário lê no chat. */
export function describeRequest(tool: string, args: Record<string, unknown> = {}): string {
  const path = typeof args.path === 'string' ? args.path : ''
  switch (tool) {
    case 'run_command': return `Executar: ${String(args.command ?? '')}`
    case 'write_file': return `Criar ou substituir ${path}`
    case 'edit_file': return `Editar ${path}`
    case 'create_spreadsheet': return `Gerar a planilha ${String(args.name ?? '')}`
    case 'create_report': return `Gerar o relatório ${String(args.title ?? '')}`
    case 'hub_request_action': return `Ação externa (${String(args.type ?? '')})`
    case 'skill_use': return `Usar ${String(args.tool ?? '')} da extensão ${String(args.extension ?? '')}`
    case 'git_push': return 'Enviar commits para o repositório remoto'
    default: return `${tool}${path ? ` em ${path}` : ''}`
  }
}
