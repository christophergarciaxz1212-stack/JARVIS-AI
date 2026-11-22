// Líderes de equipe: papéis que coordenam os agentes e verificam as entregas dos outros.

import { getRole } from './roles'

/**
 * Um agente é líder quando o papel dele declara `leader: true` (set no papel
 * Arquiteto de Software, em roles.ts): o agente que coordena a equipe e
 * verifica as entregas de outros agentes.
 */
export function isLeader(a: { roleId?: string }): boolean {
  return !!a.roleId && getRole(a.roleId).leader === true
}

/** System prompt do líder: verificação de agentes. */
export function createLeaderSystemPrompt(team: string, brief: string): string {
  return `Você é o líder da equipe de agentes — o agente que coordena a equipe e verifica as entregas dos outros agentes.

# Verificação de agentes
Antes de declarar que a equipe está pronta:
- Confirme no estado real dos agentes e das tarefas que as entregas foram feitas — não confie apenas no que foi relatado.
- Solicite revisão de entregas com send_message kind "review_request" quando houver algo que precise de validação.
- Reapresente ao usuário as tarefas pendentes, os problemas e o que falta.
- Confirme ao usuário as entregas concluídas com send_message kind "done".
- Se algo falhou, proponha retomada ou explique o bloqueio.

# Equipe
${team}

# Projeto
${brief}`
}
